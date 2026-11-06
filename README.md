# ControllerNotation

## Browser workbench

[Open ControllerNotation](https://muk-labs.github.io/ControllerNotation/) to convert MIDI CC and an optional MusicXML layout into a Dorico guide score and native-line scripts. Files are processed in your browser. Start with **Try a changing-meter example**.

See [the web workflow and validation notes](docs/web-workbench.md) for setup, current limits, and local development.

Experimental MIDI CC notation for live-electronics performers, using native
Dorico line segments attached to rhythmic positions on a one-line staff.

**Working prototype, tested in Dorico 5 on macOS.** A Standard MIDI File is
converted into a Lua macro and a MusicXML guide score. The macro creates an
editable line for each grid interval. The supplied example converts nine CC74
events into sixteen connected segments, with hidden guide notes, fractional
heights and a smoothed contour. Both the original layout and a layout with a
system break were exported and measured as vector PDFs.

This uses Dorico's recorded macro commands, not a supported score-object API.
The current workflow needs a prepared score, a selected guide note, and manual
identification of system-end segments. It is not a one-click importer for an
arbitrary existing score. Sibelius has not been tested in this repository.

## Open the results

- [Denser Bezier-sampled score](examples/03-bezier/bezier-32.dorico) and
  [PDF](examples/03-bezier/bezier-32.pdf): 32 segments, sixteenth-note anchors.
- [Smoothing comparison](examples/03-bezier/smoothing-comparison.pdf) and
  [Bezier experiment notes](docs/bezier-experiment.md).
- [Completed score](examples/02-midi-cc/corrected.dorico)
- [Original PDF](examples/02-midi-cc/corrected.pdf)
- [Score with a system break](examples/02-midi-cc/corrected-system-break.dorico)
- [System-break PDF](examples/02-midi-cc/corrected-system-break.pdf)
- [Test findings and measurements](docs/dorico-5-experiment.md)

## Generate a contour

Python 3.10 or later; the converter has no third-party dependencies.
Run from this repository:

```sh
python3 controller_notation.py examples/02-midi-cc/input.mid \
  --cc 74 --channel 1 --step 1/2 --interpolation smooth \
  --output work/my-contour
```

This produces `my-contour.lua`, `my-contour.musicxml`, and `my-contour.json`.
The JSON records the selected controller, timing, sampled values and limitations.
Times are in quarter-note beats, independent of tempo. `--step 1/2` means
eighth-note spacing; `--step 1/4` means sixteenth-note spacing. The default
vertical range is four staff spaces, centered on the controller staff.

The supported source is SMF format 0 or 1 with PPQN timing, one 7-bit CC and one
MIDI channel. Running status and multi-track files are supported. Simultaneous
events use the last event in track/event order. Format 2, SMPTE timing, 14-bit CC,
NRPN and live MIDI are outside this prototype.

`--start-beat` and `--end-beat` select an interval. The default end is the last
selected CC event. The interval must be an exact multiple of the grid step.
If the first CC event is after the requested start, supply `--initial-value`.
The fixture starts at the selected interval's origin; it does not include an
empty lead-in matching `--start-beat`.

## Run in Dorico

1. Open the generated MusicXML as a new project, or open the supplied
   [clean guide score](examples/02-midi-cc/guide-seed.dorico). Use **Save As** to
   keep a clean seed for another run. The controller staff contains pitched E4
   guide notes and uses one staff line. The reference staff makes timing visible.
2. In Write mode, select all notes on **Controller only**: click the first note,
   then Shift-click the last. Switch to Engrave mode. Set property scope to
   Global, then use the Jump Bar (`J`) commands **Hide Notehead** and **Hide Stem**.
   Alternatively, run `toggle-hide-guides.lua` with those notes selected.
   These commands toggle: run each only once on the initially visible notes.
3. Return to Write mode and select **only the first controller guide note**.
   Hidden notes appear faintly and remain selectable. Its duration must match
   the requested grid step.
4. Open the Lines panel and set **both Start and End attachment to Rhythmic
   position**. This is a required UI prerequisite; the macro does not set it.
5. Choose **Script > Run Script** and open the generated `.lua` file. The
   sixteen-segment example takes roughly half a minute in our test. It leaves
   the last line selected. Running it again creates another chain.
6. Inspect and save the result. Print mode omits hidden guide notes. Hiding
   guide notes does not silence their playback; the prototype only creates
   visual notation and does not install the source CC into Dorico playback.

The fixture fills complete bars and includes a note after the last interval to
provide its endpoint. It uses the explicit `--meter` (default `4/4`); it does not
reconstruct the MIDI file's meter changes. `--help` lists all options.

## Smoothing and attachment

`--interpolation linear` samples straight ramps. `smooth` and `bezier` are aliases
for the same bounded cubic model with monotone slopes. The model is represented
as cubic Bezier control points in the JSON report, then sampled into straight
native segments. This preserves the earlier Hermite interpolation mathematically.
There are no native Bezier objects in the tested Dorico 5 output.
More samples can look smoother, at the cost of more guide notes and line objects.
Fast changes between grid points can disappear. `hold` holds the sampled CC
value between source events, but the resulting score still connects vertices
with straight ramps; it does not produce exact vertical steps.

For the 32-segment experiment, use `--step 1/4 --interpolation bezier`.
The supplied `03-bezier/bezier-seed.dorico` already has hidden controller notes
and a beamed reference staff. On importing the MusicXML instead, select all
notes and use **Reset Beaming** before hiding the controller noteheads/stems.
The resulting layout has bars 1-2 on the first system; use
`--system-end-segments 32` to trim the contour's final endpoint to that edge.
The third bar supplies the final rhythmic anchor and contains no contour.

Endpoints follow rhythmic spacing because they are attached to score positions.
The heights use fractional engraving offsets over a fixed native position below
the staff. This avoids the notehead clearance Dorico applies near staff position
zero, which otherwise creates gaps even when noteheads are hidden.

## System breaks

The supplied fixture needs an end X offset of `9/8` staff spaces at ordinary
joins and `7/10` at a system edge. These are measured calibrations for this
fixture, not universal engraving constants.

For a break before bar 2 on the eighth-note grid, segment 8 ends the first system:

```sh
python3 controller_notation.py examples/02-midi-cc/input.mid \
  --cc 74 --step 1/2 --interpolation smooth --system-end-segments 8 \
  --output work/my-contour-with-break
```

Create the system break at bar 2 in Dorico. If a chain already exists, select
its segment ending at the edge and run `trim-selected-system-end.lua`, or set
its End offset X to `0.70` in Engrave mode. Reassess this correction whenever
the layout changes. Use `--end-dx` and `--system-end-dx` for other calibrations.
Only breaks at segment boundaries have been tested. The generator cannot read
Dorico's layout to discover breaks automatically.

## Validation and repository layout

```sh
python3 -m unittest discover -s tests -v
```

Sixteen tests cover MIDI parsing, timing, interpolation bounds, Bezier tangent
continuity, equivalence with the previous model, fixture durations and the
placement regression at staff crossings. The optional
`scripts/verify_fixture_pdf.py` requires `pdfplumber` and checks the supplied
exported vector geometry. Its captured results are in
`examples/02-midi-cc/verification.json`.

- `controller_notation.py`: converter and fixture generator.
- `examples/02-midi-cc/`: current reproducible experiment and completed scores.
- `examples/03-bezier/`: finer sampling, explicit cubic controls, comparison and
  measured PDF geometry. `scripts/compare_bezier.py` regenerates the model
  comparison using ReportLab; the core converter still has no dependencies.
- `examples/02-midi-cc/diagnostics/`: earlier approaches retained as evidence;
  their macros have known clearance gaps and are not the current generator.
- `examples/01-native-chain/`: earlier three-segment, hard-coded proof of concept.
- `work/`: ignored scratch output.
