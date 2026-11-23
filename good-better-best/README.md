# Good · Better · Best

A LUNA Add On (window, shows with a session). One switch per track builds a channel chain at
three tiers. Good runs on UAD Explore FREE. Better and Best run on UAD Spark plug-ins and show
a lock with "Get with Spark" until they're authorized.

The idea comes from Listening Booth (shawnist): a free experience that's complete on its own,
and a Spark upgrade you can name, see and hear.

Each track gets an instrument. It's guessed from the track name ("Lead Vox", "Gtr DI", "Bass DI"),
and the user can change it in the row's picker.

| Instrument | Tier | Channel chain | Reverb send (shared bus, 100 % wet) |
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
- **Nudge:** on Good with Spark locked, a line names the Better gear, with "Get with Spark".
- **Ranges:** they come from sweeping each parameter's display in LUNA 3.1.2. They are a
  starting point, set without listening, and need tuning by ear.

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

## Not done yet
- **Tuning by ear:** the macro ranges were set from the parameters' display readings without
  listening. Gain matching across tiers is approximate.
- **Locked-tier demo:** there's no bundled before/after audio yet, so a free user can't hear a
  locked tier before subscribing.

## Develop
```sh
npm install && npm test          # 22 tests on Luna.MockEngine
npx ua-builder serve             # http://localhost:8790/ against a running LUNA
npx ua-builder install           # link into LUNA: Add Ons > Windows > Good Better Best
npx ua-builder pack              # .lunaaddon for Universe
```
