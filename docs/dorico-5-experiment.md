# Dorico 5 experiment — 6 November 2026

## Result

An external converter successfully read a MIDI file and generated sixteen
consecutive native lines in Dorico 5. They follow eighth-note rhythmic positions
on a one-line controller staff. Guide noteheads and stems are hidden in print.
The contour crosses the staff line, rises from CC 0 to 127, holds, and falls
back to 0. A cubic Hermite curve is sampled into straight segments.

The original score has three bars on one system. The second saved score places
bar 2 on a new system, substantially widening bar 1. The same objects follow
the new spacing and preserve their CC heights. Segment 8 has a separate end-X
correction to finish at the first system's right edge.

## Evidence

The source contains nine CC74 events, channel 1, PPQN 480, at quarter-note beats
0 through 8. The output contains seventeen sampled values and sixteen line
objects. Each PDF contains twelve filled diagonal quadrilaterals and four
horizontal rectangles for the contour. These are vector objects, not images.

The exported original contour has about 0.0248 points of overlap at each join,
with no positive horizontal gaps. The PDF verifier checks each sampled height,
vertical agreement at joins, total segment count, and the corrected system edge
to a tolerance of 0.001 points. See the captured `verification.json` alongside
the examples. Both PDFs were also rendered and visually inspected.

## Placement findings

Changing native line Start/End position independently works, but position zero
introduces notehead clearance. Hiding noteheads and stems alone does not remove
that clearance. In the earlier `precise-hidden.pdf`, two staff crossings had
horizontal gaps of approximately 5.958 points, partially disguised by the staff
line. Visible eighth-note flags can cause further clearance problems.

The corrected generator uses native Start/End position `-4` for every segment
at the default height. It then sets fractional Start/End Y offsets to draw the
actual contour. Positive Y offset moves the endpoint upward. Native positions
are in half-spaces; engraving offsets are in full spaces. CC 0 therefore uses
DY 0, CC 63.5 uses DY 2, and CC 127 uses DY 4 over the fixed base. This removed
the clearance gaps while preserving fractional CC heights.

At ordinary joins, EndDX `9/8` leaves a very small overlap. After a system
break, this offset extended the line 2.108 points beyond the system edge in
the tested layout. Changing that segment's EndDX to `7/10` aligned it with
the edge. This manual correction is stored in `corrected-system-break.dorico`.
The corresponding full-chain macro incorporates the same override; the actual
UI test generated the normal chain first and then applied the small trim macro.

## Recorded command mechanism

The macro creates a Solid line from the selection with the Lines panel already
configured for rhythmic attachments, flips placement twice to Inside staff,
sets native positions, changes to Engrave mode to apply global offsets, returns
to Write mode, and repeats the selected line into the next interval. It does
not inspect the score, target an instrument by ID, or address arbitrary beat
positions through a public object API. Selection and guide duration matter.

The generated macros contain no screen coordinates. Guide-note selection,
attachment mode and system-break identification remain manual prerequisites.

## Boundaries of this test

- Verified: Dorico 5, one-line pitched staff, eighth-note E4 guide notes,
  fractional heights, hidden noteheads/stems, smooth sampling, ordinary joins,
  a barline crossing, and reflow with a break at a segment boundary.
- Not established: arbitrary existing scores, different engraving settings,
  tuplets, breaks within a segment, multiple simultaneous controller lanes,
  automatic layout detection, or large-stream performance.
- Each segment is a separate editable object. The smoothing is an external
  approximation, not a single native Bezier/polyline object.
- The converter is a visual-notation prototype. MIDI playback CC is not
  synchronized with later score edits; guide notes can still sound on playback.
- Earlier artifacts in `diagnostics/` and `01-native-chain/` are historical.
  Their limitations are retained so they are not mistaken for validated output.

## Vendor references

- [Steinberg Lines panel documentation](https://www.steinberg.help/r/dorico-pro/6.2/en/dorico/topics/write_mode/write_mode_notations_input/write_mode_lines_panel_r.html)
  describes the attachment choices; the hands-on tests here used Dorico 5.
- [Steinberg worksheet tutorial](https://blog.dorico.com/wp-content/uploads/2024/07/240725-Flash-cards-and-worksheets-in-Dorico.pdf)
  covers hiding noteheads and stems.
- [MIDI Association: Standard MIDI Files](https://midi.org/standard-midi-files)
  is the format reference for the input reader.
