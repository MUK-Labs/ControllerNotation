export const EPS = 1e-7;
export function sampleCC(events, times, mode = 'smooth') {
  const x = events.map(e=>e.beat), y = events.map(e=>e.value), slopes = x.map(()=>0);
  if (events.length < 2) throw new Error('This controller has only one event. Choose a stream with at least two event times.');
  const h = x.slice(1).map((v,i)=>v-x[i]);
  if(h.some(v=>v<=0)) throw new Error('Controller event times must increase.');
  const d = h.map((v,i)=>(y[i+1]-y[i])/v);
  slopes[0]=d[0]; slopes[slopes.length-1]=d[d.length-1];
  for(let i=1;i<x.length-1;i++) if(d[i-1]*d[i]>0) {
    const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1]; slopes[i]=(w1+w2)/(w1/d[i-1]+w2/d[i]);
  }
  return times.map(t=>{
    if(t<x[0]-EPS || t>x.at(-1)+EPS) throw new Error('The selected range extends outside the known controller data.');
    let lo=0,hi=x.length;
    while(lo<hi){const m=(lo+hi)>>1;if(x[m]<=t+1e-10)lo=m+1;else hi=m;}
    const i=Math.max(0,lo-1);
    if(i===x.length-1 || mode==='hold')return y[i];
    const u=(t-x[i])/h[i];
    if(mode==='linear')return y[i]+u*(y[i+1]-y[i]);
    const a=y[i],b=a+h[i]*slopes[i]/3,c=y[i+1]-h[i]*slopes[i+1]/3,e=y[i+1];
    return Math.max(Math.min(a,e),Math.min(Math.max(a,e),(1-u)**3*a+3*(1-u)**2*u*b+3*(1-u)*u*u*c+u**3*e));
  });
}

export function buildContour(stream, {step=0.125,mode='smooth',height=4,start,end,layout=null,alignmentConfirmed=false}={}) {
  if(stream.events.length<2)throw new Error('This controller has only one event. Choose a stream with at least two event times.');
  if(![1,0.5,0.25,0.125].includes(step))throw new Error('Choose a quarter, eighth, sixteenth or thirty-second note grid.');
  if(!['smooth','linear','hold'].includes(mode))throw new Error('Unknown interpolation.');
  if(!Number.isFinite(height)||height<1||height>12)throw new Error('Height must be between 1 and 12 staff spaces.');
  const first=stream.events[0]?.beat,last=stream.events.at(-1)?.beat;
  start=start==null?Math.ceil((first-EPS)/step)*step:Number(start);
  end=end==null?Math.floor((last+EPS)/step)*step:Number(end);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw new Error('There is no complete grid interval in this range. Choose a finer grid or a longer passage.');
  const onGrid=t=>Math.abs(t/step-Math.round(t/step))<EPS;
  if(!onGrid(start)||!onGrid(end))throw new Error('Start and end must fall on the chosen note grid. Values are quarter-note beats from flow start.');
  const count=Math.round((end-start)/step);
  if(count>4096 || end/step>16384)throw new Error('This export needs too many guide notes. Choose a shorter passage or a coarser grid.');
  if(layout){
    if(end>layout.totalBeats+EPS)throw new Error('The MIDI contour extends beyond this MusicXML layout. Check that both exports contain the same flow.');
    if(layout.hasRepeats&&!alignmentConfirmed)throw new Error('This layout contains repeats or playback jumps. Confirm that the MIDI follows the written timeline before continuing.');
    if(layout.bars.some(b=>!onGrid(b.start)||!onGrid(b.duration)) || layout.breaks.some(b=>!onGrid(b.beat)))throw new Error('A bar or system boundary falls between this grid’s anchors. Choose a finer grid. Tuplet and mid-bar breaks may need manual handling.');
  }
  const times=Array.from({length:count+1},(_,i)=>start+i*step), values=sampleCC(stream.events,times,mode);
  const systemEnds=(layout?.breaks||[]).filter(b=>b.beat>start+EPS&&b.beat<=end+EPS).map(b=>Math.round((b.beat-start)/step));
  const warnings=[];
  if(start>first+EPS||end<last-EPS)warnings.push(`The source spans ${formatBeat(first)}–${formatBeat(last)} beats. This grid draws ${formatBeat(start)}–${formatBeat(end)}; the short edges outside the grid are omitted.`);
  if(!layout)warnings.push('No layout map: system-ending offsets need checking after Dorico arranges the score.');
  if(mode==='hold')warnings.push('Hold samples are joined by straight ramps; this does not draw exact vertical MIDI steps.');
  if(stream.tracks.length>1)warnings.push('This channel/controller occurs on multiple tracks. Events are merged; the later track wins at equal times.');
  const errors=stream.events.filter(e=>e.beat>=start-EPS&&e.beat<=end+EPS).map(e=>{
    const p=(e.beat-start)/step,i=Math.min(count-1,Math.max(0,Math.floor(p))),u=p-i;
    return Math.abs(values[i]+u*(values[i+1]-values[i])-e.value);
  });
  return {cc:stream.cc,channel:stream.channel,step,mode,height,start,end,times,values,count,systemEnds,warnings,
    firstGuide:Math.round(start/step)+1,sourceEvents:stream.events.length,
    error:{max:errors.reduce((a,b)=>Math.max(a,b),0),mean:errors.length?errors.reduce((a,b)=>a+b,0)/errors.length:0},layout};
}
export function formatBeat(n){return Number(n.toFixed(5)).toString();}
export function fraction(n){
  // Continued fractions keep the engraving string small, as in the Python prototype.
  const sign=n<0?-1:1; let x=Math.abs(n),h0=0,h1=1,k0=1,k1=0;
  for(let i=0;i<32;i++){
    const a=Math.floor(x),h=a*h1+h0,k=a*k1+k0;
    if(k>100000)break;
    h0=h1;h1=h;k0=k1;k1=k;
    if(Math.abs(x-a)<1e-12)break;x=1/(x-a);
  }
  return k1===1?String(sign*h1):`${sign*h1}/${k1}`;
}
