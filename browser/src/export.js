import { zipSync, strToU8 } from 'fflate';
export const COLORS={track:'#df343b',ground:'#d3ccba',water:'#79adbb',greenery:'#7f9b7e',roads:'#59636b',railways:'#828b90',runways:'#979ea3',buildings:'#d8ab78',terrain:'#c3c0a5'};
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function stl(mesh) {
  const count=mesh.indices.length/3, buffer=new ArrayBuffer(84+count*50),v=new DataView(buffer);
  v.setUint32(80,count,true);let o=84;const p=mesh.vertices;
  for(let i=0;i<mesh.indices.length;i+=3) {
    const a=mesh.indices[i]*3,b=mesh.indices[i+1]*3,c=mesh.indices[i+2]*3;
    const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
    const normal=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx],len=Math.hypot(...normal)||1;
    for(const n of normal){v.setFloat32(o,n/len,true);o+=4;}
    for(const j of [a,b,c])for(let k=0;k<3;k++){v.setFloat32(o,p[j+k]+(mesh.offset?.[k]||0),true);o+=4;}o+=2;
  }
  return new Uint8Array(buffer);
}
export function threeMF(objects, metadata={}) {
  const labelNames=['terrain','water','greenery','roads','runways','railways','buildings'];
  const names=[...new Set(objects.flatMap(o=>o.labels?[o.group,...Array.from(new Set(o.labels)).map(c=>labelNames[c])]:[o.group]))];
  const chunks=['<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'];
  for(const [k,v] of Object.entries(metadata))chunks.push(`<metadata name="${xml(k)}">${xml(v)}</metadata>`);
  chunks.push('<resources><basematerials id="1">');
  for(const name of names)chunks.push(`<base name="${xml(name)}" displaycolor="${COLORS[name]||COLORS.terrain}FF"/>`);
  chunks.push('</basematerials>');
  objects.forEach((o,i)=>{
    chunks.push(`<object id="${i+2}" name="${xml(o.name||o.group)}" type="model" pid="1" pindex="${names.indexOf(o.group)}"><mesh><vertices>`);
    const p=o.vertices,t=o.indices;
    for(let j=0;j<p.length;j+=3)chunks.push(`<vertex x="${p[j].toFixed(6)}" y="${p[j+1].toFixed(6)}" z="${p[j+2].toFixed(6)}"/>`);
    chunks.push('</vertices><triangles>');
    for(let j=0;j<t.length;j+=3){let property='';if(o.labels){const a=o.labels[t[j]]||0,b=o.labels[t[j+1]]||0,c=o.labels[t[j+2]]||0,code=b===c?b:a;property=` pid="1" p1="${names.indexOf(labelNames[code])}"`;}chunks.push(`<triangle v1="${t[j]}" v2="${t[j+1]}" v3="${t[j+2]}"${property}/>`);}
    chunks.push('</triangles></mesh></object>');
  });
  chunks.push('</resources><build>');
  objects.forEach((o,i)=>{const [x,y,z]=o.offset||[0,0,0];chunks.push(`<item objectid="${i+2}" transform="1 0 0 0 1 0 0 0 1 ${x} ${y} ${z}"/>`);});
  chunks.push('</build></model>');
  return zipSync({
    '[Content_Types].xml':strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels':strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model':strToU8(chunks.join(''))
  },{level:1});
}
export function download(bytes,name,type='application/octet-stream') {
  const url=URL.createObjectURL(new Blob([bytes],{type}));const a=document.getElementById('download-file')||document.createElement('a');if(a.href.startsWith('blob:'))URL.revokeObjectURL(a.href);a.href=url;a.download=name;a.textContent='Save '+name.split('.').at(-1).toUpperCase();a.hidden=false;if(!a.isConnected)document.body.append(a);a.click();
}
