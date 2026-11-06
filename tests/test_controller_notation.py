import struct
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from fractions import Fraction as F
import xml.etree.ElementTree as ET

from controller_notation import MidiError, bezier_spans, fixture, grid, lua_macro, main, read_cc, sample


def vlq(value):
    out = [value & 127]
    while value >> 7:
        value >>= 7
        out.insert(0, 128 | (value & 127))
    return bytes(out)


def smf(*tracks, fmt=None, division=480):
    if fmt is None:
        fmt = 0 if len(tracks) == 1 else 1
    header = b'MThd' + struct.pack('>IHHH', 6, fmt, len(tracks), division)
    return header + b''.join(b'MTrk' + struct.pack('>I', len(t)) + t for t in tracks)


END = b'\0\xff\x2f\0'


class MidiTests(unittest.TestCase):
    def test_running_status_and_multibyte_delta(self):
        midi = read_cc(smf(b'\0\xb0\x4a\x00' + vlq(960) + b'\x4a\x7f' + END), 74)
        self.assertEqual(midi.points, ((0, 0), (960, 127)))
        self.assertEqual(midi.ppqn, 480)

    def test_track_merge_channel_and_controller_filter(self):
        a = b'\0\xb0\x4a\x01' + vlq(480) + b'\x4a\x20' + END
        b = b'\0\xb1\x4a\x63\0\xb0\x4b\x63' + vlq(240) + b'\xb0\x4a\x10' + END
        midi = read_cc(smf(a, b), 74)
        self.assertEqual(midi.points, ((0, 1), (240, 16), (480, 32)))
        self.assertEqual(read_cc(smf(a, b), 74, 2).points, ((0, 99),))

    def test_simultaneous_last_event_wins(self):
        a = b'\0\xb0\x4a\x01\0\x4a\x02' + END
        b = b'\0\xb0\x4a\x03' + END
        self.assertEqual(read_cc(smf(a, b), 74).points, ((0, 3),))

    def test_meta_sysex_and_one_byte_channel_messages(self):
        t = b'\0\xff\x58\x04\x03\x03\x18\x08\0\xc0\x05\0\xd0\x23'
        t += b'\0\xf0\x03\x01\x02\xf7\0\xb0\x4a\x40' + END
        midi = read_cc(smf(t), 74)
        self.assertEqual(midi.meters, ((0, 3, 8),))
        self.assertEqual(midi.points, ((0, 64),))

    def test_unsupported_formats_and_malformed_input(self):
        for data in [b'', smf(END, fmt=2), smf(END, division=0xE728),
                     smf(b'\0\x4a\x20'), smf(b'\0\xb0\x4a'),
                     smf(b'\x81\x81\x81\x81\0'), smf(b'\0\xb0\x4a\xff')]:
            with self.subTest(data=data), self.assertRaises(MidiError):
                read_cc(data, 74)

    def test_missing_controller_is_explicit(self):
        with self.assertRaisesRegex(MidiError, 'No CC74'):
            read_cc(smf(END), 74)


class SamplingTests(unittest.TestCase):
    def test_linear_and_hold_values(self):
        p = [(F(0), 0), (F(1), 127), (F(2), 0)]
        times = [F(0), F(1, 2), F(1), F(3, 2), F(2), F(3)]
        self.assertEqual(sample(p, times), [0, 63.5, 127, 63.5, 0, 0])
        self.assertEqual(sample(p, times, 'hold'), [0, 0, 127, 127, 0, 0])

    def test_smooth_preserves_vertices_plateaus_and_bounds(self):
        p = [(0, 0), (1, 32), (2, 96), (3, 127), (4, 127), (5, 10), (6, 10)]
        self.assertEqual(sample(p, range(7), 'smooth'), [y for _, y in p])
        times = [F(i, 100) for i in range(601)]
        values = sample(p, times, 'smooth')
        for t, v in zip(times, values):
            j = min(int(t), 5)
            low, high = sorted([p[j][1], p[j+1][1]])
            self.assertTrue(low <= v <= high)
        self.assertTrue(all(v == 127 for v in values[300:401]))
        self.assertNotEqual(sample(p, [F(1, 2)], 'smooth'), sample(p, [F(1, 2)], 'linear'))

    def test_nonuniform_smooth_remains_monotonic(self):
        p = [(0, 0), (F(1, 10), 100), (7, 101), (8, 127)]
        values = sample(p, [F(i, 100) for i in range(801)], 'smooth')
        self.assertTrue(all(b >= a for a, b in zip(values, values[1:])))

    def test_no_invented_initial_value(self):
        with self.assertRaisesRegex(ValueError, 'initial-value'):
            sample([(2, 100)], [0])
        self.assertEqual(sample([(2, 100)], [0, 2, 3], initial=64), [64, 100, 100])

    def test_bezier_controls_preserve_nonuniform_tangent_continuity(self):
        points = [(0, 0), (0.5, 32), (2, 96), (3, 127), (4, 127), (6, 0)]
        spans = bezier_spans(points)
        for j, s in enumerate(spans):
            self.assertEqual(s[0], points[j])
            self.assertEqual(s[-1], points[j+1])
            lo, hi = sorted([s[0][1], s[-1][1]])
            self.assertTrue(all(lo <= p[1] <= hi for p in s))
        for a, b in zip(spans, spans[1:]):
            left = (a[3][1]-a[2][1])/(a[3][0]-a[2][0])
            right = (b[1][1]-b[0][1])/(b[1][0]-b[0][0])
            self.assertAlmostEqual(left, right)

    def test_bezier_matches_previous_hermite_values(self):
        p = [(0, 0), (1, 32), (2, 96), (3, 127), (4, 127)]
        values = sample(p, [0.5, 1.5, 2.5], 'bezier')
        for got, expected in zip(values, [14.666666666666668, 64.11228070175439, 116.72105263157894]):
            self.assertAlmostEqual(got, expected)
        self.assertEqual(values, sample(p, [0.5, 1.5, 2.5], 'smooth'))

    def test_grid_uses_exact_beats_and_rejects_partial_tail(self):
        self.assertEqual(grid(F(0), F(1), F(1, 4)), [F(0), F(1, 4), F(1, 2), F(3, 4), F(1)])
        for args in [(F(0), F(1), F(2)), (F(1), F(1), F(1)), (F(0), F(1), F(1, 3))]:
            with self.assertRaises(ValueError):
                grid(*args)


class GenerationTests(unittest.TestCase):
    def test_preserve_origin_retains_lead_in_without_inventing_cc(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'late.mid'
            source.write_bytes(smf(vlq(540) + b'\xb0\x18\x0f' + vlq(7860) + b'\x18\x32' + END))
            output = Path(folder) / 'result'
            with contextlib.redirect_stdout(io.StringIO()):
                main([str(source), '--cc', '24', '--step', '1/8', '--start-beat', '9/8',
                      '--preserve-origin', '--output', str(output)])
            report = json.loads(output.with_suffix('.json').read_text())
            self.assertEqual(report['fixture_origin_beat'], '0')
            self.assertEqual(report['first_controller_guide_note_1based'], 10)
            self.assertEqual(report['samples'][0], {'beat': '9/8', 'cc': 15.0})
            self.assertEqual(report['samples'][-1]['beat'], '35/2')
            self.assertEqual(report['segments'], 131)
            xml = ET.fromstring(output.with_suffix('.musicxml').read_text())
            self.assertEqual(len(xml.findall('part')[1].findall('measure')), 5)

    def test_fixture_keeps_anchor_after_last_segment(self):
        root = ET.fromstring(fixture(F(1, 2), 16))
        parts = root.findall('part')
        self.assertEqual(len(parts), 2)
        for part in parts:
            measures = part.findall('measure')
            self.assertEqual(len(measures), 3)
            for m in measures:
                self.assertEqual(sum(int(n.findtext('duration')) for n in m.findall('note')), 1920)
        self.assertEqual(parts[1].findtext('measure/attributes/staff-details/staff-lines'), '1')

    def test_macro_shape_matches_segments_and_edge_override(self):
        macro = lua_macro([0, 127, 64, 0], system_end_indices=[2])
        self.assertEqual(macro.count("cmd('NoteInput.RepeatLast')"), 2)
        dx = [line for line in macro.splitlines() if 'Type=kHorizontalLineEndDX' in line]
        self.assertIn('"9/8"', dx[0])
        self.assertIn('"7/10"', dx[1])
        self.assertIn('"9/8"', dx[2])
        self.assertNotIn('SelectAtPoint', macro)
        self.assertNotIn('File.Save', macro)

    def test_staff_crossing_keeps_base_below_staff_and_preserves_cc_precision(self):
        macro = lua_macro([0, 63.5, 64, 127])
        positions = [s for s in macro.splitlines() if 'Position&Value=int:' in s]
        self.assertEqual(len(positions), 6)
        self.assertTrue(all('int: -4' in s for s in positions))
        offsets = [s for s in macro.splitlines() if 'DY&Value=' in s]
        self.assertIn('"0"', offsets[0])
        self.assertIn('"2"', offsets[1])
        self.assertIn('"256/127"', offsets[3])
        self.assertIn('"4"', offsets[-1])


if __name__ == '__main__':
    unittest.main()
