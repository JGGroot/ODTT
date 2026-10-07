import buffer from '@turf/buffer';
import { lineString, polygon } from '@turf/helpers';
import { dimensions, geometryBounds, project, pointInRing } from './geo.js';
import { request, pause } from './network.js';
const endpoints=['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter'];
async function osmStorage(b,data){try{const cache=await caches.open('oddt-osm-v1'),key=new URL('./cache/osm?'+new URLSearchParams(b),location.href).href;if(data){await cache.put(key,new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','X-ODDT-Cached':String(Date.now())}}));return data;}const hit=await cache.match(key);if(hit&&Date.now()-Number(hit.headers.get('X-ODDT-Cached'))<86400000)return hit.json();}catch{}return null;}
export async function fetchOSM(bounds, signal, report=()=>{}) {
  const cached=await osmStorage(bounds);if(cached){report('Using cached OSM');return cached;}
  const b=`${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const selectors=['building','building:part','highway','waterway','railway','aeroway'];
  const q=`[out:json][timeout:35];(${selectors.map(t=>`way["${t}"](${b});relation["${t}"](${b});`).join('')}nwr["natural"~"water|wood|grassland|scrub|heath"](${b});nwr["landuse"~"forest|grass|meadow|farmland|orchard"](${b});nwr["leisure"~"park|garden|golf_course|pitch"](${b}););out body geom;`;
  const errors=[];
  for(let i=0;i<endpoints.length;i++) {
    signal?.throwIfAborted();report(`Fetching OSM · ${i+1}/${endpoints.length}`);
    try {
      const r=await request(endpoints[i],{method:'POST',headers:{Accept:'application/json'},body:new URLSearchParams({data:q}),signal,timeout:45000});
      const data=await r.json();
      if(data.remark)throw new Error(data.remark);
      if(!Array.isArray(data.elements))throw new Error('OSM response is incomplete.');
      await osmStorage(bounds,data);return data;
    } catch(e) {if(signal?.aborted)throw e;errors.push(e.message);if(i<endpoints.length-1&&[406,429].includes(e.status)){report('OSM service busy · retry in 30 s');await pause(30000,signal);}}
  }
  if((bounds.north-bounds.south)*(bounds.east-bounds.west)<=.01){
    report('Fetching OSM · small-area fallback');
    try{return await fetchMapXML(bounds,signal);}catch(e){if(signal?.aborted)throw e;errors.push(e.message);}
  }
  throw new Error(`OSM unavailable. Import an OSM file, choose a smaller area, or retry later. ${errors.join(' ')}`);
}
export function parseOSM(text){
  if(text.trim().startsWith('{')){const data=JSON.parse(text);if(!Array.isArray(data.elements))throw new Error('Choose an Overpass JSON or OSM XML file.');if(data.remark)throw new Error(data.remark);return data;}
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(doc.querySelector('parsererror')||!doc.querySelector('osm'))throw new Error('Choose an Overpass JSON or OSM XML file.');
  const elements=[...doc.querySelectorAll('osm > node, osm > way, osm > relation')].map(e=>{
    const out={type:e.tagName,id:Number(e.getAttribute('id')),tags:Object.fromEntries([...e.querySelectorAll('tag')].map(t=>[t.getAttribute('k'),t.getAttribute('v')]))};
    if(out.type==='node'){out.lat=Number(e.getAttribute('lat'));out.lon=Number(e.getAttribute('lon'));}
    if(out.type==='way')out.nodes=[...e.querySelectorAll('nd')].map(n=>Number(n.getAttribute('ref')));
    if(out.type==='relation')out.members=[...e.querySelectorAll('member')].map(m=>({type:m.getAttribute('type'),ref:Number(m.getAttribute('ref')),role:m.getAttribute('role')||''}));
    return out;
  });return {elements};
}
export async function fetchMapXML(b,signal){
  if((b.north-b.south)*(b.east-b.west)>.01)throw new Error('Small-area OSM downloads require a smaller selection. Use Overpass or import a file.');
  const cached=await osmStorage(b);if(cached)return cached;
  const response=await request('https://api.openstreetmap.org/api/0.6/map?'+new URLSearchParams({bbox:[b.west,b.south,b.east,b.north].join(',')}),{signal,timeout:30000});
  const data=parseOSM(await response.text());await osmStorage(b,data);return data;
}
const same=(a,b)=>Math.abs(a[0]-b[0])<1e-8&&Math.abs(a[1]-b[1])<1e-8;
const coord=g=>(g||[]).filter(p=>Number.isFinite(p.lon)&&Number.isFinite(p.lat)).map(p=>[p.lon,p.lat]);
export function joinRings(segments) {
  const remaining=segments.filter(s=>s.length>1).map(s=>s.slice()),rings=[];
  while(remaining.length) {
    const ring=remaining.pop();let joined=true;
    while(!same(ring[0],ring.at(-1))&&joined) {
      joined=false;
      for(let i=0;i<remaining.length;i++) {
        let s=remaining[i];
        if(same(ring.at(-1),s.at(-1)))s=s.slice().reverse();
        if(same(ring.at(-1),s[0])){ring.push(...s.slice(1));remaining.splice(i,1);joined=true;break;}
        if(same(ring[0],s[0]))s=s.slice().reverse();
        if(same(ring[0],s.at(-1))){ring.unshift(...s.slice(0,-1));remaining.splice(i,1);joined=true;break;}
      }
    }
    if(ring.length>=4&&same(ring[0],ring.at(-1)))rings.push(ring);
  }
  return rings;
}
function classify(t) {
  if(t.building||t['building:part'])return 'buildings';
  if(t.aeroway&&['runway','taxiway','apron','helipad'].includes(t.aeroway))return 'runways';
  if(t.highway)return 'roads';
  if(t.railway&&['rail','light_rail','tram','narrow_gauge'].includes(t.railway))return 'railways';
  if(t.waterway||t.natural==='water'||t.landuse==='reservoir')return 'water';
  if(['wood','grassland','scrub','heath'].includes(t.natural)||['forest','grass','meadow','farmland','orchard'].includes(t.landuse)||['park','garden','golf_course','pitch'].includes(t.leisure))return 'greenery';
  return null;
}
const roadWidths={motorway:16,trunk:14,primary:12,secondary:10,tertiary:8,residential:6,service:4,track:3,path:1.5,footway:1.5,cycleway:2};
function physicalHeight(tags) {
  const explicit=parseFloat(tags.height||tags['building:height']);if(explicit>0)return explicit;
  const levels=parseFloat(tags['building:levels']);if(levels>0)return levels*3.1+1.5;
  const types={church:18,cathedral:30,hangar:12,tower:25,apartments:15,industrial:10,warehouse:10,garage:3,shed:3};
  return types[tags.building]||7;
}
export function osmFeatures(data,bounds,settings) {
  const nodes=new Map(data.elements.filter(e=>e.type==='node').map(e=>[e.id,e]));
  const ways=new Map(data.elements.filter(e=>e.type==='way').map(e=>[e.id,e]));
  const wayGeometry=w=>coord(w.geometry||w.nodes?.map(id=>nodes.get(id)).filter(Boolean));
  const features=[],consumed=new Set();
  const add=(tags,geo,id)=>{
    const group=classify(tags);if(!group||settings.layers?.[group]===false)return;
    let polygons=[];
    if(geo.type==='LineString'){
      if(geo.coordinates.length<2)return;
      let width=parseFloat(tags.width);
      if(!(width>0))width=group==='runways'?(tags.aeroway==='runway'?45:18):group==='water'?5:group==='railways'?2.5:roadWidths[tags.highway]||5;
      width*=settings.roadWidth||1;
      const buffered=buffer(lineString(geo.coordinates),width/2000,{units:'kilometers',steps:5});
      if(!buffered)return;geo=buffered.geometry;
    }
    if(geo.type==='Polygon')polygons=[geo.coordinates];else if(geo.type==='MultiPolygon')polygons=geo.coordinates;else return;
    polygons=polygons.map(p=>p.map(r=>r.map(([lon,lat])=>project(lon,lat,bounds,settings.width))));
    const meters=physicalHeight(tags),scale=dimensions(bounds,settings.width).scale;
    const height=group==='buildings'?(settings.trueScale?meters*scale*settings.buildingScale:Math.min(1,meters/60)*settings.buildingHeight*settings.buildingScale):group==='roads'?settings.roadHeight:group==='runways'?settings.roadHeight:group==='railways'?settings.roadHeight:group==='greenery'?settings.greenHeight:settings.waterHeight;
    features.push({id,group,polygons,bounds:geometryBounds(polygons),height:Math.max(.01,height),meters});
  };
  for(const e of data.elements) if(e.type==='relation'&&classify(e.tags||{})) {
    const outer=[],inner=[];
    for(const member of e.members||[])if(member.type==='way'){
      const w=ways.get(member.ref),g=coord(member.geometry||w?.geometry)||[];
      if(!g.length&&w)g.push(...wayGeometry(w));
      (member.role==='inner'?inner:outer).push(g);
    }
    const outs=joinRings(outer),holes=joinRings(inner);
    const polys=outs.map(r=>[r,...holes.filter(h=>pointInRing(h[0][0],h[0][1],r))]);
    if(polys.length){add(e.tags,{type:'MultiPolygon',coordinates:polys},e.id);for(const m of e.members||[])if(m.type==='way')consumed.add(m.ref);}
  }
  for(const e of ways.values()) {
    if(consumed.has(e.id))continue;const tags=e.tags||{},group=classify(tags);if(!group)continue;
    const g=wayGeometry(e);if(g.length<2)continue;
    const closed=g.length>=4&&same(g[0],g.at(-1));
    const area=closed&&(group==='buildings'||group==='greenery'||tags.area==='yes'||tags.natural==='water'||['apron','helipad'].includes(tags.aeroway));
    add(tags,{type:area?'Polygon':'LineString',coordinates:area?[g]:g},e.id);
  }
  return features;
}
