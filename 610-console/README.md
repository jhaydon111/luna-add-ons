# 610 Console

A LUNA Add On that presents the open session as Bill Putnam Sr.'s 1960 United Recording console: eight channels of
610 modules with only the controls a 610 had, a doorknob attenuator per channel, a VU meter bridge, an echo send on
every module, and, for tracking, an 8-track tape machine.

Requires LUNA 3.1.1 or later and the UA 610-A Preamp & EQ plug-in (the echo uses Capitol Chambers, the tape
machine the Studer A800; each is optional).

## Install

1. Download `610-console.lunaaddon` from the latest release on this repository's **Releases** page.
2. Double-click the file. LUNA installs it into its Add Ons folder.

Open it from **Add Ons › Apps › 610 Console**.

## The console

A channel is one of the session's first eight audio tracks. **+ Add channel** adds a mono audio track.

- **Meter bridge**: a VU per channel, the PROGRAM L/R meters for the master, a MONITOR knob (the master
  fader) and an ECHO knob (the Echo bus return).
- **Attenuators**: the big black doorknob is the track's fader (drag up or down; double-click resets to 0 dB);
  the toggle under it switches the channel on and off (LUNA's mute).
- **Modules**: each is a UA 610-A in the track's first insert slot, so every channel runs through a 610. Click
  **INSERT 610** to put one in.
  - **L · M · R** assigns the channel to the left, both or the right program bus (the track's pan, hard).
  - **L.F.** and **H.F.** are the 610-A's shelving switches (click to step, Shift-click or right-click to step back).
  - **MIC / LINE** is the input select; **LO / OFF / HI** is the module's gain switch.
  - **LEVEL** is the big knob: the 610's tube output stage.
  - **ECHO** sends the channel to the Echo bus. The first click builds the bus: a stereo aux named Echo with
    Capitol Chambers, fully wet; then the knob is the send level.
- Click a module to make it LUNA's focused track; the lit module follows LUNA's selection. Double-click a
  name to rename the track. **REMOVE CHANNEL** at the foot of a module deletes its track (click twice).

## The 8-track

- **REWIND** returns to the arrangement start; **STOP**, **PLAY** and the red **RECORD** button do what LUNA's
  transport does and follow it. The reels turn while playing; the counter shows a tape count and min:sec.
- Each track: a VU, **SAFE / READY** (record arm), **REPRO / INPUT** (input monitor; the amber legend means
  LUNA is monitoring the input even with the switch off), and the input picker.
- **TAPE ON** puts the Studer A800 tape extension in every channel's tape slot; OFF takes it out.

Every drag is one undo step in LUNA; Cmd+Z / Cmd+Shift+Z work while the Add On has the keyboard.

## Development

```sh
npm install && npm test        # vitest against Luna.MockEngine, no LUNA needed
npx ua-builder serve           # http://localhost:8790/ (?engine=mock for no LUNA)
npx ua-builder install         # link into LUNA's Add Ons folder
npx ua-builder pack --out 610-console.lunaaddon
```
