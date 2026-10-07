import { heightMesh, combineMeshes } from './mesh.js';
import { bilinear, pointInPolygon } from './geo.js';
export function toNative(wasm,m) {return new wasm.Manifold(new wasm.Mesh({numProp:3,vertProperties:m.vertices,triVerts:m.indices}));}
export function toPlain(solid) {
  const status=solid.status();if(status!=='NoError')throw new Error(`Mesh construction failed: ${status}`);
  const m=solid.getMesh(),v=new Float32Array(m.vertProperties.length/m.numProp*3);
  for(let i=0;i<v.length/3;i++)v.set(m.vertProperties.subarray(i*m.numProp,i*m.numProp+3),i*3);
  return {vertices:v,indices:new Uint32Array(m.triVerts)};
}
export function vectorTile(wasm,features,tile,settings) {
  const {CrossSection,Manifold}=wasm,owned=[];
  const own=o=>(owned.push(o),o);
  try {
    const clip=own(own(CrossSection.square([tile.width,tile.height])).translate([tile.x,tile.y]));
    let covered=own(CrossSection.square([0,0]));
    const groups={};
    const priority={greenery:1,water:2,roads:3,runways:4,railways:5,buildings:6};
    const sorted=features.filter(f=>f.bounds[2]>=tile.x&&f.bounds[0]<=tile.x+tile.width&&f.bounds[3]>=tile.y&&f.bounds[1]<=tile.y+tile.height).sort((a,b)=>(priority[b.group]-priority[a.group])||b.height-a.height);
    for(const group of [...new Set(sorted.map(f=>f.group))]) {
      const footprints=[];
      for(const f of sorted.filter(f=>f.group===group)) {
        // Batch coverage per layer. Same-layer solid unions preserve the tallest
        // overlap without repeatedly rebuilding the entire covered polygon set.
        const parts=f.polygons.map(p=>own(new CrossSection(p.map(r=>r.slice(0,-1)),'EvenOdd')));
        const cs=own(own(CrossSection.union(parts)).intersect(clip));
        if(cs.isEmpty())continue;footprints.push(cs);
        const visible=own(cs.subtract(covered));if(visible.isEmpty())continue;
        const local=own(visible.translate([-tile.x,-tile.y]));
        const solid=own(local.extrude(settings.base+f.height));
        (groups[group]??=[]).push(solid);
      }
      if(footprints.length)covered=own(covered.add(own(CrossSection.union(footprints))));
    }
    const ground=own(own(clip.subtract(covered)).translate([-tile.x,-tile.y]));
    if(!ground.isEmpty())groups.ground=[own(ground.extrude(settings.base))];
    if(!settings.multiColor){const merged=own(Manifold.union(Object.values(groups).flat()));return [{...toPlain(merged),group:'ground'}];}
    return Object.entries(groups).map(([group,solids])=>({...toPlain(own(Manifold.union(solids))),group}));
  } finally {for(const o of owned.reverse())o.delete();}
}
export function surfaceHeights(elevation,features,settings) {
  const {grid,w,h,min,max}=elevation;
  const heights=new Float32Array(grid.length),labels=new Uint8Array(grid.length);
  const ocean=settings.flattenOcean?Uint8Array.from(grid,v=>v<=0):null;
  const low=ocean?0:min,range=Math.max(max-low,.001),exaggeration=settings.exaggeration??1;
  const codes={water:1,greenery:2,roads:3,runways:4,railways:5,buildings:6};
  for(let row=0;row<h;row++)for(let col=0;col<w;col++) {
    const i=row*w+col,v=ocean?Math.max(0,grid[i]):grid[i]-min;
    const meters=settings.terrainMode==='stepped'?Math.floor(v/settings.contourInterval)*settings.contourInterval:v;
    const z=settings.terrainScale==='true'?meters*settings.scale*exaggeration:meters/range*settings.relief*exaggeration;
    heights[i]=settings.base+z;
  }
  if(settings.smooth>0&&settings.terrainMode!=='stepped'){const copy=heights.slice();for(let row=1;row<h-1;row++)for(let col=1;col<w-1;col++){let sum=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)sum+=copy[(row+dy)*w+col+dx];const i=row*w+col;heights[i]=copy[i]*(1-settings.smooth)+sum/9*settings.smooth;}}
  if(ocean)for(let i=0;i<heights.length;i++)if(ocean[i]){heights[i]=settings.base;labels[i]=1;}
  // Paint feature heights onto terrain. Work only in each feature's bounds.
  if(features.length){
    const priority={greenery:1,water:2,roads:3,runways:4,railways:5,buildings:6};
    const baseSurface=heights.slice();
    for(const f of features.slice().sort((a,b)=>(priority[a.group]-priority[b.group])||a.height-b.height)){
      const x0=Math.max(0,Math.floor(f.bounds[0]/settings.width*(w-1))),x1=Math.min(w-1,Math.ceil(f.bounds[2]/settings.width*(w-1)));
      const y0=Math.max(0,Math.floor((1-f.bounds[3]/settings.height)*(h-1))),y1=Math.min(h-1,Math.ceil((1-f.bounds[1]/settings.height)*(h-1)));
      for(let row=y0;row<=y1;row++)for(let col=x0;col<=x1;col++){
        const x=col/(w-1)*settings.width,y=(1-row/(h-1))*settings.height;
        if(f.polygons.some(p=>pointInPolygon(x,y,p))){const i=row*w+col;heights[i]=baseSurface[i]+f.height;labels[i]=codes[f.group];}
      }
    }
  }
  return {heights,labels,w,h};
}
export function surfaceTile(surface,tile,settings) {
  const nx=(surface.w-1)/settings.cols,ny=(surface.h-1)/settings.rows;
  const data=new Float32Array((nx+1)*(ny+1)),colors=new Uint8Array(data.length);
  for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++){
    const sourceRow=tile.row*ny+ny-y,sourceCol=tile.col*nx+x,i=sourceRow*surface.w+sourceCol,j=y*(nx+1)+x;
    data[j]=surface.heights[i];colors[j]=surface.labels[i];
  }
  return [{...heightMesh(data,nx+1,ny+1,tile.width,tile.height),group:'terrain',labels:colors}];
}
export function fullSurface(surface,settings) {
  const flipped=new Float32Array(surface.heights.length),labels=new Uint8Array(surface.labels.length);
  for(let row=0;row<surface.h;row++){const at=(surface.h-1-row)*surface.w;flipped.set(surface.heights.subarray(row*surface.w,(row+1)*surface.w),at);labels.set(surface.labels.subarray(row*surface.w,(row+1)*surface.w),at);}
  return {...heightMesh(flipped,surface.w,surface.h,settings.width,settings.height),group:'terrain',labels};
}
export function mergeSolids(wasm,objects) {
  const owned=[];
  try {
    const solids=objects.map(o=>{const s=toNative(wasm,o);owned.push(s);const moved=s.translate(o.offset||[0,0,0]);owned.push(moved);return moved;});
    const merged=wasm.Manifold.union(solids);owned.push(merged);return toPlain(merged);
  }finally{for(const o of owned.reverse())o.delete();}
}
export function trackInsert(wasm,objects,polygons,tile,settings) {
  const {CrossSection,Manifold}=wasm,owned=[],own=o=>(owned.push(o),o);
  try {
    const clip=own(own(CrossSection.square([tile.width,tile.height])).translate([tile.x,tile.y]));
    const parts=polygons.map(p=>own(new CrossSection(p.map(r=>r.slice(0,-1)),'EvenOdd')));
    const footprint=own(own(CrossSection.union(parts)).intersect(clip));
    if(footprint.isEmpty())return objects;
    const local=own(footprint.translate([-tile.x,-tile.y]));
    const pocket=own(own(local.offset(settings.trackClearance,'Round')).intersect(own(CrossSection.square([tile.width,tile.height]))));
    const floor=settings.base+settings.trackFloor;
    let height=1;for(const object of objects)for(let i=2;i<object.vertices.length;i+=3)height=Math.max(height,object.vertices[i]-floor+1);
    const cutter=own(own(pocket.extrude(height)).translate([0,0,floor]));
    const solid=own(Manifold.union(objects.map(o=>own(toNative(wasm,o)))));
    const terrain=own(solid.subtract(cutter));
    const column=own(own(local.extrude(height)).translate([0,0,floor]));
    const insert=own(solid.intersect(column));
    if(insert.isEmpty())return objects;
    return [{...toPlain(terrain),group:'terrain'},{...toPlain(insert),group:'track'}];
  }finally{for(const o of owned.reverse())o.delete();}
}
