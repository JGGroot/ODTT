export function validateBounds(b) {
  if (!['south','north','west','east'].every(k => Number.isFinite(b[k]))) throw new Error('Enter valid coordinates.');
  if (b.south >= b.north || b.west >= b.east) throw new Error('North must exceed south; east must exceed west.');
  if (b.south < -85 || b.north > 85 || b.west < -180 || b.east > 180) throw new Error('Select an area between 85°S and 85°N.');
  const d = dimensions(b);
  if (Math.max(d.widthM, d.heightM) > 500000) throw new Error('Select an area under 500 km across.');
  return b;
}
export function dimensions(b, width = 240) {
  const cos = Math.cos((b.north + b.south) * Math.PI / 360);
  const widthM = (b.east - b.west) * 111320 * cos;
  const heightM = (b.north - b.south) * 111320;
  return { widthM, heightM, width, height: width * heightM / widthM, scale: width / widthM };
}
export function aspectBounds(b,ratio,anchor=null) {
  if(!ratio)return {...b};
  let width=b.east-b.west,height=b.north-b.south;
  const lat=()=>anchor?anchor.lat+(anchor.lat===b.south?1:-1)*height/2:(b.north+b.south)/2;
  const cos=()=>Math.cos(lat()*Math.PI/180);
  if(width*cos()/height<ratio)width=height*ratio/cos();
  else for(let i=0;i<8;i++)height=width*cos()/ratio;
  if(anchor)return {west:anchor.lng===b.west?anchor.lng:anchor.lng-width,east:anchor.lng===b.west?anchor.lng+width:anchor.lng,south:anchor.lat===b.south?anchor.lat:anchor.lat-height,north:anchor.lat===b.south?anchor.lat+height:anchor.lat};
  const lon=(b.west+b.east)/2,mid=(b.south+b.north)/2;
  return {west:lon-width/2,east:lon+width/2,south:mid-height/2,north:mid+height/2};
}
export function project(lon, lat, b, width) {
  const d = dimensions(b, width);
  return [(lon-b.west)/(b.east-b.west)*width, (lat-b.south)/(b.north-b.south)*d.height];
}
export function tileBounds(row, col, rows, cols, width, height) {
  const w = width/cols, h = height/rows;
  return { x: col*w, y: (rows-1-row)*h, width:w, height:h, row, col };
}
export function gridSize(width, height, spacing, rows, cols) {
  if (width <= 0 || height <= 0 || spacing <= 0 || rows < 1 || cols < 1) throw new Error('Model dimensions must be positive.');
  let nx = Math.ceil(width / spacing / cols) * cols;
  let ny = Math.ceil(height / spacing / rows) * rows;
  const maxCells = 900000;
  const factor = Math.max(1, Math.sqrt(nx*ny/maxCells));
  nx = Math.max(cols, Math.floor(nx/factor/cols)*cols);
  ny = Math.max(rows, Math.floor(ny/factor/rows)*rows);
  return { w:nx+1, h:ny+1, spacing:Math.max(width/nx,height/ny) };
}
export function bilinear(data, w, h, x, y) {
  x=Math.max(0,Math.min(w-1,x)); y=Math.max(0,Math.min(h-1,y));
  const x0=Math.floor(x), y0=Math.floor(y), x1=Math.min(x0+1,w-1), y1=Math.min(y0+1,h-1);
  const tx=x-x0, ty=y-y0;
  const vals=[data[y0*w+x0],data[y0*w+x1],data[y1*w+x0],data[y1*w+x1]];
  const weights=[(1-tx)*(1-ty),tx*(1-ty),(1-tx)*ty,tx*ty];
  let sum=0, total=0;
  for(let i=0;i<4;i++) if(Number.isFinite(vals[i])) {sum+=vals[i]*weights[i]; total+=weights[i];}
  return total ? sum/total : NaN;
}
export function pointInRing(x,y,ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i], b=ring[j];
    if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
export function pointInPolygon(x,y,rings) { return pointInRing(x,y,rings[0]) && !rings.slice(1).some(r=>pointInRing(x,y,r)); }
export function geometryBounds(polygons) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of polygons) for(const r of p) for(const [x,y] of r) { minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); }
  return [minX,minY,maxX,maxY];
}
