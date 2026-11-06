import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DOMParser} from '@xmldom/xmldom';
import {parseMidi} from '../../web/core/midi.js';
import {parseMusicXML,makeMeterLayout} from '../../web/core/musicxml.js';
import {sampleCC,buildContour} from '../../web/core/contour.js';
import {buildPackage,luaMacro} from '../../web/core/generate.js';
import {makeZip,readMusicXML} from '../../web/core/archive.js';
import {unzipSync,strFromU8} from '../../web/vendor/fflate.js';

const read=p=>readFileSync(new URL(p,import.meta.url));
const layoutXML=read('../../web/demo/changing-meters.musicxml').toString();
const layout=parseMusicXML(layoutXML,DOMParser);
const midi=parseMidi(read('../../web/demo/controller.mid'));
const cc=midi.streams[0],contour=buildContour(cc,{layout});
const vlq=n=>{const a=[n&127];while(n>>=7)a.unshift((n&127)|128);return a;};
const smf=(tracks,{format=tracks.length===1?0:1,division=480}={})=>{
  const header=Buffer.alloc(14);header.write('MThd');header.writeUInt32BE(6,4);header.writeUInt16BE(format,8);header.writeUInt16BE(tracks.length,10);header.writeUInt16BE(division,12);
  return Buffer.concat([header,...tracks.flatMap(data=>{const h=Buffer.alloc(8);h.write('MTrk');h.writeUInt32BE(data.length,4);return[h,Buffer.from(data)];})]);
};
const end=[0,255,47,0];
const attrs='<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';
const note=n=>`<note><pitch><step>E</step><octave>4</octave></pitch><duration>${n}</duration></note>`;
const score=body=>`<score-partwise><part-list/><part id="P1">${body}</part></score-partwise>`;

test('MIDI: running status, channels, track merge and equal-time last event wins',()=>{
  const a=[0,176,24,1,...vlq(480),24,100,...end];
  const b=[0,177,24,60,0,176,24,2,...vlq(240),24,50,...end];
  const parsed=parseMidi(smf([a,b]));
  assert.deepEqual(parsed.streams[0].events.map(e=>[e.beat,e.value]),[[0,2],[.5,50],[1,100]]);
  assert.equal(parsed.streams[1].channel,2);
  assert.equal(parsed.streams[0].tracks.length,2);
});
test('MIDI: time signatures, sysex and one-byte messages do not disturb CC times',()=>{
  const parsed=parseMidi(smf([[0,255,88,4,5,3,24,8,0,192,2,0,208,4,0,240,2,1,247,0,176,24,64,...vlq(480),24,32,...end]]));
  assert.equal(parsed.meters[0].numerator,5);assert.equal(parsed.meters[0].denominator,8);
  assert.equal(parsed.streams[0].events[1].beat,1);
});
test('MIDI: malformed, empty, SMPTE and independent sequences are rejected',()=>{
  for(const bytes of [new Uint8Array(),smf([end]),smf([end],{format:2}),smf([end],{division:0xe728}),smf([[0,24,100]]),smf([[0,176,24]]),smf([[129,129,129,129,0]]),smf([[0,176,24,255]])])assert.throws(()=>parseMidi(bytes));
});
test('Real Dorico export: changing meters and system breaks map to exact quarter beats',()=>{
  assert.equal(layout.partCount,2);
  assert.deepEqual(layout.bars.map(b=>b.start),[0,3,5.5,9,14,17]);
  assert.deepEqual(layout.bars.map(b=>b.meter.label),['3/4','5/8','7/8','5/4','3/4','3/4']);
  assert.deepEqual(layout.breaks.map(b=>b.beat),[5.5,9,14]);assert.equal(layout.totalBeats,20);
  assert.match(layout.software,/Dorico 5.1.81/);
});
test('MusicXML: pickups, chords, backup, forward, full-bar rests and page-only breaks',()=>{
  const xml=score(`<measure number="pickup" implicit="yes">${attrs}${note(4)}</measure><measure number="A"><print new-page="yes"/>${note(8)}<note><chord/><duration>8</duration></note>${note(8)}<backup><duration>16</duration></backup><forward><duration>16</duration></forward></measure><measure number="B"><note><rest measure="yes"/></note></measure>`);
  const parsed=parseMusicXML(xml,DOMParser);
  assert.deepEqual(parsed.bars.map(b=>b.duration),[1,4,4]);assert.deepEqual(parsed.breaks,[{beat:1,bar:'A',page:true}]);
});
test('MusicXML: rejects inconsistent parts, mid-bar breaks and entities',()=>{
  assert.throws(()=>parseMusicXML(layoutXML.replace('new-system="yes"','new-system="no"'),DOMParser),/conflicting/);
  assert.throws(()=>parseMusicXML(score(`<measure>${attrs}${note(4)}<print new-system="yes"/>${note(12)}</measure>`),DOMParser),/inside bar/);
  assert.throws(()=>parseMusicXML('<!DOCTYPE a [<!ENTITY x "bad">]><score-partwise/>',DOMParser),/entity/);
  assert.throws(()=>parseMusicXML('<score-timewise/>',DOMParser),/partwise/);
  assert.throws(()=>parseMusicXML(score('<measure><note><duration>16</duration></note></measure>'),DOMParser));
});
test('MusicXML: compressed container selects its declared score and round-trips',()=>{
  const zip=makeZip({'META-INF/container.xml':'<container><rootfiles><rootfile full-path="score/main.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>','score/main.xml':layoutXML,'ignored.xml':'wrong'});
  assert.equal(readMusicXML(zip,DOMParser),layoutXML);
  assert.throws(()=>readMusicXML(makeZip({'missing.xml':'x'}),DOMParser),/container/);
});
test('Smoothing agrees with the Python prototype and remains bounded across extremes',()=>{
  const events=[0,32,96,127,127].map((value,beat)=>({beat,value}));
  const actual=sampleCC(events,[.5,1.5,2.5]);
  const expected=[14.666666666666668,64.11228070175439,116.72105263157894];
  actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-10));
  assert.deepEqual(sampleCC(events,[0,1,2,3,4]),[0,32,96,127,127]);
  const dense=sampleCC([{beat:0,value:0},{beat:.1,value:100},{beat:7,value:101},{beat:8,value:127}],Array.from({length:801},(_,i)=>i/100));
  assert.ok(dense.every((v,i)=>v>=0&&v<=127&&(!i||v>=dense[i-1])));
});
test('Late CC origin and layout corrections survive resampling without invented lead-in',()=>{
  assert.equal(contour.start,1.125);assert.equal(contour.end,17.5);assert.equal(contour.firstGuide,10);assert.equal(contour.count,131);
  assert.deepEqual(contour.systemEnds,[35,63,103]);
  const coarse=buildContour(cc,{step:.25,layout});assert.equal(coarse.start,1.25);assert.ok(coarse.warnings.some(w=>/omitted/.test(w)));
  assert.throws(()=>buildContour(cc,{start:0}),/outside/);
  assert.throws(()=>buildContour(cc,{layout:{...layout,hasRepeats:true}}),/repeats/);
  assert.doesNotThrow(()=>buildContour(cc,{layout:{...layout,hasRepeats:true},alignmentConfirmed:true}));
  assert.throws(()=>buildContour(cc,{step:1,layout}),/boundary/);
  assert.throws(()=>buildContour(cc,{layout:{...layout,totalBeats:10}}),/beyond/);
});
test('MIDI-only meter changes and explicit fallback create usable guide bars',()=>{
  const mapped=makeMeterLayout([{beat:0,numerator:3,denominator:4},{beat:3,numerator:5,denominator:8}],7);
  assert.deepEqual(mapped.bars.map(b=>b.start),[0,3,5.5]);
  assert.equal(makeMeterLayout([],8,'4/4').bars.length,3);
  assert.throws(()=>makeMeterLayout([],8,'free'),/meter/);
});
test('Guide export retains meters, layout breaks and the final anchor',()=>{
  const kit=buildPackage(contour);
  const parsed=parseMusicXML(kit.files['guide.musicxml'],DOMParser);
  assert.deepEqual(parsed.bars.map(b=>b.start),layout.bars.map(b=>b.start));
  assert.deepEqual(parsed.breaks,layout.breaks);assert.ok(parsed.totalBeats>contour.end);
  assert.match(kit.startDescription,/guide 10 from flow start/);
  const final=buildContour({...cc,events:[{beat:0,value:0},{beat:20,value:127}]},{layout});
  const appended=buildPackage(final);assert.equal(appended.layout.appended,true);assert.equal(appended.report.systemEndSegments.at(-1),160);
});
test('Chunked Lua has precisely the same commands as a single run, with calibrated endings',()=>{
  const kit=buildPackage(contour),commands=s=>s.split('\n').filter(l=>l.startsWith("cmd('"));
  assert.deepEqual(kit.chunks.flatMap(name=>commands(kit.files[name])),commands(kit.files['advanced/draw-all.lua']));
  const lua=kit.files['advanced/draw-all.lua'];
  assert.equal((lua.match(/NoteInput.RepeatLast/g)||[]).length,130);
  const offsets=lua.split('\n').filter(l=>l.includes('Type=kHorizontalLineEndDX'));
  assert.equal(offsets.length,131);
  offsets.forEach((s,i)=>assert.ok(s.includes(contour.systemEnds.includes(i+1)?'"7/10"':'"9/8"')));
  assert.throws(()=>luaMacro(contour,{endDX:NaN}),/offsets/);
});
test('Downloaded kit is a valid ZIP with all instructions, guide and samples intact',()=>{
  const kit=buildPackage(contour),archive=unzipSync(makeZip(kit.files));
  assert.deepEqual(Object.keys(archive),Object.keys(kit.files));
  const report=JSON.parse(strFromU8(archive['report.json']));
  assert.equal(report.samples.length,132);assert.deepEqual(report.systemEndSegments,[35,63,103]);
  assert.match(strFromU8(archive['START-HERE.txt']),/do not rerun a completed chunk/);
});
