// Mute Button: logic that does not touch the DOM, so tests can exercise it against Luna.MockEngine.
//
// One big button that mutes the selected track. "Selected" is LUNA's last selected track
// (session.context.lastSelectedTrack); with nothing selected it falls back to the first visible track.

const AddOnLogic = {
  /** The track the button acts on: LUNA's last selected track, else the first visible one. */
  selectedTrack(session) {
    const id = session.context?.lastSelectedTrack?.value;
    const picked = id ? session.tracks.byId(id) : null;
    return picked && session.visibleTracks.includes(picked) ? picked : session.visibleTracks[0] ?? null;
  },

  /** What the button shows. */
  buttonState(session) {
    const track = AddOnLogic.selectedTrack(session);
    if (!track) return { name: 'No track', muted: false, enabled: false };
    return { name: track.name.value ?? track.id, muted: track.mute.on === true, enabled: true };
  },

  /** The one action: toggle the selected track's mute. One write, which the SDK brackets as one undo step. */
  async toggleMute(session) {
    const track = AddOnLogic.selectedTrack(session);
    if (!track) return false;
    await track.mute.toggle();
    return true;
  },
};

globalThis.AddOnLogic = AddOnLogic;
