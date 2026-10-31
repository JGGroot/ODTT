// Shared by preview and export. Cutoffs are percentages of the whole model's
// relief, so adjacent tiles always use the same material boundaries.
export const TERRAIN_STOPS=[
  {name:'Forest',color:'#35633d',at:0},
  {name:'Grass',color:'#809a48',at:25},
  {name:'Earth',color:'#98704c',at:50},
  {name:'Rock',color:'#868a8d',at:72},
  {name:'Snow',color:'#f1f4f5',at:88}
];
export const FEATURE_NAMES=['terrain','water','greenery','roads','runways','railways','buildings'];
export function validateTerrainColors(s) {
  if(!['off','realistic','cutoffs','gradient'].includes(s.colorMode))throw new Error('Choose a terrain color mode.');
  const stops=s.colorStops;
  if(!Array.isArray(stops)||stops.length!==5||stops[0].at!==0||stops.some((p,i)=>!/^#[\da-f]{6}$/i.test(p.color)||!Number.isFinite(p.at)||p.at<0||p.at>=100||(i&&p.at<=stops[i-1].at)))throw new Error('Color heights must increase from 0 to below 100% of relief.');
  if(s.rockSlope!==undefined&&!(s.rockSlope>=1&&s.rockSlope<=89))throw new Error('Rock slope must be between 1 and 89 degrees.');
  if(s.colorSteps!==undefined&&![4,8,16].includes(s.colorSteps))throw new Error('Choose 4, 8 or 16 gradient materials.');
  if(!(s.colorLayerHeight>=.05&&s.colorLayerHeight<=1))throw new Error('Print layer height must be between 0.05 and 1 mm.');
}
const mix=(a,b,t)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
export function terrainPalette(s) {
  const stops=s.colorStops||TERRAIN_STOPS;
  if(s.colorMode!=='gradient')return stops;
  // A finite palette remains assignable to actual filaments in a slicer.
  const count=s.colorSteps||8;
  return Array.from({length:count},(_,i)=>{
    const at=i*100/(count-1);let k=0;while(k<stops.length-2&&at>stops[k+1].at)k++;
    return {name:`Gradient ${i+1}`,at,color:mix(stops[k].color,stops[k+1].color,Math.min(1,(at-stops[k].at)/(stops[k+1].at-stops[k].at)))};
  });
}
export function cutoffHeights(s) {
  const span=Math.max(0,(s.colorMaxZ??s.base)-s.base),layer=s.colorLayerHeight||.2;
  return terrainPalette(s).map((p,i)=>i?Math.max(layer,Math.round((s.base+span*p.at/100)/layer)*layer):0);
}
export function paintTerrain(objects,s) {
  if(!s.colorMode||s.colorMode==='off'||s.colorMode==='cutoffs')return objects;
  const palette=terrainPalette(s),span=Math.max(.00001,s.colorMaxZ-s.base);
  return objects.map(o=>{
    if(o.group!=='terrain')return o;
    const materials=palette.map(p=>({...p})),faceMaterials=new Uint16Array(o.indices.length/3);
    // Keep OSM/ocean colors on original feature faces. Track booleans discard
    // feature labels; the dedicated track object keeps its own material.
    const featureIndex=new Map();
    for(let j=0;j<o.indices.length;j+=3){
      const ids=Array.from(o.indices.subarray(j,j+3)),p=ids.map(i=>Array.from(o.vertices.subarray(i*3,i*3+3)));
      const z=p.reduce((v,q)=>v+q[2],0)/3,percent=Math.max(0,Math.min(100,(z-s.base)/span*100));
      let code=0;for(let k=1;k<palette.length;k++)if(percent>=palette[k].at)code=k;
      if(s.colorMode==='realistic'){
        const a=p[1].map((v,k)=>v-p[0][k]),b=p[2].map((v,k)=>v-p[0][k]);
        const nz=a[0]*b[1]-a[1]*b[0],nx=a[1]*b[2]-a[2]*b[1],ny=a[2]*b[0]-a[0]*b[2];
        const slope=Math.atan2(Math.hypot(nx,ny)/Math.max(.000001,s.colorZToXY||1),Math.abs(nz))*180/Math.PI;
        if(nz>0&&slope>=(s.rockSlope||38))code=3;
      }
      const labels=ids.map(i=>o.labels?.[i]||0),label=labels[1]===labels[2]?labels[1]:labels[0];
      if(label){if(!featureIndex.has(label)){featureIndex.set(label,materials.length);materials.push({name:FEATURE_NAMES[label],feature:FEATURE_NAMES[label]});}code=featureIndex.get(label);}
      faceMaterials[j/3]=code;
    }
    return {...o,materials,faceMaterials};
  });
}
