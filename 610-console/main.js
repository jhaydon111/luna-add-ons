// 610 Console: DOM wiring. Connects to LUNA, follows the focused session, and draws the desk and the tape
// machine from what logic.js computes. Every engine call goes through AddOnLogic.
//
// Rebuilds go through one Luna.Bindings per session (`strips`): a drag is never cut off by a rebuild, and every
// listener a strip made is released when the strips are rebuilt or the session changes.

const $ = (id) => document.getElementById(id);
let luna;
let session;
let generation = 0;          // bumps on every session change; stale async work checks it and stops
let releases = [];           // session-level listeners
let strips = new Luna.Bindings();
let knownInputs = [];
let inputTrack = null;
let clockRelease = null;
let building = Promise.resolve();
const waveforms = new Luna.Waveforms({ maxPages: 256 });   // one min/max page cache for the tape lanes
let lanes = [];          // [{ ch, canvas }] in channel order, spare rows have no ch
let laneScene = null;    // the last gathered clips and ranges; the playhead repaints without refetching
let laneTicket = 0;

const keep = (u) => releases.push(u);
const release = () => { for (const u of releases) u(); releases = []; };

function report(err) {
  const text = err instanceof Error ? err.message : String(err);
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(report.timer);
  report.timer = setTimeout(() => { t.hidden = true; }, 4000);
  console.warn(err);
}

const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const el = (tag, className, html) => { const e = document.createElement(tag); if (className) e.className = className; if (html !== undefined) e.innerHTML = html; return e; };

// ------------------------------------------------------------------ views

function setView(view) {
  const console_ = view === 'console';
  $('console').hidden = !console_;
  $('tape').hidden = console_;
  $('viewConsole').classList.toggle('on', console_);
  $('viewTape').classList.toggle('on', !console_);
  $('viewConsole').setAttribute('aria-selected', String(console_));
  $('viewTape').setAttribute('aria-selected', String(!console_));
  try { localStorage.setItem('610.view', view); } catch { /* private mode */ }
}
$('viewConsole').onclick = () => setView('console');
$('viewTape').onclick = () => setView('tape');
try { setView(localStorage.getItem('610.view') === 'tape' ? 'tape' : 'console'); } catch { setView('console'); }

// ------------------------------------------------------------------ VU meters

/** The VU law: a dB value's place on the sweep (0..1). Linear in voltage, 0 VU at 71% of the sweep, +3 at the end. */
const vuPos = (db) => Math.pow(10, db / 20) / Math.pow(10, 3 / 20);
const VU_SWEEP = 104;   // degrees, centred on 0
const vuAngle = (f) => -VU_SWEEP / 2 + Math.max(0, Math.min(1.04, f)) * VU_SWEEP;

/** A VU face: cream, the VU scale with its red arc, a needle with a shadow. Returns the element and a setter. */
function makeVu(number, { small = false } = {}) {
  const vu = el('div', `vu${small ? ' small' : ''}`);
  const cx = 50, cy = 60, r = 44;
  const pt = (f, rr) => { const a = (vuAngle(f) - 90) * Math.PI / 180; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; };
  const arc = (f0, f1, rr) => { const [x0, y0] = pt(f0, rr); const [x1, y1] = pt(f1, rr); return `M${x0.toFixed(1)} ${y0.toFixed(1)} A ${rr} ${rr} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const major = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
  const ticks = major.map((db) => { const f = vuPos(db); const [x0, y0] = pt(f, r); const [x1, y1] = pt(f, r - (db === 0 ? 7 : 4.5)); const [tx, ty] = pt(f, r + 6);
    const red = db > 0; const label = db === 0 ? '0' : db > 0 ? `+${db}` : String(-db);
    return `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${red ? '#c42d25' : '#2a2520'}" stroke-width="${db === 0 ? 1.4 : 1}"/>` +
      (small && ![-20, -10, -5, 0, 3].includes(db) ? '' : `<text x="${tx.toFixed(1)}" y="${(ty + 2).toFixed(1)}" fill="${red ? '#c42d25' : '#2a2520'}" font-size="${small ? 5.5 : 6}" font-weight="700" text-anchor="middle" font-family="Helvetica, Arial">${label}</text>`); }).join('');
  const minor = [-15, -8, -6, -4, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((db) => { const [x0, y0] = pt(vuPos(db), r); const [x1, y1] = pt(vuPos(db), r - 2.5); return `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${db > 0 ? '#c42d25' : '#2a2520'}" stroke-width=".7"/>`; }).join('');
  vu.innerHTML = `<svg viewBox="0 0 100 62" aria-hidden="true">
      <path d="${arc(0, vuPos(0), r)}" fill="none" stroke="#2a2520" stroke-width="1.2"/>
      <path d="${arc(vuPos(0), 1, r)}" fill="none" stroke="#c42d25" stroke-width="2.6"/>
      ${minor}${ticks}
      <text x="50" y="43" font-family="Helvetica, Arial" font-size="7.5" font-weight="700" fill="#2a2520" text-anchor="middle" letter-spacing="2">VU</text>
      <circle class="lamp" cx="92" cy="8" r="2.4" fill="#5a4a3a"/>
      <g class="needle" transform="rotate(${vuAngle(0).toFixed(2)} ${cx} ${cy})"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r - 2}" stroke="#000" stroke-width="2" opacity=".25" transform="translate(1.2 1.2)"/><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r - 2}" stroke="#141210" stroke-width="1.3"/></g>
      <path d="M${cx - 9} 62 Q ${cx} ${cy - 8} ${cx + 9} 62 Z" fill="#141210"/>
    </svg>`;
  if (number !== undefined) vu.append(el('span', 'n', String(number)));
  const needle = vu.querySelector('.needle');
  let shown = 0;
  let target = 0;
  let raf = 0;
  const tick = () => {
    raf = 0;
    shown += (target - shown) * 0.22;             // VU ballistics: a 300 ms-ish swing, overshoot free
    needle.setAttribute('transform', `rotate(${vuAngle(shown).toFixed(2)} ${cx} ${cy})`);
    if (Math.abs(target - shown) > 0.002) raf = requestAnimationFrame(tick);
  };
  const set = (level) => { target = level; if (!raf) raf = requestAnimationFrame(tick); };
  return { el: vu, set, stop: () => cancelAnimationFrame(raf) };
}

/** Drive a VU from a channel's meter for as long as `bindings` lives. LUNA's level is 0..1 per stream. */
function bindVu(vu, meter, bindings) {
  bindings.add(meter.level.onChange(() => {
    const levels = meter.level.value ?? [];
    vu.set(levels.length ? Math.max(...levels.map((l) => Math.min(1, Math.max(0, l ?? 0)))) : 0);
  }));
  bindings.on(meter.clip, () => vu.el.classList.toggle('clip', (meter.clip.value ?? []).some(Boolean)));
  vu.el.onclick = () => vu.el.classList.remove('clip');
  bindings.add(() => vu.stop());
}

// ------------------------------------------------------------------ knobs and switches

/** A continuous knob on `control`: drag, keys and double-click reset come from the SDK; the pointer follows LUNA. */
function bindKnob(knob, control, bindings, label) {
  const val = knob.querySelector('.val');
  // a big knob prints its value in its legend line (the scale ring takes the space around it)
  const ringed = !!knob.parentElement?.querySelector('.ring text');   // a labelled scale ring takes the space under the knob
  const legend = knob.classList.contains('big') || ringed ? knob.parentElement?.querySelector('.klabel') : null;
  if (legend && !legend.dataset.base) legend.dataset.base = legend.textContent;
  const show = () => {
    const text = control.display.value ?? '';
    if (legend) setText(legend, text ? `${legend.dataset.base} · ${text}` : legend.dataset.base);
    else if (val) setText(val, text);
  };
  Luna.bindDrag(knob, control, {
    bindings, label, onError: report, pixelsPerUnit: 220, step: 0.01,
    render: (v) => { knob.style.setProperty('--turn', `${AddOnLogic.knobTurn(v)}deg`); show(); },
  });
  bindings.on(control.display, show);
}

/** A rotary switch on a discrete control: click steps up, Shift or right-click steps down; the pointer snaps to the step. */
function bindStepKnob(knob, control, bindings) {
  knob.classList.add('stepped');
  const val = knob.querySelector('.val');
  const paint = () => {
    const n = (control.realValues.value ?? []).length;
    const i = AddOnLogic.stepIndex(control);
    const v = n > 1 && i >= 0 ? i / (n - 1) : control.normalized.value ?? 0;
    knob.style.setProperty('--turn', `${AddOnLogic.knobTurn(v)}deg`);
    if (val) setText(val, AddOnLogic.stepLabel(control));
  };
  paint();
  bindings.on(control.real, paint);
  bindings.on(control.display, paint);
  knob.onclick = (e) => AddOnLogic.stepSwitch(control, e.shiftKey ? -1 : 1).catch(report);
  knob.oncontextmenu = (e) => { e.preventDefault(); AddOnLogic.stepSwitch(control, -1).catch(report); };
  knob.onkeydown = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); AddOnLogic.stepSwitch(control, 1, { wrap: false }).catch(report); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); AddOnLogic.stepSwitch(control, -1, { wrap: false }).catch(report); }
  };
}

/** A bakelite toggle on a discrete control: its two (or three) labels come from LUNA's own strings. */
function bindSwitchControl(button, control, bindings) {
  const cap = button.querySelector('.cap');
  const paint = () => {
    const labels = control.displayValues.value ?? [];
    const i = AddOnLogic.stepIndex(control);
    cap.replaceChildren(...labels.map((l, k) => { const s = el(k === i ? 'b' : 'span'); s.textContent = l.toUpperCase(); return s; }));
    button.dataset.pos = labels.length === 3 ? (i === 1 ? 'mid' : i === 2 ? '1' : '0') : String(i);
    button.classList.toggle('three', labels.length === 3);
  };
  paint();
  bindings.on(control.real, paint);
  bindings.on(control.display, paint);
  button.onclick = () => AddOnLogic.stepSwitch(control, 1).catch(report);
}

/** An engraved scale around a knob: `n` ticks over the 300° sweep, with labels when given (ends first). */
function scaleRing(size, { ticks = 11, labels = [], light = false, offset = 10 } = {}) {
  const pad = labels.length ? 12 : 6;
  const S = size + pad * 2;
  const c = S / 2, r = size / 2 + 3;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
  svg.setAttribute('width', S); svg.setAttribute('height', S);
  svg.setAttribute('class', `ring${light ? ' light' : ''}`);
  let html = '';
  for (let i = 0; i < ticks; i++) {
    const a = (-150 + (300 * i) / (ticks - 1) - 90) * Math.PI / 180;
    const len = labels.length && (i % Math.max(1, Math.round((ticks - 1) / (labels.length - 1))) === 0) ? 4 : 2.5;
    html += `<line class="tick" x1="${(c + r * Math.cos(a)).toFixed(1)}" y1="${(c + r * Math.sin(a)).toFixed(1)}" x2="${(c + (r + len) * Math.cos(a)).toFixed(1)}" y2="${(c + (r + len) * Math.sin(a)).toFixed(1)}"/>`;
  }
  labels.forEach((label, k) => {
    const a = (-150 + (300 * k) / (labels.length - 1) - 90) * Math.PI / 180;
    html += `<text x="${(c + (r + 9) * Math.cos(a)).toFixed(1)}" y="${(c + (r + 9) * Math.sin(a) + 2.2).toFixed(1)}" text-anchor="middle">${label}</text>`;
  });
  svg.innerHTML = html;
  svg.style.top = `${-pad + offset}px`;
  return svg;
}

function makeKnob(classes, label, { stepped = false, scale } = {}) {
  const group = el('div', 'kgroup');
  const knob = el('div', `knob ${classes}`.trim());
  knob.setAttribute('role', stepped ? 'button' : 'slider');
  knob.tabIndex = 0;
  knob.setAttribute('aria-label', label);
  knob.innerHTML = '<div class="cap"></div><span class="val"></span>';
  const size = classes.includes('door') ? 66 : classes.includes('big') ? 64 : classes.includes('small') ? 26 : 34;
  if (scale) group.append(scaleRing(size, { ...scale, offset: classes.includes('door') ? 16 : size >= 60 ? 14 : 10 }));
  group.append(knob, el('div', `klabel${scale?.light ? ' light' : ''}`, label));
  return { group, knob };
}

function makeSwitch(classes, caps, title) {
  const b = el('button', `switch ${classes}`.trim());
  b.type = 'button';
  if (title) b.title = title;
  b.innerHTML = `<span class="lever"></span><span class="cap">${caps.map((c) => `<span>${c}</span>`).join('')}</span>`;
  return b;
}

// ------------------------------------------------------------------ the strips

function paintFocus() {
  if (!session) return;
  const id = AddOnLogic.focusedId(session);
  for (const m of document.querySelectorAll('.module[data-id]')) m.classList.toggle('focused', m.dataset.id === id);
}

/** Build the desk and the tape machine for the session's channels; waits out any drag in progress. */
function renderStrips() {
  const group = strips;
  const gen = generation;
  const render = async () => {
    if (!session || gen !== generation) return;
    const list = AddOnLogic.channels(session);
    await Promise.all(list.map((ch) => Promise.all([ch.loadStrip(), ch.effects.load(), ch.outputs.load()]).catch(() => undefined)));
    await session.buses.load().catch(() => undefined);
    const bus = AddOnLogic.findEchoBus(session);
    if (bus) await Promise.all([bus.loadStrip(), bus.effects.load()]).catch(() => undefined);
    await Promise.all(list.map((ch) => { const s = AddOnLogic.find610(ch); return s ? s.controls.load().catch(() => undefined) : undefined; }));
    await Promise.all(list.map((ch) => { const s = AddOnLogic.echoSend(session, ch); return s ? s.controls.load().catch(() => undefined) : undefined; }));
    if (gen !== generation) return;
    if (group.busy) { void group.whenIdle(render); return; }   // a drag began while loading: try again after it
    group.clear();
    const vus = $('vus'); const attens = $('attens'); const modules = $('modules'); const tracks = $('tracks');
    const tapeVus = $('tapeVus'); const laneHost = $('lanes');
    vus.replaceChildren(); tapeVus.replaceChildren(); laneHost.replaceChildren(); lanes = []; laneScene = null;
    attens.replaceChildren(attens.firstElementChild);
    modules.replaceChildren(modules.firstElementChild);
    tracks.replaceChildren();
    for (let i = 0; i < AddOnLogic.MAX_CHANNELS; i++) {
      const ch = list[i];
      const vu = makeVu(i + 1);
      vus.append(vu.el);
      const tvu = makeVu(i + 1, { small: true });
      tapeVus.append(tvu.el);
      const row = el('div', `laneRow${ch ? '' : ' spare'}`);
      const canvas = el('canvas', 'lane'); canvas.width = 1200; canvas.height = 44;
      row.append(el('div', 'ln', String(i + 1)), canvas);
      laneHost.append(row);
      lanes.push({ ch, canvas });
      if (ch) {
        bindVu(vu, ch.meter, group);
        bindVu(tvu, ch.meter, group);
        attens.append(attenFor(ch, i, group));
        modules.append(moduleFor(ch, i, group));
        tracks.append(tapeCardFor(ch, i, group));
      } else {
        attens.append(el('div', 'atten'));
        modules.append(el('div', 'module empty', `<div class="plate">NO MODULE</div>`));
        tracks.append(spareCard(i));
      }
    }
    bindMaster(group);
    paintFocus();
    paintTapeAll();
    await bindLanes(group, gen);
    $('addChannel').disabled = !AddOnLogic.canAddChannel(session);
  };
  building = group.whenIdle(render).catch(report);
  return building;
}

/** The doorknob attenuator and the channel ON toggle above a module. */
function attenFor(ch, i, bindings) {
  const a = el('div', 'atten');
  a.append(el('div', 'chno', String(i + 1)));
  const { group, knob } = makeKnob('door', '', { scale: { ticks: 21, labels: ['∞', '30', '20', '15', '10', '5', '0'], light: true } });
  knob.setAttribute('aria-label', `Channel ${i + 1} attenuator`);
  group.querySelector('.klabel').remove();
  a.append(group);
  const db = el('div', 'db');
  a.append(db);
  const val = knob.querySelector('.val');
  val.remove();
  Luna.bindDrag(knob, ch.gain, {
    bindings, onError: report, label: `Channel ${i + 1} level`, pixelsPerUnit: 240,
    render: (v) => { knob.style.setProperty('--turn', `${AddOnLogic.knobTurn(v)}deg`); setText(db, ch.gain.display.value ?? ''); },
  });
  bindings.on(ch.gain.display, () => setText(db, ch.gain.display.value ?? ''));
  const on = makeSwitch('light', ['OFF', 'ON'], 'Channel on');
  const paintOn = () => { const muted = ch.mute.on; on.classList.toggle('on', !muted); on.dataset.pos = muted ? '0' : '1'; on.querySelector('.cap').innerHTML = muted ? '<b>OFF</b><span>ON</span>' : '<span>OFF</span><b>ON</b>'; };
  paintOn();
  bindings.on(ch.mute.real, paintOn);
  on.onclick = () => ch.mute.toggle().catch(report);
  a.append(on);
  return a;
}

/** One 610 module: L·M·R, L.F. and H.F., MIC/LINE, the big level knob, the gain switch, the echo send. */
function moduleFor(ch, i, bindings) {
  const m = el('article', 'module');
  m.dataset.id = ch.id;
  m.onclick = (e) => { if (!e.target.closest('.knob, .switch, button, .name')) AddOnLogic.focusChannel(session, ch).catch(report); };

  // program bus assign
  const lmr = makeSwitch('three lmr', ['L', 'M', 'R'], 'Program bus: left, both, right');
  const paintLmr = () => {
    const side = AddOnLogic.busAssign(ch);
    lmr.dataset.pos = side === 'L' ? '0' : side === 'M' ? 'mid' : '1';
    lmr.querySelector('.cap').innerHTML = ['L', 'M', 'R'].map((s) => (s === side ? `<b>${s}</b>` : `<span>${s}</span>`)).join('');
  };
  paintLmr();
  for (const p of ch.main.pans) bindings.on(p.normalized, paintLmr);
  lmr.onclick = () => { const next = { L: 'M', M: 'R', R: 'L' }[AddOnLogic.busAssign(ch)]; AddOnLogic.setBusAssign(ch, next).catch(report); };
  m.append(lmr);
  m.append(el('div', 'screws', '<i></i><i></i><i></i><i></i>'));
  const badge = el('div', 'diamond'); badge.append(el('b', '', '610')); m.append(badge);
  m.append(el('div', 'plate', 'MODULAR AMPLIFIER'));

  const name = el('div', 'name');
  name.textContent = ch.name.value ?? ch.id;
  name.title = 'Double-click to rename';
  bindings.on(ch.name, () => setText(name, ch.name.value ?? ch.id));
  name.ondblclick = () => editName(name, ch);
  m.append(name);

  const slot = AddOnLogic.find610(ch);
  for (const e of ch.effects.items) {   // a 610 arriving in, or leaving, any insert slot redraws the module
    if (!/^effect_\d+$/.test(e.id)) continue;
    bindings.on(e.pluginId, () => void renderStrips());
    if (e === slot) bindings.on(e.instanceId, () => { if (AddOnLogic.find610(ch)) void renderStrips(); });
  }
  const c = slot ? AddOnLogic.moduleControls(slot) : {};
  const have = slot && c.level;
  m.classList.toggle('empty', !have);

  const pair = el('div', 'pair');
  const lf = makeKnob('small', 'L.F.', { stepped: true, scale: { ticks: 3 } });
  const hf = makeKnob('small', 'H.F.', { stepped: true, scale: { ticks: 4 } });
  pair.append(lf.group, hf.group);
  m.append(pair);

  const micLine = makeSwitch('', ['MIC', 'LINE'], 'Mic or line input');
  micLine.append(el('span', 'jacks', '<i></i><i></i>'));
  m.append(micLine);

  const level = makeKnob('big', 'LEVEL', { scale: { ticks: 11, labels: ['0', '2', '4', '6', '8', '10'] } });
  m.append(level.group);
  const gain = makeSwitch('three', ['LO', 'OFF', 'HI'], 'Gain');
  m.append(gain);
  const echo = makeKnob('small', 'ECHO', { scale: { ticks: 7, labels: ['OFF', 'MAX'] } });
  m.append(echo.group);

  if (have) {
    if (c.lf) bindStepKnob(lf.knob, c.lf, bindings);
    if (c.hf) bindStepKnob(hf.knob, c.hf, bindings);
    if (c.micLine) bindSwitchControl(micLine, c.micLine, bindings);
    if (c.gain) bindSwitchControl(gain, c.gain, bindings);
    bindKnob(level.knob, c.level, bindings, `Channel ${i + 1} level`);
    if (slot.pluginError?.value) m.append(el('div', 'err', slot.pluginError.value));
  } else {
    const insert = el('button', 'insert', slot ? 'LOADING 610…' : 'INSERT 610');
    insert.type = 'button';
    insert.title = 'Put a UA 610-A on this channel (first insert slot)';
    insert.onclick = () => { insert.disabled = true; AddOnLogic.ensure610(ch).then(() => renderStrips()).catch((e) => { insert.disabled = false; report(e); }); };
    m.append(insert);
    if (slot?.pluginError?.value) m.append(el('div', 'err', slot.pluginError.value));
  }

  // remove the channel: click once to arm it, again within three seconds to delete the track (one undo step)
  const remove = el('button', 'remove', 'REMOVE CHANNEL');
  remove.type = 'button';
  remove.title = 'Delete this track from the session';
  let armedAt = 0;
  remove.onclick = (e) => {
    e.stopPropagation();
    if (Date.now() - armedAt < 3000) { remove.disabled = true; AddOnLogic.removeChannel(session, ch).catch((err) => { remove.disabled = false; report(err); }); return; }
    armedAt = Date.now(); remove.classList.add('sure'); setText(remove, 'SURE? CLICK AGAIN');
    setTimeout(() => { if (Date.now() - armedAt >= 2900) { remove.classList.remove('sure'); setText(remove, 'REMOVE CHANNEL'); } }, 3000);
  };

  // echo send
  const send = AddOnLogic.echoSend(session, ch);
  if (send) {
    bindKnob(echo.knob, send.gain, bindings, `Channel ${i + 1} echo send`);
  } else {
    echo.knob.classList.add('stepped');
    echo.knob.title = 'Click to route this channel to the Echo chamber';
    echo.knob.style.opacity = '.45';
    echo.knob.onclick = () => { echo.knob.onclick = null; AddOnLogic.connectEcho(session, ch).then(() => renderStrips()).catch(report); };
  }
  m.append(remove);
  return m;
}

function editName(nameEl, ch) {
  const hold = strips.hold();
  const input = el('input');
  input.value = ch.name.value ?? '';
  input.className = 'name editing';
  input.style.cssText = 'width:100%;font:inherit;border:0;padding:3px 6px;';
  nameEl.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    const v = input.value.trim();
    input.replaceWith(nameEl);
    hold();
    if (save && v && v !== ch.name.value) {
      try { await ch.name.set(v); } catch (e) { report(e); }
    }
  };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') void finish(true); if (e.key === 'Escape') void finish(false); };
  input.onblur = () => void finish(true);
}

/** Master section: MONITOR is the master fader, ECHO the Echo bus return, the PROGRAM meters the master's. */
function bindMaster(bindings) {
  const master = session.master;
  const program = $('program');
  program.replaceChildren();
  if (master) {
    const streams = Math.max(1, master.meter.numStreams.value ?? 2);
    const vus = [makeVu('L', { small: true }), makeVu('R', { small: true })];
    for (const v of vus) program.append(v.el);
    bindings.add(master.meter.level.onChange(() => {
      const levels = master.meter.level.value ?? [];
      vus[0].set(Math.min(1, Math.max(0, levels[0] ?? 0)));
      vus[1].set(Math.min(1, Math.max(0, levels[streams > 1 ? 1 : 0] ?? 0)));
    }));
    bindings.add(() => vus.forEach((v) => v.stop()));
    if (!$('monitorKnob').parentElement.querySelector('.ring')) $('monitorKnob').parentElement.prepend(scaleRing(64, { ticks: 11, labels: ['∞', '20', '10', '5', '0'], light: true, offset: 14 }));
    bindKnob($('monitorKnob'), master.gain, bindings, 'Monitor');
  }
  const bus = AddOnLogic.findEchoBus(session);
  const echoKnob = $('echoKnob');
  if (!echoKnob.parentElement.querySelector('.ring')) echoKnob.parentElement.prepend(scaleRing(34, { ticks: 7, labels: ['0', '10'], light: true }));
  echoKnob.style.opacity = bus ? '' : '.45';
  echoKnob.onclick = null;
  if (bus) bindKnob(echoKnob, bus.gain, bindings, 'Echo return');
  else { echoKnob.title = 'Click to build the Echo chamber'; echoKnob.onclick = () => { echoKnob.onclick = null; AddOnLogic.ensureEchoBus(session).then(() => renderStrips()).catch(report); }; }
}

// ------------------------------------------------------------------ the tape machine

function tapeCardFor(ch, i, bindings) {
  const card = el('div', 'tcard');
  card.append(el('div', 'tn', String(i + 1)));
  const name = el('div', 'tname');
  name.textContent = ch.name.value ?? ch.id;
  bindings.on(ch.name, () => setText(name, ch.name.value ?? ch.id));
  card.append(name);
  const ready = makeSwitch('ready', ['SAFE', 'READY'], 'Record arm');
  const mon = makeSwitch('mon', ['REPRO', 'INPUT'], 'Input monitor');
  const paint = () => {
    const armed = ch.recordEnabled.value === true;
    ready.classList.toggle('on', armed);
    ready.querySelector('.cap').innerHTML = armed ? '<span>SAFE</span><b>READY</b>' : '<b>SAFE</b><span>READY</span>';
    const m = ch.inputMonitor.value === true;
    mon.classList.toggle('on', m);
    mon.classList.toggle('live', ch.inputMonitoring?.value === true);
    mon.querySelector('.cap').innerHTML = m ? '<span>REPRO</span><b>INPUT</b>' : '<b>REPRO</b><span>INPUT</span>';
  };
  paint();
  for (const p of [ch.recordEnabled, ch.inputMonitor, ch.inputMonitoring].filter(Boolean)) bindings.on(p, paint);
  ready.onclick = () => AddOnLogic.toggleArm(ch).catch(report);
  mon.onclick = () => AddOnLogic.toggleMonitor(ch).catch(report);
  card.append(ready, mon);
  const input = el('button', 'input');
  input.type = 'button';
  const paintInput = () => setText(input, `IN · ${AddOnLogic.inputName(ch, knownInputs)}`);
  paintInput();
  for (const p of [ch.inputDesc, ch.inputNodeUid].filter(Boolean)) bindings.on(p, paintInput);
  input.onclick = () => void openInputMenu(input, ch);
  card.append(input);
  return card;
}

function spareCard(i) {
  const card = el('div', 'tcard spare');
  card.append(el('div', 'tn', String(i + 1)));
  const add = el('button', 'add', '+ Add channel');
  add.type = 'button';
  add.disabled = !session || !AddOnLogic.canAddChannel(session);
  add.onclick = () => { add.disabled = true; AddOnLogic.addChannel(session).catch(report); };
  card.append(add);
  return card;
}

function paintTapeAll() {
  const list = session ? AddOnLogic.channels(session) : [];
  const on = list.length > 0 && list.every((ch) => AddOnLogic.tapeOn(ch));
  const b = $('tapeAll');
  b.classList.toggle('on', on);
  b.dataset.pos = on ? '1' : '0';
  b.querySelector('.cap').innerHTML = on ? '<span>OFF</span><b>ON</b>' : '<b>OFF</b><span>ON</span>';
  b.disabled = list.length === 0;
}
$('tapeAll').onclick = async () => {
  const list = AddOnLogic.channels(session);
  const on = !(list.length > 0 && list.every((ch) => AddOnLogic.tapeOn(ch)));
  $('tapeAll').disabled = true;
  try { for (const ch of list) await AddOnLogic.setTape(ch, on); } catch (e) { report(e); }
  paintTapeAll();
  $('tapeAll').disabled = false;
};

function closePopups() { $('inputMenu').hidden = true; inputTrack = null; }
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.popup, .input')) closePopups(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopups(); });

async function openInputMenu(button, track) {
  if (!session || !luna) return;
  if (!$('inputMenu').hidden && inputTrack === track) return closePopups();
  closePopups();
  inputTrack = track;
  const menu = $('inputMenu');
  const list = menu.querySelector('.items');
  menu.querySelector('.title').textContent = `Input · ${track.name.value ?? track.id}`;
  list.replaceChildren(el('div', 'note', 'Reading inputs…'));
  const r = button.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 290))}px`;
  menu.style.top = `${r.bottom + 4}px`;
  menu.hidden = false;
  let inputs;
  try {
    knownInputs = await luna.audioInputs();
    inputs = AddOnLogic.inputChoices(track, knownInputs);
  } catch (err) {
    list.replaceChildren(el('div', 'note', err instanceof Error ? err.message : String(err)));
    return;
  }
  if (inputTrack !== track || menu.hidden) return;
  const current = track.inputNodeUid.value;
  list.replaceChildren(...(inputs.length ? inputs.map((input) => {
    const item = el('button', input.uid === current ? 'current' : '');
    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.textContent = input.name;
    item.onclick = () => { closePopups(); AddOnLogic.setInput(track, input.uid).catch(report); };
    return item;
  }) : [el('div', 'note', 'No inputs of this format.')]));
}

// ------------------------------------------------------------------ the tape lanes

/** Follow the channels' playlists and sources; gather and paint the lanes now and on every change. */
async function bindLanes(bindings, gen) {
  if (!session) return;
  try {
    await Promise.all([session.musical?.ready?.() ?? Promise.resolve(), session.sources?.load?.() ?? Promise.resolve()]);
    for (const { ch } of lanes) {
      if (!ch) continue;
      const lane = session.playlistFor(ch);
      if (!lane) continue;
      await lane.clips.load();
      bindings.add(lane.clips.onChange(() => scheduleLanes()));
    }
    if (session.sources) bindings.add(session.sources.onChange(() => scheduleLanes()));
  } catch (e) { console.warn('lanes', e); }
  if (gen !== generation) return;
  scheduleLanes();
}

let laneTimer = 0;
function scheduleLanes() {
  clearTimeout(laneTimer);
  laneTimer = setTimeout(() => void drawLanes(), 80);
}

/** Gather first, then paint in one pass (a half-drawn canvas flashes during playback). */
async function drawLanes() {
  const ticket = ++laneTicket;
  if (!session) { laneScene = null; return; }
  const tl = session.musical?.timeline;
  if (!tl) return;
  const { start, end, span } = AddOnLogic.laneWindow(session);
  const W = lanes[0]?.canvas.width ?? 1200;
  const nsPerPixel = Math.max(1, (tl.seconds(end) - tl.seconds(start)) * 1e9 / W);
  const kind = Luna.kindForScale(nsPerPixel);
  const rows = [];
  for (const { ch } of lanes) {
    const clips = [];
    const lane = ch ? session.playlistFor(ch) : null;
    for (const clip of lane?.clips.items ?? []) {
      const s0 = clip.start.value, s1 = clip.stop.value;
      if (s0 === undefined || s1 === undefined || s1 <= start || s0 >= end) continue;
      const audio = session.sources && Luna.clipAudio(clip, session.sources);
      if (!audio) { clips.push({ clip, s0, s1, state: 'outline' }); continue; }
      try {
        const from = Math.max(audio.startNs, Luna.audioNsAtTick(tl, clip, audio, Math.max(s0, start)) - Luna.OVERVIEW_PAIR_NS);
        const to = Math.min(audio.stopNs, Luna.audioNsAtTick(tl, clip, audio, Math.min(s1, end)) + Luna.OVERVIEW_PAIR_NS);
        const range = await waveforms.range(audio.source, from, Math.max(from, to), kind);
        if (ticket !== laneTicket) return;
        clips.push({ clip, s0, s1, audio, range, state: range.count ? 'drawn' : 'outline' });
      } catch { clips.push({ clip, s0, s1, state: 'outline' }); }
    }
    rows.push(clips);
  }
  if (ticket !== laneTicket) return;
  laneScene = { tl, start, end, span, rows };
  paintLanes();
}

function paintLanes() {
  if (!laneScene || !session) return;
  const { tl, start, span, rows } = laneScene;
  const tick = session.transport.tick ?? session.transport.location.value?.tick;
  const gain = (session.context?.waveformZoom?.value ?? 1);
  lanes.forEach(({ canvas }, i) => {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const x = (t) => (t - start) / span * W;
    for (const { clip, s0, s1, audio, range, state } of rows[i] ?? []) {
      const x0 = Math.max(0, x(s0)), x1 = Math.min(W, x(s1));
      ctx.fillStyle = '#6b4f33';
      ctx.fillRect(x0, 2, Math.max(1, x1 - x0), H - 4);
      if (state !== 'drawn') continue;
      const px0 = Math.floor(x0);
      try {
        const cols = Luna.waveformColumns(range, Math.max(0, Math.ceil(x1) - px0), (k) => Luna.audioNsAtTick(tl, clip, audio, start + (px0 + k) / W * span), { gain: gain * 10 ** ((clip.gain?.value ?? 0) / 20) });
        const waveLanes = Luna.waveformLanes(cols.channels.length, 2, H - 4, 0);
        ctx.fillStyle = '#d7b57a';
        ctx.beginPath();
        cols.channels.forEach((chn, c) => Luna.traceWaveform(ctx, chn, waveLanes[c], px0));
        ctx.fill();
      } catch { /* a clip without pages yet stays an outline */ }
    }
    if (tick !== undefined && tick >= start) {
      ctx.fillStyle = '#ff3a2a';
      ctx.fillRect(Math.min(W - 2, x(tick)), 0, 2, H);
    }
  });
}

// ------------------------------------------------------------------ transport

function bindTransport(s) {
  const t = s.transport;
  const paint = () => {
    const playing = t.playing.value === true;
    const rec = AddOnLogic.recordState(s);
    $('play').classList.toggle('on', playing);
    $('rec').classList.toggle('on', rec.recording);
    $('rec').classList.toggle('armed', rec.armed && !rec.recording);
    $('cutin').classList.toggle('on', rec.recording);
    document.body.classList.toggle('playing', playing);
    document.body.classList.toggle('recording', rec.recording);
  };
  paint();
  keep(t.playing.onChange(paint));
  keep(t.recordEnabled.onChange(paint));
  if (t.punchedIn) keep(t.punchedIn.onChange(paint));
  if (t.countingIn) keep(t.countingIn.onChange(paint));
  $('play').onclick = () => t.toggle().catch(report);
  $('stop').onclick = () => t.stop().catch(report);
  $('rtz').onclick = () => AddOnLogic.returnToZero(s).catch(report);
  $('rec').onclick = () => t.toggleRecord().catch(report);
  $('cutin').onclick = () => AddOnLogic.cutIn(s).catch(report);
  if (clockRelease) clockRelease();
  const paintCounter = (seconds) => {
    const c = AddOnLogic.counterText(typeof seconds === 'number' ? seconds : t.seconds ?? 0);
    setText($('counter'), c.clock);
    setText($('tapecount'), c.digits);
  };
  clockRelease = Luna.bindClock($('counter'), t, { render: (v) => paintCounter(typeof v === 'number' ? v : t.seconds) });
  keep(t.location.onChange(() => paintLanes()));
  keep(() => { if (clockRelease) clockRelease(); clockRelease = null; });
  paintCounter(t.seconds ?? 0);
}

// ------------------------------------------------------------------ session lifecycle

async function bindSession() {
  release();
  generation++;
  const gen = generation;
  strips.dispose();
  strips = new Luna.Bindings();
  closePopups();
  session = luna.sessions.current();
  if (!session) {
    document.body.classList.add('nosession');
    setText($('status'), 'no session open');
    $('addChannel').disabled = true;
    return;
  }
  await session.ready();
  if (gen !== generation) return;
  document.body.classList.remove('nosession');
  setText($('status'), session.name.value ?? session.uid);
  bindTransport(session);
  keep(session.context.lastSelectedTrack.onChange(paintFocus));
  keep(session.tracks.onChange(() => void renderStrips()));
  keep(session.buses.onChange(() => void renderStrips()));
  keep(session.name.onChange(() => setText($('status'), session.name.value ?? session.uid)));
  $('addChannel').onclick = () => { $('addChannel').disabled = true; AddOnLogic.addChannel(session).catch(report); };
  try { knownInputs = await luna.audioInputs(); } catch { knownInputs = []; }
  await renderStrips();
}

async function connect() {
  for (;;) {
    try {
      luna = await Luna.connect();
      break;
    } catch (e) {
      setText($('status'), e instanceof Luna.NotRunning ? 'waiting for LUNA…' : e.message);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  Luna.bindShortcuts(luna, { onError: report });
  await luna.sessions.ready();
  luna.sessions.focused.onChange(() => void bindSession());
  luna.sessions.items.onChange(() => void bindSession());
  luna.status.onChange(() => { if (luna.status.value === 'disconnected') setText($('status'), 'reconnecting…'); });
  await bindSession();
}

connect();
