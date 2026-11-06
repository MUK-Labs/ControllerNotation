#!/usr/bin/env python3
"""Measure this two-staff fixture's pasted native contours (requires pdfplumber).

Uses reference-note glyph x positions as an independent musical-time grid.
The glyph and staff recognition are specific to the supplied Dorico fixtures.
"""
import argparse
from fractions import Fraction
import json
from pathlib import Path
import statistics
import pdfplumber


def geometry(path):
    systems = []
    guide_offset = 0
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            lines = sorted([p for p in page.lines if abs(p['top']-p['bottom']) < 1e-5
                            and p['x1']-p['x0'] > 100], key=lambda p:p['top'])
            assert lines and len(lines)%6 == 0, 'Unexpected staff configuration'
            # Dorico draws the reference heads in black and hidden guides in white.
            heads = [c for c in page.chars if c['text']=='\uf4be'
                     and c['non_stroking_color'] == (0.0,0.0,0.0)]
            groups = {}
            for c in heads:
                groups.setdefault(round(c['top'],3), []).append(c['x0'])
            assert len(groups) == len(lines)//6, 'Reference-note rows not recognized'
            for row, top in enumerate(sorted(groups)):
                ref = lines[row*6:row*6+5]
                staff = lines[row*6+5]
                center = staff['top']
                space = ref[1]['top']-ref[0]['top']
                segments = []
                for c in page.curves:
                    if (center-3*space < c['top'] < center+3*space
                        and c['x0'] > staff['x0']+25 and c['width']>5 and len(c['pts'])==5):
                        p=c['pts']
                        a=tuple((p[1][k]+p[2][k])/2 for k in (0,1))
                        b=tuple((p[0][k]+p[3][k])/2 for k in (0,1))
                        segments.append((a,b))
                for r in page.rects:
                    if (center-3*space < r['top'] < center+3*space
                        and r['x0']>staff['x0']+25 and r['width']>5 and .60<r['height']<.64):
                        y=(r['top']+r['bottom'])/2
                        segments.append(((r['x0'],y),(r['x1'],y)))
                notes=sorted(groups[top])
                barlines=[l for l in page.lines if l['height']>2*space and l['width']<1e-5
                          and l['x0']>notes[-1] and abs(l['bottom']-center)<2*space]
                assert barlines, 'Final system barline not recognized'
                boundary=max(barlines,key=lambda l:l['x0'])
                systems.append(dict(page=page.page_number, center=center, space=space,
                                    staff_end_x=staff['x1'], guide_offset=guide_offset,
                                    barline_right=boundary['x0']+boundary['linewidth']/2,
                                    note_x=notes, segments=sorted(segments)))
                guide_offset += len(notes)
    assert guide_offset == 160, f'Expected 160 reference notes, got {guide_offset}'
    return systems


def inspect(source_pdf, target_pdf, report_path):
    report=json.loads(report_path.read_text())
    source=geometry(source_pdf)
    target=geometry(target_pdf)
    # Calibrate the notehead-to-line attachment offset from the verified source.
    offsets=[]
    index=0
    for system in source:
        for a,b in system['segments']:
            guide=int(Fraction(report['samples'][index]['beat'])*8)-system['guide_offset']
            offsets.append((a[0]-system['note_x'][guide])/system['space'])
            index+=1
    assert index==report['segments']
    offset=statistics.median(offsets)
    assert max(abs(x-offset) for x in offsets)<1e-5
    index=0
    all_y_errors=[]
    all_anchor_errors=[]
    end_anchor_errors=[]
    mismatches=[]
    measured=[]
    for system in target:
        segments=system['segments']
        gaps=[b[0][0]-a[1][0] for a,b in zip(segments,segments[1:])]
        joins=[abs(b[0][1]-a[1][1]) for a,b in zip(segments,segments[1:])]
        for a,b in segments:
            expected=Fraction(report['samples'][index]['beat'])
            j=min(range(len(system['note_x'])), key=lambda j:abs(
                a[0]-(system['note_x'][j]+offset*system['space'])))
            observed=Fraction(system['guide_offset']+j,8)
            err=abs(a[0]-(system['note_x'][j]+offset*system['space']))
            all_anchor_errors.append(err)
            if observed != expected:
                mismatches.append(dict(segment=index+1,expected=str(expected),observed=str(observed)))
            end_beat=Fraction(report['samples'][index+1]['beat'])
            system_end_beat=Fraction(system['guide_offset']+len(system['note_x']),8)
            if end_beat < system_end_beat:
                end_j=min(range(len(system['note_x'])),key=lambda j:abs(
                    b[0]-(system['note_x'][j]+(offset+.005)*system['space'])))
                observed_end=Fraction(system['guide_offset']+end_j,8)
                end_anchor_errors.append(abs(b[0]-(system['note_x'][end_j]+(offset+.005)*system['space'])))
                if observed_end != end_beat:
                    mismatches.append(dict(segment=index+1,endpoint='end',expected=str(end_beat),observed=str(observed_end)))
            for k, endpoint in enumerate((a,b)):
                cc=report['samples'][index+k]['cc']
                y=system['center']-(cc/127-.5)*report['height_spaces']*system['space']
                all_y_errors.append(abs(endpoint[1]-y))
            index+=1
        system_end=Fraction(system['guide_offset']+len(system['note_x']),8)
        ends_at_boundary=bool(segments) and Fraction(report['samples'][index]['beat'])==system_end
        measured.append(dict(page=system['page'],guide_start_beat=str(Fraction(system['guide_offset'],8)),
                             guide_notes=len(system['note_x']),segments=len(segments),
                             cumulative_segments=index,join_x_gaps_points=gaps,
                             max_join_y_error_points=max(joins,default=0),
                             system_end_error_points=(segments[-1][1][0]-system['barline_right']) if ends_at_boundary else None,
                             last_endpoint_minus_staff_end_points=(segments[-1][1][0]-system['staff_end_x']) if segments else None))
    assert index==report['segments'], f'Expected {report["segments"]} segments, got {index}'
    return dict(source=source_pdf.name,target=target_pdf.name,native_segments=index,
                attachment_offset_spaces=offset,timing_mismatches=mismatches,
                max_start_anchor_error_points=max(all_anchor_errors),
                max_internal_end_anchor_error_points=max(end_anchor_errors),
                max_cc_height_error_points=max(all_y_errors),systems=measured,
                timing_passed=not mismatches and max(all_anchor_errors)<.001,
                sampled_heights_passed=max(all_y_errors)<.001,
                system_ends_passed=all(abs(s['system_end_error_points'])<.001 for s in measured
                                      if s['system_end_error_points'] is not None),
                internal_joins_passed=all(-.1<g<=.001 for s in measured for g in s['join_x_gaps_points'])
                    and all(s['max_join_y_error_points']<.001 for s in measured))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=Path)
    p.add_argument('target',type=Path)
    p.add_argument('report',type=Path)
    p.add_argument('--output',type=Path)
    a=p.parse_args()
    result=inspect(a.source,a.target,a.report)
    text=json.dumps(result,indent=2)+'\n'
    if a.output:
        a.output.write_text(text)
    else:
        print(text)
