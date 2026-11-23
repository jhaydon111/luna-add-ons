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

function makeKnob(track, tier, macro, chips) {
  const knob = el('div', 'knob');
  // Capture phase: runs before bindGesture's pointerdown touches the controls, and the socket
  // keeps the order, so LUNA sees the narrowed selection before the touch.
  knob.addEventListener('pointerdown', () => { void AddOnLogic.focusTrack(session, track); }, { capture: true });
  knob.tabIndex = 0;
  knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-label', macro.label);
  knob.innerHTML = `<svg viewBox="0 0 64 64"><path class="trk" d="${arcPath(24, 0, ARC)}"/><path class="val"/><circle class="dot" r="4"/><text class="pct" x="32" y="37"></text></svg><div class="label"></div><div class="word"></div>`;
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
    AddOnLogic.setMacro(session, track, macro.key, v).catch(fail(track));
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
    offBtn.onclick = () => AddOnLogic.removeTier(session, track).catch(fail(track));
    seg.append(offBtn);
    top.append(seg);

    const ab = el('button', 'ab', hasChain && off ? 'Dry' : 'A/B');
    ab.title = 'Hear the track without the chain and the reverb, then back';
    ab.disabled = !hasChain || isBusy;
    ab.classList.toggle('on', hasChain && off);
    ab.onclick = () => AddOnLogic.setTierIn(session, track, off).catch(fail(track));
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

const fail = (track) => (e) => { notes.set(track.id, e.message ?? String(e)); schedule(); };

// A new instrument rebuilds the same tier for it when that tier is unlocked; otherwise the old
// chain comes off, since it was built for the other instrument.
async function changeInstrument(track, inst, currentTier) {
  if (!inst) return;
  await AddOnLogic.setInstrument(session, track, inst).catch(fail(track));
  if (!currentTier && !AddOnLogic.chainSlots(session, track).length) return schedule();
  const ok = AddOnLogic.access(luna.plugins, inst).find((a) => a.key === currentTier)?.unlocked;
  if (ok) return apply(track, inst, currentTier);
  await AddOnLogic.removeTier(session, track).catch(fail(track));
  schedule();
}

async function apply(track, inst, key) {
  busy.set(track.id, key);
  notes.delete(track.id);
  lockedNote.delete(track.id);
  schedule();
  try {
    const { failures } = await AddOnLogic.applyTier(session, luna.plugins, track, inst, key);
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
