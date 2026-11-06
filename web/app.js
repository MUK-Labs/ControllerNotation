import { parseMidi } from './core/midi.js';
import { parseMusicXML } from './core/musicxml.js';
import { buildContour, formatBeat } from './core/contour.js';
import { buildPackage } from './core/generate.js';
import { readMusicXML, makeZip } from './core/archive.js';
import { buildKnobs, pointer, UNITS } from './core/knobs.js';

const $=id=>document.getElementById(id);
const state={midi:null,layout:null,midiName:'',layoutName:null,kit:null,errors:{midi:null,xml:null},version:{midi:0,xml:0},pending:new Set()};
const text=(id,s)=>{$(id).textContent=s;};
function resetRange(){for(const id of ['start','end'])$(id).value='';$('alignment').checked=false;}
function setMidi(midi,name){
  state.midi=midi;state.midiName=name;text('midi-name',name);
  $('stream').replaceChildren(...midi.streams.map(s=>new Option(`CC${s.cc} · Channel ${s.channel} · ${s.events.length.toLocaleString()} events`,s.key)));
  $('stream').value=midi.streams.reduce((best,s)=>s.events.length>best.events.length?s:best).key;
  $('knob-stream').replaceChildren(...midi.streams.map(s=>new Option(`CC${s.cc} · Channel ${s.channel} · ${s.events.length.toLocaleString()} events`,s.key)));
  $('knob-stream').value=midi.streams.find(s=>s.key!==$('stream').value)?.key||$('stream').value;
  $('knobs-enabled').checked=false;
}
async function importFile(kind,file){
  if(!file)return;
  const revision=++state.version[kind];state.pending.add(kind);state.errors[kind]=null;render();
  try{
    if(file.size>20*1024*1024)throw new Error('Choose an export smaller than 20 MB.');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const data=kind==='midi'?parseMidi(bytes):parseMusicXML(readMusicXML(bytes));
    if(revision!==state.version[kind])return;
    if(kind==='midi')setMidi(data,file.name);else{state.layout=data;state.layoutName=file.name;text('xml-name',file.name);}
    resetRange();
  }catch(error){if(revision===state.version[kind])state.errors[kind]=error.message;}
  finally{if(revision===state.version[kind]){state.pending.delete(kind);render();}}
}
for(const [kind,input,zone] of [['midi','midi-file','midi-drop'],['xml','xml-file','xml-drop']]){
  $(input).addEventListener('change',event=>{importFile(kind,event.target.files[0]);event.target.value='';});
  $(zone).addEventListener('dragover',event=>{event.preventDefault();$(zone).classList.add('drag');});
  $(zone).addEventListener('dragleave',()=>$(zone).classList.remove('drag'));
  $(zone).addEventListener('drop',event=>{event.preventDefault();$(zone).classList.remove('drag');importFile(kind,event.dataTransfer.files[0]);});
}
$('remove-layout').addEventListener('click',()=>{
  state.version.xml++;state.pending.delete('xml');state.errors.xml=null;state.layout=null;state.layoutName=null;
  text('xml-name','.musicxml, .xml or compressed .mxl');resetRange();render();
});
$('demo').addEventListener('click',async()=>{
  const revisions={midi:++state.version.midi,xml:++state.version.xml};
  state.pending.add('midi');state.pending.add('xml');state.errors={midi:null,xml:null};render();
  try{
    const results=await Promise.all(['./demo/controller.mid','./demo/changing-meters.musicxml'].map(async url=>{
      const response=await fetch(url);if(!response.ok)throw new Error('The example could not be loaded. Try importing your own exports.');return new Uint8Array(await response.arrayBuffer());
    }));
    if(revisions.midi!==state.version.midi||revisions.xml!==state.version.xml)return;
    const midi=parseMidi(results[0]),layout=parseMusicXML(readMusicXML(results[1]));
    setMidi(midi,'Example · CC24 contour + CC25 knobs');$('knobs-enabled').checked=true;state.layout=layout;state.layoutName='Example · Dorico changing-meter layout';text('xml-name',state.layoutName);resetRange();
  }catch(error){if(revisions.midi===state.version.midi)state.errors.midi=error.message;}
  finally{for(const kind of ['midi','xml'])if(revisions[kind]===state.version[kind])state.pending.delete(kind);render();}
});
$('settings').addEventListener('input',event=>{
  if(event.target.id==='stream')resetRange();
  if(event.target.id==='knob-unit'){const u=UNITS[$('knob-unit').value];$('knob-min').value=u.min;$('knob-max').value=u.max;}
  render();
});

function render(){
  state.kit=null;$('download').disabled=true;text('download-status','');text('build-error','');$('build-error').hidden=true;
  text('height-value',`${$('height').value} staff spaces`);
  $('knob-controls').hidden=!$('knobs-enabled').checked;$('custom-unit-field').hidden=$('knob-unit').value!=='custom';
  const errors=Object.values(state.errors).filter(Boolean);text('file-error',errors.join(' '));$('file-error').hidden=!errors.length;
  $('settings').disabled=!state.midi||!!state.pending.size;$('demo').disabled=!!state.pending.size;
  $('remove-layout').hidden=!state.layout&&!state.errors.xml;$('repeat-check').hidden=!state.layout?.hasRepeats;
  text('import-status',state.pending.size?'Reading your exports…':state.midi?`${state.midi.streams.length} controller stream${state.midi.streams.length===1?'':'s'} · ${state.midi.ppqn} ticks per quarter note${!state.midi.meters.length&&!state.layout?' · no MIDI meter; using fallback':''}`:'');
  $('preview-content').hidden=true;$('preview-empty').hidden=false;$('warnings').replaceChildren();
  text('preview-badge',state.midi?'Ready to shape':'Waiting for MIDI');
  text('start-location','The kit identifies the exact guide note.');text('download-detail','MusicXML guide · Lua scripts · step-by-step instructions');
  const layoutText=state.layout?`${state.layout.bars.length} bars · ${state.layout.breaks.length+1} systems · MusicXML layout snapshot`:'No MusicXML: system endings need a manual check in Dorico.';
  $('layout-status').lastElementChild.textContent=layoutText;$('layout-status').firstElementChild.classList.toggle('muted-dot',!state.layout);
  if(!state.midi||state.pending.size||errors.length)return;
  try{
    if(!$('end-dx').value||!$('system-dx').value)throw new Error('Enter both engraving offsets, or use the defaults 1.125 and 0.7.');
    const stream=state.midi.streams.find(s=>s.key===$('stream').value);
    const contour=buildContour(stream,{step:Number($('grid').value),mode:$('mode').value,height:Number($('height').value),
      start:$('start').value===''?undefined:Number($('start').value),end:$('end').value===''?undefined:Number($('end').value),layout:state.layout,alignmentConfirmed:$('alignment').checked});
    if($('knobs-enabled').checked&&(!$('knob-min').value||!$('knob-max').value))throw new Error('Enter both knob range endpoints.');
    const knobs=$('knobs-enabled').checked?buildKnobs(state.midi.streams.find(s=>s.key===$('knob-stream').value),contour,
      {unit:$('knob-unit').value,min:Number($('knob-min').value),max:Number($('knob-max').value),decimals:Number($('knob-decimals').value),customUnit:$('knob-custom').value}):null;
    const kit=buildPackage(contour,{meters:state.midi.meters,fallback:$('meter').value,endDX:Number($('end-dx').value),systemEndDX:Number($('system-dx').value),sourceName:state.midiName,layoutName:state.layoutName,knobs});
    state.kit=kit;$('download').disabled=false;$('preview-content').hidden=false;$('preview-empty').hidden=true;
    text('preview-badge',`CC${contour.cc} · Channel ${contour.channel}`);
    text('start-location',`Start at ${kit.startDescription}.`);
    text('download-detail',`${contour.count} lines · ${kit.chunks.length} short scripts${knobs?` · ${knobs.markers.length} knob SVG instructions (manual placement)`:''}`);
    drawChart(contour,stream,kit.layout,knobs);
    $('stats').replaceChildren(...[[contour.count,'native segments'],[contour.systemEnds.length,'mapped system endings'],[contour.error.max.toFixed(1),'max. error / 127 CC']].map(([value,label])=>{
      const div=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=value;small.textContent=label;div.append(strong,small);return div;
    }));
    const warnings=[...contour.warnings,...(knobs?.warnings||[])];
    if(state.layout)warnings.push('Breaks mapped automatically. Keep this destination layout’s breaks and check the calibrated end offsets in Dorico.');
    if(kit.layout.appended)warnings.push('A guide-only bar was added for the final anchor. Check the last line when transferring to the end of a flow.');
    if(contour.error.max>8)warnings.push('Some source events differ noticeably from the sampled line. Try a finer grid or inspect the fast transitions.');
    if(contour.count>512)warnings.push('This is a long drawing operation. Consider a shorter passage and save between script chunks.');
    $('warnings').replaceChildren(...warnings.map(w=>{const p=document.createElement('p');p.textContent=w;return p;}));
  }catch(error){text('build-error',error.message);$('build-error').hidden=false;text('preview-badge','Check settings');}
}

function drawChart(c,stream,layout,knobs){
  const svg=$('chart'),ns='http://www.w3.org/2000/svg';svg.replaceChildren();
  const add=(name,attrs={},content)=>{const e=document.createElementNS(ns,name);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(content!==undefined)e.textContent=content;svg.append(e);return e;};
  add('title',{id:'chart-title'},`CC${c.cc}, ${c.count} native segments${knobs?`, ${knobs.markers.length} knobs from CC${knobs.cc}`:''}`);
  add('desc',{id:'chart-desc'},`Quarter-note beats ${formatBeat(c.start)} to ${formatBeat(c.end)}. ${c.systemEnds.length} system endings mapped from MusicXML. Maximum source event error ${c.error.max.toFixed(1)} CC units.`);
  const low=Math.max(0,c.start-c.step*2),high=c.end+c.step*2,x=t=>46+(t-low)/(high-low)*690,y=v=>220-v/127*(knobs?135:159);
  for(const v of [0,32,64,96,127]){add('line',{x1:46,x2:736,y1:y(v),y2:y(v),class:'grid-line'});add('text',{x:32,y:y(v)+4,'text-anchor':'end'},v);}
  const visible=layout.bars.filter(b=>b.start+b.duration>=low&&b.start<=high),stride=Math.max(1,Math.ceil(visible.length/16));
  visible.forEach((bar,i)=>{
    if(bar.start<low||bar.start>high)return;
    const xx=x(bar.start);add('line',{x1:xx,x2:xx,y1:51,y2:230,class:'bar-line'});
    if(i%stride===0){add('text',{x:xx+5,y:26},`m.${bar.number}`);add('text',{x:xx+5,y:42,class:'chart-meter'},bar.meter.label);}
  });
  for(const b of layout.breaks)if(b.beat>=low&&b.beat<=high){const xx=x(b.beat);add('line',{x1:xx,x2:xx,y1:49,y2:232,class:'system-line'});}
  const raw=stream.events.filter(e=>e.beat>=low&&e.beat<=high),rawStride=Math.max(1,Math.ceil(raw.length/5000));
  const path=points=>points.map(([a,b],i)=>`${i?'L':'M'}${x(a).toFixed(2)},${y(b).toFixed(2)}`).join('');
  add('path',{d:path(raw.filter((e,i)=>i%rawStride===0||i===raw.length-1).map(e=>[e.beat,e.value])),class:'source-path'});
  add('path',{d:path(c.times.map((t,i)=>[t,c.values[i]])),class:'contour-path'});
  if(c.count<220)for(let i=0;i<c.times.length;i++)add('circle',{cx:x(c.times[i]),cy:y(c.values[i]),r:1.65,class:'contour-dot'});
  for(const m of knobs?.markers||[]){
    const xx=x(m.beat),yy=y(m.contourValue),p=pointer(m.value,9);
    const g=add('g',{'class':'knob-marker','data-beat':m.beat,'data-cc':m.value});
    const child=(name,attrs,content)=>{const e=add(name,attrs,content);g.append(e);};
    child('title',{},`${m.label} · CC${knobs.cc} value ${m.value} · beat ${formatBeat(m.beat)}`);
    child('circle',{cx:xx,cy:yy,r:13,fill:'white',stroke:'#20332f','stroke-width':1.6});
    child('path',{d:`M${xx},${yy}l${p.x},${p.y}`,stroke:'#20332f','stroke-width':2,'stroke-linecap':'round',fill:'none'});
    child('text',{x:xx,y:yy-20,'text-anchor':'middle',class:'knob-label'},m.label);
  }
  for(let i=0;i<=6;i++){const t=c.start+i*(c.end-c.start)/6;add('text',{x:x(t),y:251,'text-anchor':'middle'},Number(t.toFixed(2)));}
  add('text',{x:391,y:277,'text-anchor':'middle'},'Quarter-note beats');
}

$('download').addEventListener('click',()=>{
  if(!state.kit)return;
  try{
    const blob=new Blob([makeZip(state.kit.files)],{type:'application/zip'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`controller-notation-cc${state.kit.report.cc}.zip`;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    text('download-status','Kit prepared. Open START-HERE.txt after unzipping it.');
  }catch(error){text('build-error',`Could not build the download: ${error.message}`);$('build-error').hidden=false;}
});
render();
