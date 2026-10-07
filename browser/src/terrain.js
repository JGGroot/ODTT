import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import { gunzipSync } from 'fflate';
import { bilinear, dimensions } from './geo.js';
import { request, pooled } from './network.js';
proj4.defs('EPSG:27700','+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.060,0.1502,0.2470,0.8421,-20.4894 +units=m +no_defs');
export const SOURCES=[
  {id:'auto',name:'Automatic',detail:'Best available regional source',url:'https://registry.opendata.aws/terrain-tiles/'},
  {id:'ea',name:'Environment Agency',detail:'England · 1 m DTM',resolution:1,url:'https://environment.data.gov.uk/survey'},
  {id:'usgs',name:'USGS 3DEP',detail:'United States · 1–30 m DTM',resolution:1,url:'https://www.usgs.gov/3d-elevation-program'},
  {id:'gsi1',name:'GSI LiDAR',detail:'Japan · 1 m where available',resolution:1,url:'https://maps.gsi.go.jp/development/hyokochi.html'},
  {id:'gsi5',name:'GSI elevation',detail:'Japan · 5 m; 10 m fallback',resolution:5,url:'https://maps.gsi.go.jp/development/hyokochi.html'},
  {id:'mapzen',name:'Mapzen Terrain Tiles',detail:'Global · variable native resolution',resolution:30,url:'https://registry.opendata.aws/terrain-tiles/'},
  {id:'srtm',name:'Skadi elevation grid',detail:'Global · ~30 m at the equator',resolution:30,url:'https://github.com/tilezen/joerd/tree/master/docs'},
  {id:'file',name:'GeoTIFF / heightmap',detail:'Local file · native resolution',url:'https://www.usgs.gov/3d-elevation-program'}
];
const eaURL='https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs';
const usgsURL='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
export function autoSource(b) {
  const lat=(b.north+b.south)/2,lon=(b.east+b.west)/2;
  if(lat>49.85&&lat<55.85&&lon>-6.5&&lon<2)return 'ea';
  if(lat>24&&lat<46&&lon>122&&lon<146)return 'gsi1';
  if((lat>24&&lat<50&&lon>-126&&lon<-66)||(lat>51&&lat<72&&lon>-170&&lon<-130)||(lat>18&&lat<23&&lon>-161&&lon<-154))return 'usgs';
  return 'mapzen';
}
function projection(image) {
  const keys=image.getGeoKeys();const epsg=keys.ProjectedCSTypeGeoKey||keys.GeographicTypeGeoKey||4326;
  const name=`EPSG:${epsg}`;
  if(epsg>=32601&&epsg<=32660)proj4.defs(name,`+proj=utm +zone=${epsg-32600} +datum=WGS84 +units=m`);
  if(epsg>=32701&&epsg<=32760)proj4.defs(name,`+proj=utm +zone=${epsg-32700} +south +datum=WGS84 +units=m`);
  if(epsg===4269)proj4.defs(name,'+proj=longlat +datum=NAD83 +no_defs');
  if(!proj4.defs(name))throw new Error(`GeoTIFF projection EPSG:${epsg} is unsupported. Reproject to EPSG:4326, 3857, 27700 or WGS84 UTM.`);
  return name;
}
export async function inspectTIFF(buffer) {
  const tiff=await fromArrayBuffer(buffer), image=await tiff.getImage(),crs=projection(image),box=image.getBoundingBox();
  const corners=[[box[0],box[1]],[box[0],box[3]],[box[2],box[1]],[box[2],box[3]]].map(p=>proj4(crs,'EPSG:4326',p));
  return {bounds:{west:Math.min(...corners.map(p=>p[0])),east:Math.max(...corners.map(p=>p[0])),south:Math.min(...corners.map(p=>p[1])),north:Math.max(...corners.map(p=>p[1]))},crs,width:image.getWidth(),height:image.getHeight()};
}
export async function tiffGrid(buffer,b,w,h,signal) {
  signal?.throwIfAborted();
  const tiff=await fromArrayBuffer(buffer),image=await tiff.getImage(),crs=projection(image),box=image.getBoundingBox();
  const corners=[[b.west,b.south],[b.east,b.south],[b.west,b.north],[b.east,b.north]].map(p=>proj4('EPSG:4326',crs,p));
  const crop=[Math.max(box[0],Math.min(...corners.map(p=>p[0]))),Math.max(box[1],Math.min(...corners.map(p=>p[1]))),Math.min(box[2],Math.max(...corners.map(p=>p[0]))),Math.min(box[3],Math.max(...corners.map(p=>p[1])))];
  if(crop[0]>=crop[2]||crop[1]>=crop[3])throw new Error('Selected area is outside the GeoTIFF.');
  const rw=Math.min(4096,Math.max(w+4,64)),rh=Math.min(4096,Math.max(h+4,64));
  // Preserve no-data sentinels during coarse reads; interpolate only after
  // masking them, so gaps cannot turn into extreme artificial elevations.
  const rasters=await tiff.readRasters({bbox:crop,width:rw,height:rh,samples:[0],resampleMethod:'nearest'}),data=Float32Array.from(rasters[0]);
  const nodata=image.getGDALNoData();
  for(let i=0;i<data.length;i++)if(!Number.isFinite(data[i])||data[i]===nodata||Math.abs(data[i])>20000)data[i]=NaN;
  const out=new Float32Array(w*h);
  for(let row=0;row<h;row++)for(let col=0;col<w;col++) {
    const lon=b.west+col/(w-1)*(b.east-b.west),lat=b.north-row/(h-1)*(b.north-b.south),p=proj4('EPSG:4326',crs,[lon,lat]);
    out[row*w+col]=(p[0]<crop[0]||p[0]>crop[2]||p[1]<crop[1]||p[1]>crop[3])?NaN:bilinear(data,rw,rh,(p[0]-crop[0])/(crop[2]-crop[0])*rw-.5,(crop[3]-p[1])/(crop[3]-crop[1])*rh-.5);
  }
  return out;
}
function worldPixel(lon,lat,z){const n=256*2**z;return [(lon+180)/360*n,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n];}
async function imageData(url,signal) {
  let blob;
  let cached,existing;try{cached=await caches.open('oddt-elevation-v1');existing=await cached.match(url);}catch{}
  if(existing)blob=await existing.blob();else {const r=await request(url,{signal,timeout:30000});if(cached)try{await cached.put(url,r.clone());}catch{}blob=await r.blob();}
  const image=await createImageBitmap(blob);const canvas=new OffscreenCanvas(image.width,image.height);const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);image.close();return ctx.getImageData(0,0,canvas.width,canvas.height);
}
export function decodeElevation(r,g,b,kind) {
  if(kind==='terrarium')return r===0&&g===0&&b===0?NaN:r*256+g+b/256-32768;
  const v=r*65536+g*256+b;return v===8388608?NaN:(v<8388608?v:v-16777216)*.01;
}
async function tileGrid(id,b,w,h,signal,report,zoomLimit=Infinity) {
  const maxZ=Math.min(zoomLimit,id==='gsi1'?17:15);
  let z=maxZ;let first,last,keys;
  while(z>=0) {
    first=worldPixel(b.west,b.north,z);last=worldPixel(b.east,b.south,z);
    keys=[];for(let y=Math.floor(first[1]/256);y<=Math.floor(last[1]/256);y++)for(let x=Math.floor(first[0]/256);x<=Math.floor(last[0]/256);x++)keys.push([x,y]);
    if(keys.length<=64)break;z--;
  }
  // Avoid downloading details finer than the model's requested sample grid.
  while(z>0&&(last[0]-first[0])>w*2&&(last[1]-first[1])>h*2){z--;first=worldPixel(b.west,b.north,z);last=worldPixel(b.east,b.south,z);}
  keys=[];for(let y=Math.floor(first[1]/256);y<=Math.floor(last[1]/256);y++)for(let x=Math.floor(first[0]/256);x<=Math.floor(last[0]/256);x++)keys.push([x,y]);
  const tiles=new Map();let done=0;const used=new Set();
  await pooled(keys,4,async([x,y])=>{
    const choices=id==='mapzen'?['terrarium']:id==='gsi1'?['dem1a_png']:['dem5a_png','dem5b_png','dem5c_png','dem_png'];
    const candidates=[];
    for(const kind of choices) {
      const tz=Math.min(z,kind==='dem_png'?14:z),ratio=2**(z-tz),tx=Math.floor(x/ratio),ty=Math.floor(y/ratio);
      const url=kind==='terrarium'?`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`:`https://cyberjapandata.gsi.go.jp/xyz/${kind}/${tz}/${tx}/${ty}.png`;
      try {const image=await imageData(url,signal);candidates.push({image,kind,ratio,ox:(x/ratio-tx)*256,oy:(y/ratio-ty)*256});used.add(kind);if(kind==='terrarium')break;}
      catch(e){if(signal?.aborted)throw e;if(e.status!==404)throw e;}
    }
    if(!candidates.length)throw new Error(`${id==='gsi1'?'GSI 1 m LiDAR':'Elevation tiles'} do not cover this area. Choose another source.`);
    tiles.set(`${x},${y}`,candidates);report(`Elevation tiles · ${++done}/${keys.length}`);
  },signal);
  const sample=(wx,wy)=>{
    const x=Math.floor(wx/256),y=Math.floor(wy/256),tx=((wx%256)+256)%256,ty=((wy%256)+256)%256;
    for(const c of tiles.get(`${x},${y}`)||[]) {
      const px=Math.min(255,Math.max(0,Math.floor(c.ox+tx/c.ratio))),py=Math.min(255,Math.max(0,Math.floor(c.oy+ty/c.ratio))),i=(py*256+px)*4,d=c.image.data;
      const value=d[i+3]?decodeElevation(d[i],d[i+1],d[i+2],c.kind):NaN;if(Number.isFinite(value))return value;
    }return NaN;
  };
  const grid=new Float32Array(w*h);
  for(let row=0;row<h;row++)for(let col=0;col<w;col++) {
    const [wx,wy]=worldPixel(b.west+col/(w-1)*(b.east-b.west),b.north-row/(h-1)*(b.north-b.south),z);
    const x=Math.floor(wx-.5),y=Math.floor(wy-.5),fx=wx-.5-x,fy=wy-.5-y;
    let total=0,weight=0;
    for(const [dx,dy,k] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]) {
      const value=sample(x+dx,y+dy);if(Number.isFinite(value)){total+=value*k;weight+=k;}
    }
    grid[row*w+col]=weight?total/weight:NaN;
  }
  if(id==='mapzen'&&z>0&&grid.reduce((n,v)=>n+!Number.isFinite(v),0)>grid.length*.02) {
    report(`Elevation coverage · trying zoom ${z-1}`);
    return tileGrid(id,b,w,h,signal,report,z-1);
  }
  return {grid,detail:id==='mapzen'?`Mapzen · zoom ${z}`:`GSI · ${[...used].map(s=>s.replace('_png','').toUpperCase()).join(', ')} · zoom ${z}`};
}
async function skadiGrid(b,w,h,signal,report,flattenOcean=false) {
  const keys=[];for(let lat=Math.floor(b.south);lat<=Math.floor(b.north);lat++)for(let lon=Math.floor(b.west);lon<=Math.floor(b.east);lon++)keys.push([lat,lon]);
  if(keys.length>9)throw new Error('Select a smaller area for Skadi.');
  const tiles=new Map();let done=0;
  await pooled(keys,2,async([lat,lon])=>{
    const ns=lat>=0?'N':'S',ew=lon>=0?'E':'W',name=`${ns}${String(Math.abs(lat)).padStart(2,'0')}${ew}${String(Math.abs(lon)).padStart(3,'0')}`;
    const r=await request(`https://s3.amazonaws.com/elevation-tiles-prod/skadi/${name.slice(0,3)}/${name}.hgt.gz`,{signal});
    const bytes=gunzipSync(new Uint8Array(await r.arrayBuffer())),dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),side=Math.sqrt(bytes.length/2);
    if(!Number.isInteger(side))throw new Error('Invalid Skadi elevation tile.');
    const data=new Float32Array(side*side);for(let i=0;i<data.length;i++){const v=dv.getInt16(i*2,false);data[i]=v===-32768?(flattenOcean?0:NaN):v;}
    tiles.set(`${lat},${lon}`,{data,side});report(`Elevation tiles · ${++done}/${keys.length}`);
  },signal);
  const grid=new Float32Array(w*h);
  for(let row=0;row<h;row++)for(let col=0;col<w;col++){
    const lat=b.north-row/(h-1)*(b.north-b.south),lon=b.west+col/(w-1)*(b.east-b.west),ly=Math.floor(lat),lx=Math.floor(lon),tile=tiles.get(`${ly},${lx}`);
    grid[row*w+col]=tile?bilinear(tile.data,tile.side,tile.side,(lon-lx)*(tile.side-1),(ly+1-lat)*(tile.side-1)):NaN;
  }
  return {grid,detail:'Skadi · 1 arc-second grid'};
}
export function fillVoids(grid,w,h) {
  let missing=0,min=Infinity,max=-Infinity;
  for(const v of grid)if(Number.isFinite(v)){min=Math.min(min,v);max=Math.max(max,v);}else missing++;
  if(min===Infinity)throw new Error('No elevation data covers this area.');
  if(missing/grid.length>.02)throw new Error(`${(missing/grid.length*100).toFixed(1)}% of the area has no elevation data. Choose a smaller area or another source.`);
  const original=missing;
  for(let pass=0;pass<16&&missing;pass++){
    const updates=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(Number.isFinite(grid[i]))continue;let sum=0,n=0;for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h){const v=grid[yy*w+xx];if(Number.isFinite(v)){sum+=v;n++;}}}if(n)updates.push([i,sum/n]);}
    for(const [i,v] of updates)grid[i]=v;missing-=updates.length;
  }
  if(missing)throw new Error('Elevation gaps could not be filled. Choose another source.');
  return {min,max,filled:original};
}
export function fillOceanVoids(grid,reference) {
  let filled=0;
  for(let i=0;i<grid.length;i++)if(!Number.isFinite(grid[i])&&Number.isFinite(reference[i])&&reference[i]<=0){grid[i]=0;filled++;}
  return filled;
}
export async function fetchTerrain(source,b,w,h,signal,report=()=>{},file,options={}) {
  const chosen=source==='auto'?autoSource(b):source;report(`Fetching elevation · ${SOURCES.find(s=>s.id===chosen)?.name||chosen}`);
  let result;
  try {
    if(chosen==='file') {if(!file)throw new Error('Choose an elevation GeoTIFF.');result={grid:await tiffGrid(await file.arrayBuffer(),b,w,h,signal),detail:file.name};}
    else if(['mapzen','gsi1','gsi5'].includes(chosen))result=await tileGrid(chosen,b,w,h,signal,report);
    else if(chosen==='srtm')result=await skadiGrid(b,w,h,signal,report,options.flattenOcean);
    else {
      let url;
      if(chosen==='usgs'){
        const dx=(b.east-b.west)/(w-1)/2,dy=(b.north-b.south)/(h-1)/2;
        url=usgsURL+'?'+new URLSearchParams({bbox:[b.west-dx,b.south-dy,b.east+dx,b.north+dy].join(','),bboxSR:'4326',imageSR:'4326',size:`${w},${h}`,format:'tiff',pixelType:'F32',interpolation:'RSP_BilinearInterpolation',renderingRule:JSON.stringify({rasterFunction:'None'}),f:'image'});
      }else{
        const points=[[b.west,b.south],[b.east,b.south],[b.west,b.north],[b.east,b.north]].map(p=>proj4('EPSG:4326','EPSG:27700',p));
        const box=[Math.floor(Math.min(...points.map(p=>p[0])))-2,Math.floor(Math.min(...points.map(p=>p[1])))-2,Math.ceil(Math.max(...points.map(p=>p[0])))+2,Math.ceil(Math.max(...points.map(p=>p[1])))+2];
        url=eaURL+'?'+new URLSearchParams({SERVICE:'WCS',VERSION:'1.0.0',REQUEST:'GetCoverage',COVERAGE:'13787b9a-26a4-4775-8523-806d13af58fc:Lidar_Composite_Elevation_DTM_1m',CRS:'EPSG:27700',BBOX:box.join(','),WIDTH:String(w+4),HEIGHT:String(h+4),FORMAT:'GeoTIFF'});
      }
      const response=await request(url,{signal,timeout:120000}),bytes=await response.arrayBuffer();
      if(bytes.byteLength>100000000)throw new Error('Elevation response is too large. Select a smaller area.');
      result={grid:await tiffGrid(bytes,b,w,h,signal),detail:SOURCES.find(s=>s.id===chosen).detail};
    }
    if(options.flattenOcean&&!['mapzen','srtm'].includes(chosen)&&result.grid.some(v=>!Number.isFinite(v))) {
      report('Checking sea-level coverage');
      const reference=await tileGrid('mapzen',b,w,h,signal,report);
      result.oceanFilled=fillOceanVoids(result.grid,reference.grid);
      if(result.oceanFilled){result.oceanReference='mapzen';result.detail+=' · sea-level ocean';}
    }
    const stats=fillVoids(result.grid,w,h);
    return {...result,...stats,source:chosen,w,h,sampleM:Math.max(dimensions(b).widthM/(w-1),dimensions(b).heightM/(h-1))};
  }catch(e){if(signal?.aborted)throw e;if(source==='auto'&&chosen==='gsi1'){report('GSI 1 m unavailable · using GSI 5 m');try{return await fetchTerrain('gsi5',b,w,h,signal,report,file,options);}catch(e){if(signal?.aborted)throw e;}}if(source==='auto'&&chosen!=='mapzen'){report(`${SOURCES.find(s=>s.id===chosen).name} unavailable · using Mapzen`);return fetchTerrain('mapzen',b,w,h,signal,report,file,options);}throw e;}
}
