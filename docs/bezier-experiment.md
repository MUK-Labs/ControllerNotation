# Bezier sampling experiment - 6 November 2026

Tested with the installed Dorico 5.1.81.2225 on macOS. The completed score and
PDF are `examples/03-bezier/bezier-32.dorico` and `bezier-32.pdf`.

## What changed

The original smoothing already used cubic Hermite interpolation. This experiment
expresses that same model as explicit cubic Bezier control points, exports them
in the JSON report, and doubles the sampling density from 16 to 32 segments.
`--interpolation smooth` and `--interpolation bezier` intentionally produce the
same sampled values. The visible improvement comes from the denser grid, not
from renaming the cubic representation.

For a span of duration h, with endpoint values y0/y1 and derivatives m0/m1
(CC per quarter-note beat), the Bezier handles are:

```
P0 = (t0,       y0)
P1 = (t0+h/3,   y0+h*m0/3)
P2 = (t1-h/3,   y1-h*m1/3)
P3 = (t1,       y1)
```

The time handles at thirds make the Bezier parameter linear in musical time.
The shared derivatives remain equal across unequal source intervals. Plateaus
and extrema use zero interior slopes. The model interpolates source values;
it does not denoise a noisy CC recording.

## Reproduce the score

```sh
python3 controller_notation.py examples/02-midi-cc/input.mid \
  --cc 74 --step 1/4 --interpolation bezier --system-end-segments 32 \
  --output work/bezier-32
```

Open a copy of `examples/03-bezier/bezier-seed.dorico`, select the first hidden
controller note, ensure both Lines panel attachments use Rhythmic position,
and run the generated macro. The seed contains no line objects. It has beamed
reference notes and hidden controller noteheads/stems. If starting from XML,
use Reset Beaming on all notes before hiding only the controller notes.

The test macro exceeded the computer tool's 60-second response window but
completed in Dorico. It was not rerun. The exported PDF verified all 32 segments.
Do not assume a UI-automation timeout means a macro failed; inspect the score
before retrying to avoid duplicate chains.

## Measurements

On 8,001 evenly spaced sample times over eight beats, the estimated maximum
vertical deviation of the sampled polygon from the exact cubic model was:

| Native segments | Grid | CC error | Error at four-space height |
| --- | --- | --- | --- |
| 16 | Eighth notes | 2.3451 | 0.07386 staff spaces |
| 32 | Sixteenth notes | 0.7751 | 0.02441 staff spaces |
| 64 | Thirty-second notes | 0.2252 | 0.00709 staff spaces |

The 64-segment case was measured in the converter only, not run in Dorico.
These are numerical estimates in musical time, not page-distance error bounds.
Nonuniform engraving spacing can still change apparent slopes, particularly
near barlines. A sampled polygon is position-continuous but not mathematically
tangent-continuous at every small join.

The 32-segment Dorico PDF contains 24 diagonal vector quadrilaterals and eight
horizontal rectangles. All 31 internal joins overlap by approximately 0.0248
points; their vertical differences are below 0.001 points. Sampled heights and
the final system-edge position also match within 0.001 points. The captured
numbers are in `verification.json`. Both the printed score and the separate
model comparison were rendered and visually inspected.

## Native curved lines: a version distinction

Steinberg introduced tapered curve line bodies in Dorico 6.0, with control-point,
endpoint-offset and thickness settings. See [the vendor release notes, pages
42-44](https://blog.dorico.com/wp-content/uploads/Dorico_6.0_Version_History.pdf).
This is a promising separate path for native curved objects. It has not been
tested here: the installed application is Dorico 5. We have not established
whether those settings can represent every required CC span or be generated
through recorded macros. No Dorico 6 upgrade or installation was performed.

The exact Bezier row in the comparison PDF is an external reference plot. The
editable Dorico score continues to use native straight segments attached to
musical positions, with the previously calibrated endpoint offsets.
