// Shared by preview and export. Cutoffs are percentages of the whole model's
// relief, so adjacent tiles always use the same material boundaries.
export const TERRAIN_STOPS=[
  {name:'Forest',color:'#35633d',at:0},
  {name:'Grass',color:'#809a48',at:25},
  {name:'Earth',color:'#98704c',at:50},
  {name:'Rock',color:'#868a8d',at:72},
  {name:'Snow',color:'#f1f4f5',at:88}
];
export const TERRAIN_LOOKS={
  natural:{name:'Natural',water:'#2f6f9f',colors:['#35633d','#809a48','#98704c','#868a8d','#f1f4f5']},
  alpine:{name:'Alpine',water:'#3d7ea6',colors:['#365b42','#83905b','#a08a6b','#858b90','#f4f6f6']},
  lush:{name:'Lush',water:'#2a7594',colors:['#254c37','#517a42','#8b985d','#817968','#a8aaa0']},
  desert:{name:'Desert',water:'#4e8f9a',colors:['#9b7747','#c8aa68','#b67c50','#8c7565','#dfc8a0']},
  volcanic:{name:'Volcanic',water:'#3a6d78',colors:['#3c5940','#657847','#756356','#56575b','#a2a0a0']}
};
// Resolve once from the entire land surface, before tiling. Quantiles prevent a
// tiny high peak or a large flat ocean from crowding all colors into one band.
export function proceduralTerrainColors(s,surface,elevation={}) {
  if(s.colorAutomatic===false)return s;
  const look=TERRAIN_LOOKS[s.colorLook]||TERRAIN_LOOKS.natural;
  const samples=[];let max=s.base;
  for(let i=0;i<surface.heights.length;i++){
    if(surface.labels?.[i]===1)continue;
    const z=surface.heights[i];if(Number.isFinite(z)){samples.push(z);max=Math.max(max,z);}
  }
  samples.sort((a,b)=>a-b);const span=Math.max(.00001,max-s.base);
  const quantiles=[0,.3,.62,.82,.95];let previous=0;
  const stops=TERRAIN_STOPS.map((p,i)=>{
    const z=samples[Math.floor((samples.length-1)*quantiles[i])]??s.base;
    // Keep thresholds ordered on flat or plateau-heavy terrain.
    const at=i?Math.min(95+i,Math.max(previous+1,(z-s.base)/span*100)):0;previous=at;
    return {...p,color:look.colors[i],at};
  });
  if(s.colorLook==='natural'||!s.colorLook){
    // Heightmaps have no measured altitude: their chosen look is artistic.
    // Low geographic terrain should not get a white cap just for being tallest.
    const snow=elevation.source==='image'||(Number.isFinite(elevation.max)&&elevation.max>=1800);
    if(!snow){stops[4]={...stops[4],name:'High rock',color:'#b1b3ad'};}
  }
  if(s.colorLook==='desert')stops[4].name='Pale sandstone';
  if(s.colorLook==='lush')stops[4].name='High rock';
  if(s.colorLook==='volcanic')stops[4].name='Ash';
  return {...s,colorStops:stops,colorMaxZ:max,rockSlope:s.rockSlope??38};
}
// Smooth, deterministic value noise in model-wide XY coordinates. Never use
// tile-local randomness: it would make visible seams between adjacent tiles.
function terrainVariation(x,y,scale) {
  x/=scale;y/=scale;const ix=Math.floor(x),iy=Math.floor(y);
  const smooth=t=>t*t*(3-2*t),fx=smooth(x-ix),fy=smooth(y-iy);
  const hash=(a,b)=>{const v=Math.sin(a*127.1+b*311.7)*43758.5453;return v-Math.floor(v);};
  return ((hash(ix,iy)*(1-fx)+hash(ix+1,iy)*fx)*(1-fy)+(hash(ix,iy+1)*(1-fx)+hash(ix+1,iy+1)*fx)*fy)*2-1;
}
export const FEATURE_NAMES=['terrain','water','greenery','roads','runways','railways','buildings'];
export function validateTerrainColors(s) {
  if(!['off','realistic','cutoffs','gradient'].includes(s.colorMode))throw new Error('Choose a terrain color mode.');
  const stops=s.colorStops;
  if(!Array.isArray(stops)||stops.length!==5||stops[0].at!==0||stops.some((p,i)=>!/^#[\da-f]{6}$/i.test(p.color)||!Number.isFinite(p.at)||p.at<0||p.at>=100||(i&&p.at<=stops[i-1].at)))throw new Error('Color heights must increase from 0 to below 100% of relief.');
  if(s.colorWater&&!/^#[\da-f]{6}$/i.test(s.colorWater))throw new Error('Check water color.');
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
  const baseCut=s.hasOcean&&s.flattenOcean?Math.max(layer,Math.round(s.base/layer)*layer):0;
  return terrainPalette(s).map((p,i)=>{
    if(!i)return baseCut;
    const raw=s.base+span*p.at/100;
    return Math.max(baseCut+layer*i,Math.round(raw/layer)*layer);
  });
}
export function paintTerrain(objects,s,origin=[0,0]) {
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
      const z=p.reduce((v,q)=>v+q[2],0)/3;
      let percent=Math.max(0,Math.min(100,(z-s.base)/span*100));
      if(s.colorMode==='realistic'&&s.colorAutomatic!==false&&z>s.base){
        const x=origin[0]+p.reduce((v,q)=>v+q[0],0)/3,y=origin[1]+p.reduce((v,q)=>v+q[1],0)/3;
        const scale=Math.max(s.width||1,s.height||1)*.16;
        percent+=terrainVariation(x,y,scale)*7+terrainVariation(x,y,scale*.4)*2;
      }
      let code=0;for(let k=1;k<palette.length;k++)if(percent>=palette[k].at)code=k;
      if(s.colorMode==='realistic'){
        const a=p[1].map((v,k)=>v-p[0][k]),b=p[2].map((v,k)=>v-p[0][k]);
        const nz=a[0]*b[1]-a[1]*b[0],nx=a[1]*b[2]-a[2]*b[1],ny=a[2]*b[0]-a[0]*b[2];
        const slope=Math.atan2(Math.hypot(nx,ny)/Math.max(.000001,s.colorZToXY||1),Math.abs(nz))*180/Math.PI;
        if(nz>0&&slope>=(s.rockSlope||38))code=3;
      }
      const labels=ids.map(i=>o.labels?.[i]||0),label=labels[1]===labels[2]?labels[1]:labels[0];
      if(label){if(!featureIndex.has(label)){const material={name:FEATURE_NAMES[label],feature:FEATURE_NAMES[label]};if(label===1)material.color=s.colorWater||'#2f6f9f';featureIndex.set(label,materials.length);materials.push(material);}code=featureIndex.get(label);}
      faceMaterials[j/3]=code;
    }
    return {...o,materials,faceMaterials};
  });
}
