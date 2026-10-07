// A regular height grid, closed with an indexed perimeter and bottom fan.
// Adjacent tiles share the same edge samples and physical XY scale.
export function heightMesh(heights, w, h, width, height) {
  if(w<2 || h<2 || heights.length!==w*h) throw new Error('Invalid height grid.');
  const perimeter=[];
  for(let x=0;x<w;x++) perimeter.push(x);
  for(let y=1;y<h;y++) perimeter.push(y*w+w-1);
  for(let x=w-2;x>=0;x--) perimeter.push((h-1)*w+x);
  for(let y=h-2;y>0;y--) perimeter.push(y*w);
  const n=w*h, p=perimeter.length, center=n+p;
  const vertices=new Float32Array((center+1)*3);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const i=y*w+x; vertices.set([x*width/(w-1),y*height/(h-1),heights[i]],i*3);
  }
  for(let i=0;i<p;i++) {const t=perimeter[i]*3;vertices.set([vertices[t],vertices[t+1],0],(n+i)*3);}
  vertices.set([width/2,height/2,0],center*3);
  const indices=new Uint32Array(((w-1)*(h-1)*2+p*3)*3); let k=0;
  const tri=(a,b,c)=>{indices[k++]=a;indices[k++]=b;indices[k++]=c;};
  for(let y=0;y<h-1;y++) for(let x=0;x<w-1;x++) {const a=y*w+x;tri(a,a+1,a+w+1);tri(a,a+w+1,a+w);}
  for(let i=0;i<p;i++) {const j=(i+1)%p;tri(perimeter[i],n+i,n+j);tri(perimeter[i],n+j,perimeter[j]);tri(center,n+j,n+i);}
  return {vertices,indices};
}
export function combineMeshes(meshes, offsets=[]) {
  const nv=meshes.reduce((s,m)=>s+m.vertices.length,0), ni=meshes.reduce((s,m)=>s+m.indices.length,0);
  const vertices=new Float32Array(nv),indices=new Uint32Array(ni);let vp=0,ip=0;
  meshes.forEach((m,i)=>{const [dx,dy,dz]=offsets[i]||[0,0,0];for(let j=0;j<m.vertices.length;j+=3)vertices.set([m.vertices[j]+dx,m.vertices[j+1]+dy,m.vertices[j+2]+dz],vp+j);for(let j=0;j<m.indices.length;j++)indices[ip+j]=m.indices[j]+vp/3;vp+=m.vertices.length;ip+=m.indices.length;});
  return {vertices,indices};
}
export function meshVolume(mesh) {
  let v=0;const p=mesh.vertices,t=mesh.indices;
  for(let i=0;i<t.length;i+=3) {const a=t[i]*3,b=t[i+1]*3,c=t[i+2]*3;v+=(p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])+p[a+1]*(p[b+2]*p[c]-p[b]*p[c+2])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;}
  return v;
}
