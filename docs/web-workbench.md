# Browser workbench

The static app in `web/` converts a Standard MIDI File into a guide MusicXML
score and Dorico Lua scripts. It runs entirely in the browser. No Python,
account, server-side processing, analytics or externally hosted assets are used.
GitHub Pages serves the application; selected MIDI and MusicXML files stay local.

## Composer workflow

1. Export MIDI for one Dorico flow containing CC automation.
2. Optionally export MusicXML for the **same flow and destination layout**.
   The full score and individual parts can have different system breaks.
3. Open the workbench, choose the files and controller, inspect the preview,
   and choose a sampling grid and curve. The densest controller stream is
   selected initially; other channels/controllers remain available.
4. Download the ZIP and follow `START-HERE.txt`. Import `guide.musicxml`,
   preserve system/frame breaks, reset beaming, hide Controller guide notes,
   and set both line attachments to Rhythmic position.
5. Select the reported guide note and run the numbered scripts in Dorico via
   Script > Run Script. Each continuation expects the previous final line to
   remain selected. Save checkpoints between chunks. Do not rerun successful
   chunks or continue after a partial failure; restore the last checkpoint.
6. Check joins and endings. Copy the lines to an equivalently prepared
   controller staff at the same musical position, retaining destination breaks.

The scripts create notation, not CC playback. Hiding guides does not mute them.
The reference staff is for preparation and checking, not the final performer part.
The browser cannot open or control a local Dorico process. The remaining setup
and Script > Run Script actions are explicit, not silently automated.

## MusicXML check — 6 November 2026

Exported the existing `cc24-changing-meters.dorico` test through Dorico's actual
File > Export > MusicXML dialog, selecting its Full score layout and single flow.
The exporter identified itself as **Dorico 5.1.81.2225**. Both instrumental parts
contain these durations and print markers:

| Bar | Meter | Start (quarter notes) | Duration | New system |
| --- | --- | ---: | ---: | --- |
| 1 | 3/4 | 0 | 3 | first |
| 2 | 5/8 | 3 | 2.5 | no |
| 3 | 7/8 | 5.5 | 3.5 | yes |
| 4 | 5/4 | 9 | 5 | yes |
| 5 | 3/4 | 14 | 3 | yes |
| 6 | 3/4 | 17 | 3 | no |

The observed break positions **5.5, 9 and 14** match our earlier manual layout
measurements. At the CC24 range 1.125–17.5 and a 0.125-quarter-note grid, the
affected segment numbers are **35, 63 and 103**. This confirms that this Dorico
export supplies the needed layout map. It does not establish identical exporter
behavior across every Dorico version or every layout feature.

`web/demo/changing-meters.musicxml` preserves this real export's notes, durations,
meters and print markers, with the CC line directions and identifying metadata
removed. `web/demo/controller.mid` is a separate synthetic CC24 demonstration;
the user's original MIDI and score are not part of the website.

MusicXML's [`print` element](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/print/)
specifies system/page starts. The parser maps these to cumulative written
quarter-note times, using divisions, voice backups/forwards, chords and pickups.
A new page also counts as a system break. Conflicting nonempty break maps or
different part timelines are rejected rather than guessed.

## Precision and limits

- MIDI formats 0/1 with PPQN and 7-bit controller values. Format 2 and SMPTE are
  rejected. No combined 14-bit CC, NRPN or live MIDI decoding.
- Meter comes from MusicXML, otherwise MIDI, otherwise the explicit fallback.
  Musical time remains quarter-note based regardless of meter.
- Supported grids: quarter, eighth, sixteenth and thirty-second notes. Source
  edges between grid anchors are cropped inward and reported. No initial CC
  value is invented. Maximum 4096 segments and bounded guide/file sizes.
- Bounded cubic smoothing is sampled into native straight segments; there are
  no native Bezier objects. Max/mean errors compare the sampled polyline with
  original CC event values, not a guarantee about unsampled curve extrema.
  The preview connects source values linearly and uses uniform beat spacing;
  Dorico's page uses its own note spacing.
- MusicXML is a snapshot. Adding instruments, importing or repaginating can
  change the destination. Keep the exported breaks and recheck after transfer.
- Ordinary end X = 1.125, system end X = 0.7 staff spaces are **test-fixture
  calibrations**, editable in the UI. MusicXML identifies *which* line ends
  need treatment; it does not prove these offsets fit every score or staff size.
- If the contour ends exactly at flow end, the guide adds an extra endpoint
  bar and reports it. Check the final line when transferring to the flow end.
- One flow, one aligned written timeline. Repeats/jumps require explicit
  alignment confirmation. Mid-bar system breaks, tuplets and unmetered scores
  need further work. Do not use playback-expanded MIDI against written XML.
- Thirty-two-segment chunks have exactly the same command sequence as the
  full macro. This avoids one long uninterrupted script, but does not guarantee
  Dorico cannot stall. There is no automatic recovery from a partially run chunk.

## Development and deployment

```sh
npm ci --ignore-scripts
npm test
npm run dev
```

Open `http://127.0.0.1:4173`. The site itself has no build step. Vendored fflate
handles ZIP/MXL locally; `npm run vendor` refreshes it from the pinned package,
including its license. xmldom is only a Node test dependency.

`.github/workflows/pages.yml` tests the converter, uploads only `web/`, and
deploys to GitHub Pages. Set repository **Settings > Pages > Source > GitHub
Actions**. It does not publish the repository's local experiment directories.
Future pushes affecting the site/tests/package/workflow redeploy automatically.
GitHub documents the setup in its [custom workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Validation performed for this first version:

- 13 Node tests: MIDI timing/merge/error cases, actual Dorico layout, compressed
  MusicXML, pickups/voices/chords, smoothing, alignment guards, guide round-trip,
  chunk/full command equivalence and ZIP contents.
- All 17 existing Python prototype tests still pass.
- Original local CC24 regression: 328 source events, 131 segments, correct
  [35, 63, 103] endings, and maximum browser/Python sample difference below
  1.5e-14 CC units.
- Browser: real CC24 import and automatic selection, demo, curve/grid changes,
  incompatible-grid download blocking, layout removal, ZIP download, desktop
  and 390-pixel mobile views, and no captured JavaScript errors.

The browser-generated command sequence is checked against the established
prototype; the new chunked web kit has not yet had a complete fresh Dorico
draw-and-PDF-measurement pass. Keep that distinction when extending the claims.
