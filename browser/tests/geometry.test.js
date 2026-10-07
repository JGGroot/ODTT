import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import { dimensions, gridSize, tileBounds } from '../src/geo.js';
import { heightMesh, meshVolume } from '../src/mesh.js';
import { surfaceTile, fullSurface, vectorTile, mergeSolids, toNative } from '../src/engine.js';
import { stl, threeMF } from '../src/export.js';
import { decodeElevation, fillVoids, fetchTerrain } from '../src/terrain.js';
import { unzipSync, strFromU8 } from 'fflate';
import { writeArrayBuffer } from 'geotiff';
import { tiffGrid, inspectTIFF } from '../src/terrain.js';
import { osmFeatures, joinRings } from '../src/osm.js';
const wasm=await Module();wasm.setup();
const close=(a,b,tol=.001)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
function closed(mesh){const edges=new Map();for(let i=0;i<mesh.indices.length;i+=3){const t=mesh.indices.slice(i,i+3);for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],k=[Math.min(a,b),Math.max(a,b)].join(',');const e=edges.get(k)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(k,e);}}for(const e of edges.values())assert.deepEqual(e,[2,0]);}
test('geographic aspect and tile layout preserve the physical scale',()=>{const d=dimensions({south:38.5269,north:38.5611,west:-89.886,east:-89.7981},1200);close(d.height,596.952, .01);close(d.widthM/d.heightM,d.width/d.height);const t=tileBounds(0,2,3,5,d.width,d.height);close(t.width,240);close(t.height,d.height/3);close(t.x,480);close(t.y,d.height*2/3);});
test('regular terrain is closed, outward-facing and accepted by Manifold',()=>{const mesh=heightMesh(new Float32Array(20).fill(2),5,4,40,30);closed(mesh);close(meshVolume(mesh),2400);const solid=toNative(wasm,mesh);assert.equal(solid.status(),'NoError');close(solid.volume(),2400);solid.delete();});
test('adjacent terrain tiles share every edge and match the full surface volume',()=>{const s={width:40,height:24,cols:2,rows:2};const surface={w:9,h:7,heights:Float32Array.from({length:63},(_,i)=>2+i*.01),labels:new Uint8Array(63)};const tiles=Array.from({length:4},(_,i)=>{const tile=tileBounds(Math.floor(i/2),i%2,2,2,40,24);return {tile,mesh:surfaceTile(surface,tile,s)[0]};});for(const t of tiles)closed(t.mesh);for(let y=0;y<4;y++)close(tiles[0].mesh.vertices[(y*5+4)*3+2],tiles[1].mesh.vertices[y*5*3+2]);for(let x=0;x<5;x++)close(tiles[0].mesh.vertices[x*3+2],tiles[2].mesh.vertices[(3*5+x)*3+2]);const whole=fullSurface(surface,s);closed(whole);close(tiles.reduce((n,t)=>n+meshVolume(t.mesh),0),meshVolume(whole));});
test('vector polygons keep courtyard holes, clip to tiles, and merge without stretching',()=>{const ring=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];const f={group:'buildings',height:3,bounds:[5,5,35,25],polygons:[[ring(5,5,35,25),ring(15,10,25,20)]]};const s={base:2,multiColor:true};const tiles=[0,1].map(col=>{const tile=tileBounds(0,col,1,2,40,30);return {tile,objects:vectorTile(wasm,[f],tile,s)};});const objects=tiles.flatMap(t=>t.objects.map(o=>({...o,offset:[t.tile.x,t.tile.y,0]})));const merged=mergeSolids(wasm,objects);close(meshVolume(merged),40*30*2+(30*20-10*10)*3);const xs=Array.from(merged.vertices).filter((_,i)=>i%3===0),ys=Array.from(merged.vertices).filter((_,i)=>i%3===1);close(Math.max(...xs)-Math.min(...xs),40);close(Math.max(...ys)-Math.min(...ys),30);});
test('STL and 3MF retain dimensions, units, material colors and XML escaping',()=>{const m={...heightMesh(new Float32Array(4).fill(2),2,2,40,30),group:'ground'};const bytes=stl(m),dv=new DataView(bytes.buffer);assert.equal(bytes.length,84+dv.getUint32(80,true)*50);const archive=unzipSync(threeMF([m],{Title:'A & B'}));const xml=strFromU8(archive['3D/3dmodel.model']);assert.match(xml,/unit="millimeter"/);assert.match(xml,/A &amp; B/);assert.match(xml,/displaycolor="#d3ccbaFF"/);assert.match(xml,/x="40.000000"/);assert.ok(archive['_rels/.rels']);});
test('terrain PNG decoding supports negative heights and missing values',()=>{close(decodeElevation(128,100,128,'terrarium'),100.5);assert.ok(Number.isNaN(decodeElevation(0,0,0,'terrarium')));close(decodeElevation(0,39,16,'dem5a_png'),100);close(decodeElevation(255,216,240,'dem5a_png'),-100);assert.ok(Number.isNaN(decodeElevation(128,0,0,'dem5a_png')));});
test('small elevation gaps fill; missing regions never become flat zero terrain',()=>{const grid=new Float32Array(100).fill(50);grid[55]=NaN;assert.equal(fillVoids(grid,10,10).filled,1);close(grid[55],50);assert.throws(()=>fillVoids(new Float32Array(100).fill(NaN),10,10),/No elevation/);const bad=new Float32Array(100).fill(50);bad.fill(NaN,0,10);assert.throws(()=>fillVoids(bad,10,10),/no elevation/);});
test('local GeoTIFF preserves georeferencing and integer no-data values',async()=>{const values=new Uint8Array(16).fill(120);values[0]=255;const buffer=writeArrayBuffer(values,{width:4,height:4,BitsPerSample:[8],SampleFormat:[1],ModelPixelScale:[.001,.001,0],ModelTiepoint:[0,0,0,139,36,0],GeographicTypeGeoKey:4326,GTModelTypeGeoKey:2,GTRasterTypeGeoKey:1,GDAL_NODATA:'255'});const info=await inspectTIFF(buffer);close(info.bounds.west,139);close(info.bounds.south,35.996);const grid=await tiffGrid(buffer,info.bounds,5,5);assert.ok(Number.isNaN(grid[0]));close(grid.at(-1),120);});
test('terrain 3MF keeps feature face colors on a single watertight surface',()=>{const surface={w:3,h:3,heights:new Float32Array(9).fill(3),labels:new Uint8Array(9).fill(6)},m=fullSurface(surface,{width:10,height:10}),xml=strFromU8(unzipSync(threeMF([m]))['3D/3dmodel.model']);closed(m);assert.match(xml,/name="buildings"/);assert.match(xml,/<triangle[^>]+pid="1" p1="1"/);});
test('OSM lines buffer in metres and relation segments assemble courtyard holes',()=>{const joined=joinRings([[[0,0],[1,0]],[[1,1],[1,0]],[[0,1],[1,1]],[[0,0],[0,1]]]);assert.equal(joined.length,1);assert.deepEqual(joined[0][0],joined[0].at(-1));const b={west:0,east:.01,south:0,north:.01},s={width:100,buildingHeight:8,buildingScale:2,roadHeight:.5,roadWidth:1,greenHeight:.2,waterHeight:.1};const f=osmFeatures({elements:[{type:'way',id:1,tags:{highway:'residential'},geometry:[{lon:.001,lat:.005},{lon:.009,lat:.005}]}]},b,s);assert.equal(f.length,1);assert.equal(f[0].group,'roads');close(f[0].height,.5);assert.ok(f[0].bounds[3]-f[0].bounds[1]>.5);});


test('close terrain falls back from empty high-zoom tiles without expanding bounds',async()=>{
  const saved={fetch:globalThis.fetch,createImageBitmap:globalThis.createImageBitmap,OffscreenCanvas:globalThis.OffscreenCanvas};
  const requested=[];
  try {
    globalThis.fetch=async url=>{const z=Number(String(url).split('/').at(-3));requested.push(z);return new Response(JSON.stringify({z}));};
    globalThis.createImageBitmap=async blob=>({...JSON.parse(await blob.text()),width:256,height:256,close(){}});
    globalThis.OffscreenCanvas=class {
      getContext(){let bitmap;return {drawImage(image){bitmap=image;},getImageData(){const data=new Uint8ClampedArray(256*256*4);for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4;data[i+3]=255;if(bitmap.z<14){data[i]=134;data[i+1]=x;data[i+2]=y;}}return {data};}};}
    };
    const bounds={south:40.01501,north:40.01701,west:9.30061,east:9.30322};
    const result=await fetchTerrain('mapzen',bounds,65,65);
    assert.match(result.detail,/zoom 13/);assert.ok(result.max>result.min);assert.ok(result.min>0);assert.equal(result.filled,0);
    assert.ok(requested.includes(15)&&requested.includes(14)&&requested.includes(13));assert.equal(result.grid.length,4225);
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});


test('GPS imports preserve KML, GPX and TCX segments and reject non-track data',async()=>{
  const {DOMParser}=await import('@xmldom/xmldom');const {parseTrack}=await import('../src/tracks.js');const previous=globalThis.DOMParser;globalThis.DOMParser=DOMParser;
  try {
    const kml=parseTrack('<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><LineString><coordinates>9.30,40.01,1700 9.31,40.02,1750</coordinates></LineString></Placemark><Placemark><LineString><coordinates>9.32,40.02 9.33,40.03</coordinates></LineString></Placemark></kml>');assert.equal(kml.segments.length,2);assert.equal(kml.count,4);
    const gpx=parseTrack('<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="40.01" lon="9.30"/><trkpt lat="40.02" lon="9.31"/></trkseg><trkseg><trkpt lat="40.03" lon="9.32"/><trkpt lat="40.04" lon="9.33"/></trkseg></trk></gpx>','activity.gpx');assert.equal(gpx.segments.length,2);
    const tcx=parseTrack('<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Track><Trackpoint><Position><LatitudeDegrees>40.01</LatitudeDegrees><LongitudeDegrees>9.3</LongitudeDegrees></Position></Trackpoint><Trackpoint><Position><LatitudeDegrees>40.02</LatitudeDegrees><LongitudeDegrees>9.31</LongitudeDegrees></Position></Trackpoint></Track></TrainingCenterDatabase>','activity.tcx');assert.equal(tcx.count,2);assert.deepEqual(tcx.segments[0][0],[9.3,40.01]);
    assert.throws(()=>parseTrack('<kml><Point><coordinates>9.3,40.01</coordinates></Point></kml>'),/No GPS track/);
  }finally{if(previous===undefined)delete globalThis.DOMParser;else globalThis.DOMParser=previous;}
});

test('track insert follows the terrain top, has a planar underside and matches its recess',async()=>{
  const {trackInsert}=await import('../src/engine.js'),{insertFloor}=await import('../src/tracks.js');
  const wasm=await Module();wasm.setup();const settings={width:40,height:40,base:2,relief:12,trackClearance:0,trackFloor:4};
  const heights=Float32Array.from({length:81},(_,i)=>7+(i%9)*.5+Math.floor(i/9)*.25);
  const mesh={...heightMesh(heights,9,9,40,40),group:'terrain'},polygons=[[[[8,8],[32,8],[32,12],[8,12],[8,8]]]];
  const objects=trackInsert(wasm,[mesh],polygons,{x:0,y:0,width:40,height:40},settings),insert=objects.find(o=>o.group==='track');assert.ok(insert);
  let bottom=Infinity,top=-Infinity;for(let i=2;i<insert.vertices.length;i+=3){const z=insert.vertices[i];bottom=Math.min(bottom,z);top=Math.max(top,z);if(z>6.0001)close(z,7+insert.vertices[i-2]*.1+insert.vertices[i-1]*.05,1e-4);}
  close(bottom,6);assert.ok(top>bottom+2);
  for(const object of objects){const native=toNative(wasm,object);assert.equal(native.status(),'NoError');assert.ok(meshVolume(object)>0);native.delete();}
  close(objects.reduce((n,o)=>n+meshVolume(o),0),meshVolume(mesh),.01);
  const surface={heights:Float32Array.from({length:81},(_,i)=>heights[(8-Math.floor(i/9))*9+i%9]),w:9,h:9};close(insertFloor(surface,polygons,settings),4);
  const bytes=stl({...insert,offset:[0,0,-bottom]}),view=new DataView(bytes.buffer);let min=Infinity;for(let i=0;i<insert.indices.length/3;i++)for(let j=0;j<3;j++)min=Math.min(min,view.getFloat32(84+i*50+12+j*12+8,true));close(min,0);
  const xml=strFromU8(unzipSync(threeMF(objects))['3D/3dmodel.model']);assert.match(xml,/name="track" displaycolor="#df343bFF"/);
});


test('OSM greenery and ground occupy separate volumes without competing faces',async()=>{
  const wasm=await Module();wasm.setup();const settings={base:2,multiColor:true};
  const objects=vectorTile(wasm,[{group:'greenery',height:.2,bounds:[5,5,15,15],polygons:[[[[5,5],[15,5],[15,15],[5,15],[5,5]]]]}],{x:0,y:0,width:20,height:20},settings);
  const grass=toNative(wasm,objects.find(o=>o.group==='greenery')),ground=toNative(wasm,objects.find(o=>o.group==='ground'));
  const overlap=grass.intersect(ground);close(overlap.volume(),0);const merged=grass.add(ground);assert.equal(merged.status(),'NoError');close(merged.volume(),820,.001);
  overlap.delete();merged.delete();grass.delete();ground.delete();
});


test('aspect locks use ground proportions and preserve the opposite drag corner',async()=>{
  const {aspectBounds}=await import('../src/geo.js');
  const b={south:39.98,north:40.02,west:9.29,east:9.32};
  for(const ratio of [1,16/9,4/3,3/2,9/16]){const locked=aspectBounds(b,ratio),d=dimensions(locked);close(d.widthM/d.heightM,ratio,1e-8);assert.ok(locked.west<=b.west&&locked.east>=b.east&&locked.south<=b.south&&locked.north>=b.north);
    for(const lat of [b.south,b.north])for(const lng of [b.west,b.east]){const next=aspectBounds(b,ratio,{lat,lng}),dim=dimensions(next);close(dim.widthM/dim.heightM,ratio,1e-8);assert.ok(next.south===lat||next.north===lat);assert.ok(next.west===lng||next.east===lng);}}
});

test('ocean stays exactly flat through smoothing and exaggeration; island land rises above it',async()=>{
  const {surfaceHeights}=await import('../src/engine.js');const grid=Float32Array.from([-500,-20,-10,-5,-1,-2,-3,100,400,100,-3,-2,-1,-2,-3,-4,-5,-6,-7,-8,-9,-10,-11,-12,-13]);
  const settings={base:2,relief:20,exaggeration:3,flattenOcean:true,terrainScale:'relief',terrainMode:'smooth',smooth:.7,width:40,height:40};
  const surface=surfaceHeights({grid,w:5,h:5,min:-500,max:400},[],settings);
  for(let i=0;i<grid.length;i++)if(grid[i]<=0){close(surface.heights[i],2);assert.equal(surface.labels[i],1);}assert.ok(surface.heights[8]>2);
  const plain=surfaceHeights({grid,w:5,h:5,min:-500,max:400},[],{...settings,flattenOcean:false,smooth:0,exaggeration:1});
  const doubled=surfaceHeights({grid,w:5,h:5,min:-500,max:400},[],{...settings,flattenOcean:false,smooth:0,exaggeration:2});
  for(let i=0;i<grid.length;i++)close(doubled.heights[i]-2,2*(plain.heights[i]-2),1e-5);
  const mesh=fullSurface(surface,settings);closed(mesh);assert.ok(meshVolume(mesh)>0);
});


test('Skadi ocean voids become sea level only when ocean flattening is enabled',async()=>{
  const {gzipSync}=await import('fflate');const original=globalThis.fetch;const bytes=new Uint8Array(8),view=new DataView(bytes.buffer);for(let i=0;i<4;i++)view.setInt16(i*2,-32768,false);
  globalThis.fetch=async()=>new Response(gzipSync(bytes));
  try{const b={south:39.1,north:39.9,west:9.1,east:9.9};await assert.rejects(fetchTerrain('srtm',b,3,3),/No elevation data/);const ocean=await fetchTerrain('srtm',b,3,3,undefined,undefined,undefined,{flattenOcean:true});assert.ok(ocean.grid.every(v=>v===0));close(ocean.min,0);close(ocean.max,0);}finally{globalThis.fetch=original;}
});


test('regional island voids flatten only where the reference confirms sea level',async()=>{
  const {fillOceanVoids}=await import('../src/terrain.js');const grid=Float32Array.from([NaN,NaN,125,NaN]),reference=Float32Array.from([-50,90,-10,NaN]);assert.equal(fillOceanVoids(grid,reference),1);assert.equal(grid[0],0);assert.ok(Number.isNaN(grid[1]));assert.equal(grid[2],125);assert.ok(Number.isNaN(grid[3]));
});
