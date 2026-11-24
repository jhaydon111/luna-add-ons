// Good Better Best: DOM wiring. Connects to LUNA, follows the focused session, and draws a channel
// strip per track: the tier in a drop-down on top, the chain, three macro knobs stacked down the
// strip, then gain-reduction meters, the fader and the level meter. Engine work lives in logic.js.

const $ = (id) => document.getElementById(id);
const DRAG_PX = 160;          // a full knob turn over this many pixels of vertical drag
let luna;
let session;
let releases = [];
const keep = (u) => releases.push(u);
const release = () => { for (const u of releases) u(); releases = []; };
let cardBindings = new Luna.Bindings();   // knob gestures, faders and readout listeners of the rendered strips

const busy = new Map();       // track id -> tier key being applied
const notes = new Map();      // track id -> failure text from the last apply
const lockedNote = new Map(); // track id -> tier key whose 'needs Spark' note is showing
const shoot = new Map();      // track id -> blind test { order, playing, switching, heard, revealed }
// One chain edit per track at a time: overlapping tier swaps on a track left LUNA unable to load
// plug-ins until restart (2026-11-23), so every edit from this page queues behind the last.
const locks = new Map();
function exclusive(track, fn) {
  const next = (locks.get(track.id) ?? Promise.resolve()).catch(() => {}).then(fn);
  locks.set(track.id, next);
  return next;
}
let live = [];                // things the frame loop paints: { paint(playing) }
let renderQueued = false;
const schedule = () => {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; void cardBindings.whenIdle(render); });   // never mid-drag
};

async function openSpark() {
  if (await luna.gui.available().catch(() => false)) await luna.gui.openUrl(AddOnLogic.SPARK_URL);
  else window.open(AddOnLogic.SPARK_URL, '_blank');
}

function renderBanner(lockedLabels) {
  const labels = [...new Set(lockedLabels)];
  $('banner').hidden = labels.length === 0;
  if (labels.length) $('banner-text').textContent = `${labels.join(' and ')} ${labels.length > 1 ? 'use' : 'uses'} UAD Spark plug-ins. Hear them on your own tracks with Spark.`;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const fail = (track) => (e) => { notes.set(track.id, e.message ?? String(e)); schedule(); };

// ---- frame loop ---------------------------------------------------------------------------
// Meters push about 30 times a second while LUNA plays. One animation-frame loop reads them and
// moves bars by transform only (docs/DRAWING.md); stopped, everything falls to rest.
function frame() {
  const playing = session?.transport.playing.value === true && !document.hidden;
  for (const l of live) l.paint(playing);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** A value that jumps up and falls back gently, painted only when it moved. */
function follower(read, draw, fall = 0.035) {
  let shown = -1;
  return {
    paint(playing) {
      const target = playing ? Math.min(1, Math.max(0, read())) : 0;
      const next = shown < 0 ? target : target >= shown ? target : Math.max(target, shown - fall);
      if (Math.abs(next - shown) < 0.004) return;
      shown = next;
      draw(next);
    },
  };
}

// ---- knob ---------------------------------------------------------------------------------
// A 270° arc from 7:30 to 4:30: the track behind, the value arc in the tier's colour, a pointer
// dot, and an inner ring for what the knob is doing while the song plays.
const ARC = 270;
function arcPath(r, from, to) {
  const pt = (deg) => {
    const a = ((deg + 135) * Math.PI) / 180;
    return [32 + r * Math.cos(a), 32 + r * Math.sin(a)];
  };
  const [x0, y0] = pt(from);
  const [x1, y1] = pt(to);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

function paintKnob(knob, macro, v) {
  knob.querySelector('.val').setAttribute('d', arcPath(24, 0, Math.max(0.5, v * ARC)));
  const a = ((v * ARC + 135) * Math.PI) / 180;
  const dot = knob.querySelector('.dot');
  dot.setAttribute('cx', 32 + 24 * Math.cos(a));
  dot.setAttribute('cy', 32 + 24 * Math.sin(a));
  knob.parentNode.querySelector('.word').textContent = AddOnLogic.macroWord(macro, v);
  knob.querySelector('.pct').textContent = `${Math.round(v * 100)}`;
  knob.setAttribute('aria-valuenow', String(Math.round(v * 100)));
}

// The inner ring: Squeeze shows gain reduction, Space the reverb return, the others track level.
function liveSource(track, tier, macro) {
  if (macro.key === 'squeeze') {
    const grs = AddOnLogic.grMeters(session, track);
    for (const g of grs) cardBindings.add(g.meter.onChange(() => {}));
    return { kind: 'gr', read: () => AddOnLogic.squeezeAmount(grs) };
  }
  if (macro.key === 'space') {
    const bus = tier.verb && AddOnLogic.verbBuses(session)[tier.verb.plugin];
    if (!bus) return undefined;
    cardBindings.add(bus.meter.onChange(() => {}));
    return { kind: 'level', read: () => bus.meter.max };
  }
  return { kind: 'level', read: () => track.meter.max };   // the strip's level meter keeps it subscribed
}

function makeKnob(track, tier, macro, chips) {
  const row = el('div', 'krow');
  const knob = el('div', 'knob');
  // Capture phase: runs before bindGesture's pointerdown touches the controls, and the socket
  // keeps the order, so LUNA sees the narrowed selection before the touch.
  knob.addEventListener('pointerdown', () => { void AddOnLogic.focusTrack(session, track); }, { capture: true });
  knob.tabIndex = 0;
  knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-label', macro.label);
  const ringD = arcPath(16, 0, ARC);
  knob.innerHTML = `<svg viewBox="0 0 64 64"><path class="trk" d="${arcPath(24, 0, ARC)}"/><path class="val"/><path class="ringtrk" d="${ringD}"/><path class="ring" pathLength="75" d="${ringD}" style="stroke-dasharray:0 100"/><circle class="dot" r="4"/><text class="pct" x="32" y="37"></text></svg>`;
  const text = el('div', 'ktext');
  text.append(el('div', 'label', macro.label), el('div', 'word'));
  row.append(knob, text);

  const src = liveSource(track, tier, macro);
  if (src) {
    const ring = knob.querySelector('.ring');
    ring.classList.add(src.kind);
    live.push(follower(src.read, (v) => { ring.style.strokeDasharray = `${(v * 75).toFixed(2)} 100`; }));
    row.title = src.kind === 'gr' ? 'Inner ring: gain reduction while playing' : macro.key === 'space' ? 'Inner ring: reverb return while playing' : 'Inner ring: track level while playing';
  } else knob.querySelector('.ringtrk').remove();

  // The chips this macro drives light up while it is hovered or dragged.
  const plugins = new Set((tier.macros[macro.key] ?? []).map((m) => (m.send ? 'send' : m.plugin)));
  const light = (on) => { for (const c of chips) c.classList.toggle('lit', on && plugins.has(c.dataset.plugin)); };
  row.onpointerenter = () => light(true);
  row.onpointerleave = () => { if (!gesture.active) light(false); };

  let v = AddOnLogic.macroValue(session, track, macro.key);
  paintKnob(knob, macro, v);

  // Follow LUNA (undo, the plug-in window) except mid-drag.
  for (const c of AddOnLogic.macroControls(session, track, macro.key).slice(0, 1)) {
    cardBindings.on(c.normalized, () => {
      if (gesture.active) return;
      v = AddOnLogic.macroValue(session, track, macro.key);
      paintKnob(knob, macro, v);
    });
  }

  // Drag: touch every control the macro moves, write once per frame, release on pointer up.
  let startY = 0;
  let startV = v;
  let queued = false;
  const gesture = Luna.bindGesture(knob, AddOnLogic.macroControls(session, track, macro.key), {
    capture: true,
    bindings: cardBindings,
    onBegin: (e) => { startY = e.clientY; startV = v; knob.classList.add('active'); light(true); },
    onEnd: () => { knob.classList.remove('active'); light(false); },
  });
  knob.onpointermove = (e) => {
    if (!gesture.active) return;
    v = Math.min(1, Math.max(0, startV + ((startY - e.clientY) / DRAG_PX) * (e.shiftKey ? 0.25 : 1)));
    paintKnob(knob, macro, v);
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (gesture.active) void AddOnLogic.writeMacro(session, track, macro.key, v);
    });
  };
  const oneShot = (next) => {
    v = Math.min(1, Math.max(0, next));
    paintKnob(knob, macro, v);
    exclusive(track, () => AddOnLogic.setMacro(session, track, macro.key, v)).catch(fail(track));
  };
  knob.ondblclick = () => oneShot(AddOnLogic.DEFAULT_MACRO);
  knob.onkeydown = (e) => {
    const step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); oneShot(v + step); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); oneShot(v - step); }
  };
  return row;
}

// ---- EQ graphic ---------------------------------------------------------------------------
// The LUNA Channel EQ's curve, drawn from its band controls: drag a band's dot for frequency and
// gain (Shift-drag for Q; cuts move in frequency only), double-click the graph to open LUNA
// Channel. It redraws when the bands change in LUNA too.
const EQW = 140, EQH = 66, FMIN = 20, FMAX = 20000, DBR = 15;
const LOGR = Math.log10(FMAX / FMIN);
const xOf = (f) => (Math.log10(Math.min(FMAX, Math.max(FMIN, f)) / FMIN) / LOGR) * EQW;
const fOf = (x) => FMIN * 10 ** ((Math.min(EQW, Math.max(0, x)) / EQW) * LOGR);
const yOf = (db) => EQH / 2 - (Math.max(-DBR, Math.min(DBR, db)) / DBR) * (EQH / 2 - 4);
const FREQS = Array.from({ length: 110 }, (_, i) => FMIN * 10 ** ((i / 109) * LOGR));
const fmtHz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz` : `${Math.round(f)} Hz`);

function eqGraph(track, slot) {
  const box = el('div', 'eq');
  const svgNS = 'http://www.w3.org/2000/svg';
  const grid = [100, 1000, 10000].map((f) => `<line class="g" x1="${xOf(f)}" x2="${xOf(f)}" y1="0" y2="${EQH}"/>`).join('')
    + [6, -6].map((d) => `<line class="g" x1="0" x2="${EQW}" y1="${yOf(d)}" y2="${yOf(d)}"/>`).join('');
  box.innerHTML = `<svg viewBox="0 0 ${EQW} ${EQH}" preserveAspectRatio="none">${grid}<line class="zero" x1="0" x2="${EQW}" y1="${EQH / 2}" y2="${EQH / 2}"/><path class="fill"/><path class="curve"/><g class="dots"></g></svg><span class="eqlabel">EQ</span><span class="eqtip"></span>`;
  const svg = box.firstChild;
  const fillP = svg.querySelector('.fill');
  const curveP = svg.querySelector('.curve');
  const dotsG = svg.querySelector('.dots');
  const tip = box.querySelector('.eqtip');
  let dragging = null;

  const describe = (b) => `B${b.band} ${AddOnLogic.EQ_TYPES[b.type]} ${fmtHz(b.freq)}${AddOnLogic.bandHasGain(b) ? ` ${b.gain > 0 ? '+' : ''}${b.gain.toFixed(1)} dB` : ''}${/Cut/.test(AddOnLogic.EQ_TYPES[b.type]) ? ` ${b.slope} dB/oct` : ` Q ${b.q.toFixed(2)}`}`;
  const draw = () => {
    const bands = AddOnLogic.eqBands(slot);
    const on = bands.filter((b) => b.on);
    const ys = AddOnLogic.eqResponse(on, FREQS).map(yOf);
    const pts = FREQS.map((f, i) => `${xOf(f).toFixed(1)},${ys[i].toFixed(1)}`);
    curveP.setAttribute('d', `M${pts.join('L')}`);
    fillP.setAttribute('d', `M0,${EQH / 2}L${pts.join('L')}L${EQW},${EQH / 2}Z`);
    if (dragging) return;   // keep the dragged dot's element alive
    dotsG.innerHTML = '';
    for (const b of on) {
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', 'band');
      const cx = xOf(b.freq), cy = AddOnLogic.bandHasGain(b) ? yOf(b.gain) : yOf(AddOnLogic.eqResponse([b], [b.freq])[0]);
      g.innerHTML = `<circle r="6.5" cx="${cx}" cy="${cy}"/><text x="${cx}" y="${cy + 2.6}">${b.band}</text>`;
      g.onpointerenter = () => { tip.textContent = describe(b); };
      g.onpointerleave = () => { if (!dragging) tip.textContent = ''; };
      bindBand(g, b);
      dotsG.append(g);
    }
  };

  // Drag a band: touch its controls for the whole gesture, write once per frame.
  function bindBand(g, b) {
    const ctl = b.controls;
    g.addEventListener('pointerdown', () => { void AddOnLogic.focusTrack(session, track); }, { capture: true });
    let start = null;
    let queued = false;
    let next = {};
    const gesture = Luna.bindGesture(g, [ctl.freq, ctl.gain, ctl.q].filter(Boolean), {
      capture: true,
      bindings: cardBindings,
      onBegin: (e) => { dragging = b.band; start = { x: e.clientX, y: e.clientY, freq: b.freq, gain: b.gain, q: b.q }; g.classList.add('active'); },
      onEnd: () => { dragging = null; g.classList.remove('active'); tip.textContent = ''; draw(); },
    });
    g.onpointermove = (e) => {
      if (!gesture.active || !start) return;
      const r = svg.getBoundingClientRect();
      const sx = EQW / r.width, sy = EQH / r.height;
      if (e.shiftKey) next = { q: Math.min(20, Math.max(0.1, start.q * 2 ** ((start.y - e.clientY) * sy / 12))) };
      else {
        next = { freq: Math.round(fOf(xOf(start.freq) + (e.clientX - start.x) * sx)) };
        if (AddOnLogic.bandHasGain(b)) next.gain = Math.round(Math.min(DBR, Math.max(-DBR, start.gain + (start.y - e.clientY) * sy * (DBR / (EQH / 2 - 4)))) * 10) / 10;
      }
      Object.assign(b, next);
      const c = g.querySelector('circle'), t = g.querySelector('text');
      const cx = xOf(b.freq), cy = AddOnLogic.bandHasGain(b) ? yOf(b.gain) : yOf(AddOnLogic.eqResponse([b], [b.freq])[0]);
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); t.setAttribute('x', cx); t.setAttribute('y', cy + 2.6);
      tip.textContent = describe(b);
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (!gesture.active) return;
        const w = [];
        if (next.freq !== undefined && ctl.freq.real.value !== b.freq) w.push(ctl.freq.real.set(b.freq));
        if (next.gain !== undefined && ctl.gain.real.value !== b.gain) w.push(ctl.gain.real.set(b.gain));
        if (next.q !== undefined && ctl.q.real.value !== b.q) w.push(ctl.q.real.set(Math.round(b.q * 100) / 100));
        Promise.all(w).catch(fail(track));
        draw();
      });
    };
  }

  // Redraw when any band changes in LUNA (one redraw per frame).
  let pending = false;
  const redraw = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; draw(); }); };
  for (const b of AddOnLogic.eqBands(slot)) for (const c of Object.values(b.controls)) if (c) cardBindings.on(c.real, redraw);
  svg.ondblclick = (e) => { if (e.target.closest('.band')) return; slot.openEditor().catch(fail(track)); };
  box.title = 'LUNA Channel EQ: drag a band, Shift-drag for Q, double-click to open LUNA Channel';
  draw();
  return box;
}

// ---- meters and fader ---------------------------------------------------------------------

/** A vertical bar: <i> slides by the unlit share and <u> back, so the gradient stays put. */
function bar(cls) {
  const b = el('div', `bar ${cls}`);
  b.innerHTML = '<i><u></u></i>';
  const [i, u] = [b.firstChild, b.firstChild.firstChild];
  const down = cls.includes('gr');   // gain reduction hangs from the top, like a console's
  return {
    el: b,
    draw(v) {
      const off = `${((1 - v) * 100).toFixed(1)}%`;
      i.style.transform = `translateY(${down ? '-' : ''}${off})`;
      u.style.transform = `translateY(${down ? '' : '-'}${off})`;
    },
  };
}

const SHORT = { uaudio_ua_1176: '1176', uaudio_ua_1176_rev_a: 'Rev A', uaudio_ua_1176ln_rev_e: 'Rev E', 'uaudio_teletronix_la-2a_tc': 'LA-2A', 'uaudio_teletronix_la-2a_silver': 'Silver', uaudio_la3a: 'LA-3A', uaudio_distressor: 'Dist' };

function faderSection(track, hasTier) {
  const sec = el('div', 'faderrow');
  // Gain reduction: one bar per compressor the Squeeze knob drives.
  if (hasTier) {
    const grs = AddOnLogic.grMeters(session, track);
    if (grs.length) {
      const box = el('div', 'grbox');
      box.title = 'Gain reduction, from each compressor’s own meter';
      const bars = el('div', 'grbars');
      for (const g of grs) {
        cardBindings.add(g.meter.onChange(() => {}));
        const col = el('div', 'grcol');
        const b = bar('gr');
        col.append(b.el, el('span', 'grname', SHORT[g.plugin] ?? ''));
        bars.append(col);
        live.push(follower(() => AddOnLogic.grAmount(g.plugin, g.meter.max), (v) => b.draw(v), 0.02));
      }
      box.append(el('span', 'grlabel', 'GR'), bars);
      sec.append(box);
    }
  }
  // Fader: the track's volume, one undo entry per drag, double-click for 0 dB.
  const fwrap = el('div', 'fwrap');
  const fader = el('input', 'fader');
  fader.type = 'range'; fader.min = '0'; fader.max = '1000'; fader.step = '1';
  Luna.bindRange(fader, track.gain, { bindings: cardBindings, onError: fail(track) });
  fwrap.append(fader);
  sec.append(fwrap);
  // Level meter, with a held peak line.
  const lv = bar('level');
  const peak = el('b', 'peak');
  lv.el.append(peak);
  let held = 0;
  let at = 0;
  cardBindings.add(track.meter.onChange(() => {}));
  live.push(follower(() => track.meter.max, (v) => {
    lv.draw(v);
    const now = performance.now();
    if (v >= held || now - at > 1500) { held = v; at = now; peak.style.transform = `translateY(${((1 - held) * 100).toFixed(1)}%)`; }
  }, 0.06));
  sec.append(lv.el);
  return sec;
}

function bottomRow(track) {
  const db = el('div', 'db');
  const renderDb = () => { db.textContent = track.gain.display.value ? `${track.gain.display.value} dB` : ''; };
  renderDb();
  cardBindings.on(track.gain.display, renderDb);
  const btns = el('div', 'ms');
  const mute = el('button', 'mute', 'M');
  const solo = el('button', 'solo', 'S');
  const soloC = track.controls.get('solo');
  const paint = () => { mute.classList.toggle('on', !!track.mute.on); solo.classList.toggle('on', !!soloC.on); };
  paint();
  cardBindings.on(track.mute.real, paint);
  cardBindings.on(soloC.real, paint);
  mute.onclick = () => track.mute.toggle().catch(fail(track));
  solo.onclick = () => soloC.toggle().catch(fail(track));
  btns.append(mute, solo);
  return [db, btns];
}

// ---- strip --------------------------------------------------------------------------------

function render() {
  if (!session) return;
  cardBindings.clear();
  live = [];
  const root = $('tracks');
  root.innerHTML = '';
  const lockedLabels = [];
  for (const track of session.visibleTracks) {
    const inst = AddOnLogic.instrumentOf(session, track);
    const access = AddOnLogic.access(luna.plugins, inst);
    for (const a of access) if (!a.unlocked) lockedLabels.push(a.label);
    const blind = shoot.get(track.id);
    root.append(blind ? blindStrip(track, inst, blind, access) : strip(track, inst, access));
  }
  renderBanner(lockedLabels);
}

function strip(track, inst, access) {
  const current = AddOnLogic.tierOf(session, track);
  const tier = AddOnLogic.tierOfInstrument(inst, current);
  const hasChain = AddOnLogic.chainSlots(session, track).length > 0;
  const off = AddOnLogic.bypassed(session, track);
  const isBusy = busy.has(track.id);

  const s = el('div', `strip ${current ?? 'none'}${off ? ' bypassed' : ''}`);
  const head = el('div', 'head');
  head.append(el('div', 'name', track.name.value));
  const sel = el('select', 'inst');
  sel.title = 'What is on this track';
  sel.innerHTML = '<option value="">Instrument…</option>' + AddOnLogic.INSTRUMENTS.map((i) => `<option value="${i.key}">${i.label}</option>`).join('');
  sel.value = inst ?? '';
  sel.disabled = isBusy;
  sel.onchange = () => changeInstrument(track, sel.value, current);
  head.append(sel);
  s.append(head);

  // The tier drop-down: Good / Better / Best / Off, locked ones marked.
  if (inst) {
    const tsel = el('select', `tiersel ${current ?? 'off'}`);
    tsel.innerHTML = access.map((a) => `<option value="${a.key}">${a.unlocked ? '' : '🔒 '}${a.label} · ${a.source === 'UAD Spark' ? 'Spark' : 'Explore'}</option>`).join('') + '<option value="off">Off</option>';
    tsel.value = busy.get(track.id) ?? current ?? 'off';
    tsel.disabled = isBusy;
    tsel.title = tier ? `${tier.source}: ${tier.chain.map((x) => x.name).join(' → ')}` : 'Pick a tier to build its chain';
    tsel.onchange = () => {
      const key = tsel.value;
      if (key === 'off') { if (hasChain) exclusive(track, () => AddOnLogic.removeTier(session, track)).catch(fail(track)); return; }
      const a = access.find((x) => x.key === key);
      if (a.unlocked) return apply(track, inst, key);
      lockedNote.set(track.id, key);
      schedule();
    };
    s.append(tsel);
  }

  // The chain, top to bottom, with the reverb send.
  const chips = [];
  if (tier && !isBusy) {
    const chain = el('div', 'chain');
    for (const x of [...tier.chain.filter((c) => c.plugin !== 'uaudio_luna_channel'), ...(tier.verb ? [{ plugin: 'send', name: tier.verb.name }] : [])]) {   // the EQ has its own graphic
      const c = el('span', `chip${x.plugin === 'send' ? ' verb' : ''}`, x.name);
      c.dataset.plugin = x.plugin;
      chips.push(c);
      chain.append(c);
    }
    s.append(chain);
    const eq = AddOnLogic.eqSlot(session, track);
    if (eq) s.append(eqGraph(track, eq));
    else {
      const add = el('button', 'addeq', '+ LUNA EQ');
      add.title = `Adds LUNA Channel with a ${inst} EQ after the chain; the rest stays as it is`;
      add.onclick = () => apply(track, inst, current);
      s.append(add);
    }
  }

  // Notes: locked tier, failures, building, hints, the Spark nudge.
  const note = el('div', 'note');
  const locked = access.find((x) => x.key === lockedNote.get(track.id) && !x.unlocked);
  if (locked) {
    note.classList.add('locked');
    note.append(el('span', '', `${locked.label} needs ${locked.missing.join(', ')}, part of UAD Spark.`));
    const go = el('button', 'spark small', 'Get with Spark');
    go.onclick = openSpark;
    note.append(go);
  } else if (isBusy) note.textContent = 'Building the chain…';
  else if (notes.get(track.id)) { note.textContent = notes.get(track.id); note.classList.add('warn'); }
  else if (!inst) note.textContent = 'Pick an instrument for tiers.';
  else if (!tier && hasChain) note.textContent = 'Part of a chain is here. Pick a tier to rebuild it.';
  if (note.childNodes.length) s.append(note);

  // Processing: the three macro knobs, stacked.
  const proc = el('div', 'proc');
  if (tier && !isBusy) for (const macro of AddOnLogic.macrosOf(inst)) proc.append(makeKnob(track, tier, macro, chips));
  else proc.classList.add('empty');
  s.append(proc);

  // A/B and Blind.
  const tools = el('div', 'tools');
  const ab = el('button', 'ab', hasChain && off ? 'Dry' : 'A/B');
  ab.title = 'Hear the track without the chain and the reverb, then back';
  ab.disabled = !hasChain || isBusy;
  ab.classList.toggle('on', hasChain && off);
  ab.onclick = () => exclusive(track, () => AddOnLogic.setTierIn(session, track, off)).catch(fail(track));
  const test = el('button', 'blindbtn', 'Blind');
  test.title = 'Hear the dry track and each tier you have as A, B, C… without knowing which is which, then pick';
  test.disabled = isBusy || !inst || !access.some((a) => a.unlocked);
  test.onclick = () => startBlind(track, inst);
  tools.append(ab, test);
  s.append(tools);

  s.append(faderSection(track, !!tier && !isBusy), ...bottomRow(track));
  return s;
}

// ---- blind shootout -----------------------------------------------------------------------
// The dry track and every unlocked tier, dealt to letters at random. The strip hides the tier,
// the chain and the knobs while you listen; macro positions carry over between tiers, so it
// compares the gear, not the settings. Keep a letter to see which was which.

function startBlind(track, inst) {
  const order = AddOnLogic.dealShootout(AddOnLogic.shootoutContenders(luna.plugins, inst));
  shoot.set(track.id, { order, playing: null, switching: null, heard: new Set(), revealed: false });
  lockedNote.delete(track.id);
  notes.delete(track.id);
  schedule();
}

async function listen(track, inst, b, d) {
  if (b.switching) return;          // one switch at a time, even if a click lands before the re-render
  b.switching = d.letter;
  schedule();
  try {
    const { failures } = await exclusive(track, () => AddOnLogic.playContender(session, luna.plugins, track, inst, d.key));
    const bad = Object.keys(failures);
    if (bad.length) notes.set(track.id, `Could not load: ${bad.join(', ')}`);
  } catch (e) {
    notes.set(track.id, e.message ?? String(e));
  } finally {
    b.switching = null;
    b.playing = d.letter;
    b.heard.add(d.letter);
    await bindTracks();
  }
}

function verdict(inst, key) {
  if (key === 'dry') return 'You picked the dry track. The chain stays bypassed; A/B brings it back.';
  const t = AddOnLogic.tierOfInstrument(inst, key);
  return `You picked ${t.label}, from ${t.source}. It stays on.`;
}

function blindStrip(track, inst, b, access) {
  const s = el('div', 'strip blind');
  const head = el('div', 'head');
  head.append(el('div', 'name', track.name.value), el('div', 'blind-tag', b.revealed ? 'Results' : 'Blind test'));
  s.append(head);
  const body = el('div', 'blindbody');
  if (!b.revealed) {
    const letters = el('div', 'letters');
    for (const d of b.order) {
      const btn = el('button', 'letter', d.letter);
      btn.classList.toggle('on', b.playing === d.letter && !b.switching);
      btn.classList.toggle('heard', b.heard.has(d.letter));
      btn.classList.toggle('busy', b.switching === d.letter);
      btn.disabled = !!b.switching;
      btn.onclick = () => listen(track, inst, b, d);
      letters.append(btn);
    }
    body.append(letters);
    const playing = session.transport.playing.value === true;
    body.append(el('div', 'hint', b.switching ? 'Switching…'
      : !b.playing ? `Click a letter to hear it${playing ? '' : ' (space plays)'}. One is the dry track.`
      : b.heard.size < b.order.length ? `On ${b.playing}. Try the others.` : 'Heard them all. Keep your favourite.'));
    const keepBtn = el('button', 'keep', b.playing ? `Keep ${b.playing}` : 'Keep');
    keepBtn.disabled = !b.playing || !!b.switching;
    keepBtn.onclick = () => { b.revealed = true; schedule(); };
    body.append(keepBtn);
  } else {
    for (const d of b.order) {
      const t = d.key === 'dry' ? null : AddOnLogic.tierOfInstrument(inst, d.key);
      const row = el('div', `rrow ${d.key}${d.letter === b.playing ? ' picked' : ''}`);
      row.append(el('b', '', d.letter), el('span', 'rtier', t ? t.label : 'Dry'));
      if (d.letter === b.playing) row.append(el('span', 'star', '★'));
      row.title = t ? t.chain.map((x) => x.name).join(' → ') : 'No chain';
      body.append(row);
    }
    const pick = b.order.find((d) => d.letter === b.playing);
    const lockedLabels = access.filter((a) => !a.unlocked).map((a) => a.label);
    body.append(el('div', 'hint', verdict(inst, pick.key) + (lockedLabels.length ? ` ${lockedLabels.join(' and ')} join the test with Spark.` : '')));
    if (lockedLabels.length) { const go = el('button', 'spark small', 'Get with Spark'); go.onclick = openSpark; body.append(go); }
  }
  const close = el('button', 'small', b.revealed ? 'Done' : 'Stop test');
  close.onclick = () => { shoot.delete(track.id); schedule(); };
  body.append(close);
  if (notes.get(track.id)) body.append(el('div', 'note warn', notes.get(track.id)));
  s.append(body);
  s.append(faderSection(track, false), ...bottomRow(track));
  return s;
}

// ---- actions ------------------------------------------------------------------------------

// A new instrument rebuilds the same tier for it when that tier is unlocked; otherwise the old
// chain comes off, since it was built for the other instrument.
async function changeInstrument(track, inst, currentTier) {
  if (!inst) return;
  await AddOnLogic.setInstrument(session, track, inst).catch(fail(track));
  if (!currentTier && !AddOnLogic.chainSlots(session, track).length) return schedule();
  const ok = AddOnLogic.access(luna.plugins, inst).find((a) => a.key === currentTier)?.unlocked;
  if (ok) return apply(track, inst, currentTier);
  await exclusive(track, () => AddOnLogic.removeTier(session, track)).catch(fail(track));
  schedule();
}

async function apply(track, inst, key) {
  busy.set(track.id, key);
  notes.delete(track.id);
  lockedNote.delete(track.id);
  schedule();
  try {
    const { failures } = await exclusive(track, () => AddOnLogic.applyTier(session, luna.plugins, track, inst, key));
    const bad = Object.entries(failures);
    if (bad.length) notes.set(track.id, `Could not load: ${bad.map(([n, m]) => `${n} (${m})`).join(', ')}`);
  } catch (e) {
    notes.set(track.id, e.message ?? String(e));
  } finally {
    busy.delete(track.id);
    await bindTracks();
  }
}

// Re-render on anything that changes a strip's structure: tracks, inserts, bypass, sends.
async function bindTracks() {
  release();
  await Promise.all(session.visibleTracks.map((t) => Promise.all([t.loadStrip(), t.effects.load()]).then(() => AddOnLogic.loadMacroControls(session, t))));
  keep(session.tracks.onChange(() => { void bindTracks(); }));
  keep(session.buses.onChange(schedule));
  keep(session.transport.playing.onChange(schedule));   // the blind-test hint follows play/stop
  keep(session.storage.context('com.jhaydon.good_better_best.tracks').records.onChange(schedule));
  for (const track of session.visibleTracks) {
    keep(track.name.onChange(schedule));
    keep(track.effects.onChange(() => { void bindTracks(); }));
    for (const slot of track.effectSlots) {
      keep(slot.pluginId.onChange(() => { void bindTracks(); }));
      keep(slot.in.onChange(schedule));
    }
  }
  schedule();
}

async function bindSession() {
  release();
  session = luna.sessions.current();
  if (!session) {
    $('status').textContent = 'Open a session to start';
    $('tracks').innerHTML = '';
    return;
  }
  await session.ready();
  $('status').textContent = session.name.value ?? '';
  await AddOnLogic.loadOwnership(session);
  await bindTracks();
}

async function connect() {
  for (;;) {
    try { luna = await Luna.connect(); break; }
    catch (e) {
      $('status').textContent = e instanceof Luna.NotRunning ? 'Waiting for LUNA…' : e.message;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  Luna.bindShortcuts(luna);
  $('spark').onclick = openSpark;
  await luna.plugins.load();
  luna.plugins.onChange(schedule);   // a new Spark licence unlocks tiers without reopening
  await luna.sessions.ready();
  luna.sessions.focused.onChange(bindSession);
  luna.sessions.items.onChange(bindSession);
  luna.status.onChange(() => { if (luna.status.value === 'disconnected') $('status').textContent = 'Reconnecting…'; });
  await bindSession();
}

connect();
