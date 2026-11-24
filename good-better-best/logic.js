// Good Better Best: logic that does not touch the DOM, so tests can exercise it against Luna.MockEngine.
//
// Each track gets an instrument (vocal, guitar or bass, guessed from its name) and a tier. A tier
// is a three-insert channel chain, plus for vocal and guitar a reverb on a shared aux bus reached
// through one of the track's sends. Good runs on UAD Explore FREE plug-ins; Better and Best on
// UAD Spark plug-ins. Guitar assumes a DI electric guitar (the chain starts with an amp).
//
// Plug-in ids were read from LUNA 3.1.2's catalog on 2026-11-23.
// There is no UADx Ampeg (only legacy UAD-2 versions, not in Spark), so bass tiers are
// preamp, compression and saturation.
//
// A tier is unlocked when every plug-in in it is installed and authorized (Plugin.authorized is
// null for plug-ins without UA licensing, which counts as available). A locked tier still shows,
// with what is missing and a "Get with Spark" link.

const SPARK_URL = 'https://www.uaudio.com/spark?utm_source=luna&utm_medium=add_on&utm_campaign=good_better_best';
const BUS_PREFIX = 'GBB · ';
const STORE = 'com.jhaydon.good_better_best.tracks';   // session storage: per track, owned slots + instrument

const P = {
  // UAD Explore FREE
  n610a: { plugin: 'uaudio_610_a', name: '610-A' },
  n610b: { plugin: 'uaudio_610_b', name: '610-B' },
  n1176: { plugin: 'uaudio_ua_1176', name: '1176' },
  la2a: { plugin: 'uaudio_teletronix_la-2a_tc', name: 'LA-2A' },
  century: { plugin: 'uaudio_century_channel_strip', name: 'Century Tube Strip' },
  showtime: { plugin: 'uaudio_showtime_amp', name: 'Showtime 64' },
  purePlate: { plugin: 'uaudio_pure_plate', name: 'Pure Plate' },
  // UAD Spark
  neve: { plugin: 'uaudio_neve_1073', name: 'Neve 1073' },
  revA: { plugin: 'uaudio_ua_1176_rev_a', name: '1176 Rev A' },
  revE: { plugin: 'uaudio_ua_1176ln_rev_e', name: '1176LN Rev E' },
  silver: { plugin: 'uaudio_teletronix_la-2a_silver', name: 'LA-2A Silver' },
  voxbox: { plugin: 'uaudio_manley_voxbox', name: 'Manley VOXBOX' },
  la3a: { plugin: 'uaudio_la3a', name: 'LA-3A' },
  pultec: { plugin: 'uaudio_pultec_eqp-1a', name: 'Pultec EQP-1A' },
  distressor: { plugin: 'uaudio_distressor', name: 'Distressor' },
  fatso: { plugin: 'uaudio_empirical_labs_fatso_jr', name: 'FATSO Jr' },
  dream: { plugin: 'uaudio_dream_amp', name: "Dream '65" },
  lion: { plugin: 'uaudio_lion_amp', name: "Lion '68" },
  galaxy: { plugin: 'uaudio_galaxy_tape_echo', name: 'Galaxy Tape Echo' },
  emt140: { plugin: 'uaudio_emt_140', name: 'EMT 140' },
  lex224: { plugin: 'uaudio_lexicon_224', name: 'Lexicon 224' },
  capitol: { plugin: 'uaudio_capitol_chambers', name: 'Capitol Chambers' },
};

const EXPLORE = 'UAD Explore FREE';
const SPARK = 'UAD Spark';

// A macro mapping: move `param` of the stage running `plugin` from `lo` to `hi` (normalized) as
// the macro goes 0 -> 1. The first mapping of each macro is its readout: the knob reads its
// position back from it, so it follows undo and edits made in the plug-in window. Ranges come
// from sweeping each parameter in LUNA 3.1.2 (2026-11-23); output trims roughly compensate drive.
const M = (stage, param, lo, hi) => ({ plugin: stage.plugin, param, lo, hi });
const SEND = { send: true };          // the Space macro's send level (see spaceDb)
const F = (stage, param, value) => ({ plugin: stage.plugin, param, value });

const MACROS = {
  drive: { key: 'drive', label: 'Drive', words: ['Clean', 'Warm', 'Hot', 'Driven'] },
  squeeze: { key: 'squeeze', label: 'Squeeze', words: ['Light', 'Even', 'Tight', 'Slammed'] },
  space: { key: 'space', label: 'Space', words: ['Dry', 'Close', 'Room', 'Big'] },
  weight: { key: 'weight', label: 'Weight', words: ['Lean', 'Solid', 'Deep', 'Huge'] },
  gain: { key: 'drive', label: 'Gain', words: ['Clean', 'Edge', 'Crunch', 'Roar'] },
};

const VOCAL_SQUEEZE = (comp) => [M(comp, 'input', 0.35, 0.8), M(comp, 'output', 0.7, 0.55), M(P.silver, 'peak_reduct', 0.15, 0.6), M(P.silver, 'gain', 0.3, 0.42)];
const LA3A_SQUEEZE = [M(P.la3a, 'peak_reduction', 0.2, 0.65), M(P.la3a, 'gain', 0.5, 0.58)];

const INSTRUMENTS = [
  {
    key: 'vocal',
    label: 'Vocal',
    match: /\b(vox|vocals?|voc|lead|bvs?|harmony|harm|choir|singer|verse|chorus)\b/i,
    macros: [MACROS.drive, MACROS.squeeze, MACROS.space],
    tiers: [
      { key: 'good', label: 'Good', source: EXPLORE, chain: [P.n610a, P.n1176, P.la2a], verb: P.purePlate,
        macros: {
          drive: [M(P.n610a, 'level', 0.38, 0.72), M(P.n610a, 'output', 0.55, 0.32)],
          squeeze: [M(P.n1176, 'input', 0.35, 0.8), M(P.n1176, 'output', 0.7, 0.55), M(P.la2a, 'peak_reduct', 0.15, 0.6), M(P.la2a, 'gain', 0.3, 0.42)],
          space: [SEND],
        } },
      { key: 'better', label: 'Better', source: SPARK, chain: [P.neve, P.revA, P.silver], verb: P.emt140,
        macros: {
          drive: [M(P.neve, 'output', 0.55, 0.42), M(P.neve, 'line_gain', 0.43, 0.75)],   // readout first: line_gain is stepped
          squeeze: VOCAL_SQUEEZE(P.revA),
          space: [SEND],
        } },
      { key: 'best', label: 'Best', source: SPARK, chain: [P.voxbox, P.revE, P.silver], verb: P.lex224,
        fixed: [F(P.voxbox, 'comp_byp', 0)],                     // two compressors follow; VOXBOX's own comp out
        macros: {
          drive: [M(P.voxbox, 'input', 0.25, 0.65), M(P.voxbox, 'output', 0.55, 0.4), M(P.voxbox, 'hi_peak', 0, 0.35)],
          squeeze: VOCAL_SQUEEZE(P.revE),
          space: [SEND],
        } },
    ],
  },
  {
    key: 'guitar',
    label: 'Guitar',
    match: /\b(gtrs?|guitars?|gtr\d*|git|elec|rhythm|lead gtr|solo)\b/i,
    macros: [MACROS.gain, MACROS.squeeze, MACROS.space],
    tiers: [
      { key: 'good', label: 'Good', source: EXPLORE, chain: [P.showtime, P.n610b, P.n1176], verb: P.purePlate,
        macros: {
          drive: [M(P.showtime, 'volume', 0.2, 0.85), M(P.showtime, 'output', 0.8, 0.6)],
          squeeze: [M(P.n1176, 'input', 0.3, 0.75), M(P.n1176, 'output', 0.7, 0.58)],
          space: [SEND],
        } },
      { key: 'better', label: 'Better', source: SPARK, chain: [P.dream, P.galaxy, P.la3a], verb: P.emt140,
        fixed: [F(P.galaxy, 'feedback', 0.2)],
        macros: {
          drive: [M(P.dream, 'volume', 0.25, 0.85), M(P.dream, 'boost_amount', 0, 0.6), M(P.dream, 'output', 0.55, 0.4)],
          squeeze: LA3A_SQUEEZE,
          space: [SEND, M(P.galaxy, 'echo_vol', 0.05, 0.4)],      // more space brings the tape echo up too
        } },
      { key: 'best', label: 'Best', source: SPARK, chain: [P.lion, P.neve, P.la3a], verb: P.capitol,
        macros: {
          drive: [M(P.lion, 'volume_1', 0.3, 0.95), M(P.lion, 'boost_amount', 0.2, 0.6), M(P.lion, 'output', 0.62, 0.48)],
          squeeze: LA3A_SQUEEZE,
          space: [SEND],
        } },
    ],
  },
  {
    key: 'bass',
    label: 'Bass',
    match: /\b(bass|bs|bass di|sub|low end)\b/i,
    macros: [MACROS.drive, MACROS.squeeze, MACROS.weight],
    tiers: [
      { key: 'good', label: 'Good', source: EXPLORE, chain: [P.century, P.n1176, P.la2a], verb: null,
        macros: {
          drive: [M(P.century, 'level', 0.45, 0.75), M(P.century, 'output', 0.55, 0.4)],
          squeeze: [M(P.century, 'compression', 0.2, 0.7), M(P.n1176, 'input', 0.3, 0.7), M(P.n1176, 'output', 0.7, 0.6), M(P.la2a, 'peak_reduct', 0.1, 0.45)],
          weight: [M(P.century, 'low_shelf', 0.45, 0.72)],
        } },
      { key: 'better', label: 'Better', source: SPARK, chain: [P.pultec, P.revA, P.silver], verb: null,
        fixed: [F(P.pultec, 'low_freq', 0.5)],                   // 60 cps
        macros: {
          drive: [M(P.pultec, 'output', 0.5, 0.68), M(P.silver, 'gain', 0.4, 0.32)],
          squeeze: [M(P.revA, 'input', 0.3, 0.75), M(P.revA, 'output', 0.72, 0.6), M(P.silver, 'peak_reduct', 0.1, 0.5)],
          weight: [M(P.pultec, 'lf_boost', 0, 0.6)],
        } },
      { key: 'best', label: 'Best', source: SPARK, chain: [P.neve, P.distressor, P.fatso], verb: null,
        macros: {
          drive: [M(P.neve, 'output', 0.55, 0.45), M(P.fatso, 'ch1warmth', 0, 0.75), M(P.neve, 'line_gain', 0.43, 0.7)],   // stepped ones after the readout
          squeeze: [M(P.distressor, 'input', 0.3, 0.7), M(P.distressor, 'output', 0.7, 0.55)],
          weight: [M(P.neve, 'lf_gain', 0.45, 0.72)],
        } },
    ],
  },
];

const DEFAULT_MACRO = 0.5;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
// Space: the send level, -30 dB at 0.02 up to -6 dB at 1; fully off at 0.
const spaceDb = (v) => (v <= 0.01 ? -144 : lerp(-30, -6, v));
const spaceFromDb = (db) => (db <= -100 ? 0 : clamp01((db + 30) / 24));

// Gain reduction, read from each compressor's own meter (`<slot>/meters/<id>`), for the Squeeze
// knob's live ring. Measured in LUNA 3.1.2 on 2026-11-23 with a vocal and a bass playing: with the
// meter switch on GR, the 1176 and LA-3A needles rest at 0.70 and the LA-2A's at 0.62, and fall
// toward 0.04 (pinned) as gain reduction grows; the Distressor's gain_reduction meter rests at 0
// and rises (0.63 driven hard). The Century's GR meter and a bypassed VOXBOX compressor do not
// move, so they are left out.
const NEEDLE_1176 = { meter: 'vu', rest: 0.7, full: 0.04, grSwitch: true };
const NEEDLE_LA2A = { meter: 'vu_meter', rest: 0.62, full: 0.04, grSwitch: true };
const GR_METERS = {
  uaudio_ua_1176: NEEDLE_1176,
  uaudio_ua_1176_rev_a: NEEDLE_1176,
  uaudio_ua_1176ln_rev_e: NEEDLE_1176,
  'uaudio_teletronix_la-2a_tc': NEEDLE_LA2A,
  'uaudio_teletronix_la-2a_silver': NEEDLE_LA2A,
  uaudio_la3a: { meter: 'vu_meter', rest: 0.7, full: 0.04, grSwitch: true },
  uaudio_distressor: { meter: 'gain_reduction', rest: 0, full: 0.8 },
};

const instrumentByKey = (key) => INSTRUMENTS.find((i) => i.key === key);
const tierOfInstrument = (inst, key) => instrumentByKey(inst)?.tiers.find((t) => t.key === key);
const busName = (verb) => BUS_PREFIX + verb.name;
const ALL_VERBS = [...new Map(INSTRUMENTS.flatMap((i) => i.tiers).filter((t) => t.verb).map((t) => [t.verb.plugin, t.verb])).values()];

// Only inserts this Add On placed are its own: a user's 1176 or LA-2A on the same track is never
// touched. A slot counts while it still holds the plug-in recorded for it.
const store = (session) => session.storage.context(STORE);
const field = (session, track, name) => store(session).value(track.id, name).value;
async function saveField(session, track, name, value) {
  const st = store(session);
  if (st.value(track.id, name).value === undefined) await st.add(track.id, name, value);
  else await st.set(track.id, name, value);
}

// Whether a slot is IN (processing); UADx plug-ins report `in` from their active-low power control.
const isIn = (slot) => slot.in.value !== false;

const AddOnLogic = {
  INSTRUMENTS,
  SPARK_URL,
  busName,
  isIn,
  tierOfInstrument,
  DEFAULT_MACRO,
  spaceDb,
  GR_METERS,

  /** The instrument's three macros: [{ key, label, words }]. */
  macrosOf(instrument) {
    return instrumentByKey(instrument)?.macros ?? [];
  },

  /** A word for a macro position ("Warm", "Tight", ...). */
  macroWord(macro, v) {
    // Boundaries at 30 / 60 / 85 %, so the default 50 % always reads as the second word.
    const x = clamp01(v);
    return macro.words[x < 0.3 ? 0 : x < 0.6 ? 1 : x < 0.85 ? 2 : 3];
  },

  /** What a macro would write at `v`: [{ plugin, param, value }] and, for Space, { send: dB }. */
  macroTargets(tier, key, v) {
    return (tier.macros[key] ?? []).map((m) => (m.send ? { send: spaceDb(v) } : { plugin: m.plugin, param: m.param, value: lerp(m.lo, m.hi, clamp01(v)) }));
  },

  /** Load the controls of the track's chain inserts and sends, before reading or writing macros. */
  async loadMacroControls(session, track) {
    await Promise.all(AddOnLogic.chainSlots(session, track).map((s) => s.controls.load()));
    await track.outputs.load();
    const send = AddOnLogic.gbbSend(session, track);
    if (send) await send.controls.load();
  },

  /** For the track's current tier: { tier, slots: { pluginId: Effect }, send } or undefined. */
  macroContext(session, track) {
    const inst = AddOnLogic.instrumentOf(session, track);
    const tier = tierOfInstrument(inst, AddOnLogic.tierOf(session, track));
    if (!tier) return undefined;
    const slots = {};
    for (const s of AddOnLogic.chainSlots(session, track)) slots[s.pluginId.value] ??= s;
    return { tier, slots, send: AddOnLogic.gbbSend(session, track) };
  },

  /** The controls a macro moves on this track, for touch-bracketing a drag. */
  macroControls(session, track, key) {
    const ctx = AddOnLogic.macroContext(session, track);
    if (!ctx) return [];
    return (ctx.tier.macros[key] ?? [])
      .map((m) => (m.send ? ctx.send?.gain : ctx.slots[m.plugin]?.controls.byId(m.param)))
      .filter(Boolean);
  },

  /** Where a macro sits now, read back from its first mapping (follows undo). 0.5 when unknown. */
  macroValue(session, track, key) {
    const ctx = AddOnLogic.macroContext(session, track);
    const m = ctx?.tier.macros[key]?.[0];
    if (!m) return DEFAULT_MACRO;
    if (m.send) {
      const db = ctx.send?.gain.real.value;
      return typeof db === 'number' ? spaceFromDb(db) : DEFAULT_MACRO;
    }
    const n = ctx.slots[m.plugin]?.controls.byId(m.param)?.normalized.value;
    return typeof n === 'number' && m.hi !== m.lo ? clamp01((n - m.lo) / (m.hi - m.lo)) : DEFAULT_MACRO;
  },

  /** Every macro of the track's instrument: { key: value }. */
  macroValues(session, track) {
    const inst = AddOnLogic.instrumentOf(session, track);
    return Object.fromEntries(AddOnLogic.macrosOf(inst).map((m) => [m.key, AddOnLogic.macroValue(session, track, m.key)]));
  },

  /** Write a macro at `v`. Inside a drag gesture the writes are not bracketed one by one. */
  async writeMacro(session, track, key, v) {
    const ctx = AddOnLogic.macroContext(session, track);
    if (!ctx) return;
    const writes = [];
    for (const t of AddOnLogic.macroTargets(ctx.tier, key, v)) {
      if (t.send !== undefined) { if (ctx.send && ctx.send.gain.real.value !== t.send) writes.push(ctx.send.gain.real.set(t.send)); continue; }
      const c = ctx.slots[t.plugin]?.controls.byId(t.param);
      if (c && c.normalized.value !== t.value) writes.push(c.normalized.set(t.value));
    }
    await Promise.all(writes);
  },

  /** A one-shot macro change (keys, double-click reset): one undo step. */
  async setMacro(session, track, key, v) {
    await AddOnLogic.focusTrack(session, track);
    await session.transaction(`Good Better Best: ${key}`, () => AddOnLogic.writeMacro(session, track, key, v));
  },

  /**
   * LUNA applies a control edit to every selected track when the edited one is among them (the
   * mixer's gang-by-selection). Before editing a track that is selected along with others, select
   * it alone, as clicking it in LUNA would, so the edit stays on this track. A track that is not
   * selected edits alone already, so the selection is left as it is then.
   */
  async focusTrack(session, track) {
    try {
      const sel = session.context.selectionTracks.value ?? [];
      if (sel.length > 1 && sel.includes(track.id)) await session.context.selectionTracks.set([track.id]);
    } catch { /* no edit context (older LUNA): nothing to narrow */ }
  },

  // ---- live rings --------------------------------------------------------------------------

  /** How hard a compressor is working, 0..1, from its meter level (see GR_METERS). */
  grAmount(pluginId, level) {
    const spec = GR_METERS[pluginId];
    if (!spec || typeof level !== 'number') return 0;
    return clamp01((spec.rest - level) / (spec.rest - spec.full));
  },

  /**
   * The gain-reduction meters of the compressors the Squeeze macro moves on this track:
   * [{ plugin, meter }]. A needle meter only shows gain reduction with its switch on GR, so a
   * compressor switched to VU in its window is left out. Load the slots' controls first.
   */
  grMeters(session, track) {
    const ctx = AddOnLogic.macroContext(session, track);
    if (!ctx) return [];
    const plugins = [...new Set((ctx.tier.macros.squeeze ?? []).filter((m) => !m.send).map((m) => m.plugin))];
    return plugins.flatMap((plugin) => {
      const spec = GR_METERS[plugin];
      const slot = ctx.slots[plugin];
      if (!spec || !slot) return [];
      const sw = slot.controls.byId('meter')?.display.value;
      if (spec.grSwitch && sw !== undefined && sw.trim() !== 'GR') return [];
      return [{ plugin, meter: new Luna.Meter(slot.client, `${slot.path}/meters/${spec.meter}`) }];
    });
  },

  /**
   * The Squeeze ring, 0..1: the compressors' gain reduction averaged, so the ring still moves when
   * a 1176 pins on a hot source (it did on a mastered vocal, from Squeeze 50 %).
   */
  squeezeAmount(grMeters) {
    if (!grMeters.length) return 0;
    return grMeters.reduce((a, g) => a + AddOnLogic.grAmount(g.plugin, g.meter.max), 0) / grMeters.length;
  },

  // ---- blind shootout ----------------------------------------------------------------------

  /** What a blind test compares on this instrument: the dry track and every unlocked tier. */
  shootoutContenders(plugins, instrument) {
    return ['dry', ...AddOnLogic.access(plugins, instrument).filter((a) => a.unlocked).map((a) => a.key)];
  },

  /** Deal the contenders to letters at random: [{ letter, key }]. */
  dealShootout(contenders, random = Math.random) {
    const keys = [...contenders];
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys.map((key, i) => ({ letter: 'ABCDEFGH'[i], key }));
  },

  /**
   * Make the track sound like one contender: 'dry' bypasses the chain (and mutes its send); a
   * tier builds it if needed, macros carried over, and makes sure every insert is in.
   */
  async playContender(session, plugins, track, instrument, key) {
    if (key === 'dry') {
      if (AddOnLogic.chainSlots(session, track).length && !AddOnLogic.bypassed(session, track)) await AddOnLogic.setTierIn(session, track, false);
      return { failures: {} };
    }
    let result = { failures: {} };
    if (AddOnLogic.tierOf(session, track) !== key) result = await AddOnLogic.applyTier(session, plugins, track, instrument, key);
    await track.effects.load();
    await track.outputs.load();
    const send = AddOnLogic.gbbSend(session, track);
    if (send) await send.controls.load();
    if (AddOnLogic.chainSlots(session, track).some((s) => !isIn(s)) || send?.mute.on) await AddOnLogic.setTierIn(session, track, true);
    return result;
  },

  /** Load the session records (ownership, instruments); call once per session before the rest. */
  async loadOwnership(session) {
    await store(session).load();
  },

  /** The instrument a track name suggests, or undefined. */
  guessInstrument(name) {
    // Most specific first: "Bass Gtr" is a bass, "Lead Gtr" a guitar, "Lead Vox" a vocal.
    return ['bass', 'guitar', 'vocal'].find((k) => instrumentByKey(k).match.test(name ?? ''));
  },

  /** The track's instrument: the one the user picked, else a guess from its name, else undefined. */
  instrumentOf(session, track) {
    return field(session, track, 'instrument') ?? AddOnLogic.guessInstrument(track.name.value);
  },

  /** Remember the user's pick for this track (saved with the session, undoable). */
  async setInstrument(session, track, key) {
    await saveField(session, track, 'instrument', key);
  },

  /** For each of the instrument's tiers: { key, label, source, unlocked, missing }. Load luna.plugins first. */
  access(plugins, instrument) {
    const inst = instrumentByKey(instrument);
    if (!inst) return [];
    return inst.tiers.map((tier) => {
      const missing = [...tier.chain, ...(tier.verb ? [tier.verb] : [])]
        .filter((s) => {
          const p = plugins.items.find((x) => x.pluginId.value === s.plugin);
          return !p || p.installed.value === false || p.authorized.value === false;
        })
        .map((s) => s.name);
      return { key: tier.key, label: tier.label, source: tier.source, unlocked: missing.length === 0, missing: [...new Set(missing)] };
    });
  },

  /** The inserts on the track that this Add On placed, in slot order. */
  chainSlots(session, track) {
    const owned = field(session, track, 'owned') ?? {};
    return track.loadedEffects.filter((s) => !s.pluginError.value && owned[s.id] === s.pluginId.value);
  },

  /** The tier (of the track's instrument) whose whole chain is on the track, else undefined. */
  tierOf(session, track) {
    const inst = instrumentByKey(AddOnLogic.instrumentOf(session, track));
    if (!inst) return undefined;
    const on = AddOnLogic.chainSlots(session, track).map((s) => s.pluginId.value);
    return [...inst.tiers].reverse().find((t) => t.chain.every((s) => on.includes(s.plugin)))?.key;
  },

  /** The GBB reverb buses in the session, by reverb plug-in id. */
  verbBuses(session) {
    const out = {};
    for (const verb of ALL_VERBS) {
      const bus = session.buses.items.find((b) => b.name.value === busName(verb));
      if (bus) out[verb.plugin] = bus;
    }
    return out;
  },

  /** The track's send that feeds a GBB bus, if any. Call `track.outputs.load()` first. */
  gbbSend(session, track) {
    const ids = new Set(Object.values(AddOnLogic.verbBuses(session)).map((b) => b.id));
    return track.outputs.items.find((o) => o.id.startsWith('send_') && ids.has(o.busUid.value));
  },

  /** Find the reverb's bus or make it: a stereo aux with the reverb set 100 % wet. */
  async ensureVerbBus(session, plugins, verb) {
    const have = AddOnLogic.verbBuses(session)[verb.plugin];
    if (have) return have;
    const bus = await session.newBus({ name: busName(verb) });
    const slot = await bus.insert(verb.plugin);
    if (slot) {
      // The reverb's manifest names its wet-solo switch (`wet_solo` or `wetsolo`, solo_value 1).
      const manifest = plugins.items.find((p) => p.pluginId.value === verb.plugin)?.manifest.value;
      const ws = manifest?.wet_solo_parameter ?? { id: 'wet_solo', solo_value: 1 };
      await slot.controls.load();
      const c = slot.controls.byId(ws.id);
      if (c) await c.normalized.set(ws.solo_value);
    }
    return bus;
  },

  /**
   * Put the instrument's tier on the track. Takes off the other inserts this Add On placed,
   * inserts this tier's missing ones into free slots in chain order, and points one send at the
   * tier's reverb bus (or takes the send off, for bass). The inserts are one undo step. A
   * plug-in that will not load (not authorized here, no free slot) is reported and the rest
   * still build. Resolves to { failures: { name: message } }.
   */
  async applyTier(session, plugins, track, instrument, key) {
    const tier = tierOfInstrument(instrument, key);
    if (!tier) throw new Error(`no ${key} tier for ${instrument}`);
    const failures = {};
    await AddOnLogic.focusTrack(session, track);
    await AddOnLogic.loadOwnership(session);
    await track.effects.load();
    const want = tier.chain.map((s) => s.plugin);
    // Macro positions carry over from the tier that is on now, so Good vs Best compares like for like.
    let carry = {};
    if (AddOnLogic.tierOf(session, track)) {
      await AddOnLogic.loadMacroControls(session, track);
      carry = AddOnLogic.macroValues(session, track);
    }

    // 1. Clear what does not belong and queue what is missing, as one undo step. LUNA holds a
    //    transaction's edits until the commit, so plug-ins finish loading after it.
    const pending = [];
    const owned = {};
    await session.transaction(`Good Better Best: ${instrumentByKey(instrument).label} ${tier.label}`, async () => {
      const kept = new Set();
      const reuse = [];
      for (const slot of AddOnLogic.chainSlots(session, track)) {
        const id = slot.pluginId.value;
        if (want.includes(id) && !kept.has(id)) { kept.add(id); owned[slot.id] = id; }
        else { await slot.clear(); reuse.push(slot); }
      }
      // Free slots in slot order: empty ones and the ones just cleared (they read empty after the commit).
      const free = track.effectSlots.filter((e) => e.isEmpty || reuse.includes(e));
      for (const s of tier.chain) {
        if (kept.has(s.plugin)) continue;
        const target = free.shift();
        if (!target) { failures[s.name] = 'no free insert slot'; continue; }
        await target.setPlugin(s.plugin, { wait: false });
        owned[target.id] = s.plugin;
        pending.push([s, target]);
      }
      await saveField(session, track, 'owned', owned);
      await saveField(session, track, 'instrument', instrument);
    });

    // 2. Wait for each to load; one that fails keeps its slot with an error, so free it.
    await Promise.all(pending.map(async ([s, target]) => {
      try {
        await target.waitForPlugin(20_000, s.plugin);
        if (target.pluginError.value) throw new Error(target.pluginError.value);
      } catch (e) {
        failures[s.name] = target.pluginError.value ?? e.code ?? e.message;
        delete owned[target.id];
        await target.clear().catch(() => {});
      }
    }));
    if (Object.keys(failures).length) await saveField(session, track, 'owned', owned);

    // 3. The send: retarget the GBB send if there is one, else take the first free send. A tier
    //    with no reverb (bass) takes the GBB send off instead.
    try {
      await track.outputs.load();
      let send = AddOnLogic.gbbSend(session, track);
      if (!tier.verb) {
        for (const d of send?.destinations.value ?? []) await send.unassign(d.uid);
      } else {
        const bus = await AddOnLogic.ensureVerbBus(session, plugins, tier.verb);
        await track.outputs.load();
        send = AddOnLogic.gbbSend(session, track);
        send ??= track.outputs.items.find((o) => o.id.startsWith('send_') && !o.assigned);
        if (!send) failures[tier.verb.name] = 'no free send';
        else {
          if (send.busUid.value !== bus.id) await send.retarget(bus.id);
          await send.controls.load();
          if (send.mute.on) await send.mute.toggle();
        }
      }
    } catch (e) {
      failures[tier.verb?.name ?? 'send'] = e.code ?? e.message;
    }

    // 4. Fixed settings and the macros, as one more undo step.
    await AddOnLogic.loadMacroControls(session, track);
    const ctx = AddOnLogic.macroContext(session, track);
    if (ctx) {
      await session.transaction(`Good Better Best: ${tier.label} settings`, async () => {
        for (const f of tier.fixed ?? []) {
          const c = ctx.slots[f.plugin]?.controls.byId(f.param);
          if (c && c.normalized.value !== f.value) await c.normalized.set(f.value);
        }
        for (const m of instrumentByKey(instrument).macros) await AddOnLogic.writeMacro(session, track, m.key, carry[m.key] ?? DEFAULT_MACRO);
      });
    }
    return { failures };
  },

  /** Take the tier off the track: its chain inserts and its GBB send. One undo step. */
  async removeTier(session, track) {
    await AddOnLogic.focusTrack(session, track);
    await track.outputs.load();
    const send = AddOnLogic.gbbSend(session, track);
    await session.transaction('Good Better Best: off', async () => {
      for (const slot of AddOnLogic.chainSlots(session, track)) await slot.clear();
      await saveField(session, track, 'owned', {});
      for (const d of send?.destinations.value ?? []) await send.unassign(d.uid);
    });
  },

  /** A/B: bypass (on = false) or restore the chain inserts and mute or unmute the send. One undo step. */
  async setTierIn(session, track, on) {
    await AddOnLogic.focusTrack(session, track);
    await track.outputs.load();
    const send = AddOnLogic.gbbSend(session, track);
    if (send) await send.controls.load();
    await session.transaction(on ? 'Good Better Best: in' : 'Good Better Best: bypass', async () => {
      for (const slot of AddOnLogic.chainSlots(session, track)) if (isIn(slot) !== on) await slot.setIn(on);
      if (send && send.mute.on === on) await send.mute.toggle();
    });
  },

  /** True when the track has chain inserts and every one is bypassed. */
  bypassed(session, track) {
    const slots = AddOnLogic.chainSlots(session, track);
    return slots.length > 0 && slots.every((s) => !isIn(s));
  },
};

globalThis.AddOnLogic = AddOnLogic;
