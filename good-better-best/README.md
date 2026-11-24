# Good · Better · Best

A LUNA Add On (window, shows with a session). One switch per track builds a channel chain at
three tiers. Good runs on UAD Explore FREE. Better and Best run on UAD Spark plug-ins and show
a lock with "Get with Spark" until they're authorized.

The idea comes from Listening Booth (shawnist): a free experience that's complete on its own,
and a Spark upgrade you can name, see and hear.

Each track gets an instrument. It's guessed from the track name ("Lead Vox", "Gtr DI", "Bass DI"),
and the user can change it in the row's picker.

| Instrument | Tier | Channel chain (then LUNA Channel EQ) | Reverb send (shared bus, 100 % wet) |
|---|---|---|---|
| Vocal | Good (Explore FREE) | 610-A → 1176 → LA-2A | Pure Plate |
| Vocal | Better (Spark) | Neve 1073 → 1176 Rev A → LA-2A Silver | EMT 140 |
| Vocal | Best (Spark) | Manley VOXBOX → 1176LN Rev E → LA-2A Silver | Lexicon 224 |
| Guitar (DI) | Good (Explore FREE) | Showtime 64 → 610-B → 1176 | Pure Plate |
| Guitar (DI) | Better (Spark) | Dream '65 → Galaxy Tape Echo → LA-3A | EMT 140 |
| Guitar (DI) | Best (Spark) | Lion '68 → Neve 1073 → LA-3A | Capitol Chambers |
| Bass (DI) | Good (Explore FREE) | Century Tube Strip → 1176 → LA-2A | none |
| Bass (DI) | Better (Spark) | Pultec EQP-1A → 1176 Rev A → LA-2A Silver | none |
| Bass (DI) | Best (Spark) | Neve 1073 → Distressor → FATSO Jr | none |

Guitar assumes a DI electric, because the chain starts with an amp. LUNA has no UADx Ampeg (only
legacy UAD-2 versions, which aren't in Spark), so the bass tiers use preamps, compression and
saturation. Changing a track's instrument rebuilds the same tier for the new instrument if it's
unlocked; otherwise it takes the old chain off.

The plug-in ids were read from LUNA 3.1.2's catalog.

## LUNA Channel EQ
Every tier ends with LUNA Channel, which comes free with LUNA, so Good, Better and Best all
get it. Its Equalizer module starts from a setting for the instrument:

| Instrument | Starting EQ |
|---|---|
| Vocal | Low cut 90 Hz (24 dB/oct), −2.5 dB at 300 Hz, +2 dB at 3.2 kHz, +2.5 dB air shelf at 12 kHz |
| Guitar | Low cut 90 Hz (24 dB/oct), −2 dB at 400 Hz, +1.5 dB at 2.5 kHz, high cut 10 kHz |
| Bass | Low cut 35 Hz (24 dB/oct), +2 dB at 90 Hz, −2.5 dB at 250 Hz, +1.5 dB at 900 Hz, high cut 6 kHz |

- **The graphic:** each strip draws the EQ curve from LUNA Channel's band controls.
  - **Drag:** drag a numbered dot for frequency and gain; Shift-drag sets Q, and cuts move in
    frequency only. A drag is one undo step.
  - **Open:** double-click the graph to open LUNA Channel.
  - **Follows LUNA:** edits made in LUNA Channel's own window redraw it.
- **Switching tiers:** LUNA Channel stays in its slot when you switch tiers, so your EQ edits
  carry over. The starting EQ goes on again only when the EQ insert is new or the instrument
  changes.
- **Older tracks:** a track built before the EQ still shows its tier, with **+ LUNA EQ** to add it.
- **Level matching:** the EQ moves the level by a dB or so, the same in every tier. Level
  matching between tiers holds, but each tier now sits that much off the dry track.

## Layout
Every track in the session is a channel strip, so the window works as a small mixer:
- **Top:** the track's instrument, then a drop-down for Good, Better, Best or Off. Locked tiers
  are marked with a lock, and picking one names the missing plug-ins with "Get with Spark".
- **Under the drop-down:** the chain as chips (the reverb send marked ↪) and the three macro
  knobs, stacked. The chips a knob drives light up while you hover or turn it.
- **A/B and Blind.**
- **Bottom:** a meter bridge with one gain-reduction meter per compressor, hanging from the top
  in orange like a console's; the track's fader (one undo step per drag, double-click for 0 dB);
  a level meter with a held peak; the dB readout; mute and solo.

A track with no instrument still gets a fader, meter, mute and solo. Strips line up their
faders at the bottom, and the window scrolls sideways for big sessions.

## Macros
Each track with a tier on gets three knobs. Drive and Squeeze are on every instrument (guitar
calls Drive "Gain"). Vocal and guitar get Space; bass gets Weight. One knob moves several real
controls in the tier's plug-ins, and the plug-ins it drives light up in the chain chips while you
turn it.

| Macro | What it moves |
|---|---|
| Drive / Gain | Preamp or amp drive (610 level, Neve line gain, VOXBOX input, Showtime/Dream/Lion volume, Century level, Pultec output, FATSO warmth), with the output trimmed down to roughly hold level |
| Squeeze | Compressor input and output (1176 family, Distressor), LA-2A/LA-3A peak reduction and gain, Century compression |
| Space | The reverb send, from off through −30 dB to −6 dB. Guitar Better also brings up the Galaxy Tape Echo |
| Weight | Bass low end: Century low shelf, Pultec low boost at 60 cps, Neve low-frequency gain |

- **Carry-over:** switching tiers keeps the knob positions, so Good vs Best compares at the same
  settings.
- **Undo:** a drag is one undo step. Each knob reads its position back from its first control,
  so it follows undo and edits made in the plug-in window.
- **Keys:** double-click resets a knob to 50 %. Arrow keys step 5 % (1 % with Shift), and Shift
  while dragging gives fine control.
- **Tuning:** Drive and Squeeze were tuned by measurement, not by ear, in LUNA 3.1.2. The
  sources were a vocal, a DI guitar and a bass at recording level (about −20 dBFS RMS).
  - **Squeeze:** runs from light to heavy gain reduction (about 0.1 to 0.6 of a pinned needle on
    the compressors' own meters). Good guitar keeps some compression even at 0, because the amp
    feeds its 1176 hot.
  - **Level:** output trims hold every tier within 0.8 dB of the dry track at the points checked
    (centre, and each knob at 0, 50 and 100 %). The exception is Better bass at the Drive
    extremes (±1.4 dB). So A/B and the blind test compare tone, not loudness.
  - **Bend:** a makeup gain can bend through a midpoint at 50 % (`M(..., lo, hi, mid)`), because
    compression doesn't grow evenly with the knob.
  - **Not tuned:** Weight and Space, and whether each tier sounds right, which needs ears.

## Live rings
Each knob has an inner ring that moves while the song plays and falls to rest when it stops.

| Knob | Inner ring shows |
|---|---|
| Squeeze | Gain reduction (orange), averaged across the tier's compressors, read from their own meters |
| Space | The reverb bus return |
| Drive / Gain / Weight | The track's output level |

The compressors' meters are the plug-ins' own (`<slot>/meters/<id>`), measured in LUNA 3.1.2:
- **1176 family and LA-3A:** with the meter switch on GR, the needle rests at 0.70 and falls
  toward 0.04 as gain reduction grows.
- **LA-2A:** the same, resting at 0.62.
- **Distressor:** its `gain_reduction` meter rests at 0 and rises.
- **Left out:** a compressor switched to VU in its window, the Century's GR meter (it doesn't
  move) and the VOXBOX compressor (bypassed in Best).

## Blind test
**Blind** deals the dry track and every tier you have to letters at random (A, B, C, D), and hides
the tier drop-down, knobs and chain; the fader stays. Click letters to hear each one, then **Keep** your favourite to
see which was which. The pick stays on the track. Knob positions carry over between tiers, so the
test compares the gear, not the settings.
- **On Explore FREE:** the test is Dry vs Good, and the results say Better and Best join the test
  with Spark, with "Get with Spark".
- **Mixer:** the inserts are still visible in LUNA's mixer, so no peeking.
- **Switch time:** a tier switch takes about 0.5 to 1.4 s while plug-ins load. Each switch is
  an ordinary undo step.

## How it behaves
- **Tier lock:** a tier unlocks when each of its plug-ins is installed and `Plugin.authorized`
  isn't false. When LUNA's catalog changes (a new Spark licence), the window updates without
  reopening.
- **Switching tiers:** swaps only the inserts this Add On placed, and retargets the same send to
  the new tier's reverb bus. Inserts the user put there (their own 1176, say) are never touched.
  Ownership is kept in session storage (`com.jhaydon.good_better_best.tracks`) as slot id →
  plug-in id.
- **A/B:** bypasses the chain and mutes the send in one undo step; press again to restore.
- **Off:** removes the chain and the send. The reverb bus stays for other tracks.
- **Locked tiers:** clicking one names the missing plug-ins and offers "Get with Spark", which
  opens `uaudio.com/spark?utm_source=luna&utm_medium=add_on&utm_campaign=good_better_best`.
- **Selection:** LUNA applies a control edit to every selected track when the edited one is among
  them. So before an edit, the Add On selects that track alone if others are selected with it,
  as clicking it in LUNA would. Otherwise it leaves the selection alone.
- **Full tracks:** when a track runs out of insert slots, the plug-ins that don't fit are
  reported and the rest still build.
- **One edit at a time:** chain edits on a track queue behind each other. In testing,
  overlapping tier swaps on one track left LUNA unable to load new plug-ins until a restart.

## Not done yet
- **Listening pass:** the ranges are measured, not heard. Tone choices (how much Drive colours,
  whether Best sounds best) still need ears. Sources much hotter than recording level (a
  mastered vocal) will compress harder than intended.
- **Locked-tier demo:** there's no bundled before/after audio yet, so a free user can't hear a
  locked tier before subscribing.

## Develop
```sh
npm install && npm test          # 34 tests on Luna.MockEngine
npx ua-builder serve             # http://localhost:8790/ against a running LUNA
npx ua-builder install           # link into LUNA: Add Ons > Windows > Good Better Best
npx ua-builder pack              # .lunaaddon for Universe
```
