// Standard MIDI File parser. Timing is quarter notes, never seconds.
export function parseMidi(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Please use a MIDI file smaller than 20 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const need = (n, end = bytes.length) => { if (pos + n > end) throw new Error('The MIDI file is incomplete. Export it again from Dorico.'); };
  const u32 = () => { need(4); const n = view.getUint32(pos); pos += 4; return n; };
  const tag = () => { need(4); const s = String.fromCharCode(...bytes.subarray(pos, pos + 4)); pos += 4; return s; };
  if (tag() !== 'MThd') throw new Error('This is not a Standard MIDI File. Choose a .mid or .midi export.');
  const header = u32(); need(header);
  if (header < 6) throw new Error('Invalid MIDI header.');
  const format = view.getUint16(pos), tracks = view.getUint16(pos + 2), ppqn = view.getUint16(pos + 4);
  pos += header;
  if (format > 1 || !tracks || (format === 0 && tracks !== 1)) throw new Error('Use MIDI format 0 or 1. Independent format-2 sequences are not supported.');
  if (!ppqn || (ppqn & 0x8000)) throw new Error('This MIDI uses SMPTE timing. Export MIDI with ticks per quarter note (PPQN).');
  const streams = new Map(), meters = [], names = [];
  let endTick = 0, order = 0;
  for (let track = 0; track < tracks; track++) {
    if (tag() !== 'MTrk') throw new Error('Expected a MIDI track.');
    const size = u32(); need(size); const end = pos + size;
    let tick = 0, running = null;
    const vlq = () => {
      let value = 0;
      for (let i = 0; i < 4; i++) { need(1, end); const b = bytes[pos++]; value = value * 128 + (b & 127); if (!(b & 128)) return value; }
      throw new Error('Invalid MIDI event length.');
    };
    while (pos < end) {
      tick += vlq(); need(1, end);
      let status = bytes[pos];
      if (status & 128) { pos++; running = status < 0xf0 ? status : null; }
      else if (running !== null) status = running;
      else throw new Error('Invalid MIDI running status.');
      if (status === 0xff) {
        need(1, end); const kind = bytes[pos++], length = vlq(); need(length, end);
        const data = bytes.subarray(pos, pos + length); pos += length;
        if (kind === 3) names[track] = new TextDecoder().decode(data);
        if (kind === 0x58) {
          if (length !== 4 || !data[0] || data[1] > 7) throw new Error('Invalid MIDI time signature.');
          meters.push({ beat: tick / ppqn, numerator: data[0], denominator: 2 ** data[1], order: order++ });
        }
        if (kind === 0x2f) { if (length) throw new Error('Invalid MIDI end-of-track event.'); break; }
      } else if (status === 0xf0 || status === 0xf7) { const length = vlq(); need(length, end); pos += length; }
      else if (status >= 0x80 && status < 0xf0) {
        const kind = status >> 4, length = kind === 12 || kind === 13 ? 1 : 2;
        need(length, end); const a = bytes[pos++], b = length === 2 ? bytes[pos++] : 0;
        if (a > 127 || b > 127) throw new Error('Invalid MIDI channel data.');
        if (kind === 11) {
          const channel = (status & 15) + 1, key = `${channel}:${a}`;
          if (!streams.has(key)) streams.set(key, { key, channel, cc: a, tracks: new Set(), events: [] });
          const stream = streams.get(key); stream.tracks.add(track);
          stream.events.push({ tick, beat: tick / ppqn, value: b, order: order++ });
        }
      } else throw new Error(`Unsupported MIDI event 0x${status.toString(16)}.`);
    }
    pos = end; endTick = Math.max(endTick, tick);
  }
  const result = [...streams.values()].map(stream => {
    const points = new Map();
    for (const event of stream.events.sort((a, b) => a.tick - b.tick || a.order - b.order)) points.set(event.tick, event);
    return { ...stream, tracks: [...stream.tracks].map(i => names[i] || `Track ${i + 1}`), events: [...points.values()] };
  }).sort((a, b) => a.cc - b.cc || a.channel - b.channel);
  if (!result.length) throw new Error('No MIDI controller events found. Export a flow containing CC automation, then try again.');
  const meterMap = new Map();
  for (const meter of meters.sort((a, b) => a.beat - b.beat || a.order - b.order)) meterMap.set(meter.beat, meter);
  return { format, ppqn, tracks, endBeat: endTick / ppqn, streams: result, meters: [...meterMap.values()] };
}
