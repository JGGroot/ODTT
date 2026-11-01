import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { unzipSync, strFromU8 } from 'fflate';
import { heightMesh, meshVolume } from '../src/mesh.js';
import { splitTerrainColors, toNative } from '../src/engine.js';
import { TERRAIN_STOPS, TERRAIN_LOOKS, proceduralTerrainColors, cutoffHeights, paintTerrain, terrainPalette, validateTerrainColors } from '../src/terrain-colors.js';
import { threeMF } from '../src/export.js';
const wasm=await Module();wasm.setup();
const s={base:2,colorMaxZ:12,colorMode:'cutoffs',colorStops:TERRAIN_STOPS,colorLayerHeight:.2};
const mesh={...heightMesh(new Float32Array([2,12,2,12]),2,2,20,20),group:'terrain'};
test('cutoff volumes are closed, layer aligned, and preserve total volume',()=>{
 const parts=splitTerrainColors(wasm,[mesh],s);assert.equal(parts.length,5);
 assert.ok(Math.abs(parts.reduce((v,p)=>v+meshVolume(p),0)-meshVolume(mesh))<.01);
 const cuts=cutoffHeights(s);for(const cut of cuts)assert.ok(Math.abs(cut/.2-Math.round(cut/.2))<1e-8);
 parts.forEach((p,i)=>{const solid=toNative(wasm,p);assert.equal(solid.status(),'NoError');solid.delete();for(let j=2;j<p.vertices.length;j+=3){assert.ok(p.vertices[j]>=cuts[i]-.0001);if(i<4)assert.ok(p.vertices[j]<=cuts[i+1]+.0001);}});
 const xml=strFromU8(unzipSync(threeMF(parts))['3D/3dmodel.model']);for(const p of parts)assert.ok(xml.includes(p.color+'FF'));
});
test('collapsed cutoffs omit empty slabs and preserve a flat model',()=>{const flat={...heightMesh(new Float32Array(4).fill(2),2,2,20,20),group:'terrain'};const parts=splitTerrainColors(wasm,[flat],{...s,colorMaxZ:2});assert.equal(parts.length,1);assert.ok(Math.abs(meshVolume(parts[0])-800)<.00001);});
test('flatten ocean creates a blue ocean layer in cutoffs mode',()=>{
 const oceanSettings={...s,flattenOcean:true,hasOcean:true,colorWater:'#2f6f9f'};
 const parts=splitTerrainColors(wasm,[mesh],oceanSettings);
 assert.equal(parts.length,6);
 assert.equal(parts[0].name,'Ocean');
 assert.equal(parts[0].color,'#2f6f9f');
 assert.ok(Math.abs(parts.reduce((v,p)=>v+meshVolume(p),0)-meshVolume(mesh))<.01);
 const xml=strFromU8(unzipSync(threeMF(parts))['3D/3dmodel.model']);
 assert.match(xml,/name="Ocean"/);
 assert.match(xml,/displaycolor="#2f6f9fFF"/);
});
test('realistic and gradient materials survive 3MF with feature precedence',()=>{
 for(const colorMode of ['realistic','gradient']){
  const labels=new Uint8Array(4).fill(1),[painted]=paintTerrain([{...mesh,labels}],{...s,colorMode,colorZToXY:1,colorWater:'#2f6f9f'});
  assert.equal(painted.faceMaterials.length,mesh.indices.length/3);
  assert.ok(painted.materials.some(m=>m.feature==='water'&&m.color==='#2f6f9f'));
  const xml=strFromU8(unzipSync(threeMF([painted]))['3D/3dmodel.model']);assert.match(xml,/name="water"/);assert.match(xml,/displaycolor="#2f6f9fFF"/);assert.doesNotMatch(xml,/p1="(?:-1|undefined)"/);
 }
 assert.equal(terrainPalette({...s,colorMode:'gradient',colorSteps:4}).length,4);
});
test('cutoffs validate ordering and colors',()=>{validateTerrainColors(s);assert.throws(()=>validateTerrainColors({...s,colorStops:TERRAIN_STOPS.map(p=>({...p,at:0}))}),/increase/);assert.throws(()=>validateTerrainColors({...s,colorLayerHeight:0}),/layer height/);});

test('automatic looks adapt to land distribution and ignore ocean',()=>{
 const heights=Float32Array.from([2,3,3,3,4,4,5,12]),surface={heights,labels:new Uint8Array(8)};
 const resolved=proceduralTerrainColors({...s,colorLook:'natural'},surface,{max:800,source:'file'});
 assert.equal(resolved.colorStops[4].name,'High rock');validateTerrainColors(resolved);
 const ocean={heights:Float32Array.from([...heights,...new Array(200).fill(2)]),labels:Uint8Array.from([...new Array(8).fill(0),...new Array(200).fill(1)])};
 assert.deepEqual(proceduralTerrainColors({...s,colorLook:'natural'},ocean,{max:800,source:'file'}).colorStops,resolved.colorStops);
 const plateau=proceduralTerrainColors(s,{heights:new Float32Array(10).fill(2)},{max:0});validateTerrainColors(plateau);
 const alpine=proceduralTerrainColors({...s,colorLook:'alpine'},surface,{max:800});assert.equal(alpine.colorStops[4].name,'Snow');
 assert.notEqual(resolved.colorStops[1].at,TERRAIN_STOPS[1].at);
 for(const colorLook of Object.keys(TERRAIN_LOOKS))validateTerrainColors(proceduralTerrainColors({...s,colorLook},surface));
});
test('procedural colors repeat across tile origins and manual mode remains exact',()=>{
 const settings={...s,colorMode:'realistic',width:40,height:40,colorZToXY:1};
 const a={vertices:Float32Array.from([1,1,7,5,1,7,1,5,7]),indices:Uint32Array.from([0,1,2]),group:'terrain'};
 const b={...a,vertices:Float32Array.from([21,11,7,25,11,7,21,15,7])};
 assert.deepEqual(paintTerrain([a],settings,[20,10])[0].faceMaterials,paintTerrain([b],settings)[0].faceMaterials);
 assert.deepEqual(paintTerrain([b],settings),paintTerrain([b],settings));
 const manual={...settings,colorAutomatic:false};assert.equal(proceduralTerrainColors(manual,{heights:[]}),manual);
 assert.equal(paintTerrain([a],manual)[0].faceMaterials[0],2);
});

test('realistic boundaries vary smoothly while manual elevation bands stay level',()=>{
 const vertices=[],indices=[];for(let y=0;y<40;y+=2)for(let x=0;x<40;x+=2){const n=vertices.length/3;vertices.push(x,y,7,x+1,y,7,x,y+1,7);indices.push(n,n+1,n+2);}
 const plane={vertices:Float32Array.from(vertices),indices:Uint32Array.from(indices),group:'terrain'};
 const settings={...s,colorMode:'realistic',width:40,height:40};
 const automatic=paintTerrain([plane],settings)[0].faceMaterials,manual=paintTerrain([plane],{...settings,colorAutomatic:false})[0].faceMaterials;
 assert.ok(new Set(automatic).size>1);assert.equal(new Set(manual).size,1);
});
