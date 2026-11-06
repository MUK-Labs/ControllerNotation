#!/usr/bin/env python3
"""Experimental Standard MIDI File CC -> Dorico native line macro + guide score.

No third-party dependencies. Commands are recorded Dorico 5 macro commands;
this is not a supported Dorico score-object API. See README for UI prerequisites.
"""
from __future__ import annotations

import argparse
import bisect
from dataclasses import dataclass
from fractions import Fraction
import json
import math
from pathlib import Path
import struct
import xml.etree.ElementTree as ET


@dataclass(frozen=True)
class MidiCC:
    ppqn: int
    # Sorted, unique absolute ticks; last event wins for simultaneous events.
    points: tuple[tuple[int, int], ...]
    end_tick: int
    meters: tuple[tuple[int, int, int], ...]


class MidiError(ValueError):
    pass


def read_cc(data: bytes, controller: int, channel: int = 1) -> MidiCC:
    """Read SMF 0/1, PPQN timing, one 7-bit CC and one 1-based MIDI channel."""
    if not 0 <= controller <= 127 or not 1 <= channel <= 16:
        raise MidiError('CC must be 0..127 and channel 1..16')
    pos = 0

    def chunk():
        nonlocal pos
        if pos + 8 > len(data):
            raise MidiError('Truncated MIDI chunk header')
        tag, size = data[pos:pos + 4], int.from_bytes(data[pos + 4:pos + 8], 'big')
        pos += 8
        if pos + size > len(data):
            raise MidiError('Truncated MIDI chunk')
        body = data[pos:pos + size]
        pos += size
        return tag, body

    tag, header = chunk()
    if tag != b'MThd' or len(header) < 6:
        raise MidiError('Not a Standard MIDI File')
    fmt, tracks, division = struct.unpack('>HHH', header[:6])
    if fmt not in (0, 1) or tracks == 0 or (fmt == 0 and tracks != 1):
        raise MidiError('Only SMF format 0 or 1 is supported')
    if division == 0 or division & 0x8000:
        raise MidiError('Only PPQN timing is supported; SMPTE needs explicit conversion')
    points, meters, end_tick = [], [], 0
    for track_number in range(tracks):
        tag, track = chunk()
        if tag != b'MTrk':
            raise MidiError('Expected MTrk chunk')
        p, tick, running = 0, 0, None

        def take(n):
            nonlocal p
            if p + n > len(track):
                raise MidiError(f'Truncated event in track {track_number + 1}')
            result = track[p:p + n]
            p += n
            return result

        def vlq():
            value = 0
            for _ in range(4):
                b = take(1)[0]
                value = (value << 7) | (b & 127)
                if not b & 128:
                    return value
            raise MidiError('Invalid MIDI variable-length quantity')

        while p < len(track):
            tick += vlq()
            if p >= len(track):
                raise MidiError('Missing event after delta time')
            if track[p] & 0x80:
                status = take(1)[0]
                if status < 0xF0:
                    running = status
                else:
                    running = None
            elif running is not None:
                status = running
            else:
                raise MidiError('Running status without a channel status')
            if status == 0xFF:
                kind = take(1)[0]
                payload = take(vlq())
                if kind == 0x58:
                    if len(payload) != 4 or not payload[0] or payload[1] > 7:
                        raise MidiError('Invalid time signature')
                    meters.append((tick, payload[0], 2 ** payload[1]))
                if kind == 0x2F:
                    if payload:
                        raise MidiError('Invalid end-of-track event')
                    break
            elif status in (0xF0, 0xF7):
                take(vlq())
            elif 0x80 <= status < 0xF0:
                n = 1 if status >> 4 in (0xC, 0xD) else 2
                payload = take(n)
                if any(b > 127 for b in payload):
                    raise MidiError('Channel-event data byte has its high bit set')
                if status >> 4 == 0xB and (status & 15) + 1 == channel and payload[0] == controller:
                    points.append((tick, track_number, len(points), payload[1]))
            else:
                raise MidiError(f'Unsupported status 0x{status:02x} in SMF')
        end_tick = max(end_tick, tick)
    if not points:
        raise MidiError(f'No CC{controller} events on channel {channel}')
    merged = {}
    for tick, _, _, value in sorted(points):
        merged[tick] = value
    return MidiCC(division, tuple(merged.items()), end_tick, tuple(sorted(set(meters))))


def bezier_spans(points):
    """Cubic Bezier control points (quarter-note beats, CC), one per input span.

    This is the Bezier representation of the existing monotone Hermite model.
    X handles lie at thirds of each interval, so parameter u is linear in time.
    Shared derivatives are measured in CC per beat, including unequal intervals.
    """
    xs, ys = zip(*points)
    xs = list(map(float, xs))
    ys = list(map(float, ys))
    if any(b <= a for a, b in zip(xs, xs[1:])):
        raise ValueError('Control points must have strictly increasing times')
    slopes = [0.0] * len(xs)
    if len(xs) > 1:
        h = [b - a for a, b in zip(xs, xs[1:])]
        d = [(b - a) / width for a, b, width in zip(ys, ys[1:], h)]
        slopes[0], slopes[-1] = d[0], d[-1]
        for j in range(1, len(xs) - 1):
            if d[j - 1] * d[j] > 0:
                w1, w2 = 2 * h[j] + h[j - 1], h[j] + 2 * h[j - 1]
                slopes[j] = (w1 + w2) / (w1 / d[j - 1] + w2 / d[j])
    return [((xs[j], ys[j]),
             (xs[j] + width/3, ys[j] + width*slopes[j]/3),
             (xs[j+1] - width/3, ys[j+1] - width*slopes[j+1]/3),
             (xs[j+1], ys[j+1])) for j, width in enumerate(
                 [b-a for a, b in zip(xs, xs[1:])])]


def sample(points, at, interpolation='linear', initial=None):
    """Sample CC at quarter-note positions; smooth/bezier are equivalent modes."""
    if interpolation not in ('hold', 'linear', 'smooth', 'bezier'):
        raise ValueError('Unknown interpolation')
    xs, ys = zip(*points)
    xs, ys = list(map(float, xs)), list(map(float, ys))
    spans = bezier_spans(points)  # also validates strictly increasing times
    result = []
    for t in map(float, at):
        if t < xs[0]:
            if initial is None:
                raise ValueError('CC begins after the requested start; specify --initial-value')
            result.append(float(initial))
            continue
        j = bisect.bisect_right(xs, t) - 1
        if j == len(xs) - 1 or interpolation == 'hold':
            result.append(ys[j])
            continue
        width = xs[j + 1] - xs[j]
        u = (t - xs[j]) / width
        if interpolation == 'linear':
            y = ys[j] + (ys[j + 1] - ys[j]) * u
        else:
            a, b, c, d = [p[1] for p in spans[j]]
            y = (1-u)**3*a + 3*(1-u)**2*u*b + 3*(1-u)*u*u*c + u**3*d
        result.append(min(max(y, min(ys[j:j+2])), max(ys[j:j+2])))
    return result


NOTE_TYPES = {Fraction(4): 'whole', Fraction(2): 'half', Fraction(1): 'quarter',
              Fraction(1, 2): 'eighth', Fraction(1, 4): '16th', Fraction(1, 8): '32nd'}


def grid(start, end, step):
    if start < 0 or end <= start or step not in NOTE_TYPES:
        raise ValueError('Require 0 <= start < end and step 4, 2, 1, 1/2, 1/4 or 1/8 beats')
    count = (end - start) / step
    if count.denominator != 1:
        raise ValueError('Start/end interval must be an exact multiple of the grid step')
    if count > 4096:
        raise ValueError('More than 4096 segments; use a coarser grid or shorter interval')
    return [start + i * step for i in range(int(count) + 1)]


def lua_macro(values, height_spaces=4, end_dx=Fraction(9, 8),
              system_end_indices=(), system_end_dx=Fraction(7, 10)):
    """One selected guide note seeds one grid interval. All following spans repeat it.

    Keep native positions below the staff to avoid notehead clearance at zero.
    Fractional engraving offsets place the contour; positive DY moves upward.
    Both offsets were checked against Dorico 5 PDF exports of the fixture.
    """
    heights = [-height_spaces + 2 * height_spaces * y / 127 for y in values]
    ends = set(system_end_indices)
    lines = [
        '-- Generated by ControllerNotation. See README before running.',
        '-- Select ONE guide note at the start in Write mode.',
        '-- Lines panel: set both Start and End to Rhythmic position.',
        '-- A separate native line is made for every guide-note duration.',
        'local app = DoApp.DoApp()',
        'local function cmd(s) app:doCommand(s) end',
        "cmd('UI.InvokePaletteButton?PaletteIndicatorID=kGenericLinesPanel.linestyle.solidLine&PaletteSectionID=kGenericLinesHorizontalLinePanel&PropertyButton=false&SetOldValue=false&Set=true&UseLocalOverride=0')",
        "cmd('Edit.FlipItem')", "cmd('Edit.FlipItem')",
    ]
    def prop(name, value):
        lines.append(f"cmd('UI.InvokePropertyChangeValue?Type=kHorizontalLine{name}&Value={value}')")
    for i, (a, b) in enumerate(zip(heights, heights[1:])):
        lines.append(f'-- Segment {i + 1}: CC {values[i]:.6f} -> {values[i + 1]:.6f}')
        # Staff position zero triggers notehead clearance even with hidden notes.
        # Keep the base below the staff; engraving DY then places the contour.
        base_a = base_b = min(-1, math.floor(-height_spaces))
        prop('StartPosition', f'int: {base_a}')
        prop('EndPosition', f'int: {base_b}')
        prop('HorizontalStartPosition', 'string: "kStartWithLeftmostNotehead"')
        lines += ["cmd('Window.SwitchMode?WindowMode=kEngraveMode')", "cmd('Edit.PropertiesSetGlobal')"]
        dx = system_end_dx if i + 1 in ends else end_dx
        prop('EndDX', f'string: "{dx}"')
        # Native positions use half-spaces; engraving offsets use full spaces.
        for which, target, base in [('Start', a, base_a), ('End', b, base_b)]:
            offset = Fraction((target - base) / 2).limit_denominator(100000)
            prop(which + 'DY', f'string: "{offset}"')
        lines.append("cmd('Window.SwitchMode?WindowMode=kWriteMode')")
        if i + 2 < len(heights):
            lines.append("cmd('NoteInput.RepeatLast')")
    return '\n'.join(lines) + '\n'


def fixture(step, segments, title='MIDI CC native line test', numerator=4, denominator=4):
    """Reference staff and single-line controller staff, with a final anchor note.

    The fixture begins at the exported interval's origin. Meter is explicit;
    it does not reconstruct the source MIDI's changing meters or an existing score.
    """
    beats_per_bar = Fraction(4 * numerator, denominator)
    if beats_per_bar / step != int(beats_per_bar / step):
        raise ValueError('Grid must divide the fixture bar duration')
    per_bar = int(beats_per_bar / step)
    bars = math.ceil((segments + 1) / per_bar)
    root = ET.Element('score-partwise', version='4.0')
    work = ET.SubElement(root, 'work')
    ET.SubElement(work, 'work-title').text = title
    part_list = ET.SubElement(root, 'part-list')
    for p, name in [('P1', 'Reference grid'), ('P2', 'Controller')]:
        scorepart = ET.SubElement(part_list, 'score-part', id=p)
        ET.SubElement(scorepart, 'part-name').text = name
        instr = ET.SubElement(scorepart, 'score-instrument', id=p+'I')
        ET.SubElement(instr, 'instrument-name').text = 'Flute'
        part = ET.SubElement(root, 'part', id=p)
        for bar in range(1, bars + 1):
            measure = ET.SubElement(part, 'measure', number=str(bar))
            if bar == 1:
                attr = ET.SubElement(measure, 'attributes')
                ET.SubElement(attr, 'divisions').text = '480'
                time = ET.SubElement(attr, 'time')
                ET.SubElement(time, 'beats').text = str(numerator)
                ET.SubElement(time, 'beat-type').text = str(denominator)
                clef = ET.SubElement(attr, 'clef')
                ET.SubElement(clef, 'sign').text = 'G'
                ET.SubElement(clef, 'line').text = '2'
                if p == 'P2':
                    detail = ET.SubElement(attr, 'staff-details')
                    ET.SubElement(detail, 'staff-lines').text = '1'
            for _ in range(per_bar):
                note = ET.SubElement(measure, 'note')
                pitch = ET.SubElement(note, 'pitch')
                ET.SubElement(pitch, 'step').text = 'E'
                ET.SubElement(pitch, 'octave').text = '4'
                ET.SubElement(note, 'duration').text = str(int(step * 480))
                ET.SubElement(note, 'type').text = NOTE_TYPES[step]
    ET.indent(root)
    return ET.tostring(root, encoding='unicode', xml_declaration=True)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('midi', type=Path)
    p.add_argument('--cc', type=int, default=74)
    p.add_argument('--channel', type=int, default=1)
    p.add_argument('--step', type=Fraction, default=Fraction(1, 2), help='Quarter-note beats per segment')
    p.add_argument('--start-beat', type=Fraction, default=Fraction(0))
    p.add_argument('--end-beat', type=Fraction)
    p.add_argument('--initial-value', type=int, choices=range(128), metavar='0..127')
    p.add_argument('--interpolation', choices=['hold', 'linear', 'smooth', 'bezier'], default='linear',
                   help='smooth and bezier use the same bounded cubic curve')
    p.add_argument('--height-spaces', type=float, default=4, help='Total vertical range in staff spaces')
    p.add_argument('--end-dx', type=Fraction, default=Fraction(9, 8))
    p.add_argument('--system-end-segments', default='', help='1-based segment numbers; layout-specific override')
    p.add_argument('--system-end-dx', type=Fraction, default=Fraction(7, 10))
    p.add_argument('--meter', default='4/4', help='Explicit fixture meter; source meter changes are not reconstructed')
    p.add_argument('--output', type=Path, required=True, help='Output file stem; writes .lua, .musicxml, .json')
    args = p.parse_args(argv)
    try:
        if not math.isfinite(args.height_spaces) or not 0 < args.height_spaces <= 100:
            raise ValueError('Height must be finite and between 0 and 100 staff spaces')
        midi = read_cc(args.midi.read_bytes(), args.cc, args.channel)
        end = args.end_beat if args.end_beat is not None else Fraction(midi.points[-1][0], midi.ppqn)
        times = grid(args.start_beat, end, args.step)
        pts = [(Fraction(t, midi.ppqn), v) for t, v in midi.points]
        values = sample(pts, times, args.interpolation, args.initial_value)
        ends = [int(x) for x in args.system_end_segments.split(',') if x.strip()]
        if any(i < 1 or i >= len(times) for i in ends):
            raise ValueError('System-end segment indices are outside the generated range')
        meter_n, meter_d = map(int, args.meter.split('/'))
        if meter_n <= 0 or meter_d not in (1, 2, 4, 8, 16, 32):
            raise ValueError('Invalid fixture meter')
        macro = lua_macro(values, args.height_spaces, args.end_dx, ends, args.system_end_dx)
        xml = fixture(args.step, len(times) - 1, f'CC{args.cc} - {args.interpolation} - {args.step} beat grid', meter_n, meter_d)
        report = {'source': args.midi.name, 'cc': args.cc, 'channel': args.channel,
                  'ppqn': midi.ppqn, 'source_event_count': len(pts), 'segments': len(times) - 1,
                  'step_beats': str(args.step), 'start_beat': str(args.start_beat),
                  'interpolation': args.interpolation, 'height_spaces': args.height_spaces,
                  'placement': 'fixed-below-staff-base-with-fractional-DY',
                  'fixture_meter': args.meter, 'source_meters': midi.meters,
                  'system_end_segments': ends, 'end_dx_spaces': str(args.end_dx),
                  'system_end_dx_spaces': str(args.system_end_dx),
                  'samples': [{'beat': str(t), 'cc': v} for t, v in zip(times, values)],
                  'limitations': ['Fixture meter is explicit; source meter changes are not imported.',
                                  'CC is resampled: fast changes between grid points can be lost.',
                                  'Hold interpolation still draws straight ramps between sampled vertices.',
                                  'System-end corrections are manual and become stale after reflow.',
                                  'SMF format 0/1 with PPQN only; no 14-bit CC, NRPN, or live MIDI.']}
        if args.interpolation in ('smooth', 'bezier'):
            report['bezier_model'] = {
                'units': ['quarter-note beats', '7-bit CC value'],
                'scope': 'full source CC stream; samples above select the output interval',
                'spans': [dict(zip(('p0', 'p1', 'p2', 'p3'), span)) for span in bezier_spans(pts)],
                'dorico_rendering': 'sampled native straight segments, not native Bezier objects'}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        for ext, content in [('.lua', macro), ('.musicxml', xml), ('.json', json.dumps(report, indent=2))]:
            args.output.with_suffix(ext).write_text(content + '\n')
    except (ValueError, OSError) as exc:
        p.error(str(exc))
    print(f'Generated {len(times) - 1} segments from {len(pts)} CC events: {args.output}')


if __name__ == '__main__':
    main()
