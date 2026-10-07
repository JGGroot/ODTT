import './style.css';
import L from 'leaflet';
import { zipSync, strToU8 } from 'fflate';
import { dimensions, validateBounds, gridSize, tileBounds, aspectBounds } from './geo.js';
import { fetchOSM, fetchMapXML, parseOSM } from './osm.js';
import { attribution } from './sources.js';
import { SOURCES, inspectTIFF } from './terrain.js';
import { ModelPool, workerCount } from './pool.js';
import { Preview } from './preview.js';
import { COLORS, download } from './export.js';
import { request } from './network.js';
import { parseTrack, trackPolygons } from './tracks.js';
const $=id=>document.getElementById(id),num=id=>Number($(id).value),checked=id=>$(id).checked;
const presets={santamaria:{south:36.91,north:37.07,west:-25.25,east:-25.00},scott:{south:38.5269,north:38.5611,west:-89.886,east:-89.7981},mildenhall:{south:52.344,north:52.373,west:.461,east:.51},rainier:{south:46.805,north:46.895,west:-121.825,east:-121.68},snowdon:{south:53.052,north:53.078,west:-4.105,east:-4.06},tokyo:{south:35.674,north:35.693,west:139.747,east:139.778},kyoto:{south:35.048,north:35.082,west:135.744,east:135.785}};
let trackFile=null,elevationCache=null;
let mode='osm',model=null,pool=null,controller=null,running=false,osmCache=null,osmFile=null,imageFile=null,demFile=null,view='split',drawStart=null,drawing=false,searchController=null;
const map=L.map('map',{zoomControl:false,attributionControl:true}).setView([38.544,-89.842],13);
const streetLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'}).addTo(map);
const satelliteLayer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,attribution:'Source: <a href="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" target="_blank" rel="noreferrer">Esri</a>, Vantor, Earthstar Geographics, and the GIS User Community'});
$('map-style').addEventListener('change',()=>{const satellite=$('map-style').value==='satellite';map.removeLayer(satellite?streetLayer:satelliteLayer);(satellite?satelliteLayer:streetLayer).addTo(map);$('map').classList.toggle('satellite',satellite);updateMapPOIs();});
L.control.zoom({position:'bottomleft'}).addTo(map);
const selection=L.rectangle([[38.5269,-89.886],[38.5611,-89.7981]],{color:'#285d50',weight:1.8,fillColor:'#799d79',fillOpacity:.1}).addTo(map),mapGrid=L.layerGroup().addTo(map),handles=L.layerGroup().addTo(map);
let preview;
try{preview=new Preview($('preview'));}catch(e){$('preview-empty').textContent='3D preview needs WebGL. Downloads remain available.';}
function bounds(){return {south:num('south'),north:num('north'),west:num('west'),east:num('east')};}
function settings(){
  const b=mode==='image'?presets.scott:validateBounds(bounds()),width=num('model-width'),d=mode==='image'&&imageFile?{width,height:width*imageFile.height/imageFile.width,scale:1}:dimensions(b,width);
  const s={...d,width,base:num('base'),relief:num('relief'),rows:num('rows'),cols:num('cols'),spacing:num('spacing'),multiColor:checked('multi-color'),layers:Object.fromEntries([...document.querySelectorAll('[data-layer]')].map(e=>[e.dataset.layer,e.checked])),buildingHeight:num('building-height'),roadHeight:num('road-height'),greenHeight:num('green-height'),waterHeight:num('water-height'),roadWidth:num('road-width'),trueScale:checked('true-scale'),buildingScale:num('building-scale'),terrainMode:$('terrain-mode').value,terrainScale:$('terrain-scale').value,contourInterval:num('contour-interval'),exaggeration:num('exaggeration'),smooth:num('smooth'),flattenOcean:mode!=='image'&&checked('flatten-ocean')};
  if(mode==='image'){s.terrainScale='relief';s.terrainMode='smooth';}
  if(!(s.width>=10&&s.width<=2000&&s.height>0&&s.height<=2000&&s.base>=.4&&s.relief>0&&s.rows>=1&&s.cols>=1&&s.rows<=10&&s.cols<=10&&Number.isInteger(s.rows)&&Number.isInteger(s.cols)))throw new Error('Check model dimensions, base, relief and tile counts.');
  s.trackWidth=num('track-width');s.trackClearance=num('track-clearance');s.trackFloor=2.5;s.trackThickness=1.5;
  if(!(s.trackWidth>=.8&&s.trackWidth<=20&&s.trackClearance>=0&&s.trackClearance<=1))throw new Error('Check track width and fit clearance.');
  if(s.contourInterval<=0||(s.exaggeration<.5||s.exaggeration>10)||s.roadWidth<=0||s.buildingHeight<=0||s.buildingScale<=0)throw new Error('Heights and scale factors must be positive.');
  return s;
}
function updateDimensions(){
  try{const s=settings(),b=bounds();$('model-ratio').textContent=`${s.width.toFixed(0)} × ${s.height.toFixed(1)} mm`;$('tile-size').textContent=`${(s.width/s.cols).toFixed(1)} × ${(s.height/s.rows).toFixed(1)} mm / tile`;$('tile-count').textContent=`${s.rows*s.cols} tiles`;$('area-size').textContent=mode==='image'?'':`${(s.widthM/1000).toFixed(1)} × ${(s.heightM/1000).toFixed(1)} km`;$('selection-label').textContent=$('area-size').textContent;
  selection.setBounds([[b.south,b.west],[b.north,b.east]]);mapGrid.clearLayers();
  if(checked('show-grid')){
    for(let c=1;c<s.cols;c++){const lon=b.west+c/s.cols*(b.east-b.west);L.polyline([[b.south,lon],[b.north,lon]],{color:'#285d50',weight:1,dashArray:'4 5',opacity:.55}).addTo(mapGrid);}
    for(let r=1;r<s.rows;r++){const lat=b.south+r/s.rows*(b.north-b.south);L.polyline([[lat,b.west],[lat,b.east]],{color:'#285d50',weight:1,dashArray:'4 5',opacity:.55}).addTo(mapGrid);}
  }
  }catch(e){$('model-ratio').textContent='—';}
}
function writeBounds(b){for(const k of ['south','north','west','east'])$(k).value=b[k].toFixed(7);updateDimensions();}
function setBounds(b,fit=true){b=validateBounds(aspectBounds(b,num('aspect-ratio')));writeBounds(b);if(fit)map.fitBounds(selection.getBounds(),{padding:[35,35]});refreshHandles();}
function refreshHandles(){handles.clearLayers();const b=bounds();for(const [a,c] of [['south','west'],['south','east'],['north','west'],['north','east']]){const marker=L.marker([b[a],b[c]],{draggable:true,icon:L.divIcon({className:'',html:'<div class="handle"></div>',iconSize:[11,11],iconAnchor:[5,5]})}).addTo(handles);let fixed;
  marker.on('dragstart',()=>{const current=bounds();fixed={lat:current[a==='south'?'north':'south'],lng:current[c==='west'?'east':'west']};});
  marker.on('drag',()=>{const p=marker.getLatLng();try{const next=validateBounds(aspectBounds({south:Math.min(p.lat,fixed.lat),north:Math.max(p.lat,fixed.lat),west:Math.min(p.lng,fixed.lng),east:Math.max(p.lng,fixed.lng)},num('aspect-ratio'),fixed));writeBounds(next);$('preset').value='custom';}catch{}});marker.on('dragend',refreshHandles);}}
function error(e){$('error').textContent=e.message||String(e);$('error').hidden=false;}
function report(text,percent){$('status').textContent=text;if(percent!==undefined)$('progress').value=percent;}
function setBusy(value){running=value;$('generate').hidden=value;$('cancel').hidden=!value;$('progress').hidden=!value;document.querySelectorAll('.inspector section').forEach(s=>{s.classList.toggle('busy',value);s.querySelectorAll('input,select,button').forEach(e=>e.disabled=value);});handles.eachLayer(m=>value?m.dragging.disable():m.dragging.enable());['export-stl','export-3mf','export-tiles','export-track'].forEach(id=>$(id).disabled=value||!model);document.querySelectorAll('nav button').forEach(b=>b.disabled=value);}
function setMode(value){if(running)return;mode=value;document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});$('track-section').hidden=mode==='image';$('area-section').hidden=mode==='image';$('osm-section').hidden=mode!=='osm';$('image-section').hidden=mode!=='image';$('terrain-section').hidden=mode==='image';$('layers-section').hidden=mode!=='osm';$('multi-color').parentElement.hidden=checked('with-terrain');$('terrain-toggle').hidden=mode!=='osm';$('terrain-options').hidden=mode==='osm'&&!checked('with-terrain');if(mode==='image'){setView('model');}else if(view==='model'&&!model)setView('split');updateDimensions();}
function setView(value){view=value;$('views').className=`views ${view}`;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));requestAnimationFrame(()=>{map.invalidateSize();preview?.resize();});}
SOURCES.forEach(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;$('terrain-source').append(o);if(s.id!=='auto'&&s.id!=='file'){const row=document.createElement('div');row.className='source-row';const text=document.createElement('div');text.textContent=s.name;const small=document.createElement('small');small.textContent=s.detail;text.append(small);const a=document.createElement('a');a.href=s.url;a.textContent='Source ↗';a.target='_blank';a.rel='noreferrer';row.append(text,a);$('source-list').append(row);}});
function sourceChanged(){const s=SOURCES.find(s=>s.id===$('terrain-source').value);$('source-detail').textContent=s.detail;$('dem-file-label').hidden=s.id!=='file';$('dem-file-info').hidden=s.id!=='file'||!demFile;}
async function heightmapGrid(file,w,h){const bitmap=await createImageBitmap(file);const c=new OffscreenCanvas(w,h),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,w,h);bitmap.close();const pixels=ctx.getImageData(0,0,w,h).data,grid=new Float32Array(w*h);for(let i=0;i<grid.length;i++){const v=(pixels[i*4]*.2126+pixels[i*4+1]*.7152+pixels[i*4+2]*.0722)/255;grid[i]=checked('invert-image')?1-v:v;}return {grid,w,h,min:0,max:1,source:'image',detail:file.name};}
async function generate(){
  if(drawing)finishDrawing(true);
  $('error').hidden=true;let start=performance.now();controller=new AbortController();
  try {
    const s=settings(),b=bounds(),hasTerrain=mode==='terrain'||(mode==='osm'&&checked('with-terrain'))||mode==='image';
    if(trackFile&&mode==='osm'&&!hasTerrain)throw new Error('Enable Use terrain for a GPS track insert.');
    if(mode==='image'&&!imageFile)throw new Error('Choose a heightmap first.');
    const grid=gridSize(s.width,s.height,s.spacing,s.rows,s.cols),count=workerCount(s.rows*s.cols,num('workers'));
    pool=new ModelPool(count);setBusy(true);report('Preparing model',2);
    let features=[],elevation=null,surface=null;
    const elevationKey=JSON.stringify({b,w:grid.w,h:grid.h,source:mode==='image'?'image':$('terrain-source').value,file:mode==='image'?[imageFile?.file.name,imageFile?.file.size,imageFile?.file.lastModified]:[demFile?.name,demFile?.size,demFile?.lastModified],invert:checked('invert-image'),flattenOcean:s.flattenOcean&&$('terrain-source').value!=='mapzen'});
    const cached=hasTerrain&&elevationCache?.key===elevationKey;
    if(cached)report('Using cached elevation',25);
    const elevationTask=hasTerrain?(cached?Promise.resolve(elevationCache.data):mode==='image'?heightmapGrid(imageFile.file,grid.w,grid.h):pool.run('elevation',{source:$('terrain-source').value,bounds:b,w:grid.w,h:grid.h,file:demFile,options:{flattenOcean:s.flattenOcean}},t=>report(t,25))):null;
    elevationTask?.catch(()=>{});
    if(mode==='osm') {
      const key=JSON.stringify(b)+$('osm-source').value;let data;
      if($('osm-source').value==='file'){if(!osmFile)throw new Error('Choose an OSM file.');data=osmFile.data;}
      else if(osmCache?.key===key){data=osmCache.data;report('Using cached OSM',10);}else{data=$('osm-source').value==='map'?await fetchMapXML(b,controller.signal):await fetchOSM(b,controller.signal,t=>report(t,8));osmCache={key,data};}
      features=await pool.run('features',{data,bounds:b,settings:s});report(`${features.length.toLocaleString()} OSM features`,20);
    }
    if(hasTerrain) {
      elevation=await elevationTask;elevationCache={key:elevationKey,data:elevation};
      report('Building terrain surface',35);surface=await pool.run('surface',{elevation,features,settings:s});
    }
    const track=trackFile&&mode!=='image'?trackPolygons(trackFile,b,s):null;
    if(track){report('Preparing track recess',38);s.trackFloor=await pool.run('trackFloor',{surface,polygons:track,settings:s});}
    let done=0;const tiles=await Promise.all(Array.from({length:s.rows*s.cols},(_,i)=>{
      const row=Math.floor(i/s.cols),col=i%s.cols,tile=tileBounds(row,col,s.rows,s.cols,s.width,s.height);
      return pool.run('tile',{tile,features,surface,settings:s,track}).then(objects=>{report(`Tiles · ${++done}/${s.rows*s.cols} · ${count} workers`,40+done/(s.rows*s.cols)*55);return {tile,objects};});
    }));
    controller.signal.throwIfAborted();
    const seconds=(performance.now()-start)/1000;
    model={tiles,track,trackName:trackFile?.name,settings:s,bounds:b,surface,elevation,features:features.length,mode,name:mode==='image'?imageFile.file.name.replace(/\.[^.]+$/,''):trackFile&&mode!=='image'?trackFile.name.replace(/\.[^.]+$/,''):$('preset').value==='custom'?'map':$('preset').selectedOptions[0].textContent,seconds};
    $('export-track').hidden=!track;$('download-file').hidden=true;report(`Complete · ${seconds.toFixed(1)} s${elevation?` · ${elevation.detail} · ${Math.round(elevation.min)}–${Math.round(elevation.max)} m`:''}${elevation?.sampleM?` · ${elevation.sampleM.toFixed(1)} m mesh`:''}`,100);preview?.setModel(tiles,s);if(preview)$('preview-empty').hidden=true;$('preview-size').textContent=`${s.width.toFixed(0)} × ${s.height.toFixed(1)} mm`;
    const faces=tiles.reduce((n,t)=>n+t.objects.reduce((v,o)=>v+o.indices.length/3,0),0);$('output-name').textContent=model.name;$('output-stats').textContent=`${s.rows*s.cols} tiles · ${faces.toLocaleString()} triangles`;
    $('legend').replaceChildren();const labelNames=['terrain','water','greenery','roads','runways','railways','buildings'];const groups=[...new Set(tiles.flatMap(t=>t.objects.flatMap(o=>o.labels?[o.group,...Array.from(new Set(o.labels)).map(c=>labelNames[c])]:[o.group])))];groups.forEach(group=>{const item=document.createElement('span');item.className='legend-item';const dot=document.createElement('i');dot.className='swatch';dot.style.background=COLORS[group];item.append(dot,document.createTextNode(group));$('legend').append(item);});$('legend').hidden=false;
  }catch(e){if(controller.signal.aborted||e.name==='AbortError')report('Cancelled');else{error(e);report('Generation stopped');}}
  finally{pool?.close();pool=null;setBusy(false);}
}
function modelObjects(){return model.tiles.flatMap(t=>t.objects.map(o=>({...o,offset:[t.tile.x,t.tile.y,0],name:`R${t.tile.row+1}C${t.tile.col+1} · ${o.group}`})));}
function metadata(){return {Title:model.name,Application:'ODTT',Description:model.elevation?.detail||'OpenStreetMap',Copyright:attribution(model),Modification:'Clipped, resampled, scaled and converted to a printable mesh.'};}
async function exportModel(kind){
  if(!model||running)return;$('error').hidden=true;pool=new ModelPool(workerCount(5,num('workers')));setBusy(true);report('Preparing download',0);
  const filename=model.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'model';
  try{
    if(kind==='tiles'){
      const entries={};let completed=0;
      await Promise.all(model.tiles.map(async tile=>{
        const name=`${filename}_R${tile.tile.row+1}C${tile.tile.col+1}`;
        const bytes=await pool.run('exportTile',{objects:tile.objects,metadata:metadata(),multiColor:model.settings.multiColor&&model.mode==='osm'&&!model.surface});
        entries[name+'.3mf']=bytes.threeMF;entries[name+'.stl']=bytes.stl;if(bytes.track)entries[name+'-track.stl']=bytes.track;
        report(`Packing tiles · ${++completed}/${model.tiles.length}`,completed/model.tiles.length*90);
      }));
      const elevation=model.elevation?Object.fromEntries(['source','detail','min','max','w','h','sampleM','filled','oceanFilled','oceanReference'].map(k=>[k,model.elevation[k]])):null;
      entries['model.json']=strToU8(JSON.stringify({bounds:model.bounds,settings:model.settings,track:model.track?{name:model.trackName||trackFile?.name,bottom:model.settings.base+model.settings.trackFloor,top:"terrain surface",width:model.settings.trackWidth,clearance:model.settings.trackClearance}:null,elevation,source:model.elevation?.detail||'OpenStreetMap',attribution:metadata().Copyright},null,2));
      const bytes=await pool.run('zip',{entries});download(bytes,filename+'-tiles.zip','application/zip');
    }else{
      let objects;
      if(model.surface){objects=[await pool.run('fullSurface',{surface:model.surface,settings:model.settings})];if(model.track)objects=await pool.run('track',{objects,polygons:model.track,tile:{x:0,y:0,width:model.settings.width,height:model.settings.height},settings:model.settings});}
      else{
        const all=modelObjects(),groups=[...new Set(all.map(o=>o.group))];let done=0;
        objects=await Promise.all(groups.map(async group=>{const mesh=await pool.run('merge',{objects:all.filter(o=>o.group===group)});report(`Merging layers · ${++done}/${groups.length}`,done/groups.length*65);return {...mesh,group};}));
      }
      if(kind==='track'){const insert=objects.filter(o=>o.group==='track').map(o=>({...o,offset:[0,0,-(model.settings.base+model.settings.trackFloor)]})),terrain=objects.filter(o=>o.group!=='track');const [groundBytes,trackBytes]=await Promise.all([pool.run('export',{kind:'stl',objects:terrain}),pool.run('export',{kind:'stl',objects:insert})]);const entries={[filename+'-terrain.stl']:groundBytes,[filename+'-track.stl']:trackBytes,[filename+'-assembly.3mf']:await pool.run('export',{kind:'3mf',objects,metadata:metadata()})};download(await pool.run('zip',{entries}),filename+'-track.zip','application/zip');}
      else {const bytes=await pool.run('export',{kind,objects:kind==='stl'?objects.filter(o=>o.group!=='track'):objects,metadata:metadata()});download(bytes,filename+'.'+kind,kind==='3mf'?'model/3mf':'model/stl');}
    }
    report('Download ready',100);
  }catch(e){if(e.name==='AbortError')report('Cancelled');else{error(e);report('Export stopped');}}finally{pool?.close();pool=null;setBusy(false);}
}
$('export-track').addEventListener('click',()=>exportModel('track'));
$('generate').addEventListener('click',generate);$('cancel').addEventListener('click',()=>{controller?.abort();pool?.close();report('Cancelled');});
document.querySelectorAll('[data-mode]').forEach(e=>e.addEventListener('click',()=>setMode(e.dataset.mode)));document.querySelectorAll('[data-view]').forEach(e=>e.addEventListener('click',()=>setView(e.dataset.view)));
$('with-terrain').addEventListener('change',()=>setMode(mode));$('terrain-source').addEventListener('change',sourceChanged);
$('osm-source').addEventListener('change',()=>{$('osm-file-label').hidden=$('osm-source').value!=='file';$('osm-file-info').hidden=$('osm-source').value!=='file'||!osmFile;});
$('osm-file').addEventListener('change',async()=>{const file=$('osm-file').files[0];if(!file)return;try{if(file.size>100000000)throw new Error('OSM file exceeds 100 MB. Import a smaller extract.');const data=parseOSM(await file.text());osmFile={data,name:file.name};const nodes=data.elements.filter(e=>e.type==='node'&&Number.isFinite(e.lon)&&Number.isFinite(e.lat)),points=nodes.length?nodes:data.elements.flatMap(e=>e.geometry||[]);if(points.length){let west=180,east=-180,south=90,north=-90;for(const p of points){west=Math.min(west,p.lon);east=Math.max(east,p.lon);south=Math.min(south,p.lat);north=Math.max(north,p.lat);}if(north>south&&east>west)setBounds(validateBounds({west,east,south,north}));}$('preset').value='custom';$('osm-file-info').textContent=`${file.name} · ${data.elements.length.toLocaleString()} elements`;$('osm-file-info').hidden=false;}catch(e){osmFile=null;error(e);}});
$('terrain-mode').addEventListener('change',()=>{$('contour-field').hidden=$('terrain-mode').value!=='stepped';});$('terrain-scale').addEventListener('change',()=>{$('exaggeration-field').hidden=false;});
for(const id of ['model-width','base','relief','cols','rows','spacing'])$(id).addEventListener('input',updateDimensions);
for(const id of ['north','south','west','east'])$(id).addEventListener('change',()=>{$('preset').value='custom';try{setBounds(bounds(),false);}catch(e){error(e);}});
$('preset').addEventListener('change',()=>{if(presets[$('preset').value]){setBounds(presets[$('preset').value]);if($('preset').value==='santamaria'){$('flatten-ocean').checked=true;}}});
$('use-view').addEventListener('click',()=>{const b=map.getBounds();$('preset').value='custom';setBounds({south:b.getSouth(),north:b.getNorth(),west:b.getWest(),east:b.getEast()},false);});
let drawOriginal=null,drawPointer=null,drawOrigin=null;
function finishDrawing(cancel=false){if(cancel&&drawOriginal)writeBounds(drawOriginal);drawing=false;drawStart=null;drawPointer=null;drawOriginal=null;drawOrigin=null;$('draw-area').classList.remove('active');$('draw-area').setAttribute('aria-pressed','false');$('map').classList.remove('draw-active');map.dragging.enable();map.touchZoom.enable();map.doubleClickZoom.enable();refreshHandles();}
$('draw-area').addEventListener('click',()=>{if(drawing){finishDrawing(true);report('Ready');return;}drawing=true;drawOriginal=null;$('draw-area').setAttribute('aria-pressed','true');$('draw-area').classList.add('active');$('map').classList.add('draw-active');map.dragging.disable();map.touchZoom.disable();map.doubleClickZoom.disable();handles.clearLayers();report('Drag to select an area');});
const mapElement=$('map');
mapElement.addEventListener('pointerdown',e=>{if(!drawing||running||e.button!==0||e.isPrimary===false||e.target.closest('.leaflet-control'))return;e.preventDefault();e.stopPropagation();drawStart=map.mouseEventToLatLng(e);drawOriginal=bounds();drawPointer=e.pointerId;drawOrigin=[e.clientX,e.clientY];mapElement.setPointerCapture(e.pointerId);});
mapElement.addEventListener('pointermove',e=>{if(!drawing||drawPointer!==e.pointerId||!drawStart)return;e.preventDefault();const p=map.mouseEventToLatLng(e);try{writeBounds(validateBounds(aspectBounds({south:Math.min(p.lat,drawStart.lat),north:Math.max(p.lat,drawStart.lat),west:Math.min(p.lng,drawStart.lng),east:Math.max(p.lng,drawStart.lng)},num('aspect-ratio'),{lat:drawStart.lat,lng:drawStart.lng})));}catch{}});
mapElement.addEventListener('pointerup',e=>{if(!drawing||drawPointer!==e.pointerId)return;mapElement.releasePointerCapture(e.pointerId);if(Math.hypot(e.clientX-drawOrigin[0],e.clientY-drawOrigin[1])<5){writeBounds(drawOriginal);drawStart=null;drawPointer=null;report('Drag to select an area');return;}$('preset').value='custom';finishDrawing();report('Area selected');});
mapElement.addEventListener('pointercancel',()=>{if(drawing){finishDrawing(true);report('Ready');}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawing){finishDrawing(true);report('Ready');}});
$('aspect-ratio').addEventListener('change',()=>{try{setBounds(bounds());$('preset').value='custom';}catch(e){error(e);}});
function syncExaggeration(value){$('exaggeration').value=value;$('exaggeration-slider').value=value;$('exaggeration-value').textContent=`${Number(value).toFixed(1).replace(/\.0$/,'')}×`;document.querySelectorAll('[data-exaggeration]').forEach(button=>button.classList.toggle('active',Math.abs(Number(button.dataset.exaggeration)-Number(value))<.001));}
function regenerateTerrain(){if(model?.surface&&model.mode===mode&&!running)generate();}
$('flatten-ocean').addEventListener('change',regenerateTerrain);
$('exaggeration-slider').addEventListener('input',()=>syncExaggeration($('exaggeration-slider').value));$('exaggeration-slider').addEventListener('change',regenerateTerrain);
$('exaggeration').addEventListener('change',()=>{syncExaggeration($('exaggeration').value);regenerateTerrain();});
document.querySelectorAll('[data-exaggeration]').forEach(button=>button.addEventListener('click',()=>{syncExaggeration(button.dataset.exaggeration);regenerateTerrain();}));
$('show-grid').addEventListener('change',()=>{updateDimensions();preview?.setGrid(checked('show-grid'));});$('fit-view').addEventListener('click',()=>{map.fitBounds(selection.getBounds(),{padding:[35,35]});preview?.fit();});
$('wire-view').addEventListener('click',()=>{preview?.setWire(true);$('wire-view').classList.add('active');$('solid-view').classList.remove('active');});$('solid-view').addEventListener('click',()=>{preview?.setWire(false);$('wire-view').classList.remove('active');$('solid-view').classList.add('active');});$('top-view').addEventListener('click',()=>preview?.fit(true));
$('sources-button').addEventListener('click',()=>$('sources-dialog').showModal());$('close-sources').addEventListener('click',()=>$('sources-dialog').close());
$('export-stl').addEventListener('click',()=>exportModel('stl'));$('export-3mf').addEventListener('click',()=>exportModel('3mf'));$('export-tiles').addEventListener('click',()=>exportModel('tiles'));
$('heightmap-file').addEventListener('change',async()=>{const file=$('heightmap-file').files[0];if(!file)return;try{const img=await createImageBitmap(file);imageFile={file,width:img.width,height:img.height};img.close();$('image-info').textContent=`${file.name} · ${imageFile.width} × ${imageFile.height} px`;updateDimensions();}catch(e){error(new Error('This image format is unsupported. Use PNG, JPG or WebP.'));}});
$('dem-file').addEventListener('change',async()=>{const file=$('dem-file').files[0];if(!file)return;try{demFile=file;const info=await inspectTIFF(await file.arrayBuffer());setBounds(info.bounds);$('preset').value='custom';$('dem-file-info').textContent=`${file.name} · ${info.width} × ${info.height} · ${info.crs}`;$('dem-file-info').hidden=false;}catch(e){demFile=null;error(e);}});
$('search-form').addEventListener('submit',async e=>{e.preventDefault();const q=$('search').value.trim();if(!q||running)return;searchController?.abort();searchController=new AbortController();$('search-results').replaceChildren();report('Searching');try{const r=await request('https://nominatim.openstreetmap.org/search?'+new URLSearchParams({q,format:'json',limit:'4'}),{signal:searchController.signal,timeout:15000});const results=await r.json();$('search-results').hidden=false;if(!results.length)report('No places found');else{results.forEach(hit=>{const button=document.createElement('button');button.type='button';button.className='search-result';button.textContent=hit.display_name;button.addEventListener('click',()=>{const bb=hit.boundingbox.map(Number);const lat=Number(hit.lat),lon=Number(hit.lon),span=Math.max(.002,Math.min(.12,bb[1]-bb[0]));setBounds({south:lat-span/2,north:lat+span/2,west:lon-span/2/Math.cos(lat*Math.PI/180),east:lon+span/2/Math.cos(lat*Math.PI/180)});$('preset').value='custom';$('search-results').hidden=true;report('Area selected');});$('search-results').append(button);});report('Select a place');}}catch(e){if(e.name!=='AbortError'){error(new Error('Place search unavailable. Use coordinates or the map.'));report('Search stopped');}}});
sourceChanged();setBounds(presets.scott);setMode('osm');
// Optional browser agent API. The same controls and validation serve both paths.
if(document.modelContext?.registerTool){
  document.modelContext.registerTool({name:'set_map_area',description:'Set the map area using WGS84 coordinates.',inputSchema:{type:'object',properties:Object.fromEntries(['south','north','west','east'].map(k=>[k,{type:'number'}])),required:['south','north','west','east']},execute(input){if(running)throw new Error('Generation in progress.');setBounds(validateBounds(input));$('preset').value='custom';return {bounds:bounds()};}});
  document.modelContext.registerTool({name:'generate_model',description:'Generate a printable model with the current visible controls.',inputSchema:{type:'object',properties:{}},execute:async()=>{if(running)throw new Error('Generation in progress.');await generate();return {status:$('status').textContent,width:model?.settings.width,height:model?.settings.height};}});
}

const trackMap=L.layerGroup().addTo(map);
function showTrack(){trackMap.clearLayers();if(!trackFile)return;for(const segment of trackFile.segments)L.polyline(segment.map(([lon,lat])=>[lat,lon]),{color:'#df343b',weight:3}).addTo(trackMap);}
$('track-file').addEventListener('change',async()=>{const file=$('track-file').files[0];if(!file)return;try{if(file.size>20000000)throw new Error('Track exceeds 20 MB.');const parsed=parseTrack(await file.text(),file.name);trackFile={...parsed,name:file.name};$('track-info').textContent=`${file.name} · ${parsed.count.toLocaleString()} points · ${parsed.segments.length} segments`;$('track-options').hidden=false;showTrack();setBounds(parsed.bounds);$('preset').value='custom';if(mode==='osm'){$('with-terrain').checked=true;setMode(mode);}report('Track loaded');}catch(e){error(e);}});
$('fit-track').addEventListener('click',()=>{if(trackFile){setBounds(trackFile.bounds);$('preset').value='custom';}});
$('remove-track').addEventListener('click',()=>{trackFile=null;$('track-file').value='';$('track-options').hidden=true;$('track-info').textContent='KML, GPX, TCX or GeoJSON';showTrack();report('Track removed');});

map.createPane('labels');map.getPane('labels').style.zIndex=450;map.getPane('labels').style.pointerEvents='none';
const placeLabels=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{pane:'labels',maxZoom:20,maxNativeZoom:18,attribution:'Labels: Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community'});
const pois=L.layerGroup().addTo(map);let poiTimer,poiController,poiKey='';
function updateMapPOIs(){
  const active=$('map-style').value==='satellite'&&checked('show-pois');
  if(active&&!map.hasLayer(placeLabels))placeLabels.addTo(map);if(!active&&map.hasLayer(placeLabels))map.removeLayer(placeLabels);
  clearTimeout(poiTimer);poiController?.abort();if(!active){pois.clearLayers();poiKey='';$('poi-status').textContent='';return;}
  poiTimer=setTimeout(loadPOIs,700);
}
async function loadPOIs(){
  const box=map.getBounds(),b={south:box.getSouth(),north:box.getNorth(),west:box.getWest(),east:box.getEast()};
  if(map.getZoom()<12||(b.north-b.south)*(b.east-b.west)>.01){$('poi-status').textContent='Zoom in for POIs';pois.clearLayers();poiKey='';return;}
  const key=Object.values(b).map(v=>v.toFixed(4)).join(',');if(key===poiKey)return;
  poiController=new AbortController();const signal=poiController.signal;$('poi-status').textContent='Loading POIs';
  try{const data=await fetchMapXML(b,signal);if(signal.aborted)return;pois.clearLayers();let count=0;
    for(const node of data.elements){const t=node.tags||{};if(node.type!=='node'||!Number.isFinite(node.lat)||!Number.isFinite(node.lon))continue;
      const kind=['peak','saddle','spring','cave_entrance'].includes(t.natural)?t.natural:['alpine_hut','wilderness_hut','viewpoint','camp_site','information','picnic_site','attraction'].includes(t.tourism)?t.tourism:['drinking_water','shelter','parking','toilets'].includes(t.amenity)?t.amenity:null;if(!kind)continue;
      const label=t.name||kind.replaceAll('_',' '),content=document.createElement('div');content.textContent=label+(t.ele?' · '+t.ele+' m':'');
      const marker=L.circleMarker([node.lat,node.lon],{radius:kind==='peak'?4:3,color:'#fff',weight:1.5,fillColor:kind==='peak'?'#a85338':'#285d50',fillOpacity:1}).bindPopup(content).addTo(pois);
      if(t.name&&(kind==='peak'||map.getZoom()>=15)){const text=document.createElement('span');text.textContent=label;marker.bindTooltip(text,{permanent:true,direction:'right',className:'poi-label',offset:[5,0]});}
      if(++count>=300)break;
    }
    poiKey=key;$('poi-status').textContent=count?`${count} POIs`:'';
  }catch(e){if(!signal.aborted)$('poi-status').textContent='POIs unavailable';}
}
$('show-pois').addEventListener('change',updateMapPOIs);map.on('moveend',updateMapPOIs);
