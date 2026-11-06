# CC24 across changing meters and system breaks

Tested in Dorico 5 on macOS. The existing 131 native CC24 segments were copied
from `examples/04-cc24/cc24-smooth.dorico` and pasted into a separately prepared
score. They were not regenerated for the destination's meters.

**Result:** all start positions and sampled CC heights survived the paste.
Seven copied endpoint offsets needed changes for the new layout. After those
changes, all timing, height, internal-join and system-end checks pass.

## Destination and timing

All times below are quarter-note beats, counted from zero at flow start.
The contour starts at 9/8 and ends at 35/2, exactly as in the source.
The final endpoint is now halfway through the first quarter-note beat of bar 6.

| Bar | Meter | Start beat | End beat | System |
| --- | --- | --- | --- | --- |
| 1 | 3/4 | 0 | 3 | 1 |
| 2 | 5/8 | 3 | 11/2 | 1 |
| 3 | 7/8 | 11/2 | 9 | 2 |
| 4 | 5/4 | 9 | 14 | 3 |
| 5 | 3/4 | 14 | 17 | 4 |
| 6 | 3/4 | 17 | 20 | 4 |

The source has five systems, one 4/4 bar per system. The destination has four
systems with contour segment counts 35, 28, 40 and 28. Both scores contain
160 32nd-note guide notes on each staff. Controller guide noteheads and stems
are hidden; the upper reference staff provides a visible timing grid.

## Paste and correction procedure

1. Run `python3 examples/05-meter-transfer/make_fixture.py` to reproduce the
   destination MusicXML. Import it as a new project, apply Reset Beaming to all
   notes, and hide the Controller noteheads and stems. The supplied
   `changing-meters-seed.dorico` already has this preparation.
2. In the source, select all and use the Jump Bar command **Filter Horizontal
   and Note-attached Lines**. Copy the resulting contour-only selection.
3. In the destination, select the tenth Controller guide note, at beat 9/8,
   then paste. Selecting that destination preserves the source's initial gap.
   Save a separate working score. `unadjusted-paste.dorico` retains this state.
4. With all pasted lines selected, run `reset-selected-end-offsets.lua`.
   This sets End offset X to 9/8 staff spaces. It restores the ordinary joins
   at the four former system ends: segments 23, 55, 87 and 119.
5. Select the segments ending at the three new system boundaries, numbered
   35, 63 and 103, and run `trim-selected-system-ends.lua`. This sets End
   offset X to 7/10 staff spaces. It can be run on one selected segment at a
   time or on all three together. These property changes are idempotent.

For precise keyboard selection in this fixture, select the first Controller
guide in Write mode, press Right 43 times, then Tab to select segment 35.
After trimming, return to Write mode and press Right 28 times to reach segment
63. After trimming that, return to Write mode and press Right 40 times to reach
segment 103. Verify the selected line before applying each macro.

The offset values are calibrations for these fixtures, not universal Dorico
constants. Courtesy time signatures extend the staff beyond the ending
barline here. Trim to the barline, not to the far end of that extension.

## Measurements

The verifier reads the native vector geometry and uses black reference-note
glyphs to identify rhythmic positions independently of horizontal page spacing.
It compares heights with all 132 vertices in the original CC24 JSON report.
It is specific to this two-staff, 160-guide fixture, not a general PDF parser.

| Check | Immediately after paste | After endpoint correction |
| --- | --- | --- |
| Native segments | 131 | 131 |
| Timing mismatches | 0 | 0 |
| Maximum sampled-height error | <0.000004 pt | <0.000004 pt |
| Internal joins | Four gaps of about 2.0832 pt | No positive gaps; about 0.0248 pt overlap |
| New system endings | About 2.108 pt beyond barline | Within 0.000001 pt of barline edge |

The final maximum start-anchor error is below 0.000001 pt, as is the maximum
ordinary end-anchor error. Vertical mismatch at joins is below 0.000004 pt.
These small residuals reflect PDF coordinate precision, not a meaningful
musical or engraving displacement.

`unadjusted-verification.json` records the paste before correction;
`verification.json` records the final result. PDFs in this experiment were
extracted unchanged from Dorico's saved `supplementary_data/preview/preview.pdf`.
They contain Dorico's native vector rendering, not reconstructed contour images.
The final PDF was also rendered and visually inspected. The saved working score
was checked in Dorico's Print view.

Recheck with Python and `pdfplumber` installed:

```sh
python3 scripts/verify_meter_transfer.py \
  examples/04-cc24/cc24-smooth.pdf \
  examples/05-meter-transfer/cc24-changing-meters.pdf \
  examples/04-cc24/cc24-smooth.json \
  --output examples/05-meter-transfer/verification.json
```

## Scope of the result

Quarter-note timing can be independent of the source bar structure. The target
still needs usable rhythmic anchors and an explicit paste position. This test
retains the dense hidden guide notes and only places system breaks at segment
boundaries. It does not establish behavior for a break inside a segment,
tuplets, different staff sizes, or an arbitrary existing score without guides.

The printed horizontal contour follows Dorico's rhythmic spacing; its page
width is not a uniform seconds or beats axis. The test preserves the sampled
contour, including its original smoothing/sampling error. It does not recover
MIDI details lost between samples or install MIDI playback data.

For an eventual importer, keep timing in rational quarter-note beats and apply
system-end corrections after the destination layout is known. Meter changes
alone did not require regenerating this contour; system-break offsets did.
