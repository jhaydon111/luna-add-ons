// Runs against Luna.MockEngine: no LUNA needed. `npm test`.
import { describe, expect, it } from 'vitest';
import { Luna } from '@uaudio/luna-builder-sdk';

globalThis.Luna = Luna; // logic.js is a classic script that reads the Luna global
await import('../logic.js');
const L = globalThis.AddOnLogic;

async function connected(tracks = ['Vocal', 'Bass', 'Drums']) {
  const engine = new Luna.MockEngine();
  engine.addPlugin(L.PLUGIN_610, { name: '610-A Preamp and EQ' });
  engine.addPlugin(L.PLUGIN_ECHO, { name: 'Capitol Chambers' });
  engine.addPlugin(L.PLUGIN_TAPE, { name: 'Studer A800' });
  engine.addDevice('Apollo', { inputs: ['In 1', 'In 2'] });
  engine.addSession('abc', { name: 'Demo', tracks });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  const session = await luna.session();
  await Promise.all(session.tracks.items.map((t) => Promise.all([t.loadStrip(), t.effects.load()])));
  return { engine, luna, session };
}

/** Give a mock slot a 610-style rotary switch with these labels. */
function addSwitch(engine, path, labels, at = 0) {
  engine.addControl(path, 'parameter', { discrete: true, value: at, real: at, str: labels[at], automatable: true, normalized: at / (labels.length - 1) });
  engine.setValue(path, 'real_values', labels.map((_, i) => i));
  engine.setValue(path, 'string_values', labels);
  engine.setValue(path, 'num_steps', labels.length);
}

describe('channels', () => {
  it('seats the first eight audio tracks and no more', async () => {
    const { session } = await connected(Array.from({ length: 10 }, (_, i) => `T${i + 1}`));
    expect(L.channels(session).map((t) => t.name.value)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']);
    expect(L.canAddChannel(session)).toBe(false);
    await expect(L.addChannel(session)).rejects.toThrow('eight channels');
  });

  it('adds a mono audio track named for the next free channel', async () => {
    const { engine, session } = await connected(['Ch 1']);
    expect(L.nextChannelName(session)).toBe('Ch 2');
    const track = await L.addChannel(session);
    await engine.settled();
    expect(track.name.value).toBe('Ch 2');
    expect(L.channels(session).length).toBe(2);
    const req = engine.requests.find((r) => r.path.endsWith('/new_track'));
    expect(req.data).toMatchObject({ name: 'Ch 2', track_type: 'audio', stem_format: 'mono' });
  });

  it('removes a channel by deleting its track', async () => {
    const { engine, session } = await connected();
    const bass = L.channels(session)[1];
    await L.removeChannel(session, bass);
    await engine.settled();
    expect(L.channels(session).map((t) => t.name.value)).toEqual(['Vocal', 'Drums']);
    expect(engine.requests.some((r) => r.path.endsWith('/delete_tracks'))).toBe(true);
  });

  it('focuses a channel in LUNA', async () => {
    const { engine, session } = await connected();
    const bass = L.channels(session)[1];
    await L.focusChannel(session, bass);
    await engine.settled();
    expect(L.focusedId(session)).toBe(bass.id);
  });
});

describe('the 610 module', () => {
  it('puts a 610-A in the first insert slot once, and finds it after', async () => {
    const { engine, session } = await connected();
    const ch = L.channels(session)[0];
    expect(L.find610(ch)).toBeUndefined();
    const slot = await L.ensure610(ch);
    await engine.settled();
    expect(slot.id).toBe('effect_0');
    expect(engine.value(`/sessions/abc/tracks/${ch.id}/effects/effect_0`, 'plugin_id')).toBe(L.PLUGIN_610);
    expect(engine.value(`/sessions/abc/tracks/${ch.id}/effects/console`, 'plugin_id')).toBeNull();   // never the console slot: LUNA asserts on a non-extension there
    const inserts = engine.requests.filter((r) => r.path.endsWith('/set_inserts')).length;
    const again = await L.ensure610(ch);
    expect(again).toBe(L.find610(ch));
    expect(engine.requests.filter((r) => r.path.endsWith('/set_inserts')).length).toBe(inserts);
  });

  it('reads the panel controls by name and leaves the missing ones undefined', async () => {
    const { engine, session } = await connected();
    const ch = L.channels(session)[0];
    const slot = await L.ensure610(ch);
    const base = `/sessions/abc/tracks/${ch.id}/effects/effect_0/controls`;
    addSwitch(engine, `${base}/${L.MODULE.lf}`, ['-6 dB', '0 dB', '+6 dB'], 1);
    addSwitch(engine, `${base}/${L.MODULE.micLine}`, ['Line', 'Mic'], 0);
    await slot.controls.reload();   // the mock grew a control after the first load
    const m = L.moduleControls(slot);
    expect(m.lf).toBeDefined();
    expect(m.micLine).toBeDefined();
    expect(m.level).toBeUndefined();
    expect(L.stepLabel(m.lf)).toBe('0 dB');
    expect(L.stepIndex(m.lf)).toBe(1);
  });

  it('steps a rotary switch with one touched write, wrapping at the end', async () => {
    const { engine, session } = await connected();
    const ch = L.channels(session)[0];
    const slot = await L.ensure610(ch);
    const path = `/sessions/abc/tracks/${ch.id}/effects/effect_0/controls/${L.MODULE.hf}`;
    addSwitch(engine, path, ['-6 dB', '0 dB', '+3 dB', '+6 dB'], 1);
    await slot.controls.reload();
    const hf = L.moduleControls(slot).hf;
    expect(await L.stepSwitch(hf, 1)).toBe(2);
    await engine.settled();
    expect(engine.value(path, 'real_value')).toBe(2);
    expect(engine.touches.filter((t) => t.startsWith(path))).toEqual([`${path}:on`, `${path}:off`]);
    expect(await L.stepSwitch(hf, 2)).toBe(0);   // 2 -> 4 wraps to 0
    expect(await L.stepSwitch(hf, -1)).toBe(3);
  });

  it('turns a knob angle from a normalized value', () => {
    expect(L.knobTurn(0)).toBe(-150);
    expect(L.knobTurn(0.5)).toBe(0);
    expect(L.knobTurn(1)).toBe(150);
    expect(L.knobTurn(undefined)).toBe(-150);
  });
});

describe('program bus', () => {
  it('reads L, M or R from the pans and sets them hard', async () => {
    const { engine, session } = await connected();
    const ch = L.channels(session)[0];
    expect(L.busAssign(ch)).toBe('M');
    await L.setBusAssign(ch, 'L');
    await engine.settled();
    expect(L.busAssign(ch)).toBe('L');
    expect(ch.main.pans[0].normalized.value).toBe(0);
    await L.setBusAssign(ch, 'R');
    await engine.settled();
    expect(L.busAssign(ch)).toBe('R');
    await L.setBusAssign(ch, 'M');
    await engine.settled();
    expect(L.busAssign(ch)).toBe('M');
    const path = `/sessions/abc/tracks/${ch.id}/outputs/main/controls/pan`;
    expect(engine.touches.filter((t) => t.startsWith(path)).length).toBe(6);   // three writes, each touched on and off
  });
});

describe('echo', () => {
  it('makes one Echo bus with the chamber on it, and reuses it', async () => {
    const { engine, session } = await connected();
    const [a, b] = await Promise.all([L.ensureEchoBus(session), L.ensureEchoBus(session)]);
    await engine.settled();
    expect(a).toBe(b);
    expect(a.name.value).toBe('Echo');
    expect(engine.requests.filter((r) => r.path.endsWith('/new_track') && r.data?.track_type === 'bus').length).toBe(1);
    const chamber = a.effects.items.find((e) => e.pluginId.value === L.PLUGIN_ECHO);
    expect(chamber).toBeDefined();
    const again = await L.ensureEchoBus(session);
    expect(again).toBe(a);
    expect(engine.requests.filter((r) => r.path.endsWith('/new_track') && r.data?.track_type === 'bus').length).toBe(1);
  });
});

describe('tape machine', () => {
  it('arms and monitors a track, settling on LUNA', async () => {
    const { engine, session } = await connected();
    const ch = L.channels(session)[0];
    expect(L.canRecord(ch)).toBe(true);
    await L.toggleArm(ch);
    await engine.settled();
    expect(ch.recordEnabled.value).toBe(true);
    await L.toggleArm(ch);
    await engine.settled();
    expect(ch.recordEnabled.value).toBe(false);
    await L.toggleMonitor(ch);
    await engine.settled();
    expect(ch.inputMonitor.value).toBe(true);
  });

  it('lists and sets inputs of the track format', async () => {
    const { engine, luna, session } = await connected();
    const ch = L.channels(session)[0];
    const inputs = await luna.audioInputs();
    expect(L.inputChoices(ch, inputs).map((i) => i.name)).toEqual(['In 1', 'In 2']);
    await L.setInput(ch, inputs[1].uid);
    await engine.settled();
    expect(ch.inputNodeUid.value).toBe(inputs[1].uid);
    expect(L.inputName(ch, inputs)).toBe('In 2');
  });

  it('puts the Studer tape extension in the tape slot and takes it out', async () => {
    const { engine, session } = await connected();
    const ch = L.channels(session)[0];
    expect(L.tapeOn(ch)).toBe(false);
    await L.setTape(ch, true);
    await engine.settled();
    expect(L.tapeOn(ch)).toBe(true);
    expect(engine.value(`/sessions/abc/tracks/${ch.id}/effects/tape`, 'plugin_id')).toBe(L.PLUGIN_TAPE);
    await L.setTape(ch, false);
    await engine.settled();
    expect(L.tapeOn(ch)).toBe(false);
  });

  it('counts tape like a 7.5 ips counter and shows min:sec', () => {
    expect(L.counterText(0)).toEqual({ digits: '0000', clock: '00:00.0' });
    expect(L.counterText(90.5)).toEqual({ digits: '0150', clock: '01:30.5' });
    expect(L.counterText(-3).digits).toBe('0000');
  });

  it('reads the record state and rewinds', async () => {
    const { engine, session } = await connected();
    expect(L.recordState(session)).toEqual({ armed: false, recording: false, countingIn: false });
    await L.returnToZero(session);
    await engine.settled();
    expect(engine.requests.some((r) => r.verb === 'set' && r.path.endsWith('/play_start'))).toBe(true);   // LUNA's RTZ: play start and loop to the arrangement start
  });
});
