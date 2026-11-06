import { fraction, formatBeat, EPS } from './contour.js';
import { makeMeterLayout } from './musicxml.js';
import { knobFiles } from './knobs.js';
const escape=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const cmd=s=>`cmd('${s}')`;
const property=(name,value)=>cmd(`UI.InvokePropertyChangeValue?Type=kHorizontalLine${name}&Value=${value}`);
export function luaMacro(c,{from=0,to=c.count,endDX=1.125,systemEndDX=0.7}={}){
  if(![endDX,systemEndDX].every(n=>Number.isFinite(n)&&n>=-5&&n<=5))throw new Error('End offsets must be between −5 and 5 staff spaces.');
  const lines=[`-- ControllerNotation: CC${c.cc}, segments ${from+1}-${to} of ${c.count}.`,
    '-- Read START-HERE.txt. Work in a duplicate score. This creates native lines, not MIDI playback.',
    from?'-- CONTINUATION: keep the last line from the preceding chunk selected in Write mode.':'-- FIRST CHUNK: select the indicated single guide note in Write mode.',
    'local app = DoApp.DoApp()','local function cmd(s) app:doCommand(s) end'];
  if(!from)lines.push(cmd('UI.InvokePaletteButton?PaletteIndicatorID=kGenericLinesPanel.linestyle.solidLine&PaletteSectionID=kGenericLinesHorizontalLinePanel&PropertyButton=false&SetOldValue=false&Set=true&UseLocalOverride=0'),cmd('Edit.FlipItem'),cmd('Edit.FlipItem'));
  const base=Math.min(-1,Math.floor(-c.height)),ends=new Set(c.systemEnds);
  for(let i=from;i<to;i++){
    if(i>0)lines.push(cmd('NoteInput.RepeatLast'));
    lines.push(`-- Segment ${i+1}: beat ${formatBeat(c.times[i])} to ${formatBeat(c.times[i+1])}`,
      property('StartPosition',`int: ${base}`),property('EndPosition',`int: ${base}`),
      property('HorizontalStartPosition','string: "kStartWithLeftmostNotehead"'),
      cmd('Window.SwitchMode?WindowMode=kEngraveMode'),cmd('Edit.PropertiesSetGlobal'),
      property('EndDX',`string: "${fraction(ends.has(i+1)?systemEndDX:endDX)}"`));
    for(const [name,value] of [['Start',c.values[i]],['End',c.values[i+1]]]){
      const target=-c.height+2*c.height*value/127;
      lines.push(property(`${name}DY`,`string: "${fraction((target-base)/2)}"`));
    }
    lines.push(cmd('Window.SwitchMode?WindowMode=kWriteMode'));
  }
  return lines.join('\n')+'\n';
}

export function guideLayout(c,meters=[],fallback='4/4'){
  const source=c.layout||makeMeterLayout(meters,c.end,fallback);
  const bars=source.bars.filter(b=>b.start<=c.end+EPS).map(b=>({...b}));
  let appended=false;
  if(bars.at(-1).start+bars.at(-1).duration<=c.end+EPS){
    const last=bars.at(-1); appended=true;
    bars.push({number:'anchor',start:last.start+last.duration,duration:last.meter.duration,meter:last.meter,implicit:false});
  }
  if(bars.some(b=>Math.abs(b.duration/c.step-Math.round(b.duration/c.step))>EPS))throw new Error('The note grid must divide every guide bar. Choose a finer grid.');
  const total=bars.reduce((n,b)=>n+Math.round(b.duration/c.step),0);
  if(total>20000)throw new Error('The guide score is too large. Use a shorter passage.');
  const breaks=source.breaks.filter(b=>b.beat<=c.end+EPS);
  if(appended&&!breaks.some(b=>Math.abs(b.beat-c.end)<EPS))breaks.push({beat:c.end,bar:'anchor',page:false});
  return {...source,bars,breaks,appended,totalBeats:bars.at(-1).start+bars.at(-1).duration};
}

export function guideMusicXML(c,layout){
  const title=`CC${c.cc} · ${c.mode} · controller guide`;
  const types={1:'quarter',0.5:'eighth',0.25:'16th',0.125:'32nd'};
  let xml=`<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${escape(title)}</work-title></work><identification><encoding><software>ControllerNotation web</software></encoding></identification><part-list>`;
  for(const [id,name] of [['P1','Reference grid'],['P2','Controller']])xml+=`<score-part id="${id}"><part-name>${name}</part-name><score-instrument id="${id}I"><instrument-name>Flute</instrument-name></score-instrument></score-part>`;
  xml+='</part-list>';
  for(const id of ['P1','P2']){
    xml+=`<part id="${id}">`; let previous='';
    layout.bars.forEach((bar,i)=>{
      xml+=`<measure number="${escape(bar.number)}"${bar.implicit?' implicit="yes"':''}>`;
      const br=layout.breaks.find(b=>Math.abs(b.beat-bar.start)<EPS);
      if(br)xml+=`<print new-system="yes"${br.page?' new-page="yes"':''}/>`;
      if(!i||bar.meter.label!==previous){
        xml+='<attributes>'+(i?'':'<divisions>480</divisions>')+'<time>';
        for(const g of bar.meter.groups)xml+=`<beats>${g.numerator}</beats><beat-type>${g.denominator}</beat-type>`;
        xml+='</time>';
        if(!i)xml+='<clef><sign>G</sign><line>2</line></clef>'+(id==='P2'?'<staff-details><staff-lines>1</staff-lines></staff-details>':'');
        xml+='</attributes>';
      }
      previous=bar.meter.label;
      const notes=Math.round(bar.duration/c.step);
      for(let n=0;n<notes;n++)xml+=`<note><pitch><step>E</step><octave>4</octave></pitch><duration>${Math.round(c.step*480)}</duration><type>${types[c.step]}</type></note>`;
      xml+='</measure>';
    });
    xml+='</part>';
  }
  return xml+'</score-partwise>\n';
}

export function buildPackage(contour,{meters=[],fallback='4/4',endDX=1.125,systemEndDX=0.7,sourceName='MIDI export',layoutName=null,knobs=null}={}){
  const layout=guideLayout(contour,meters,fallback);
  const c={...contour,systemEnds:[...contour.systemEnds]};
  if(layout.appended&&!c.systemEnds.includes(c.count))c.systemEnds.push(c.count);
  const bar=layout.bars.find(b=>c.start>=b.start-EPS&&c.start<b.start+b.duration-EPS);
  const startDescription=`bar ${bar.number}, ${formatBeat(c.start-bar.start)} quarter-note beats after its start (guide ${Math.round((c.start-bar.start)/c.step)+1} in that bar; guide ${c.firstGuide} from flow start)`;
  const files={'guide.musicxml':guideMusicXML(c,layout)};
  const chunks=[];
  for(let from=0;from<c.count;from+=32){
    const name=`draw/${String(chunks.length+1).padStart(3,'0')}-segments-${from+1}-${Math.min(from+32,c.count)}.lua`;
    files[name]=luaMacro(c,{from,to:Math.min(from+32,c.count),endDX,systemEndDX});chunks.push(name);
  }
  files['advanced/draw-all.lua']=luaMacro(c,{endDX,systemEndDX});
  files['prepare/hide-selected-guides.lua']=[
    '-- Select ALL visible Controller guide notes first. RUN ONCE: these commands toggle visibility.',
    '-- Do not select the Reference staff. Hiding does not mute playback.',
    'local app = DoApp.DoApp()',
    'app:doCommand([[Window.SwitchMode?WindowMode=kEngraveMode]])',
    'app:doCommand([[Edit.PropertiesSetGlobal]])',
    'app:doCommand([[Edit.ToggleHideNotehead]])',
    'app:doCommand([[Edit.ToggleHideStem]])',''].join('\n');
  const warnings=[...c.warnings,'End offsets are calibrated against a Dorico 5.1.81 test fixture. Check joins and barlines in your destination layout.','Layout-specific corrections become stale after changing system breaks or pasting to another layout.'];
  const knobKit=knobs?knobFiles(knobs,layout):null;
  if(knobKit){Object.assign(files,knobKit.files);warnings.push(...knobs.warnings);}
  if(layout.appended)warnings.push('An extra guide-only bar holds the final endpoint. Check the final line when transferring to the end of a flow.');
  const report={version:1,sourceName,layoutName,cc:c.cc,channel:c.channel,mode:c.mode,gridQuarterBeats:c.step,startQuarterBeat:c.start,endQuarterBeat:c.end,firstGuide:c.firstGuide,startDescription,segments:c.count,heightStaffSpaces:c.height,endDX,systemEndDX,systemEndSegments:c.systemEnds,sourceEvents:c.sourceEvents,sampleErrorCC:c.error,
    bars:layout.bars.map(b=>({number:b.number,start:b.start,duration:b.duration,meter:b.meter.label})),breaks:layout.breaks,
    samples:c.times.map((beat,i)=>({beat,cc:c.values[i]})),warnings};
  if(knobKit)report.knobs={...knobs,markers:knobKit.placements,symbols:knobKit.symbols,nativePlacement:'manual'};
  files['report.json']=JSON.stringify(report,null,2)+'\n';
  files['START-HERE.txt']=`CONTROLLERNOTATION — CC${c.cc}, channel ${c.channel}
${c.count} native straight segments · ${c.mode} sampling · ${c.height} staff spaces high
Timing: ${formatBeat(c.start)}–${formatBeat(c.end)} quarter-note beats from flow start.
Start at ${startDescription}.

This is an experimental Dorico workflow, tested with Dorico 5.1.81 on macOS.
No Python is required. The browser makes the files; Dorico runs the Lua locally.

1. OPEN AND PREPARE
   Open guide.musicxml as a NEW project. In Dorico's MusicXML import preferences,
   enable importing system and frame breaks before opening it. Confirm meters
   and breaks match your intended destination; MusicXML is a layout snapshot.
   Select all notes and run Reset Beaming from the Jump Bar.
   Select only all Controller guide notes and run prepare/hide-selected-guides.lua
   ONCE via Script > Run Script. It toggles noteheads and stems off. The upper
   Reference grid stays visible to help locate beats. Mute guide playback separately.
   Save a working copy before drawing.

2. SET THE ANCHORS
   In Write mode, open the Lines panel. Set BOTH Start and End attachment to
   Rhythmic position. Select ONE Controller guide note at ${startDescription}.
   Hidden notes can be located with the reference grid; verify the selected time.

3. DRAW IN SHORT CHUNKS
   Use Script > Run Script to run the files in draw/ in numerical order:
   ${chunks.map(n=>n.replace('draw/','')).join('\n   ')}
   The first creates a line. Later chunks CONTINUE from the last selected line.
   Wait for each to finish; keep its final line selected in Write mode.
   These macros add objects: do not rerun a completed chunk. If a chunk stalls,
   restore the last saved checkpoint and rerun from that checkpoint. Do not run
   the next chunk after a partial failure. Save a checkpoint between chunks.
   advanced/draw-all.lua is an alternative single run; do not run it after chunks.
   Long macros stalled in earlier experiments, so short chunks are recommended.

4. CHECK AND TRANSFER
   Check all joins and the ${c.systemEnds.length} corrected system endings.
   End X: ordinary ${endDX}; system end ${systemEndDX} staff spaces.
   Corrected segment numbers: ${c.systemEnds.join(', ')||'none detected'}.
   For another project, prepare equivalent hidden guide notes on a pitched
   controller staff. Select the contour with Filter Horizontal and Note-attached
   Lines, copy, and paste at the SAME quarter-note position in the destination.
   Keep the exported system breaks. If they change, export that layout again
   and regenerate; avoid adding a second set of lines on top of the old ones.
   Guide notes are rhythmic anchors, not imported CC playback.

NOTES
${warnings.map(w=>'- '+w).join('\n')}
The preview uses uniform beat spacing; printed widths follow Dorico's spacing.
Smoothing samples a bounded cubic curve into straight native lines; it does not
create native Bezier objects. Fast changes between grid points can be lost.
MIDI format 0/1, PPQN, 7-bit CC only. No 14-bit CC/NRPN or live MIDI decoding.
One flow per export. Repeats must share the same written timeline in both files.
Report.json records exact sampled values and timings for checking the result.
`;
  if(knobKit)files['START-HERE.txt']+='\nKNOB LAYER\n'+`${knobs.markers.length} knob events from CC${knobs.cc}, channel ${knobs.channel}.\n`+
    'Open knobs/placements.html and read knobs/KNOBS.txt. SVGs and labels are ready;\nimporting their artwork and placing native knobs in Dorico are manual steps.\nThe draw/ scripts create only the contour.\n';
  return {files,report,chunks,startDescription,layout};
}
