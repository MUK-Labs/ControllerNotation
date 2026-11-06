import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { buildKnobs, contourValueAt, pointer, knobSVG } from '../../web/core/knobs.js';
import { buildContour } from '../../web/core/contour.js';
import { buildPackage } from '../../web/core/generate.js';
import { parseMidi } from '../../web/core/midi.js';
import { makeZip } from '../../web/core/archive.js';
import { unzipSync, strFromU8 } from '../../web/vendor/fflate.js';

const stream=(values,cc=25,channel=2)=>({cc,channel,tracks:['Test'],events:values.map(([beat,value])=>({beat,tick:beat*480,value}))});
const c=buildContour(stream([[0,0],[1,100],[2,127]],24,1),{step:.5});

test('Secondary values map across the entire range, with independent pointer precision',()=>{
  const k=buildKnobs(stream([[0,0],[.5,32],[1,64],[2,127]]),c,{unit:'semitones',min:0,max:12});
  assert.deepEqual(k.markers.map(m=>m.label),['0 st','3 st','6 st','12 st']);
  assert.equal(k.markers[1].scaled,12*32/127);
  assert.equal(k.channel,2);assert.equal(c.channel,1);
  const low=pointer(0),high=pointer(127),middle=pointer(63.5);
  assert.ok(low.x<0&&low.y>0&&high.x>0&&high.y>0);
  assert.ok(Math.abs(middle.x)<1e-10&&middle.y===-10);
  assert.notDeepEqual(pointer(63),pointer(64));
});
test('Knobs follow the sampled polyline at exact event times; no smoothing or snapping of secondary CC',()=>{
  const k=buildKnobs(stream([[-1,4],[.333,70],[.75,70],[2,40],[3,20]]),c);
  assert.deepEqual(k.markers.map(m=>m.beat),[.333,.75,2]);
  assert.equal(k.markers[0].tick,159.84);assert.equal(k.markers[0].onGrid,false);
  assert.equal(k.markers[0].contourValue,c.values[0]+.666*(c.values[1]-c.values[0]));
  assert.equal(k.omitted,2);assert.match(k.warnings.join(' '),/not been snapped/);
  assert.equal(contourValueAt(c,2),127);
  assert.throws(()=>contourValueAt(c,3),/outside/);
});
test('Label formatting covers percent, MIDI, decimals, negative scales and custom XML characters',()=>{
  const s=stream([[0,0],[1,64],[2,127]]);
  assert.deepEqual(buildKnobs(s,c).markers.map(m=>m.label),['0%','50%','100%']);
  assert.equal(buildKnobs(s,c,{unit:'midi',min:0,max:127}).markers[1].label,'64 MIDI');
  const k=buildKnobs(s,c,{unit:'custom',min:-12,max:12,decimals:2,customUnit:'<Hz & ms>'});
  assert.equal(k.markers[1].label,'0.09 <Hz & ms>');
  const svg=knobSVG(k.markers[1]);
  const doc=new DOMParser().parseFromString(svg,'image/svg+xml');
  assert.equal(doc.getElementsByTagName('text')[0].textContent,k.markers[1].label);
  assert.equal(doc.getElementsByTagName('circle')[0].getAttribute('fill'),'white');
  assert.equal(doc.getElementsByTagName('rect').length,0);
  assert.match(svg,/&lt;Hz &amp; ms&gt;/);
  assert.equal(buildKnobs(stream([[1,63]]),c,{unit:'custom',min:-.001,max:.001,decimals:2}).markers[0].label,'0.00');
});
test('Invalid scales and dense automation fail explicitly; empty passages remain honest',()=>{
  for(const options of [{min:NaN},{max:Infinity},{min:5,max:5},{min:6,max:5},{min:-1e10},{unit:'unknown'},{decimals:4},{unit:'custom',customUnit:'x'.repeat(17)}])
    assert.throws(()=>buildKnobs(stream([[1,2]]),c,options));
  assert.throws(()=>buildKnobs(stream(Array.from({length:257},(_,i)=>[i/128,64])),c),/256/);
  const empty=buildKnobs(stream([[3,2]]),c);assert.equal(empty.markers.length,0);assert.match(empty.warnings.join(' '),/No knob events/);
  assert.equal(buildKnobs(null,c),null);
});
test('Demo and download preserve independent streams, exact bar placement and reusable symbols',()=>{
  const midi=parseMidi(readFileSync(new URL('../../web/demo/controller.mid',import.meta.url)));
  assert.deepEqual(midi.streams.map(s=>s.cc),[24,25]);assert.equal(midi.streams[1].events.length,5);
  const k=buildKnobs(stream([[0,32],[.333,32],[1,64]]),c,{unit:'semitones',min:0,max:12});
  const kit=buildPackage(c,{knobs:k});const zip=unzipSync(makeZip(kit.files));
  const report=JSON.parse(strFromU8(zip['report.json']));
  assert.equal(report.knobs.markers.length,3);assert.equal(report.knobs.symbols.length,2);
  assert.equal(report.knobs.markers[1].beat,.333);assert.equal(report.knobs.markers[1].quarterBeatsIntoBar,.333);
  assert.equal(report.knobs.nativePlacement,'manual');
  for(const s of report.knobs.symbols)assert.ok(zip[s.file]);
  assert.match(strFromU8(zip['START-HERE.txt']),/placing native knobs in Dorico are manual/);
  assert.match(strFromU8(zip['knobs/placements.html']),/3 st/);
  const plain=buildPackage(c);
  assert.equal(kit.files['advanced/draw-all.lua'],plain.files['advanced/draw-all.lua']);
  assert.equal(kit.files['guide.musicxml'],plain.files['guide.musicxml']);
  assert.ok(!Object.keys(plain.files).some(s=>s.startsWith('knobs/')));
});
