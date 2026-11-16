// Mute Button: DOM wiring. Connects to LUNA, follows the focused session and its selected track,
// and paints one big button from what logic.js computes.

const $ = (id) => document.getElementById(id);
let luna;
let session;
let releases = [];
const keep = (u) => releases.push(u);
const release = () => {
  for (const u of releases) u();
  releases = [];
};

let watched = null;   // the track whose mute we are listening to
let unwatch = null;

function paint() {
  const state = AddOnLogic.buttonState(session);
  const button = $('mute');
  button.disabled = !state.enabled;
  button.classList.toggle('on', state.muted);
  $('name').textContent = state.name;
  $('label').textContent = state.muted ? 'MUTED' : 'MUTE';
  const track = AddOnLogic.selectedTrack(session);
  if (track !== watched) {
    if (unwatch) unwatch();
    watched = track;
    unwatch = track ? track.mute.real.onChange(paint) : null;
  }
}

async function bindSession() {
  release();
  if (unwatch) { unwatch(); unwatch = null; watched = null; }
  session = luna.sessions.current();
  if (!session) {
    $('status').textContent = 'no session open';
    $('name').textContent = 'No session';
    $('mute').disabled = true;
    return;
  }
  await session.ready();
  $('status').textContent = session.name.value ?? session.uid;
  await Promise.all(session.visibleTracks.map((track) => track.loadStrip()));
  paint();
  keep(session.tracks.onChange(async () => {
    await Promise.all(session.visibleTracks.map((track) => track.loadStrip()));
    paint();
  }));
  keep(session.context.lastSelectedTrack.onChange(paint));
  $('mute').onclick = () => void AddOnLogic.toggleMute(session);
}

async function connect() {
  for (;;) {
    try {
      luna = await Luna.connect();
      break;
    } catch (e) {
      $('status').textContent = e instanceof Luna.NotRunning ? 'waiting for LUNA...' : e.message;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  Luna.bindShortcuts(luna);
  await luna.sessions.ready();
  luna.sessions.focused.onChange(bindSession);
  luna.sessions.items.onChange(bindSession);
  luna.status.onChange(() => {
    if (luna.status.value === 'disconnected') $('status').textContent = 'reconnecting...';
  });
  await bindSession();
}

connect();
