#!/usr/bin/env python3
"""Measure the supplied Dorico fixture exports (requires pdfplumber).

This deliberately targets this fixture's six staff lines per system, thin solid
contour and four-space height. It is not a general PDF/music recognizer.
"""
import json
from pathlib import Path
import pdfplumber


def inspect(pdf_path, report_path):
    report = json.loads(report_path.read_text())
    values = [p['cc'] for p in report['samples']]
    with pdfplumber.open(pdf_path) as pdf:
        assert len(pdf.pages) == 1
        page = pdf.pages[0]
        staff_lines = sorted([p for p in page.lines
                              if abs(p['top'] - p['bottom']) < 1e-5
                              and p['x1'] - p['x0'] > 100], key=lambda p: p['top'])
        assert len(staff_lines) in (6, 12), 'Unexpected fixture layout'
        all_segments, systems = [], []
        for i in range(0, len(staff_lines), 6):
            reference, controller = staff_lines[i:i+5], staff_lines[i+5]
            space = reference[1]['top'] - reference[0]['top']
            center = controller['top']
            segments = []
            for c in page.curves:
                if (center - 3*space < c['top'] < center + 3*space
                        and c['x0'] > controller['x0'] + 25
                        and c['x1'] - c['x0'] > 5 and len(c['pts']) == 5):
                    p = c['pts']
                    start = tuple((p[1][k] + p[2][k]) / 2 for k in (0, 1))
                    end = tuple((p[0][k] + p[3][k]) / 2 for k in (0, 1))
                    segments.append((start, end))
            for r in page.rects:
                if (center - 3*space < r['top'] < center + 3*space
                        and r['x0'] > controller['x0'] + 25
                        and r['width'] > 5 and 0.60 < r['height'] < 0.64):
                    y = (r['top'] + r['bottom']) / 2
                    segments.append(((r['x0'], y), (r['x1'], y)))
            segments.sort()
            if not segments and len(all_segments) == report['segments']:
                continue  # trailing guide-only system
            assert segments, 'No contour found before the expected chain end'
            gaps = [b[0][0] - a[1][0] for a, b in zip(segments, segments[1:])]
            discontinuities = [abs(b[0][1] - a[1][1]) for a, b in zip(segments, segments[1:])]
            y_errors = []
            offset = len(all_segments)
            for j, segment in enumerate(segments):
                for k, endpoint in enumerate(segment):
                    expected = center - (values[offset+j+k]/127 - 0.5)*report['height_spaces']*space
                    y_errors.append(abs(endpoint[1] - expected))
            system = {
                'segments': len(segments),
                'join_x_gaps_points': gaps,
                'max_join_y_error_points': max(discontinuities, default=0),
                'max_cc_height_error_points': max(y_errors),
            }
            if offset + len(segments) in report['system_end_segments']:
                system['right_edge_error_points'] = segments[-1][1][0] - controller['x1']
                assert abs(system['right_edge_error_points']) < 0.001
            assert all(-0.1 < gap <= 0.001 for gap in gaps), 'Gap or excessive overlap'
            assert max(discontinuities, default=0) < 0.001
            assert max(y_errors) < 0.001
            systems.append(system)
            all_segments.extend(segments)
        assert len(all_segments) == report['segments']
        return {'pdf': pdf_path.name, 'native_vector_segments': len(all_segments),
                'systems': systems, 'passed': True}


if __name__ == '__main__':
    folder = Path(__file__).resolve().parents[1] / 'examples/02-midi-cc'
    print(json.dumps([inspect(folder/f'{stem}.pdf', folder/f'{stem}.json')
                      for stem in ('corrected', 'corrected-system-break')], indent=2))
