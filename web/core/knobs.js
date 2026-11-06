import { EPS, formatBeat } from './contour.js';

const xml = s => String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export const UNITS = {
  midi: { min: 0, max: 127, suffix: 'MIDI' },
  percent: { min: 0, max: 100, suffix: '%' },
  semitones: { min: 0, max: 12, suffix: 'st' },
  custom: { min: 0, max: 1, suffix: '' },
};

// Interpolate the actual native polyline, not the unsampled cubic curve.
export function contourValueAt(c, beat) {
  if (beat < c.start-EPS || beat > c.end+EPS) throw new Error('Knob time lies outside the contour.');
  let i = 0;
  while (i < c.times.length-2 && c.times[i+1] < beat) i++;
  const f = Math.max(0, Math.min(1, (beat-c.times[i])/(c.times[i+1]-c.times[i])));
  return c.values[i] + f*(c.values[i+1]-c.values[i]);
}

export function pointer(value, radius=10) {
  const angle = (-135+270*value/127)*Math.PI/180;
  return { x: Math.sin(angle)*radius, y: -Math.cos(angle)*radius };
}

export function buildKnobs(stream, c, {unit='percent', min=0, max=100, decimals=0, customUnit=''}={}) {
  if (!stream) return null;
  if (!UNITS[unit]) throw new Error('Choose a knob unit.');
  if (![min,max].every(Number.isFinite) || max<=min || Math.max(Math.abs(min),Math.abs(max))>1e9)
    throw new Error('Knob maximum must exceed minimum; use finite values within ±1 billion.');
  if (![0,1,2].includes(decimals)) throw new Error('Choose zero, one or two decimal places.');
  const suffix = unit==='custom' ? customUnit.trim() : UNITS[unit].suffix;
  if (suffix.length>16 || /[\x00-\x1f]/.test(suffix)) throw new Error('Use a short unit label (up to 16 characters).');
  const events = stream.events.filter(e => e.beat>=c.start-EPS && e.beat<=c.end+EPS);
  if (events.length>256) throw new Error('The knob stream has more than 256 events in this passage. Choose a discrete CC stream or shorten the passage.');
  const markers = events.map((e,i) => {
    const scaled = min+(max-min)*e.value/127;
    const rounded = Number(scaled.toFixed(decimals));
    const label = `${Object.is(rounded,-0)?(0).toFixed(decimals):rounded.toFixed(decimals)}${suffix==='%'?'':suffix?' ':''}${suffix}`;
    return { index:i+1, beat:e.beat, tick:e.tick, value:e.value, scaled, label,
      contourValue:contourValueAt(c,e.beat), onGrid:Math.abs(e.beat/c.step-Math.round(e.beat/c.step))<EPS };
  });
  const omitted = stream.events.length-markers.length;
  const warnings = ['Knob export: SVG artwork and exact timings are included. Import each distinct SVG as a Dorico playing technique, then place and centre it manually. Bulk native knob placement is not yet available.'];
  if (omitted) warnings.push(`${omitted} knob event${omitted===1?'':'s'} outside the contour range omitted.`);
  if (!markers.length) warnings.push('No knob events occur inside the selected contour range.');
  if (markers.some(m=>!m.onGrid)) warnings.push('Some knobs fall between contour guide notes. Their exact times are preserved; use a suitable rhythmic grid/caret in Dorico. They have not been snapped.');
  if (markers.some((m,i)=>i && m.beat-markers[i-1].beat<.5)) warnings.push('Closely spaced knob instructions may overlap in print. Check spacing in Dorico; event times are unchanged.');
  return {cc:stream.cc, channel:stream.channel, unit, min, max, decimals, suffix, markers, omitted, warnings};
}

// No external images, fonts or scripts. White face masks the line; corners stay transparent.
export function knobSVG(marker) {
  const p=pointer(marker.value), width=Math.max(40,marker.label.length*6+8);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="54" viewBox="${-width/2} -36 ${width} 54"><title>${xml(marker.label)}; CC value ${marker.value}</title><circle r="14" fill="white" stroke="black" stroke-width="1.4"/><path d="M0 0L${p.x.toFixed(5)} ${p.y.toFixed(5)}" stroke="black" stroke-width="2" stroke-linecap="round"/><text x="0" y="-22" text-anchor="middle" font-family="sans-serif" font-size="10" fill="black">${xml(marker.label)}</text></svg>\n`;
}

export function knobFiles(knobs, layout) {
  const files={}, symbols=new Map();
  const placements=knobs.markers.map(m=>{
    if (!symbols.has(m.value)) {
      const id=`cnk${m.value}`;
      const file=`knobs/symbols/${id}.svg`;
      symbols.set(m.value,{popover:id,file,label:m.label,value:m.value});
      files[file]=knobSVG(m);
    }
    const bar=layout.bars.find(b=>m.beat>=b.start-EPS && m.beat<b.start+b.duration-EPS);
    return {...m, ...symbols.get(m.value), bar:bar?.number??'end', quarterBeatsIntoBar:bar?m.beat-bar.start:0};
  });
  const rows=placements.map(m=>`<tr><td>${m.index}</td><td><img src="symbols/${m.popover}.svg" alt="${xml(m.label)}"></td><td>${xml(m.bar)} + ${formatBeat(m.quarterBeatsIntoBar)}</td><td>${formatBeat(m.beat)}</td><td>${m.value}</td><td>${xml(m.label)}</td><td>${m.onGrid?'Guide note':'Between guides'}</td></tr>`).join('');
  files['knobs/placements.html']=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Knob placement list</title><style>body{font:16px/1.5 system-ui;max-width:1000px;margin:40px auto;padding:0 20px;color:#20332f}table{border-collapse:collapse;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}img{max-width:160px;height:65px}table{font-variant-numeric:tabular-nums}@media print{body{margin:0}tr{break-inside:avoid}}</style><h1>Knob instructions · CC${knobs.cc}, channel ${knobs.channel}</h1><p>${xml(knobs.min)}–${xml(knobs.max)} ${xml(knobs.suffix)}. Timing counts quarter notes from zero, regardless of meter. Centre each knob on the contour at that time; the pointer shows the secondary CC value.</p><p>See KNOBS.txt for the manual Dorico import steps. These images are symbols, not an anchored score.</p><table><thead><tr><th>#</th><th>Symbol</th><th>Bar + quarter notes</th><th>Absolute beat</th><th>CC value</th><th>Instruction</th><th>Anchor</th></tr></thead><tbody>${rows}</tbody></table></html>`;
  files['knobs/KNOBS.txt']=`KNOB INSTRUCTIONS — CC${knobs.cc}, channel ${knobs.channel}
${placements.length} discrete events; ${symbols.size} distinct symbols.
Value mapping: ${knobs.min} + (${knobs.max} - ${knobs.min}) × CC value / 127.
Pointer: 270-degree sweep, minimum at lower left, maximum at lower right.
Labels: ${knobs.decimals} decimal places. The pointer retains the unrounded CC value.

STATUS
The browser preview centres knobs on the sampled native contour. SVG symbols
and exact event times are generated automatically. Native knob placement in
Dorico is currently MANUAL. The line-drawing scripts do not insert these knobs.
We verified a directly imported SVG playing technique with an opaque face in
Dorico 5.1.81. Our generated .doricolib import lost its graphic dependencies,
so a broken library or unverified placement macro is not included.

IMPORT EACH DISTINCT SYMBOL
1. In your working project, open Library > Playing Techniques and add a new
   technique. Set its type to Glyph, edit its symbol, choose Graphic, and import
   the matching SVG from symbols/. Scale it to your preferred printed size.
2. Give it a unique popover such as cnk32 (shown by each SVG filename).
   For a new kit with different scaling or units, update the artwork or use new
   popover names. Do not silently reuse symbols from a different mapping.
3. Choose an appropriate playback technique and suppress playback for the
   inserted instructions. These are performer notation, not playback changes.

PLACE EACH EVENT
Open placements.html for the visual checklist. In Write mode select the hidden
Controller guide at the listed time, then use Shift+P and the symbol's popover.
For an event between guides, use the note-input caret with a suitable rhythmic
grid at the exact listed time. No event has been snapped to a nearby guide.
In Engrave mode, move the symbol so the circular face is centred on the contour
at its rhythmic anchor. The label belongs above the knob. Avoid moving its
musical time: adjust engraving offsets, not rhythmic position.
The white face masks the line; the rest of the SVG is transparent. Check size,
labels, collisions and joins in the destination layout and in its PDF export.
Keep the native playing techniques when copying the contour to another score;
filtering only horizontal lines omits the knobs. Recheck placement after reflow.

${knobs.warnings.join('\n')}
`;
  return {files, placements, symbols:[...symbols.values()]};
}
