import { unzipSync, zipSync, strFromU8, strToU8 } from '../vendor/fflate.js';
import { parseXml } from './musicxml.js';
const LIMIT=20*1024*1024;
export function readMusicXML(bytes,Parser=globalThis.DOMParser){
  if(bytes.length>LIMIT)throw new Error('Choose a MusicXML file smaller than 20 MB.');
  if(bytes[0]!==0x50 || bytes[1]!==0x4b)return new TextDecoder().decode(bytes);
  const extract=name=>unzipSync(bytes,{filter:f=>{
    if(f.name!==name)return false;
    if(f.originalSize>LIMIT)throw new Error('The expanded MusicXML exceeds 20 MB. Export one layout and flow.');
    return true;
  }})[name];
  const container=extract('META-INF/container.xml');
  if(!container)throw new Error('This compressed file has no MusicXML container.');
  const doc=parseXml(strFromU8(container),Parser);
  const roots=Array.from(doc.getElementsByTagName('rootfile'));
  const root=roots.find(n=>n.getAttribute('media-type')==='application/vnd.recordare.musicxml+xml')||roots[0];
  const path=root?.getAttribute('full-path'),score=path&&extract(path);
  if(!score)throw new Error('The compressed file does not contain its declared MusicXML score.');
  return strFromU8(score);
}
export function makeZip(files){return zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,strToU8(text)])),{level:6});}
