"""Rebar the existing dense guide fixture; do not generate any contour objects."""
from pathlib import Path
from fractions import Fraction as F
import sys
import xml.etree.ElementTree as ET
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from controller_notation import fixture

METERS = [(3, 4), (5, 8), (7, 8), (5, 4), (3, 4), (3, 4)]
root = ET.fromstring(fixture(F(1, 8), 140, 'CC24 - changing meters - pasted contour'))
for part in root.findall('part'):
    old = part.findall('measure')
    notes = [note for measure in old for note in measure.findall('note')]
    initial = old[0].find('attributes')
    for measure in old:
        part.remove(measure)
    cursor = 0
    previous = None
    for index, (n, d) in enumerate(METERS, 1):
        measure = ET.SubElement(part, 'measure', number=str(index))
        if index in (3, 4, 5):
            ET.SubElement(measure, 'print', {'new-system': 'yes'})
        if index == 1:
            attr = initial
            measure.append(attr)
        elif previous != (n, d):
            attr = ET.SubElement(measure, 'attributes')
        else:
            attr = None
        if attr is not None:
            time = attr.find('time')
            if time is None:
                time = ET.SubElement(attr, 'time')
                ET.SubElement(time, 'beats')
                ET.SubElement(time, 'beat-type')
            time.find('beats').text = str(n)
            time.find('beat-type').text = str(d)
        count = int(F(4*n, d) / F(1, 8))
        for note in notes[cursor:cursor+count]:
            measure.append(note)
        cursor += count
        previous = (n, d)
    assert cursor == len(notes) == 160
ET.indent(root)
Path(__file__).with_name('changing-meters.musicxml').write_text(ET.tostring(root, encoding='unicode', xml_declaration=True)+'\n')
