// Good Better Best: DOM wiring. Connects to LUNA, follows the focused session, and renders a card
// per track: instrument, tier switch, A/B, three macro knobs and the chain as chips that light up
// for the plug-ins a knob is moving. Engine work lives in logic.js.

const $ = (id) => document.getElementById(id);
const DRAG_PX = 160;          // a full knob turn over this many pixels of vertical drag
let luna;
let session;
let releases = [];
const keep = (u) => releases.push(u);
const release = () => { for (const u of releases) u(); releases = []; };
let cardBindings = new Luna.Bindings();   // knob gestures and readout listeners of the rendered cards

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
let rings = [];               // live rings of the rendered knobs: { el, read, shown }
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

// ---- knob ---------------------------------------------------------------------------------
// A 270° arc from 7:30 to 4:30: the track behind, the value arc in the tier's colour, a pointer dot.
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
  knob.querySelector('.word').textContent = AddOnLogic.macroWord(macro, v);
  knob.querySelector('.pct').textContent = `${Math.round(v * 100)}`;
  knob.setAttribute('aria-valuenow', String(Math.round(v * 100)));
}

// ---- live rings -----------------------------------------------------------------------------
// An inner ring under each knob shows what it is doing while the song plays: Squeeze the gain
// reduction of its compressors, Space the reverb return, the others the track's output level.
// One animation-frame loop reads the meters and repaints only rings that moved (meters push about
// 30 times a second; docs/DRAWING.md). Stopped, the rings fall to rest.
function paintRings() {
  const playing = session?.transport.playing.value === true && !document.hidden;
  for (const r of rings) {
    const target = playing ? Math.min(1, Math.max(0, r.read())) : 0;
    const next = target >= r.shown ? target : Math.max(target, r.shown - 0.04);   // fall back gently
    if (Math.abs(next - r.shown) < 0.005) continue;
    r.shown = next;
    r.el.style.strokeDasharray = `${(next * 75).toFixed(2)} 100`;
    r.el.parentNode.parentNode.classList.toggle('working', next > 0.05);
  }
  requestAnimationFrame(paintRings);
}
requestAnimationFrame(paintRings);

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
  cardBindings.add(track.meter.onChange(() => {}));
  return { kind: 'level', read: () => track.meter.max };
}

function makeKnob(track, tier, macro, chips) {
  const knob = el('div', 'knob');
  // Capture phase: runs before bindGesture's pointerdown touches the controls, and the socket
  // keeps the order, so LUNA sees the narrowed selection before the touch.
  knob.addEventListener('pointerdown', () => { void AddOnLogic.focusTrack(session, track); }, { capture: true });
  knob.tabIndex = 0;
  knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-label', macro.label);
  const ringD = arcPath(16, 0, ARC);
  knob.innerHTML = `<svg viewBox="0 0 64 64"><path class="trk" d="${arcPath(24, 0, ARC)}"/><path class="val"/><path class="ringtrk" d="${ringD}"/><path class="ring" pathLength="75" d="${ringD}" style="stroke-dasharray:0 100"/><circle class="dot" r="4"/><text class="pct" x="32" y="37"></text></svg><div class="label"></div><div class="word"></div>`;
  const live = liveSource(track, tier, macro);
  if (live) {
    const ring = knob.querySelector('.ring');
    ring.classList.add(live.kind);
    rings.push({ el: ring, read: live.read, shown: 0 });
    knob.title = live.kind === 'gr' ? 'Inner ring: gain reduction while playing' : macro.key === 'space' ? 'Inner ring: reverb return while playing' : 'Inner ring: track level while playing';
  } else knob.querySelector('.ringtrk').remove();
  knob.querySelector('.label').textContent = macro.label;

  // The chips this macro drives light up while it is hovered or dragged.
  const plugins = new Set((tier.macros[macro.key] ?? []).map((m) => (m.send ? 'send' : m.plugin)));
  const light = (on) => { for (const c of chips) c.classList.toggle('lit', on && plugins.has(c.dataset.plugin)); };
  knob.onpointerenter = () => light(true);
  knob.onpointerleave = () => { if (!gesture.active) light(false); };

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
  let frame = false;
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
    if (frame) return;
    frame = true;
    requestAnimationFrame(() => {
      frame = false;
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
  return knob;
}

// ---- card ---------------------------------------------------------------------------------

function render() {
  if (!session) return;
  cardBindings.clear();
  rings = [];
  const root = $('tracks');
  root.innerHTML = '';
  const lockedLabels = [];
  for (const track of session.visibleTracks) {
    const inst = AddOnLogic.instrumentOf(session, track);
    const access = AddOnLogic.access(luna.plugins, inst);
    for (const a of access) if (!a.unlocked) lockedLabels.push(a.label);
    const current = AddOnLogic.tierOf(session, track);
    const tier = AddOnLogic.tierOfInstrument(inst, current);
    const hasChain = AddOnLogic.chainSlots(session, track).length > 0;
    const off = AddOnLogic.bypassed(session, track);
    const isBusy = busy.has(track.id);
    const blind = shoot.get(track.id);
    if (blind) { root.append(blindCard(track, inst, blind, access)); continue; }

    const card = el('div', `card ${current ?? 'none'}${off ? ' bypassed' : ''}`);
    const top = el('div', 'top');
    top.append(el('span', 'name', track.name.value));

    const sel = el('select', 'inst');
    sel.title = 'What is on this track';
    sel.innerHTML = '<option value="">Instrument…</option>' + AddOnLogic.INSTRUMENTS.map((i) => `<option value="${i.key}">${i.label}</option>`).join('');
    sel.value = inst ?? '';
    sel.disabled = isBusy;
    sel.onchange = () => changeInstrument(track, sel.value, current);
    top.append(sel);

    const seg = el('div', 'seg');
    for (const a of access) {
      const b = el('button', `tier ${a.key}`, a.unlocked ? a.label : `🔒 ${a.label}`);
      b.classList.toggle('on', current === a.key);
      b.classList.toggle('locked', !a.unlocked);
      b.classList.toggle('busy', busy.get(track.id) === a.key);
      const t = AddOnLogic.tierOfInstrument(inst, a.key);
      b.title = a.unlocked ? `${a.source}: ${t.chain.map((s) => s.name).join(' → ')}` : `Needs ${a.missing.join(', ')} (${a.source})`;
      b.disabled = isBusy;
      b.onclick = () => {
        if (a.unlocked) return apply(track, inst, a.key);
        lockedNote.set(track.id, a.key);
        schedule();
      };
      seg.append(b);
    }
    const offBtn = el('button', 'tier off', 'Off');
    offBtn.classList.toggle('on', !hasChain);
    offBtn.disabled = isBusy || !hasChain;
    offBtn.onclick = () => exclusive(track, () => AddOnLogic.removeTier(session, track)).catch(fail(track));
    seg.append(offBtn);
    top.append(seg);

    const test = el('button', 'blindbtn', 'Blind');
    test.title = 'Hear the dry track and each tier you have as A, B, C… without knowing which is which, then pick';
    test.disabled = isBusy || !access.some((a) => a.unlocked);
    test.onclick = () => startBlind(track, inst);
    top.append(test);

    const ab = el('button', 'ab', hasChain && off ? 'Dry' : 'A/B');
    ab.title = 'Hear the track without the chain and the reverb, then back';
    ab.disabled = !hasChain || isBusy;
    ab.classList.toggle('on', hasChain && off);
    ab.onclick = () => exclusive(track, () => AddOnLogic.setTierIn(session, track, off)).catch(fail(track));
    top.append(ab);
    card.append(top);

    // Macros and chips, when a whole tier is on the track.
    if (tier && !isBusy) {
      const chips = [...tier.chain.map((s) => s), ...(tier.verb ? [{ plugin: 'send', name: tier.verb.name }] : [])].map((s) => {
        const c = el('span', `chip${s.plugin === 'send' ? ' verb' : ''}`, s.name);
        c.dataset.plugin = s.plugin;
        return c;
      });
      const body = el('div', 'body');
      const knobs = el('div', 'knobs');
      for (const macro of AddOnLogic.macrosOf(inst)) knobs.append(makeKnob(track, tier, macro, chips));
      const chain = el('div', 'chain');
      chain.append(el('span', 'src', tier.source), ...chips.flatMap((c, i) => (i ? [el('span', 'arrow', c.classList.contains('verb') ? '·' : '→'), c] : [c])));
      body.append(knobs, chain);
      card.append(body);

      // On Good with Spark locked: name the next tier's gear.
      const next = access.find((a) => a.key === 'better');
      if (current === 'good' && next && !next.unlocked) {
        const better = AddOnLogic.tierOfInstrument(inst, 'better');
        const nudge = el('div', 'nudge');
        nudge.append(el('span', '', `More of this sound: Better runs ${better.chain.map((s) => s.name).join(' → ')}${better.verb ? ` with ${better.verb.name}` : ''}.`));
        const go = el('button', 'spark small', 'Get with Spark');
        go.onclick = openSpark;
        nudge.append(go);
        card.append(nudge);
      }
    }

    const detail = el('div', 'detail');
    const locked = access.find((x) => x.key === lockedNote.get(track.id) && !x.unlocked);
    if (locked) showLocked(detail, locked);
    else if (isBusy) detail.textContent = 'Building the chain…';
    else if (notes.get(track.id)) { detail.textContent = notes.get(track.id); detail.classList.add('warn'); }
    else if (!inst) detail.textContent = 'Pick an instrument to see its tiers.';
    else if (!tier) detail.textContent = hasChain ? 'Part of a chain is on this track. Pick a tier to rebuild it.' : 'Pick a tier to build its chain.';
    if (detail.textContent || detail.childNodes.length) card.append(detail);
    root.append(card);
  }
  renderBanner(lockedLabels);
}

function showLocked(detail, a) {
  detail.className = 'detail locked-note';
  detail.append(el('span', '', `${a.label} needs ${a.missing.join(', ')}, part of UAD Spark.`));
  const go = el('button', 'spark small', 'Get with Spark');
  go.onclick = openSpark;
  detail.append(go);
}

// ---- blind shootout -----------------------------------------------------------------------
// The dry track and every unlocked tier, dealt to letters at random. The card hides the tier
// switch, the knobs and the chain while you listen; macro positions carry over between tiers, so
// it compares the gear, not the settings. Keep a letter to see which was which.

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
  if (key === 'dry') return 'You picked the dry track. The chain stays bypassed; press A/B to bring it back.';
  const t = AddOnLogic.tierOfInstrument(inst, key);
  return `You picked ${t.label}: ${t.chain[0].name} and friends, from ${t.source}. It stays on the track.`;
}

function blindCard(track, inst, b, access) {
  const card = el('div', 'card blind');
  const top = el('div', 'top');
  top.append(el('span', 'name', track.name.value), el('span', 'blind-tag', b.revealed ? 'Blind test: results' : 'Blind test'));
  const close = el('button', 'small', b.revealed ? 'Done' : 'Stop test');
  close.onclick = () => { shoot.delete(track.id); schedule(); };
  top.append(close);
  card.append(top);
  const foot = el('div', 'blind-foot');
  const msg = el('span', '');
  foot.append(msg);

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
    card.append(letters);
    const playing = session.transport.playing.value === true;
    msg.textContent = b.switching ? 'Switching…'
      : !b.playing ? `Click a letter to hear it${playing ? '' : ' (space plays)'}. One of them is the dry track.`
      : b.heard.size < b.order.length ? `Listening to ${b.playing}. Try the others.`
      : 'Heard them all. Keep the one you like best.';
    const keep = el('button', 'keep small', b.playing ? `Keep ${b.playing}` : 'Keep');
    keep.disabled = !b.playing || !!b.switching;
    keep.onclick = () => { b.revealed = true; schedule(); };
    foot.append(keep);
  } else {
    const list = el('div', 'reveal');
    for (const d of b.order) {
      const t = d.key === 'dry' ? null : AddOnLogic.tierOfInstrument(inst, d.key);
      const row = el('div', `rrow ${d.key}${d.letter === b.playing ? ' picked' : ''}`);
      row.append(el('b', '', d.letter), el('span', 'rtier', t ? t.label : 'Dry'),
        el('span', 'rchain', t ? t.chain.map((x) => x.name).join(' → ') + (t.verb ? ` · ${t.verb.name}` : '') : 'No chain, no reverb'));
      if (d.letter === b.playing) row.append(el('span', 'star', '★ your pick'));
      list.append(row);
    }
    card.append(list);
    const pick = b.order.find((d) => d.letter === b.playing);
    const locked = access.filter((a) => !a.unlocked).map((a) => a.label);
    msg.textContent = verdict(inst, pick.key) + (locked.length ? ` ${locked.join(' and ')} sat this one out. ${locked.length > 1 ? 'They join' : 'It joins'} the test with Spark.` : '');
    if (locked.length) {
      const go = el('button', 'spark small', 'Get with Spark');
      go.onclick = openSpark;
      foot.append(go);
    }
  }
  card.append(foot);
  if (notes.get(track.id)) { const n = el('div', 'detail warn', notes.get(track.id)); card.append(n); }
  return card;
}

const fail = (track) => (e) => { notes.set(track.id, e.message ?? String(e)); schedule(); };

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

// Re-render on anything that changes a card's structure: tracks, inserts, bypass, sends.
async function bindTracks() {
  release();
  await Promise.all(session.visibleTracks.map((t) => t.effects.load().then(() => AddOnLogic.loadMacroControls(session, t))));
  keep(session.tracks.onChange(() => { void bindTracks(); }));
  keep(session.buses.onChange(schedule));
  keep(session.transport.playing.onChange(schedule));   // rings rest and the blind-test hint follow play/stop
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
  await Promise.all(session.visibleTracks.map((t) => t.loadStrip()));
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
