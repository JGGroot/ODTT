import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { unzipSync, strFromU8 } from 'fflate';
import { heightMesh, meshVolume } from '../src/mesh.js';
import { splitTerrainColors, toNative } from '../src/engine.js';
import { TERRAIN_STOPS, cutoffHeights, paintTerrain, terrainPalette, validateTerrainColors } from '../src/terrain-colors.js';
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
test('realistic and gradient materials survive 3MF with feature precedence',()=>{
 for(const colorMode of ['realistic','gradient']){
  const labels=new Uint8Array(4).fill(1),[painted]=paintTerrain([{...mesh,labels}],{...s,colorMode,colorZToXY:1});
  assert.equal(painted.faceMaterials.length,mesh.indices.length/3);
  assert.ok(painted.materials.some(m=>m.feature==='water'));
  const xml=strFromU8(unzipSync(threeMF([painted]))['3D/3dmodel.model']);assert.match(xml,/name="water"/);assert.doesNotMatch(xml,/p1="(?:-1|undefined)"/);
 }
 assert.equal(terrainPalette({...s,colorMode:'gradient',colorSteps:4}).length,4);
});
test('cutoffs validate ordering and colors',()=>{validateTerrainColors(s);assert.throws(()=>validateTerrainColors({...s,colorStops:TERRAIN_STOPS.map(p=>({...p,at:0}))}),/increase/);assert.throws(()=>validateTerrainColors({...s,colorLayerHeight:0}),/layer height/);});
