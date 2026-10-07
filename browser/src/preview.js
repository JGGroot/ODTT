import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COLORS } from './export.js';
export class Preview {
  constructor(container){
    this.container=container;this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,logarithmicDepthBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.setClearColor(0x000000,0);container.append(this.renderer.domElement);
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(35,1,.1,10000);this.camera.up.set(0,0,1);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.09;
    this.scene.add(new THREE.HemisphereLight(0xfffcf1,0x8a9b85,1));const key=new THREE.DirectionalLight(0xfffaf0,3);key.position.set(-300,-200,200);this.scene.add(key);const fill=new THREE.DirectionalLight(0xcce2de,.3);fill.position.set(200,200,100);this.scene.add(fill);
    this.group=new THREE.Group();this.scene.add(this.group);this.overlays=new THREE.Group();this.scene.add(this.overlays);this.gridOn=true;this.wire=false;
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.resize();
    const tick=()=>{this.frame=requestAnimationFrame(tick);this.controls.update();this.renderer.render(this.scene,this.camera);};tick();
  }
  resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  clear(group){for(const child of [...group.children]){group.remove(child);child.geometry?.dispose();if(Array.isArray(child.material))child.material.forEach(m=>m.dispose());else child.material?.dispose();}}
  setModel(tiles,settings){
    this.clear(this.group);this.clear(this.overlays);this.settings=settings;
    for(const tile of tiles)for(const o of tile.objects){
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(o.vertices,3));g.setIndex(new THREE.BufferAttribute(o.indices,1));g.computeVertexNormals();
      const material=new THREE.MeshStandardMaterial({color:COLORS[o.group]||COLORS.terrain,roughness:.78,metalness:0,wireframe:this.wire});
      if(o.labels){const colors=new Float32Array(o.vertices.length),names=['terrain','water','greenery','roads','runways','railways','buildings'];for(let i=0;i<o.vertices.length/3;i++){const c=new THREE.Color(COLORS[names[o.labels[i]||0]]);colors.set([c.r,c.g,c.b],i*3);}g.setAttribute('color',new THREE.BufferAttribute(colors,3));material.vertexColors=true;material.color.set(0xffffff);}
      const mesh=new THREE.Mesh(g,material);mesh.position.set(tile.tile.x,tile.tile.y,0);this.group.add(mesh);
    }
    const box=new THREE.Box3().setFromObject(this.group),maxZ=box.max.z;
    const lines=[];for(let c=0;c<=settings.cols;c++){const x=c*settings.width/settings.cols;lines.push(x,0,maxZ+.3,x,settings.height,maxZ+.3);}for(let r=0;r<=settings.rows;r++){const y=r*settings.height/settings.rows;lines.push(0,y,maxZ+.3,settings.width,y,maxZ+.3);}
    const lineGeo=new THREE.BufferGeometry();lineGeo.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));this.overlays.add(new THREE.LineSegments(lineGeo,new THREE.LineBasicMaterial({color:0x285d50,transparent:true,opacity:.28})));this.overlays.visible=this.gridOn;this.fit();
  }
  fit(top=false){if(!this.group.children.length)return;const box=new THREE.Box3().setFromObject(this.group),center=box.getCenter(new THREE.Vector3()),direction=(top?new THREE.Vector3(.00001,-.00001,1):new THREE.Vector3(.75,-.9,.82)).normalize(),right=new THREE.Vector3().crossVectors(this.camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right),tan=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2));let distance=1;for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new THREE.Vector3(x,y,z).sub(center);distance=Math.max(distance,p.dot(direction)+Math.abs(p.dot(right))/(tan*this.camera.aspect),p.dot(direction)+Math.abs(p.dot(up))/tan);}distance*=1.15;this.controls.target.copy(center);this.camera.position.copy(center).addScaledVector(direction,distance);this.camera.near=Math.max(.01,distance/10000);this.camera.far=distance*10;this.camera.updateProjectionMatrix();this.controls.update();}
  setGrid(value){this.gridOn=value;this.overlays.visible=value;}
  setWire(value){this.wire=value;for(const m of this.group.children)m.material.wireframe=value;}
}
