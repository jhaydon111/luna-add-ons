// 610 Console: engine logic with no DOM, so tests exercise it against Luna.MockEngine.
//
// The console is Bill Putnam Sr.'s 1960 United Recording desk: eight channels of 610 modules, a doorknob
// attenuator per channel, a VU bridge, an echo send on every module. Each module here is the UA 610-A plug-in
// in the track's first insert slot, so every channel runs through a 610. The echo is an aux bus
// named Echo with UA's Capitol Chambers (Putnam built those chambers) and each module's ECHO knob is the
// track's send to it. The tape machine is the track's record arm, input monitor and input, and LUNA's tape
// slot with the Studer A800 tape extension when the TAPE switch is on.
//
// Slots: the 610-A is an ordinary plug-in, so it lives in an insert slot. LUNA's `console` and `tape` slots
// accept any plug-in id, but LUNA then treats it as a console or tape extension and asserts when it draws
// the strip (Rack_LookAndFeelBase GetConsoleModelCustomization, seen 11/15 on adding a track), so only the
// `_ext` / `_console` extension builds (here uaudio_studer_a800_console) go in those slots.
//
// Everything here takes SDK objects and returns plain data or performs an engine action. main.js draws.

const MAX_CHANNELS = 8;
const PLUGIN_610 = 'uaudio_610_a';
const SLOT_610 = 'effect_0';     // the first insert slot; see the note on slots above
const PLUGIN_TAPE = 'uaudio_studer_a800_console';   // LUNA's tape extension build of the Studer, the only kind the tape slot takes
const SLOT_TAPE = 'tape';
const PLUGIN_ECHO = 'uaudio_capitol_chambers';
const ECHO_BUS = 'Echo';

/** The 610-A plug-in parameters the original module's front panel had, by panel name. */
const MODULE = {
  micLine: 'input_select',   // MIC / LINE toggle: "Line", "Mic"
  gain: 'input_gain',        // the module's gain switch: "Lo", "Off", "Hi"
  lf: 'low_eq_gain',         // L.F. shelf: -6, 0, +6 dB
  hf: 'hi_eq_gain',          // H.F. shelf: -6, 0, +3, +6 dB
  level: 'level',            // the big knob: the tube output stage, continuous
};

const settleProp = (prop, want, what) => Luna.settle(() => prop.value === want, what);

const AddOnLogic = {
  MAX_CHANNELS, PLUGIN_610, SLOT_610, PLUGIN_TAPE, SLOT_TAPE, PLUGIN_ECHO, ECHO_BUS, MODULE,

  // ---------------------------------------------------------------- channels

  /** The desk's channels: the first eight visible audio tracks, in LUNA's order. */
  channels(session) {
    return session.visibleTracks.filter((t) => t.trackType.value === 'audio').slice(0, MAX_CHANNELS);
  },

  /** True while the desk has a free channel. */
  canAddChannel(session) {
    return AddOnLogic.channels(session).length < MAX_CHANNELS;
  },

  /** The next free channel name: "Ch 1".."Ch 8", skipping names in use. */
  nextChannelName(session) {
    const used = new Set(session.visibleTracks.map((t) => (t.name.value ?? '').trim().toLowerCase()));
    for (let n = 1; n <= MAX_CHANNELS; n++) if (!used.has(`ch ${n}`)) return `Ch ${n}`;
    return `Ch ${AddOnLogic.channels(session).length + 1}`;
  },

  /** Add a mono audio track as the next channel; resolves once LUNA lists it. */
  async addChannel(session) {
    if (!AddOnLogic.canAddChannel(session)) throw new Error('The desk has eight channels.');
    const before = AddOnLogic.channels(session).length;
    const name = AddOnLogic.nextChannelName(session);
    await session.newTrack({ name, trackType: 'audio', stemFormat: 'mono' });
    await Luna.settle(() => AddOnLogic.channels(session).length > before, 'new channel', { refresh: () => session.tracks.reload() });
    return AddOnLogic.channels(session).find((t) => t.name.value === name) ?? AddOnLogic.channels(session)[before];
  },

  /** LUNA's focused track id, or null. */
  focusedId(session) {
    return session.context?.lastSelectedTrack?.value ?? null;
  },

  /** Make a channel LUNA's focused and selected track. */
  async focusChannel(session, ch) {
    const ctx = session.context;
    await Promise.all([ctx.lastSelectedTrack.set(ch.id), ctx.select?.({ trackUids: [ch.id] }) ?? Promise.resolve()]);
  },

  /** ARGB integer as the engine stores it to a CSS colour. */
  cssColor(argb) {
    if (typeof argb !== 'number') return '';
    return `#${(argb & 0xffffff).toString(16).padStart(6, '0')}`;
  },

  // ---------------------------------------------------------------- the 610 module

  /** The channel's 610 module: the first insert slot holding a 610-A; needs `ch.effects` loaded. */
  find610(ch) {
    return ch.effects.items.find((e) => e.pluginId.value === PLUGIN_610 && /^effect_\d+$/.test(e.id));
  },

  /** Put a 610-A in the first free insert slot when the channel has none, and load its controls. */
  async ensure610(ch) {
    await ch.effects.load();
    let slot = AddOnLogic.find610(ch);
    if (!slot) {
      slot = ch.effects.items.find((e) => /^effect_\d+$/.test(e.id) && e.isEmpty) ?? ch.effects.byId(SLOT_610);
      if (!slot) throw new Error(`${ch.name.value ?? 'This channel'} has no free insert slot.`);
      await slot.setPlugin(PLUGIN_610, { timeoutMs: 15000 });
    }
    await slot.controls.load();
    return slot;
  },

  /** The module's front-panel controls from a 610 slot, by panel name; missing ones are undefined. */
  moduleControls(slot) {
    const out = {};
    for (const [name, id] of Object.entries(MODULE)) {
      const control = slot.controls.items.find((c) => c.id === id);
      out[name] = control && control.initialized?.value !== null ? control : undefined;   // a ghost of a cleared plug-in is null
    }
    return out;
  },

  /** A discrete control's position (0-based) among its real values, or -1. */
  stepIndex(control) {
    const values = control.realValues.value ?? [];
    return values.findIndex((v) => v === control.real.value);
  },

  /** The display text of a discrete control's current step, from LUNA's own strings. */
  stepLabel(control) {
    const i = AddOnLogic.stepIndex(control);
    const labels = control.displayValues.value ?? [];
    return (i >= 0 && labels[i]) || control.display.value || '';
  },

  /** Move a rotary switch by `delta` positions (wrapping); one discrete write, one undo step. */
  async stepSwitch(control, delta = 1, { wrap = true } = {}) {
    const values = control.realValues.value ?? [];
    if (!values.length) throw new Error('Not a stepped control.');
    let i = AddOnLogic.stepIndex(control);
    if (i < 0) i = 0;
    let next = i + delta;
    if (wrap) next = ((next % values.length) + values.length) % values.length;
    else next = Math.max(0, Math.min(values.length - 1, next));
    if (next === i) return values[i];
    await control.real.set(values[next]);
    await settleProp(control.real, values[next], control.name.value ?? 'switch');
    return values[next];
  },

  /** Knob angle for a normalized value: -150° at the bottom-left to +150° at the bottom-right. */
  knobTurn(normalized) {
    const v = Math.max(0, Math.min(1, normalized ?? 0));
    return (v - 0.5) * 300;
  },

  // ---------------------------------------------------------------- program bus: L · M · R

  /** Where the channel sits on the program bus: 'L', 'M' (both) or 'R', from its pan(s). */
  busAssign(ch) {
    const pans = ch.main.pans.map((p) => p.normalized.value ?? 0.5);
    if (!pans.length) return 'M';
    const avg = pans.reduce((a, b) => a + b, 0) / pans.length;
    return avg < 0.25 ? 'L' : avg > 0.75 ? 'R' : 'M';
  },

  /** Assign the channel to the left, both or the right program bus: hard pans, one write per pan control. */
  async setBusAssign(ch, side) {
    const pans = ch.main.pans;
    const want = (i) => (side === 'L' ? 0 : side === 'R' ? 1 : pans.length > 1 ? i : 0.5);
    for (let i = 0; i < pans.length; i++) {
      const v = want(i);
      if (Math.abs((pans[i].normalized.value ?? 0.5) - v) > 1e-6) await pans[i].normalized.set(v);
    }
    await Luna.settle(() => AddOnLogic.busAssign(ch) === side, 'program bus');
  },

  // ---------------------------------------------------------------- echo

  /** The session's Echo bus, by name, ignoring case; needs `session.buses` loaded. */
  findEchoBus(session) {
    return session.buses.items.find((b) => b.busType.value === 'aux' && String(b.name.value ?? '').trim().toLowerCase() === ECHO_BUS.toLowerCase());
  },

  _echoPending: new WeakMap(),

  /**
   * The Echo bus, made once per session when it has none: a stereo aux with Capitol Chambers fully wet. An
   * existing bus of that name is used as it is. Concurrent calls share one creation.
   */
  ensureEchoBus(session) {
    const pending = AddOnLogic._echoPending.get(session);
    if (pending) return pending;
    const p = (async () => {
      await session.buses.load();
      let bus = AddOnLogic.findEchoBus(session);
      const fresh = !bus;
      if (!bus) {
        await session.newBus({ name: ECHO_BUS, stemFormat: 'stereo' });
        await Luna.settle(() => !!AddOnLogic.findEchoBus(session), 'echo bus', { refresh: () => session.buses.reload() });
        bus = AddOnLogic.findEchoBus(session);
      }
      await bus.loadStrip();
      await bus.effects.load();
      if (fresh && !bus.effects.items.some((e) => e.pluginId.value === PLUGIN_ECHO)) {
        try {
          const slot = await bus.insert(PLUGIN_ECHO);
          await slot.controls.load();
          const mix = AddOnLogic.safeControl(slot, 'mix');
          if (mix) await mix.normalized.set(1);   // the chamber return is all echo; the send sets how much
        } catch { /* the bus still works as a plain return without the chamber */ }
      }
      return bus;
    })();
    AddOnLogic._echoPending.set(session, p);
    p.finally(() => AddOnLogic._echoPending.delete(session)).catch(() => undefined);
    return p;
  },

  safeControl(slot, id) {
    try { return slot.controls.get(id); } catch { return undefined; }
  },

  /** The channel's send routed to the Echo bus, or undefined; needs `ch.outputs` loaded. */
  echoSend(session, ch) {
    const bus = AddOnLogic.findEchoBus(session);
    return bus ? ch.outputs.items.find((o) => o.isSend && (o.destinations.value ?? []).some((d) => d.busUid === bus.id)) : undefined;
  },

  /** Make the channel's ECHO knob live: the bus if needed, a send to it (send_0 preferred), switched on. */
  async connectEcho(session, ch) {
    const bus = await AddOnLogic.ensureEchoBus(session);
    await ch.outputs.load();
    let send = AddOnLogic.echoSend(session, ch);
    if (!send) {
      const sends = ch.outputs.items.filter((o) => o.isSend);
      send = [sends.find((o) => o.id === 'send_0'), ...sends].find((o) => o && !o.assigned);
      if (!send) throw new Error(`Every send on ${ch.name.value ?? 'this channel'} is in use.`);
      await send.assign(bus.id);
    }
    await send.controls.load();
    if (send.enabled.real.value !== true) {
      await send.enabled.real.set(true);
      await settleProp(send.enabled.real, true, 'echo send on');
    }
    return send;
  },

  // ---------------------------------------------------------------- tape machine

  canRecord(ch) {
    const type = ch.trackType?.value;
    return type === 'audio' || type === 'instrument';
  },

  async setArmed(track, armed) {
    if (track.recordEnabled.value === armed) return;
    await track.recordEnabled.set(armed);
    await settleProp(track.recordEnabled, armed, armed ? 'arm' : 'disarm');
  },

  toggleArm(track) {
    return AddOnLogic.setArmed(track, track.recordEnabled.value !== true);
  },

  async toggleMonitor(track) {
    const want = track.inputMonitor.value !== true;
    await track.inputMonitor.set(want);
    await settleProp(track.inputMonitor, want, 'input monitor');
  },

  /** The name of a track's input: LUNA's own description, else the listed input's name, else "No input". */
  inputName(track, inputs = []) {
    const desc = track.inputDesc.value;
    if (desc && typeof desc === 'object' && typeof desc.name === 'string' && desc.name) return desc.name;
    const uid = track.inputNodeUid.value;
    return (uid && inputs.find((i) => i.uid === uid)?.name) || 'No input';
  },

  /** The device inputs a track can take: those matching its mono or stereo format. */
  inputChoices(track, inputs) {
    const stem = track.stemFormat.value;
    return stem ? inputs.filter((i) => i.stemFormat === stem) : inputs.slice();
  },

  async setInput(track, uid) {
    if (!uid) throw new Error('Choose an input.');
    if (track.inputNodeUid.value !== uid) await track.inputNodeUid.set(uid);
    await settleProp(track.inputNodeUid, uid, 'set input');
  },

  /** True when the track's tape slot holds the Studer. */
  tapeOn(ch) {
    const slot = ch.effects.byId(SLOT_TAPE);
    return !!slot && slot.pluginId.value === PLUGIN_TAPE;
  },

  /** Put the Studer tape extension in LUNA's tape slot, or clear it. */
  async setTape(ch, on) {
    await ch.effects.load();
    const slot = ch.effects.byId(SLOT_TAPE);
    if (!slot) throw new Error(`${ch.name.value ?? 'This channel'} has no tape slot.`);
    if (on && slot.pluginId.value !== PLUGIN_TAPE) await slot.setPlugin(PLUGIN_TAPE, { timeoutMs: 15000 });
    if (!on && slot.pluginId.value === PLUGIN_TAPE) await slot.clear();
    await Luna.settle(() => AddOnLogic.tapeOn(ch) === on, on ? 'tape on' : 'tape off');
  },

  // ---------------------------------------------------------------- transport

  recordState(session) {
    const t = session.transport;
    return {
      armed: t.recordEnabled.value === true,
      recording: t.punchedIn?.value === true || (t.recordEnabled.value === true && t.playing.value === true),
      countingIn: t.countingIn?.value === true,
    };
  },

  returnToZero(session) {
    return session.transport.returnToZero();
  },

  /** The tape counter: a four-digit mechanical count from the playhead's seconds (one digit per 0.6 s, like a 7.5 ips counter), and min:sec. */
  counterText(seconds) {
    const s = Math.max(0, seconds ?? 0);
    const digits = String(Math.floor(s / 0.6) % 10000).padStart(4, '0');
    return { digits, clock: Luna.formatMinSec(s, { fraction: 1 }) };
  },
};

globalThis.AddOnLogic = AddOnLogic;
