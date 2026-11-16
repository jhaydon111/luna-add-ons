// Runs against Luna.MockEngine: no LUNA needed. `npm test`.
import { describe, expect, it } from 'vitest';
import { Luna } from '@uaudio/luna-builder-sdk';

globalThis.Luna = Luna; // logic.js is a classic script that reads the Luna global
await import('../logic.js');
const logic = globalThis.AddOnLogic;

async function connected() {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { name: 'Demo', tracks: ['Vocal', 'Bass', 'Drums'] });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  const session = await luna.session();
  await Promise.all(session.tracks.items.map((t) => t.loadStrip()));
  return { engine, luna, session };
}

describe('Mute Button', () => {
  it('acts on the first visible track when nothing is selected', async () => {
    const { session } = await connected();
    expect(logic.selectedTrack(session).name.value).toBe('Vocal');
    expect(logic.buttonState(session)).toEqual({ name: 'Vocal', muted: false, enabled: true });
  });

  it("follows LUNA's last selected track", async () => {
    const { engine, session } = await connected();
    const bass = session.tracks.items.find((t) => t.name.value === 'Bass');
    await session.context.lastSelectedTrack.set(bass.id);
    await engine.settled();
    expect(logic.selectedTrack(session).name.value).toBe('Bass');
  });

  it('mutes and unmutes the selected track, one touched write each', async () => {
    const { engine, session } = await connected();
    expect(await logic.toggleMute(session)).toBe(true);
    await engine.settled();
    expect(logic.buttonState(session).muted).toBe(true);
    expect(await logic.toggleMute(session)).toBe(true);
    await engine.settled();
    expect(logic.buttonState(session).muted).toBe(false);
    const touches = engine.touches.filter((t) => t.includes('mute'));
    expect(touches.length).toBe(4);   // :on, :off per edit
  });

  it('does nothing without a track', async () => {
    const engine = new Luna.MockEngine();
    engine.addSession('empty', { name: 'Empty', tracks: [] });
    await engine.settled();
    const luna = await Luna.connect({ port_: engine.port() });
    const session = await luna.session();
    expect(logic.buttonState(session)).toEqual({ name: 'No track', muted: false, enabled: false });
    expect(await logic.toggleMute(session)).toBe(false);
  });
});
