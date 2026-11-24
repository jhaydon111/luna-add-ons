// Runs against Luna.MockEngine: no LUNA needed. `npm test`.
import { describe, expect, it } from 'vitest';
import { Luna } from '@uaudio/luna-builder-sdk';

globalThis.Luna = Luna; // logic.js is a classic script that reads the Luna global
await import('../logic.js');
const logic = globalThis.AddOnLogic;
const allTiers = logic.INSTRUMENTS.flatMap((i) => i.tiers);
const ALL = [...new Set(allTiers.flatMap((t) => [...t.chain.map((s) => s.plugin), ...(t.verb ? [t.verb.plugin] : [])]))];
const EXPLORE = [...new Set(allTiers.filter((t) => t.key === 'good').flatMap((t) => [...t.chain.map((s) => s.plugin), ...(t.verb ? [t.verb.plugin] : [])]))];

async function connected({ plugins = ALL, unauthorized = [], tracks = ['Lead Vox', 'Gtr DI', 'Bass DI', 'Synth'] } = {}) {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { name: 'GBB Test', tracks });
  for (const id of plugins) engine.addPlugin(id, { name: id });
  for (const id of unauthorized) engine.setValue(`/plugins/${id}`, 'authorized', false);
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  await luna.plugins.load();
  const session = await luna.session();
  await Promise.all(session.visibleTracks.map((t) => t.loadStrip()));
  await logic.loadOwnership(session);
  const [vox, gtr, bass, synth] = session.visibleTracks;
  return { engine, luna, session, vox, gtr, bass, synth };
}

const ids = (track) => track.loadedEffects.map((e) => e.pluginId.value);
const chainOf = (inst, key) => logic.tierOfInstrument(inst, key).chain.map((s) => s.plugin);

describe('instruments', () => {
  it('guesses the instrument from the track name, most specific first', () => {
    expect(logic.guessInstrument('Lead Vox')).toBe('vocal');
    expect(logic.guessInstrument('BVs')).toBe('vocal');
    expect(logic.guessInstrument('Gtr DI')).toBe('guitar');
    expect(logic.guessInstrument('Lead Gtr')).toBe('guitar');
    expect(logic.guessInstrument('Bass DI')).toBe('bass');
    expect(logic.guessInstrument('Bass Gtr')).toBe('bass');
    expect(logic.guessInstrument('Synth Pad')).toBeUndefined();
  });

  it("keeps the user's pick over the guess", async () => {
    const { engine, session, synth } = await connected();
    expect(logic.instrumentOf(session, synth)).toBeUndefined();
    await logic.setInstrument(session, synth, 'guitar');
    await engine.settled();
    expect(logic.instrumentOf(session, synth)).toBe('guitar');
  });

  it('every instrument has Good on Explore FREE and Better/Best on Spark: three UAD inserts, then LUNA Channel EQ', () => {
    for (const inst of logic.INSTRUMENTS) {
      expect(inst.tiers.map((t) => t.key)).toEqual(['good', 'better', 'best']);
      expect(inst.tiers.map((t) => t.source)).toEqual(['UAD Explore FREE', 'UAD Spark', 'UAD Spark']);
      for (const t of inst.tiers) {
        expect(t.chain).toHaveLength(4);
        expect(t.chain[3].plugin).toBe('uaudio_luna_channel');
      }
      expect(logic.EQ_PRESETS[inst.key]?.length).toBeGreaterThan(2);
    }
  });
});

describe('tier access', () => {
  it('an Explore FREE user has Good unlocked on every instrument, Better and Best locked', async () => {
    const { luna } = await connected({ plugins: EXPLORE });
    for (const inst of ['vocal', 'guitar', 'bass']) {
      expect(logic.access(luna.plugins, inst).map((a) => a.unlocked)).toEqual([true, false, false]);
    }
  });

  it('names the missing Spark plug-ins per instrument', async () => {
    const { luna } = await connected({ unauthorized: ['uaudio_lion_amp', 'uaudio_empirical_labs_fatso_jr'] });
    expect(logic.access(luna.plugins, 'guitar')[2]).toMatchObject({ unlocked: false, missing: ["Lion '68"] });
    expect(logic.access(luna.plugins, 'bass')[2]).toMatchObject({ unlocked: false, missing: ['FATSO Jr'] });
    expect(logic.access(luna.plugins, 'vocal').every((a) => a.unlocked)).toBe(true);
  });
});

describe('tiers on a track', () => {
  it('vocal Good builds 610-A -> 1176 -> LA-2A and sends to a Pure Plate bus', async () => {
    const { engine, luna, session, vox } = await connected();
    const { failures } = await logic.applyTier(session, luna.plugins, vox, 'vocal', 'good');
    await engine.settled();
    expect(failures).toEqual({});
    expect(ids(vox)).toEqual(chainOf('vocal', 'good'));
    expect(logic.tierOf(session, vox)).toBe('good');
    const bus = logic.verbBuses(session).uaudio_pure_plate;
    expect(bus.name.value).toBe('GBB · Pure Plate');
    const send = logic.gbbSend(session, vox);
    expect(send.busUid.value).toBe(bus.id);
    expect(send.gain.real.value).toBeCloseTo(logic.spaceDb(0.5));
  });

  it("guitar Best builds Lion '68 -> Neve 1073 -> LA-3A with a Capitol Chambers send", async () => {
    const { engine, luna, session, gtr } = await connected();
    await logic.applyTier(session, luna.plugins, gtr, 'guitar', 'best');
    await engine.settled();
    expect(ids(gtr)).toEqual(chainOf('guitar', 'best'));
    expect(logic.gbbSend(session, gtr).busUid.value).toBe(logic.verbBuses(session).uaudio_capitol_chambers.id);
  });

  it('bass tiers have no reverb send', async () => {
    const { engine, luna, session, bass } = await connected();
    await logic.applyTier(session, luna.plugins, bass, 'bass', 'better');
    await engine.settled();
    expect(ids(bass)).toEqual(chainOf('bass', 'better'));
    await bass.outputs.load();
    expect(logic.gbbSend(session, bass)).toBeUndefined();
  });

  it('switching a track to bass takes its reverb send off', async () => {
    const { engine, luna, session, synth } = await connected();
    await logic.applyTier(session, luna.plugins, synth, 'vocal', 'good');
    await engine.settled();
    expect(logic.gbbSend(session, synth)).toBeDefined();
    await logic.applyTier(session, luna.plugins, synth, 'bass', 'good');
    await engine.settled();
    expect(ids(synth)).toEqual(chainOf('bass', 'good'));
    expect(logic.instrumentOf(session, synth)).toBe('bass');
    expect(logic.gbbSend(session, synth)).toBeUndefined();
  });

  it('switching Good -> Best swaps the chain and retargets the same send', async () => {
    const { engine, luna, session, vox } = await connected();
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'good');
    await engine.settled();
    const sendId = logic.gbbSend(session, vox).id;
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'best');
    await engine.settled();
    expect(ids(vox)).toEqual(chainOf('vocal', 'best'));
    expect(logic.tierOf(session, vox)).toBe('best');
    expect(logic.gbbSend(session, vox).id).toBe(sendId);
    expect(logic.gbbSend(session, vox).busUid.value).toBe(logic.verbBuses(session).uaudio_lexicon_224.id);
  });

  it("never touches the user's own copy of a tier plug-in", async () => {
    const { engine, luna, session, vox } = await connected();
    await vox.insert('uaudio_ua_1176');                      // the user's own 1176
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'good');
    await engine.settled();
    expect(ids(vox)).toEqual(['uaudio_ua_1176', ...chainOf('vocal', 'good')]);
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'best');
    await engine.settled();
    expect(ids(vox)).toEqual(['uaudio_ua_1176', ...chainOf('vocal', 'best')]);
    await logic.removeTier(session, vox);
    await engine.settled();
    expect(ids(vox)).toEqual(['uaudio_ua_1176']);
  });

  it('A/B bypasses the chain and mutes the send, then restores both', async () => {
    const { engine, luna, session, gtr } = await connected();
    await logic.applyTier(session, luna.plugins, gtr, 'guitar', 'good');
    await engine.settled();
    await logic.setTierIn(session, gtr, false);
    await engine.settled();
    expect(logic.bypassed(session, gtr)).toBe(true);
    expect(logic.gbbSend(session, gtr).mute.on).toBe(true);
    await logic.setTierIn(session, gtr, true);
    await engine.settled();
    expect(logic.bypassed(session, gtr)).toBe(false);
    expect(logic.gbbSend(session, gtr).mute.on).toBe(false);
  });

  it('vocal and guitar on Good share one Pure Plate bus', async () => {
    const { engine, luna, session, vox, gtr } = await connected();
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'good');
    await logic.applyTier(session, luna.plugins, gtr, 'guitar', 'good');
    await engine.settled();
    expect(session.buses.items.filter((b) => b.name.value === 'GBB · Pure Plate')).toHaveLength(1);
  });
});

// The mock gives a loaded plug-in only `bypass` and `input`; add the parameters the tier's macros
// and fixed settings use, at mid position, the way the real plug-in lists them.
async function addTierParams(engine, session, track) {
  const ctx = logic.macroContext(session, track);
  const params = [...Object.values(ctx.tier.macros).flat().filter((m) => !m.send), ...(ctx.tier.fixed ?? [])];
  for (const m of params) {
    const path = `${ctx.slots[m.plugin].path}/controls/${m.param}`;
    if (!engine.has(path)) engine.addControl(path, 'parameter', { discrete: false, value: 0.5, real: 0.5, str: '0.5', automatable: true, normalized: 0.5 });
  }
  await engine.settled();
  await logic.loadMacroControls(session, track);
}

describe('macros', () => {
  it('every tier maps every macro of its instrument, inside 0..1', () => {
    for (const inst of logic.INSTRUMENTS) {
      for (const tier of inst.tiers) {
        for (const macro of inst.macros) {
          const maps = tier.macros[macro.key];
          expect(maps?.length, `${inst.key} ${tier.key} ${macro.key}`).toBeGreaterThan(0);
          for (const m of maps.filter((x) => !x.send)) {
            expect(tier.chain.map((s) => s.plugin), `${m.plugin} is in the chain`).toContain(m.plugin);
            for (const v of [m.lo, m.hi]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
          }
        }
      }
    }
  });

  it('the default position reads as the second word for every macro', () => {
    for (const inst of logic.INSTRUMENTS) for (const m of inst.macros) expect(logic.macroWord(m, 0.5)).toBe(m.words[1]);
    for (const inst of logic.INSTRUMENTS) for (const m of inst.macros) expect(logic.macroWord(m, 0.499)).toBe(m.words[1]);
  });

  it('bass has Weight instead of Space, and guitar calls Drive "Gain"', () => {
    expect(logic.macrosOf('bass').map((m) => m.label)).toEqual(['Drive', 'Squeeze', 'Weight']);
    expect(logic.macrosOf('guitar').map((m) => m.label)).toEqual(['Gain', 'Squeeze', 'Space']);
    expect(logic.macrosOf('vocal').map((m) => m.label)).toEqual(['Drive', 'Squeeze', 'Space']);
  });

  it('Squeeze moves the compressors and reads its own position back', async () => {
    const { engine, luna, session, vox } = await connected();
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'good');
    await engine.settled();
    await addTierParams(engine, session, vox);
    await logic.setMacro(session, vox, 'squeeze', 1);
    await engine.settled();
    const ctx = logic.macroContext(session, vox);
    const want = (plugin, param) => logic.macroTargets(ctx.tier, 'squeeze', 1).find((t) => t.plugin === plugin && t.param === param).value;
    expect(ctx.slots.uaudio_ua_1176.controls.byId('input').normalized.value).toBeCloseTo(want('uaudio_ua_1176', 'input'));
    expect(ctx.slots['uaudio_teletronix_la-2a_tc'].controls.byId('peak_reduct').normalized.value).toBeCloseTo(want('uaudio_teletronix_la-2a_tc', 'peak_reduct'));
    expect(logic.macroValue(session, vox, 'squeeze')).toBeCloseTo(1);
    expect(logic.macroWord(logic.macrosOf('vocal')[1], 1)).toBe('Slammed');
  });

  it('a one-shot macro change is one undo step', async () => {
    const { engine, luna, session, vox } = await connected();
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'good');
    await engine.settled();
    await addTierParams(engine, session, vox);
    const before = engine.transactions.length;
    await logic.setMacro(session, vox, 'drive', 0.8);
    await engine.settled();
    expect(engine.transactions.slice(before)).toEqual(['begin', 'commit']);
  });

  it('Space rides the reverb send level, and carries over when the tier changes', async () => {
    const { engine, luna, session, vox } = await connected();
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'good');
    await engine.settled();
    expect(logic.gbbSend(session, vox).gain.real.value).toBeCloseTo(logic.spaceDb(0.5));   // a new track starts at the middle
    await logic.setMacro(session, vox, 'space', 0.9);
    await engine.settled();
    expect(logic.gbbSend(session, vox).gain.real.value).toBeCloseTo(logic.spaceDb(0.9));
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'better');
    await engine.settled();
    expect(logic.macroValue(session, vox, 'space')).toBeCloseTo(0.9);
  });

  it('guitar Better Space also brings up the Galaxy tape echo', async () => {
    const { engine, luna, session, gtr } = await connected();
    await logic.applyTier(session, luna.plugins, gtr, 'guitar', 'better');
    await engine.settled();
    await addTierParams(engine, session, gtr);
    await logic.setMacro(session, gtr, 'space', 1);
    await engine.settled();
    expect(logic.macroContext(session, gtr).slots.uaudio_galaxy_tape_echo.controls.byId('echo_vol').normalized.value).toBeCloseTo(0.4);
  });
});

describe('macro readouts', () => {
  // The knob reads its position from the first mapping; a stepped control there would snap it.
  const STEPPED = new Set(['line_gain', 'ch1warmth', 'ch1comp', 'input_gain', 'comp_byp', 'model', 'input_select']);
  it('no macro reads back from a stepped control', () => {
    for (const inst of logic.INSTRUMENTS) for (const tier of inst.tiers) for (const [key, maps] of Object.entries(tier.macros)) {
      expect(STEPPED.has(maps[0].param), `${inst.key} ${tier.key} ${key} reads ${maps[0].param}`).toBe(false);
    }
  });
});

describe('selection', () => {
  it('narrows a multi-track selection to the edited track, and leaves other selections alone', async () => {
    const { engine, luna, session, vox, gtr } = await connected();
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'good');
    await engine.settled();
    await session.context.selectionTracks.set([vox.id, gtr.id]);
    await engine.settled();
    await logic.setMacro(session, vox, 'space', 0.8);
    await engine.settled();
    expect(session.context.selectionTracks.value).toEqual([vox.id]);
    await session.context.selectionTracks.set([gtr.id]);           // the edited track is not selected
    await engine.settled();
    await logic.setMacro(session, vox, 'space', 0.6);
    await engine.settled();
    expect(session.context.selectionTracks.value).toEqual([gtr.id]);
  });
});

async function addEqControls(engine, slot) {
  const add = (id, discrete, real, str) => { const path = `${slot.path}/controls/${id}`; if (!engine.has(path)) engine.addControl(path, 'parameter', { discrete, value: 0, real, str, automatable: true, normalized: 0 }); };
  add('slot_1', true, 0, 'Empty');
  for (let b = 1; b <= 8; b++) {
    add(`eq_b${b}_on`, true, b === 1, b === 1 ? 'On' : 'Off');
    add(`eq_b${b}_type`, true, b === 8 ? 2 : 0, 'Bell');
    add(`eq_b${b}_slope`, true, 12, '12 dB/oct');
    add(`eq_b${b}_freq`, false, 1000, '1.00 kHz');
    add(`eq_b${b}_gain`, false, 0, '0.0 dB');
    add(`eq_b${b}_q`, false, 0.707, '0.707');
  }
  await engine.settled();
  await slot.controls.load();
}

describe('LUNA Channel EQ', () => {
  it('draws bells, shelves and cuts: gain at the centre, half at a shelf corner, -3 dB at a cut', () => {
    const T = Object.fromEntries(logic.EQ_TYPES.map((n, i) => [n, i]));
    expect(logic.eqResponse([{ on: true, type: T.Bell, freq: 1000, gain: 4, q: 1 }], [1000])[0]).toBeCloseTo(4, 1);
    expect(logic.eqResponse([{ on: true, type: T.Bell, freq: 1000, gain: 4, q: 1 }], [50])[0]).toBeCloseTo(0, 1);
    expect(logic.eqResponse([{ on: true, type: T['High Shelf'], freq: 8000, gain: 6, q: 0.707 }], [8000])[0]).toBeCloseTo(3, 0);
    expect(logic.eqResponse([{ on: true, type: T['Low Cut'], freq: 100, slope: 24 }], [100])[0]).toBeCloseTo(-3, 0);
    expect(logic.eqResponse([{ on: false, type: T.Bell, freq: 1000, gain: 9, q: 1 }], [1000])[0]).toBe(0);
  });

  it("puts the instrument's preset on the Equalizer module and turns the other bands off", async () => {
    const { engine, luna, session, vox } = await connected();
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'good');
    await engine.settled();
    const eq = logic.eqSlot(session, vox);
    expect(eq).toBeTruthy();
    await addEqControls(engine, eq);
    await logic.applyEqPreset(eq, 'vocal');
    await engine.settled();
    expect(eq.controls.byId('slot_1').real.value).toBe(1);
    const bands = logic.eqBands(eq);
    const on = bands.filter((b) => b.on);
    expect(on.map((b) => b.band)).toEqual(logic.EQ_PRESETS.vocal.map((b) => b.band));
    expect(on.find((b) => b.band === 5).freq).toBe(3200);
    expect(on.find((b) => b.band === 3).gain).toBe(-2.5);
  });

  it('keeps the same LUNA Channel, and the edits on it, when the tier changes', async () => {
    const { engine, luna, session, vox } = await connected();
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'good');
    await engine.settled();
    const eq = logic.eqSlot(session, vox);
    await addEqControls(engine, eq);
    await eq.controls.byId('eq_b5_gain').real.set(4.5);
    await engine.settled();
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'best');
    await engine.settled();
    const after = logic.eqSlot(session, vox);
    expect(after.id).toBe(eq.id);
    expect(after.controls.byId('eq_b5_gain').real.value).toBe(4.5);
  });
});

describe('mapping bends', () => {
  it('a mapping with a midpoint passes through it at 50 % and stays straight without one', () => {
    expect(logic.mapValue({ lo: 0.2, hi: 0.6 }, 0.5)).toBeCloseTo(0.4);
    const bent = { lo: 0.2, hi: 0.3, mid: 0.15 };
    expect(logic.mapValue(bent, 0)).toBeCloseTo(0.2);
    expect(logic.mapValue(bent, 0.5)).toBeCloseTo(0.15);
    expect(logic.mapValue(bent, 0.75)).toBeCloseTo(0.225);
    expect(logic.mapValue(bent, 1)).toBeCloseTo(0.3);
  });

  it('every readout mapping can be read back (it moves and does not bend)', () => {
    for (const inst of logic.INSTRUMENTS) for (const tier of inst.tiers) for (const [key, maps] of Object.entries(tier.macros)) {
      const r = maps[0];
      if (r.send) continue;
      expect(r.hi, `${inst.key} ${tier.key} ${key}`).not.toBe(r.lo);
      expect(r.mid, `${inst.key} ${tier.key} ${key}`).toBeUndefined();
    }
  });
});

describe('live rings', () => {
  it('reads gain reduction from needle meters (falling) and the Distressor (rising)', () => {
    expect(logic.grAmount('uaudio_ua_1176', 0.7)).toBe(0);
    expect(logic.grAmount('uaudio_ua_1176', 0.04)).toBeCloseTo(1);
    expect(logic.grAmount('uaudio_teletronix_la-2a_tc', 0.33)).toBeCloseTo(0.5);
    expect(logic.grAmount('uaudio_distressor', 0)).toBe(0);
    expect(logic.grAmount('uaudio_distressor', 0.4)).toBeCloseTo(0.5);
    expect(logic.grAmount('uaudio_neve_1073', 0.3)).toBe(0);          // no GR meter
  });

  it('every Squeeze macro has at least one compressor it can meter', () => {
    for (const inst of logic.INSTRUMENTS) {
      for (const tier of inst.tiers) {
        const plugins = (tier.macros.squeeze ?? []).filter((m) => !m.send).map((m) => m.plugin);
        expect(plugins.some((p) => logic.GR_METERS[p]), `${inst.key} ${tier.key}`).toBe(true);
      }
    }
  });

  it("follows the Squeeze compressors' meters on the track, skipping one switched to VU", async () => {
    const { engine, luna, session, vox } = await connected();
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'good');
    await engine.settled();
    await addTierParams(engine, session, vox);
    const ctx = logic.macroContext(session, vox);
    const meter = (plugin, id, level) => engine.addNode(`${ctx.slots[plugin].path}/meters/${id}`, { properties: { type: 'meter', enabled: true, num_streams: 1, level: [level], peak: [0], clip: [0] } });
    meter('uaudio_ua_1176', 'vu', 0.7);
    meter('uaudio_teletronix_la-2a_tc', 'vu_meter', 0.62);
    const sw = `${ctx.slots['uaudio_teletronix_la-2a_tc'].path}/controls/meter`;
    engine.addControl(sw, 'parameter', { discrete: true, value: 0.5, real: 0.5, str: 'GR', automatable: false, normalized: 0.5 });
    await engine.settled();
    await logic.loadMacroControls(session, vox);

    const grs = logic.grMeters(session, vox);
    expect(grs.map((g) => g.plugin).sort()).toEqual(['uaudio_teletronix_la-2a_tc', 'uaudio_ua_1176']);
    const stops = grs.map((g) => g.meter.onChange(() => {}));
    engine.setValue(`${ctx.slots.uaudio_ua_1176.path}/meters/vu`, 'level', [0.37]);
    await engine.settled();
    expect(logic.squeezeAmount(grs)).toBeCloseTo(0.25);            // 1176 half way, LA-2A at rest

    engine.setValue(sw, 'string_value', 'VU');
    await engine.settled();
    expect(logic.grMeters(session, vox).map((g) => g.plugin)).toEqual(['uaudio_ua_1176']);
    stops.forEach((s) => s());
  });
});

describe('blind shootout', () => {
  it('compares the dry track with every unlocked tier', async () => {
    const free = await connected({ plugins: EXPLORE });
    expect(logic.shootoutContenders(free.luna.plugins, 'vocal')).toEqual(['dry', 'good']);
    const spark = await connected();
    expect(logic.shootoutContenders(spark.luna.plugins, 'vocal')).toEqual(['dry', 'good', 'better', 'best']);
  });

  it('deals every contender to its own letter', () => {
    const seq = [0.9, 0.1, 0.5];
    const dealt = logic.dealShootout(['dry', 'good', 'better', 'best'], () => seq.shift());
    expect(dealt.map((d) => d.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(dealt.map((d) => d.key).sort()).toEqual(['best', 'better', 'dry', 'good']);
  });

  it('switches between dry and tiers, always ending with the whole chain in', async () => {
    const { engine, luna, session, vox } = await connected();
    await logic.playContender(session, luna.plugins, vox, 'vocal', 'best');
    await engine.settled();
    expect(logic.tierOf(session, vox)).toBe('best');
    expect(logic.bypassed(session, vox)).toBe(false);

    await logic.playContender(session, luna.plugins, vox, 'vocal', 'dry');
    await engine.settled();
    expect(logic.bypassed(session, vox)).toBe(true);

    // From dry to another tier: kept inserts (LA-2A Silver) come back in with the new ones.
    await logic.playContender(session, luna.plugins, vox, 'vocal', 'better');
    await engine.settled();
    expect(logic.tierOf(session, vox)).toBe('better');
    expect(logic.chainSlots(session, vox).every(logic.isIn)).toBe(true);

    await logic.playContender(session, luna.plugins, vox, 'vocal', 'dry');
    await logic.playContender(session, luna.plugins, vox, 'vocal', 'better');
    await engine.settled();
    expect(logic.bypassed(session, vox)).toBe(false);
  });
});

describe('tracks built before the EQ', () => {
  it('still count as their tier without LUNA Channel, and re-applying adds it', async () => {
    const { engine, luna, session, vox } = await connected();
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'better');
    await engine.settled();
    await logic.eqSlot(session, vox).clear();
    await engine.settled();
    await vox.effects.load();
    expect(logic.eqSlot(session, vox)).toBeUndefined();
    expect(logic.tierOf(session, vox)).toBe('better');
    await logic.applyTier(session, luna.plugins, vox, 'vocal', 'better');
    await engine.settled();
    expect(logic.eqSlot(session, vox)).toBeTruthy();
  });
});
