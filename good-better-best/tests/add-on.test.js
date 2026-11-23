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

  it('every instrument has Good on Explore FREE and Better/Best on Spark, three inserts each', () => {
    for (const inst of logic.INSTRUMENTS) {
      expect(inst.tiers.map((t) => t.key)).toEqual(['good', 'better', 'best']);
      expect(inst.tiers.map((t) => t.source)).toEqual(['UAD Explore FREE', 'UAD Spark', 'UAD Spark']);
      for (const t of inst.tiers) expect(t.chain).toHaveLength(3);
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
    expect(ctx.slots.uaudio_ua_1176.controls.byId('input').normalized.value).toBeCloseTo(0.8);
    expect(ctx.slots['uaudio_teletronix_la-2a_tc'].controls.byId('peak_reduct').normalized.value).toBeCloseTo(0.6);
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
