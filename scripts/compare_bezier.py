#!/usr/bin/env python3
"""Reproduce the model comparison and error estimates; PDF needs reportlab."""
from fractions import Fraction as F
from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from controller_notation import bezier_spans, grid, read_cc, sample


def main():
    from reportlab.pdfgen import canvas
    from reportlab.lib.colors import HexColor

    root = Path(__file__).resolve().parents[1]
    out = root / 'examples/03-bezier'
    midi = read_cc((root/'examples/02-midi-cc/input.mid').read_bytes(), 74)
    points = [(F(t, midi.ppqn), v) for t, v in midi.points]
    times = [F(i, 1000) for i in range(8001)]
    ideal = sample(points, times, 'bezier')
    results = []
    for step in [F(1, 2), F(1, 4), F(1, 8)]:
        knots = grid(F(0), F(8), step)
        polygon = list(zip(knots, sample(points, knots, 'bezier')))
        error = max(abs(a-b) for a, b in zip(ideal, sample(polygon, times)))
        results.append({'step_beats': str(step), 'segments': len(knots)-1,
                        'max_cc_error_estimate': error,
                        'max_staff_space_error_estimate': error*4/127})
    (out/'sampling-comparison.json').write_text(json.dumps({
        'method': 'Maximum over 8001 evenly spaced beat positions; model space, not page layout',
        'results': results}, indent=2)+'\n')

    c = canvas.Canvas(str(out/'smoothing-comparison.pdf'), pagesize=(700, 800))
    c.setTitle('ControllerNotation - smoothing comparison')
    ink, blue, pale = map(HexColor, ['#172531', '#176C91', '#D9E2E8'])
    c.setFillColor(ink)
    c.setFont('Helvetica-Bold', 22)
    c.drawString(48, 755, 'MIDI CC smoothing')
    c.setFont('Helvetica', 11)
    c.drawString(48, 731, 'Same nine CC74 values. Equal beat spacing for a direct shape comparison.')
    c.drawString(48, 714, 'Dorico 5 uses sampled straight segments; the exact curve is a reference here.')
    left, width, height = 70, 574, 65

    def xy(t, v, bottom):
        return left+float(t)/8*width, bottom+float(v)/127*height

    def frame(bottom, title, subtitle):
        c.setFillColor(ink)
        c.setFont('Helvetica-Bold', 12)
        c.drawString(48, bottom+height+30, title)
        c.setFont('Helvetica', 9)
        c.drawString(48, bottom+height+15, subtitle)
        c.setStrokeColor(pale)
        c.setLineWidth(0.5)
        for t in range(9):
            x, _ = xy(t, 0, bottom)
            c.line(x, bottom, x, bottom+height)
            c.setFillColor(ink)
            c.setFont('Helvetica', 8)
            c.drawCentredString(x, bottom-13, str(t))
        c.line(left, bottom, left+width, bottom)
        for v in (0, 127):
            c.drawRightString(left-10, bottom+v/127*height-3, str(v))

    rows = [(575, '1  Straight ramps between source events',
             'Eight segments; corners remain at the MIDI events.', None),
            (432, '2  Previous smoothed contour - 16 segments',
             'Eighth-note sampling of the cubic model.', F(1, 2)),
            (289, '3  New smoothed contour - 32 segments',
             'Sixteenth-note sampling; generated and tested as native Dorico lines.', F(1, 4)),
            (146, '4  Exact cubic Bezier reference',
             'Eight cubic spans with matching tangents; this row is not a Dorico object.', 'exact')]
    for bottom, title, subtitle, step in rows:
        frame(bottom, title, subtitle)
        path = c.beginPath()
        if step == 'exact':
            path.moveTo(*xy(*points[0], bottom))
            for span in bezier_spans(points):
                path.curveTo(*[coord for p in span[1:] for coord in xy(*p, bottom)])
        else:
            plot = points if step is None else [(t, y) for t, y in zip(
                grid(F(0), F(8), step), sample(points, grid(F(0), F(8), step), 'bezier'))]
            path.moveTo(*xy(*plot[0], bottom))
            for p in plot[1:]:
                path.lineTo(*xy(*p, bottom))
        c.setStrokeColor(blue)
        c.setLineWidth(1.25)
        c.drawPath(path)
        for p in points:
            c.setFillColor(ink)
            c.circle(*xy(*p, bottom), 1.8, stroke=0, fill=1)
    c.setFillColor(ink)
    c.setFont('Helvetica', 10)
    c.drawString(48, 90, 'Estimated maximum error from the cubic model: 2.345 CC (16) -> 0.775 CC (32).')
    c.drawString(48, 73, 'About 3x closer with twice the objects. The comparison uses musical time, not page distance.')
    c.setFont('Helvetica', 9)
    c.drawString(48, 45, 'ControllerNotation  |  6 November 2026  |  Black dots: source MIDI values  |  X: quarter-note beats')
    c.save()
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
