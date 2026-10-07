import Module from 'manifold-3d';
import wasmURL from 'manifold-3d/manifold.wasm?url';
import { vectorTile, surfaceTile, surfaceHeights, fullSurface, mergeSolids, trackInsert } from './engine.js';
import { osmFeatures } from './osm.js';
import { fetchTerrain } from './terrain.js';
import { threeMF, stl } from './export.js';
import { insertFloor } from './tracks.js';
import { zipSync } from 'fflate';
let native;
async function wasm(){if(!native){native=await Module({locateFile:()=>wasmURL});native.setup();}return native;}
self.onmessage=async({data})=>{
  const {id,kind,payload}=data;
  try {
    let result;
    if(kind==='features')result=osmFeatures(payload.data,payload.bounds,payload.settings);
    else if(kind==='elevation')result=await fetchTerrain(payload.source,payload.bounds,payload.w,payload.h,undefined,text=>self.postMessage({id,progress:text}),payload.file,payload.options);
    else if(kind==='surface')result=surfaceHeights(payload.elevation,payload.features,payload.settings);
    else if(kind==='tile'){result=payload.surface?surfaceTile(payload.surface,payload.tile,payload.settings):vectorTile(await wasm(),payload.features,payload.tile,payload.settings);if(payload.track)result=trackInsert(await wasm(),result,payload.track,payload.tile,payload.settings);}
    else if(kind==='merge')result=mergeSolids(await wasm(),payload.objects);
    else if(kind==='fullSurface')result=fullSurface(payload.surface,payload.settings);
    else if(kind==='trackFloor')result=insertFloor(payload.surface,payload.polygons,payload.settings);
    else if(kind==='track')result=trackInsert(await wasm(),payload.objects,payload.polygons,payload.tile,payload.settings);
    else if(kind==='export') {
      if(payload.kind==='3mf')result=threeMF(payload.objects,payload.metadata);
      else {const mesh=payload.objects.length===1?payload.objects[0]:mergeSolids(await wasm(),payload.objects);result=stl(mesh);}
    }
    else if(kind==='exportTile') {
      const objects=payload.objects;
      const ground=objects.filter(o=>o.group!=='track'),track=objects.filter(o=>o.group==='track');
      const mesh=ground.length===1?ground[0]:mergeSolids(await wasm(),ground);
      result={threeMF:threeMF(objects,payload.metadata),stl:stl(mesh)};
      if(track.length){const merged=track.length===1?track[0]:mergeSolids(await wasm(),track);let bottom=Infinity;for(let i=2;i<merged.vertices.length;i+=3)bottom=Math.min(bottom,merged.vertices[i]);for(let i=2;i<merged.vertices.length;i+=3)merged.vertices[i]-=bottom;result.track=stl(merged);}
    }
    else if(kind==='zip')result=zipSync(payload.entries,{level:1});
    else throw new Error('Unknown model operation.');
    const buffers=[];
    const gather=v=>{if(ArrayBuffer.isView(v))buffers.push(v.buffer);else if(v&&typeof v==='object')Object.values(v).forEach(gather);};gather(result);
    self.postMessage({id,result},[...new Set(buffers)]);
  }catch(e){self.postMessage({id,error:e.message||String(e)});}
};
