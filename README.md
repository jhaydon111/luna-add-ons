# JC Haydon's LUNA Add Ons

Add Ons for [LUNA](https://www.uaudio.com/luna), built with [LUNA Builder Tools](https://github.com/uaudio-labs/luna-builder-sdk)
by following the Get started page on [UA Universe](https://universe.uaudio.com/index/builders/start).

| Folder | What it is | Opens as |
|---|---|---|
| [`610-console/`](610-console/) | LUNA as Bill Putnam Sr.'s 1960 United Recording 610 console, with an 8-track tape machine for tracking | Add Ons › Apps › 610 Console |
| [`mute-button/`](mute-button/) | The Get started tutorial: one big button that mutes the selected track | Add Ons › Windows › Mute Button |
| [`good-better-best/`](good-better-best/) | Good / Better / Best channel chains for vocal, guitar and bass, with Drive, Squeeze and Space macros, channel strips with faders, level and gain-reduction meters, and a blind test: Good on UAD Explore FREE, Better and Best on UAD Spark | Add Ons › Windows › Good Better Best |

## Install

Download the `.lunaaddon` file from the latest release on the **Releases** page and double-click it. LUNA installs it
into its Add Ons folder. Requires LUNA 3.1.1 or later.

## Build

Each folder is a LUNA Builder Tools scaffold: `npm install && npm test` runs its tests against the mock engine, and
`npx ua-builder install` links it into LUNA's Add Ons folder for development. The SDK is expected as a sibling
checkout at `../luna-builder-sdk` (the scaffold's `package.json` points there).
