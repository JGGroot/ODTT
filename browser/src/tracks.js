import buffer from '@turf/buffer';
import { lineString } from '@turf/helpers';
import { project, validateBounds, bilinear, pointInPolygon, geometryBounds } from './geo.js';

export function parseTrack(text,filename='track.kml') {
  let segments=[];
  if(/\.(geojson|json)$/i.test(filename)) {
    const data=JSON.parse(text);
    const read=g=>{if(!g)return;if(g.type==='FeatureCollection')g.features.forEach(read);else if(g.type==='Feature')read(g.geometry);else if(g.type==='LineString')segments.push(g.coordinates);else if(g.type==='MultiLineString')segments.push(...g.coordinates);else if(g.type==='GeometryCollection')g.geometries.forEach(read);};read(data);
  }else {
    const doc=new DOMParser().parseFromString(text,'application/xml');
    if(doc.getElementsByTagName('parsererror').length)throw new Error('The track file contains invalid XML.');
    const nodes=(root,name)=>Array.from(root.getElementsByTagNameNS('*',name));
    for(const line of nodes(doc,'LineString'))for(const coordinates of nodes(line,'coordinates'))segments.push(coordinates.textContent.trim().split(/\s+/).map(s=>s.split(',').map(Number)));
    for(const track of nodes(doc,'Track')) {const coords=nodes(track,'coord');if(coords.length)segments.push(coords.map(e=>e.textContent.trim().split(/\s+/).map(Number)));}
    for(const segment of nodes(doc,'trkseg'))segments.push(nodes(segment,'trkpt').map(e=>[Number(e.getAttribute('lon')),Number(e.getAttribute('lat'))]));
    for(const route of nodes(doc,'rte'))segments.push(nodes(route,'rtept').map(e=>[Number(e.getAttribute('lon')),Number(e.getAttribute('lat'))]));
    for(const track of nodes(doc,'Track')) {const points=nodes(track,'Trackpoint');if(points.length){let part=[];for(const point of points){const lat=nodes(point,'LatitudeDegrees')[0],lon=nodes(point,'LongitudeDegrees')[0];if(lat&&lon)part.push([Number(lon.textContent),Number(lat.textContent)]);else {if(part.length>1)segments.push(part);part=[];}}if(part.length>1)segments.push(part);}}
  }
  let count=0;
  segments=segments.map(segment=>{const out=[];for(const p of segment){if(p.length<2||!p.slice(0,2).every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>85)throw new Error('Track coordinates must be valid longitude / latitude.');const last=out.at(-1);if(!last||p[0]!==last[0]||p[1]!==last[1])out.push(p.slice(0,2));}count+=out.length;return out;}).filter(s=>s.length>1);
  if(!segments.length)throw new Error('No GPS track found. Choose KML, GPX, TCX or GeoJSON with track coordinates.');
  if(count>200000)throw new Error('Track exceeds 200,000 points. Export a shorter activity.');
  let west=180,east=-180,south=90,north=-90;for(const segment of segments)for(const [lon,lat] of segment){west=Math.min(west,lon);east=Math.max(east,lon);south=Math.min(south,lat);north=Math.max(north,lat);}
  const pad=Math.max(.0002,Math.max(east-west,north-south)*.04);
  return {segments,count,bounds:validateBounds({west:west-pad,east:east+pad,south:south-pad,north:north+pad})};
}
// Simplify in print space, preserving separate activity segments and endpoints.
export function simplifyLine(points,tolerance=.08) {
  if(points.length<3)return points;
  const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]],sq=tolerance*tolerance;
  while(stack.length){const [a,b]=stack.pop(),p=points[a],q=points[b],dx=q[0]-p[0],dy=q[1]-p[1],length=dx*dx+dy*dy;let max=sq,index=-1;
    for(let i=a+1;i<b;i++){const r=points[i],t=length?Math.max(0,Math.min(1,((r[0]-p[0])*dx+(r[1]-p[1])*dy)/length)):0,d=(r[0]-p[0]-t*dx)**2+(r[1]-p[1]-t*dy)**2;if(d>max){max=d;index=i;}}
    if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}}
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}
export function trackPolygons(track,b,settings) {
  const polygons=[];
  for(const segment of track.segments){const points=simplifyLine(segment.map(([lon,lat])=>project(lon,lat,b,settings.width)));
    // Turf's spherical buffer uses metres; print-space points are mapped to a
    // small patch at the equator to make the requested width independent of latitude.
    const line=points.map(([x,y])=>[x/111320,y/111320]);
    const shape=buffer(lineString(line),settings.trackWidth/2,{units:'meters',steps:6});
    if(!shape)continue;const parts=shape.geometry.type==='Polygon'?[shape.geometry.coordinates]:shape.geometry.coordinates;
    polygons.push(...parts.map(rings=>rings.map(r=>r.map(([x,y])=>[x*111320,y*111320]))));
  }
  return polygons;
}

export function insertFloor(surface,polygons,settings) {
  let top=Infinity;
  for(const polygon of polygons){
    for(const ring of polygon)for(const [x,y] of ring)if(x>=0&&x<=settings.width&&y>=0&&y<=settings.height)top=Math.min(top,bilinear(surface.heights,surface.w,surface.h,x/settings.width*(surface.w-1),(1-y/settings.height)*(surface.h-1)));
    const box=geometryBounds([polygon]),x0=Math.max(0,Math.floor(box[0]/settings.width*(surface.w-1))),x1=Math.min(surface.w-1,Math.ceil(box[2]/settings.width*(surface.w-1))),y0=Math.max(0,Math.floor((1-box[3]/settings.height)*(surface.h-1))),y1=Math.min(surface.h-1,Math.ceil((1-box[1]/settings.height)*(surface.h-1)));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(pointInPolygon(x/(surface.w-1)*settings.width,(1-y/(surface.h-1))*settings.height,polygon))top=Math.min(top,surface.heights[y*surface.w+x]);
  }
  if(!Number.isFinite(top))throw new Error('The GPS track is outside the selected area.');
  if(top<1.6)throw new Error('Increase the base to at least 2 mm to support the track insert.');
  return Math.max(.4,Math.min(settings.base+4,top-1.2))-settings.base;
}
