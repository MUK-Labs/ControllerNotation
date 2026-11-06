// Read a layout snapshot. Do not interpret playback repeats as written bars.
const children = (el, name) => Array.from(el.childNodes || []).filter(n => n.nodeType === 1 && (!name || n.localName === name || n.nodeName === name));
const one = (el, name) => children(el, name)[0];
const value = (el, name) => one(el, name)?.textContent?.trim();
const near = (a, b) => Math.abs(a - b) < 1e-7;

export function parseXml(text, Parser = globalThis.DOMParser) {
  if (text.length > 20 * 1024 * 1024) throw new Error('Please use a MusicXML file smaller than 20 MB.');
  if (/<!ENTITY\s/i.test(text) || /<!DOCTYPE[^>]*\[/i.test(text)) throw new Error('XML entity declarations are not supported. Use an unmodified Dorico export.');
  const doc = new Parser().parseFromString(text, 'application/xml');
  if (!doc.documentElement || doc.getElementsByTagName('parsererror').length) throw new Error('The MusicXML is not valid XML. Export it again.');
  return doc;
}

export function parseMusicXML(text, Parser = globalThis.DOMParser) {
  const doc = parseXml(text, Parser), root = doc.documentElement;
  if (root.localName !== 'score-partwise' && root.nodeName !== 'score-partwise') throw new Error('Choose a single-flow, partwise MusicXML export (.musicxml, .xml or .mxl).');
  const partNodes = children(root, 'part');
  if (!partNodes.length) throw new Error('The MusicXML contains no instrumental parts.');
  const partNames = new Map(children(one(root, 'part-list') || {}, 'score-part').map(p => [p.getAttribute('id'), value(p, 'part-name')]));
  let hasRepeats = false;
  const parts = partNodes.map(part => {
    let start = 0, divisions = null, meter = null;
    const bars = [], breaks = [];
    for (const measure of children(part, 'measure')) {
      let cursor = 0, extent = 0, lastNoteStart = 0, measureRest = false;
      const number = measure.getAttribute('number') || String(bars.length + 1);
      for (const e of children(measure)) {
        const name = e.localName || e.nodeName;
        if (name === 'attributes') {
          if (one(e, 'divisions')) {
            divisions = Number(value(e, 'divisions'));
            if (!Number.isFinite(divisions) || divisions <= 0) throw new Error(`Invalid duration units in bar ${number}.`);
          }
          const time = one(e, 'time');
          if (time) {
            if (cursor > 1e-7) throw new Error(`A time-signature change inside bar ${number} needs manual handling in this release.`);
            const beats = children(time, 'beats').map(n => n.textContent.trim());
            const types = children(time, 'beat-type').map(n => Number(n.textContent));
            if (!beats.length || beats.length !== types.length) throw new Error('Unmetered or incomplete time signatures are not yet supported.');
            const groups = beats.map((b, i) => ({ numerator: b.split('+').reduce((a, n) => a + Number(n), 0), denominator: types[i] }));
            if (groups.some(g => !Number.isInteger(g.numerator) || g.numerator <= 0 || ![1,2,4,8,16,32,64,128].includes(g.denominator))) throw new Error('Unsupported MusicXML time signature.');
            meter = { groups, label: groups.map(g => `${g.numerator}/${g.denominator}`).join(' + '), duration: groups.reduce((a, g) => a + 4 * g.numerator / g.denominator, 0) };
          }
        } else if (name === 'print' && (e.getAttribute('new-system') === 'yes' || e.getAttribute('new-page') === 'yes')) {
          if (cursor > 1e-7) throw new Error(`The system break inside bar ${number} needs manual handling in this release.`);
          if (start > 0) breaks.push({ beat: start, bar: number, page: e.getAttribute('new-page') === 'yes' });
        } else if (['note', 'forward', 'backup'].includes(name)) {
          if (name === 'note' && one(e, 'grace')) continue;
          const durationText = value(e, 'duration');
          if (!divisions && durationText) throw new Error('MusicXML duration units are missing.');
          const duration = durationText ? Number(durationText) / divisions : 0;
          if (!Number.isFinite(duration) || duration < 0) throw new Error(`Invalid duration in bar ${number}.`);
          if (name === 'backup') { cursor -= duration; if (cursor < -1e-7) throw new Error(`Invalid voice timing in bar ${number}.`); }
          else if (name === 'note' && one(e, 'chord')) extent = Math.max(extent, lastNoteStart + duration);
          else { lastNoteStart = cursor; cursor += duration; extent = Math.max(extent, cursor); }
          if (one(e, 'rest')?.getAttribute('measure') === 'yes') measureRest = true;
        } else if (name === 'barline' && (one(e, 'repeat') || one(e, 'ending'))) hasRepeats = true;
        if (name === 'sound' && ['dacapo','dalsegno','tocoda'].some(a => e.hasAttribute(a))) hasRepeats = true;
        if (name === 'direction' && one(e, 'sound') && ['dacapo','dalsegno','tocoda'].some(a => one(e, 'sound').hasAttribute(a))) hasRepeats = true;
      }
      if (!meter) throw new Error('MusicXML has no opening time signature.');
      let duration = extent;
      if (duration === 0 && measureRest) duration = meter.duration;
      if (duration <= 0) throw new Error(`Bar ${number} has no measurable duration. Use a layout containing notes or full-bar rests.`);
      // Measure totals, rather than printed bar labels, preserve pickups and irregular bars.
      bars.push({ number, start, duration, meter, implicit: measure.getAttribute('implicit') === 'yes' || !near(duration, meter.duration) });
      start += duration;
    }
    return { id: part.getAttribute('id'), name: partNames.get(part.getAttribute('id')) || 'Part', bars, breaks, totalBeats: start };
  });
  const primary = parts[0];
  for (const part of parts.slice(1)) {
    if (part.bars.length !== primary.bars.length || part.bars.some((b,i) => !near(b.start, primary.bars[i].start) || !near(b.duration, primary.bars[i].duration))) throw new Error('Parts have different bar timelines. Export the intended performer’s layout separately.');
    // Some exporters put print markers only in one part; conflicting nonempty maps are unsafe.
    if (part.breaks.length && primary.breaks.length && (part.breaks.length !== primary.breaks.length || part.breaks.some((b,i) => !near(b.beat,primary.breaks[i].beat)))) throw new Error('Parts contain conflicting system breaks. Export one destination layout.');
    if (!primary.breaks.length && part.breaks.length) primary.breaks = part.breaks;
  }
  const defaults = one(root, 'defaults'), scaling = one(defaults || {}, 'scaling');
  const mm = Number(value(scaling || {}, 'millimeters')), tenths = Number(value(scaling || {}, 'tenths'));
  return { bars: primary.bars, breaks: primary.breaks, totalBeats: primary.totalBeats, hasRepeats,
    partCount: parts.length, title: value(one(root, 'work') || {}, 'work-title') || value(root, 'movement-title') || 'Imported layout',
    staffSpaceMm: mm > 0 && tenths > 0 ? mm / tenths * 10 : null,
    software: Array.from(root.getElementsByTagName('software')).map(n => n.textContent).join(', ') };
}

export function makeMeterLayout(meters, requiredEnd, fallback = '4/4') {
  const [n, d] = fallback.split('/').map(Number);
  if (!Number.isInteger(n) || n < 1 || n > 64 || ![1,2,4,8,16,32].includes(d)) throw new Error('Enter a meter such as 4/4, 3/4 or 5/8.');
  const changes = meters.slice().sort((a,b) => a.beat-b.beat);
  if (!changes.length || changes[0].beat !== 0) changes.unshift({beat:0,numerator:n,denominator:d});
  const bars = []; let start = 0, i = 0;
  while (start <= requiredEnd + 1e-7) {
    while (i + 1 < changes.length && changes[i+1].beat <= start + 1e-7) i++;
    const {numerator,denominator} = changes[i], nominal = 4*numerator/denominator;
    if (!(nominal > 0)) throw new Error('Invalid meter duration.');
    const next = changes[i+1]?.beat ?? Infinity, duration = Math.min(nominal, next-start);
    bars.push({number:String(bars.length+1),start,duration,implicit:duration!==nominal,
      meter:{groups:[{numerator,denominator}],label:`${numerator}/${denominator}`,duration:nominal}});
    start += duration;
    if (bars.length > 4096) throw new Error('This passage is too long. Export a shorter flow.');
  }
  return {bars,breaks:[],totalBeats:start,hasRepeats:false,title:'Guide score',source:'MIDI meter or explicit fallback'};
}
