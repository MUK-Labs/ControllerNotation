# Real Dorico CC24 export

Status: completed and saved in Dorico 5. Both the saved project's vector preview
and the exported PDF contain 131 segments. The final PDF was rendered and
visually inspected, and its geometry passes the automated checks. All 17
converter tests pass, including the new initial-gap regression.

Source: `test/Flows from Untitled Project 1/Untitled Project 1 - Full score - Flow 1.mid`.
The MIDI contains 328 distinct CC24 event times on channel 1, at 480 ticks per
quarter note. Values span 0–127. No time-signature event is present, so the test
uses the composer's chosen 4/4 meter.

## Timing and generation

The first controller event is tick 540 (9/8 quarter-note beats from flow start),
value 15. The last is tick 8400 (35/2 beats), value 50. The generated fixture keeps
this timing: the first line starts at the tenth 32nd-note guide in bar 1, and the
last ends halfway through beat 2 of bar 5. There is no contour before the first
known value or after the final event. Hidden guides fill five complete bars.

```sh
python3 controller_notation.py \
  'test/Flows from Untitled Project 1/Untitled Project 1 - Full score - Flow 1.mid' \
  --cc 24 --channel 1 --step 1/8 --start-beat 9/8 --end-beat 35/2 \
  --preserve-origin --interpolation smooth --meter 4/4 \
  --system-end-segments 23,55,87,119 \
  --output examples/04-cc24/cc24-smooth
```

`--preserve-origin` is new. It includes the guides preceding the selected
interval without supplying a fictitious initial CC value. The JSON reports the
1-based guide-note number to select. Without this flag, the earlier behavior
(interval starts at the fixture origin) remains unchanged.

The MusicXML import uses Reset Beaming on all notes. The Controller noteheads
and stems are hidden in Engrave mode. The resulting full score has one bar per
system; its four system ends require the endpoint corrections above. The clean
`cc24-seed.dorico` is retained for another run. Start and End attachment in the
Lines panel must both be Rhythmic position. Select the tenth controller guide
note, then run `cc24-smooth.lua` once. Large macros can take several minutes.

This run stopped during segment 102 after the automation connection had timed
out. Its cause is unknown. The endpoint stayed unchanged over several checks;
saving the project and reading its embedded vector preview confirmed exactly
102 objects (23, 32, 32, 15, 0 across the five systems). The selected final line
was retained, and `cc24-resume-from-102.lua` reapplied segment 102 before adding
the remaining 29 objects. This continuation is only for that exact partial
state; do not run it on the completed score or a clean guide score. Keep the
selection unchanged while a macro runs.

## Verified engraving

Final artifacts are `examples/04-cc24/cc24-smooth.dorico` and
`examples/04-cc24/cc24-smooth.pdf`. The exported PDF contains 23, 32, 32, 32 and
12 contour segments across the five systems. Ordinary joins overlap by about
0.0248 points, with no positive gaps. Maximum vertical mismatch at joins is
0.000003 points; maximum endpoint-height error against the requested sampled
CC values is below 0.000004 points. All four trimmed system ends meet the staff
edge within 0.001 points. Full measurements are in `verification.json`.

These geometry measurements test faithful rendering of the *sampled* values.
The separate MIDI sampling error described below still applies.

## What smoothing preserves

A bounded monotone cubic passes through the original CC events. The macro
samples that model at 32nd-note positions and connects the samples using 131
native straight line objects. These remain editable and attached to musical
positions. They are not native Bezier objects and do not install playback CC.

`sampling-analysis.json` compares the resulting polygon, interpolated in
musical time, with the original CC values at their event times. Mean absolute
error is 1.0518 CC units; maximum error is 14.5 at beat 241/16 from flow start
(source 28, polygon 42.5). This is a localized fast change between grid anchors.
It is not a bound on every intermediate time, nor a measurement of horizontal
page geometry, which follows Dorico's rhythmic spacing. The full cubic control
points and all 132 sampled vertices are preserved in `cc24-smooth.json`.

This is a practical density test, not a lossless transcription of every MIDI
event. Denser or adaptive anchoring is a possible next experiment. System-end
corrections must also be revisited if the score is reflowed.
