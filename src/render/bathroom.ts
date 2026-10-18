import { AmbientLight, BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, DoubleSide, Float32BufferAttribute, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, MeshStandardNodeMaterial, Path, PlaneGeometry, Scene, Shape, ShapeGeometry, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector3 } from 'three/webgpu';
import { color, float, mix, normalView, positionLocal, positionWorld, sin, cos, uniform, uniformArray, vec3 } from 'three/tsl';
import type { RunState } from '../sim/types.ts';
import { waterBounds } from '../data/balance.ts';
import { WATER_Y, FLOOR_Y, SCRUB_Y } from '../sim/water.ts';

export interface Bathroom { root:Group; update:(run:RunState,time:number)=>void; ripple:(x:number,z:number,time:number)=>void; dispose:()=>void }

function roundedPath(target:Shape|Path,x:number,z:number,r:number):void {
  target.moveTo(-x+r,-z);target.lineTo(x-r,-z);target.quadraticCurveTo(x,-z,x,-z+r);target.lineTo(x,z-r);target.quadraticCurveTo(x,z,x-r,z);target.lineTo(-x+r,z);target.quadraticCurveTo(-x,z,-x,z-r);target.lineTo(-x,-z+r);target.quadraticCurveTo(-x,-z,-x+r,-z);
}

/** Rounded ceramic cross-section: exterior, rolled rim and a real inset basin. */
function ceramicGeometry():BufferGeometry {
  const loops=[{x:2.12,z:.99,y:-.56,r:.49},{x:2.45,z:1.25,y:.95,r:.57},{x:2.46,z:1.26,y:1.2,r:.58},{x:2.35,z:1.16,y:1.29,r:.53},{x:2.2,z:1,y:1.28,r:.5},{x:2.2,z:1,y:.94,r:.48},{x:2.2,z:1,y:-.25,r:.42}];
  const positions:number[]=[],indices:number[]=[],segments=64;
  for(const loop of loops)for(let i=0;i<segments;i++){
    const corner=Math.floor(i/16);
    // Four quarter-arcs, connected by the straight sides of the basin.
    const a=corner*Math.PI/2+(i%16)/16*Math.PI/2;
    const centers=[[loop.x-loop.r,loop.z-loop.r],[-loop.x+loop.r,loop.z-loop.r],[-loop.x+loop.r,-loop.z+loop.r],[loop.x-loop.r,-loop.z+loop.r]];
    const center=centers[corner];positions.push(center[0]+Math.cos(a)*loop.r,loop.y,center[1]+Math.sin(a)*loop.r);
  }
  for(let j=0;j<loops.length-1;j++)for(let i=0;i<segments;i++){const a=j*segments+i,b=j*segments+(i+1)%segments,c=b+segments,d=a+segments;indices.push(a,b,d,b,c,d);}
  const center=positions.length/3;positions.push(0,-.25,0);for(let i=0;i<segments;i++)indices.push(center,(loops.length-1)*segments+i,(loops.length-1)*segments+(i+1)%segments);
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setIndex(indices);
  g.addGroup(0,4*segments*6,0);g.addGroup(4*segments*6,2*segments*6,1);g.addGroup(6*segments*6,segments*3,0);
  g.computeVertexNormals();return g;
}

/** Interior vertices carry displacement; corner vertices follow the shared circular water boundary. */
function waterSurfaceGeometry():BufferGeometry {
  const columns=64,rows=32,vertexCount=(columns+1)*(rows+1);
  const positions=new Float32Array(vertexCount*3),normals=new Float32Array(vertexCount*3),uvs=new Float32Array(vertexCount*2),indices:number[]=[];
  for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++){
    let x=-2.2+4.4*column/columns,z=-1+2*row/rows;
    const dx=Math.max(Math.abs(x)-1.7,0),dz=Math.max(Math.abs(z)-.5,0),distance=Math.hypot(dx,dz);
    if(distance>.5){const scale=.5/distance;x=Math.sign(x)*(1.7+dx*scale);z=Math.sign(z)*(.5+dz*scale);}
    const vertex=row*(columns+1)+column;
    positions[vertex*3]=x;positions[vertex*3+2]=z;normals[vertex*3+1]=1;
    uvs[vertex*2]=x/4.4+.5;uvs[vertex*2+1]=z/2+.5;
  }
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const a=row*(columns+1)+column,b=a+1,c=a+columns+1,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));
  geometry.setIndex(indices);return geometry;
}

/** A thin vertical ribbon follows the same circular rounded boundary as the water. */
function meniscusGeometry():BufferGeometry {
  const positions:number[]=[],indices:number[]=[],segments=128,radius=.5-.004;
  for(let ring=0;ring<2;ring++)for(let i=0;i<segments;i++){
    const corner=Math.floor(i/32),angle=corner*Math.PI/2+(i%32)/32*Math.PI/2;
    const cx=corner===0||corner===3?1.7:-1.7,cz=corner<2?.5:-.5;
    positions.push(cx+Math.cos(angle)*radius,WATER_Y+(ring===0?-.012:.006),cz+Math.sin(angle)*radius);
  }
  for(let i=0;i<segments;i++){const next=(i+1)%segments;indices.push(i,i+segments,next,next,i+segments,next+segments);}
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

export function createBathroom(scene:Scene):Bathroom {
  const root=new Group(),bath=new Group();root.add(bath);scene.add(root);
  const geometries:BufferGeometry[]=[],materials:(MeshStandardMaterial|MeshBasicMaterial|MeshStandardNodeMaterial)[]=[];
  const ceramic=new MeshStandardMaterial({color:0xe7f6fa,roughness:.22,metalness:.025,side:DoubleSide});
  const innerCeramic=new MeshStandardNodeMaterial({roughness:.22,metalness:.025,side:DoubleSide});
  const depth=float(WATER_Y).sub(positionLocal.y).div(WATER_Y-FLOOR_Y).clamp(0,1);
  const submergedTint=depth.greaterThan(0).select(depth.mul(.5).add(.3),float(0));
  innerCeramic.colorNode=mix(color('#e7f6fa'),color('#5cb9c4'),submergedTint);materials.push(innerCeramic);
  const chrome=new MeshStandardMaterial({color:0xb5d4df,roughness:.2,metalness:.85});
  const wood=new MeshStandardMaterial({color:0x538997,roughness:.8});
  const towelMaterial=new MeshStandardMaterial({color:0x67c3b4,roughness:1});
  const grout=new MeshStandardMaterial({color:0x86b7c8,roughness:1});materials.push(ceramic,chrome,wood,towelMaterial,grout);
  const boxGeometry=new BoxGeometry(1,1,1),sphereGeometry=new SphereGeometry(1,14,10),cylinderGeometry=new CylinderGeometry(1,1,1,16);geometries.push(boxGeometry,sphereGeometry,cylinderGeometry);
  const box=(parent:Group,material:MeshStandardMaterial,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{const mesh=new Mesh(boxGeometry,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;};
  const cylinder=(parent:Group,material:MeshStandardMaterial,x:number,y:number,z:number,r:number,h:number)=>{const mesh=new Mesh(cylinderGeometry,material);mesh.position.set(x,y,z);mesh.scale.set(r,h,r);mesh.castShadow=true;parent.add(mesh);return mesh;};
  const tubGeometry=ceramicGeometry();geometries.push(tubGeometry);const tub=new Mesh(tubGeometry,[ceramic,innerCeramic]);tub.castShadow=true;tub.receiveShadow=true;bath.add(tub);
  for(const x of [-1.55,1.55])for(const z of [-.65,.65]){const foot=new Mesh(sphereGeometry,chrome);foot.position.set(x,-.68,z);foot.scale.set(.19,.22,.14);bath.add(foot);}
  cylinder(bath,chrome,1.76,1.54,-1.04,.057,.58);
  const bendGeometry=new TorusGeometry(.18,.056,8,18,Math.PI);geometries.push(bendGeometry);const bend=new Mesh(bendGeometry,chrome);bend.position.set(1.76,1.82,-.86);bend.rotation.y=Math.PI/2;bath.add(bend);
  cylinder(bath,chrome,1.76,1.68,-.68,.057,.28);
  for(const x of [1.43,2.06]){cylinder(bath,chrome,x,1.3,-1.02,.055,.13);box(bath,chrome,x,1.38,-1.02,.23,.037,.046);}
  // A compact tiled surround keeps the bathtub as the architectural focus.
  box(root,grout,0,-.975,0,10,.15,6);box(root,grout,0,.2,-2.06,10,2.2,.12);
  const tileGeometry=new BoxGeometry(.97,.05,.97),tileMaterial=new MeshStandardMaterial({color:0xffffff,roughness:.84});geometries.push(tileGeometry);materials.push(tileMaterial);
  const tiles=new InstancedMesh(tileGeometry,tileMaterial,60),matrix=new Matrix4();let tile=0;
  for(let x=0;x<10;x++)for(let z=0;z<6;z++){matrix.makeTranslation(x-4.5,-.9,z-2.5);tiles.setMatrixAt(tile,matrix);tiles.setColorAt(tile,new Color((x+z)%3===0?0xa7d5e5:0xbce8e7));tile++;}tiles.receiveShadow=true;root.add(tiles);
  const wallTileGeometry=new BoxGeometry(.98,.53,.06),wallTileMaterial=new MeshStandardMaterial({color:0xffffff,roughness:.58});geometries.push(wallTileGeometry);materials.push(wallTileMaterial);
  const wallTiles=new InstancedMesh(wallTileGeometry,wallTileMaterial,40);tile=0;for(let x=0;x<10;x++)for(let y=0;y<4;y++){matrix.makeTranslation(x-4.5,-.625+y*.55,-1.97);wallTiles.setMatrixAt(tile,matrix);wallTiles.setColorAt(tile,new Color(y%2===0?0xa9dce5:0xc4e9f0));tile++;}wallTiles.receiveShadow=true;root.add(wallTiles);
  box(bath,towelMaterial,-.65,1.34,-1.1,.45,.09,.22);
  // Keep the soap tray on the rim within the close-up composition.
  box(bath,wood,-1.55,1.31,-1.05,.7,.065,.33);const soapMaterial=new MeshStandardMaterial({color:0x83cce5,roughness:.6});materials.push(soapMaterial);box(bath,soapMaterial,-1.55,1.39,-1.05,.39,.11,.2);
  // Procedural node shading: actual water displacement plus animated basin caustics.
  const clock=uniform(0),turbidity=uniform(.05);
  // Each vec3 stores world X/Z and its start time; mutating the backing entries avoids drop-time allocations.
  const rippleData=Array.from({length:8},()=>new Vector3(0,0,-100)),ripples=uniformArray<'vec3'>(rippleData,'vec3');
  let nextRipple=0;
  const waterMaterial=new MeshStandardNodeMaterial({transparent:true,depthWrite:false,roughness:.10,metalness:.02,side:DoubleSide});materials.push(waterMaterial);
  const wave=sin(positionLocal.x.mul(5).add(clock.mul(1.1))).mul(cos(positionLocal.z.mul(7).sub(clock.mul(.8)))).mul(.009);
  let displacement=wave;
  // Build eight independent shader contributions once, not a runtime shader loop.
  for(let i=0;i<8;i++){
    const ripple=ripples.element(i),radius=positionWorld.xz.sub(ripple.xy).length(),age=clock.sub(ripple.z).max(0);
    const lifetime=float(1).sub(age.div(1.25)).max(0);
    const ring=sin(radius.mul(23).sub(age.mul(11))).mul(radius.sub(age.mul(.65)).abs().mul(-6).exp()).mul(age.mul(-1.5).exp()).mul(lifetime).mul(.018);
    displacement=displacement.add(ring);
  }
  waterMaterial.positionNode=positionLocal.add(vec3(0,displacement,0));
  waterMaterial.colorNode=mix(color('#21a9cd'),color('#238b83'),turbidity.mul(.4));
  waterMaterial.opacityNode=float(.24).add(turbidity.clamp(0,1).mul(.08));
  waterMaterial.normalNode=normalView.add(vec3(sin(positionWorld.x.mul(7).add(clock)).mul(.035),cos(positionWorld.z.mul(6).sub(clock)).mul(.025),0)).normalize();
  const waterGeometry=waterSurfaceGeometry();geometries.push(waterGeometry);const water=new Mesh(waterGeometry,waterMaterial);water.position.y=WATER_Y;water.renderOrder=3;bath.add(water);
  const meniscus=meniscusGeometry(),meniscusMaterial=new MeshBasicMaterial({color:0xa8f5e6,opacity:.65,transparent:true,depthWrite:false,side:DoubleSide});
  geometries.push(meniscus);materials.push(meniscusMaterial);const waterline=new Mesh(meniscus,meniscusMaterial);waterline.renderOrder=4;bath.add(waterline);
  const floorShape=new Shape();roundedPath(floorShape,2.2,1,.42);const floorGeometry=new ShapeGeometry(floorShape,12);floorGeometry.rotateX(-Math.PI/2);geometries.push(floorGeometry);
  const floorMaterial=new MeshStandardNodeMaterial({roughness:.34,side:DoubleSide});materials.push(floorMaterial);
  const caustic=sin(positionWorld.x.mul(12).add(sin(positionWorld.z.mul(9).add(clock.mul(.8))))).mul(cos(positionWorld.z.mul(13).sub(clock.mul(.6)))).abs().pow(10);
  floorMaterial.colorNode=mix(color('#4b98ac'),color('#92e2d4'),caustic.mul(.32));floorMaterial.emissiveNode=vec3(caustic.mul(.025),caustic.mul(.055),caustic.mul(.06));
  const floor=new Mesh(floorGeometry,floorMaterial);floor.position.y=FLOOR_Y;floor.receiveShadow=true;bath.add(floor);
  const dirtCanvas=document.createElement('canvas');dirtCanvas.width=64;dirtCanvas.height=64;const ctx=dirtCanvas.getContext('2d');if(ctx){const gradient=ctx.createRadialGradient(32,32,2,32,32,34);gradient.addColorStop(0,'rgba(72,89,43,.95)');gradient.addColorStop(.6,'rgba(86,100,49,.7)');gradient.addColorStop(1,'rgba(91,104,51,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);}
  const dirtTexture=new CanvasTexture(dirtCanvas);dirtTexture.colorSpace=SRGBColorSpace;
  const patchGeometry=new PlaneGeometry(1,1);patchGeometry.rotateX(-Math.PI/2);geometries.push(patchGeometry);const patches:Mesh<PlaneGeometry,MeshBasicMaterial>[]=[];
  for(let i=0;i<20;i++){const material=new MeshBasicMaterial({map:dirtTexture,transparent:true,depthWrite:false,opacity:0,side:DoubleSide});materials.push(material);const patch=new Mesh(patchGeometry,material);patch.position.set(-2.2+(i%5+.5)*.88,SCRUB_Y-.01,-1+(Math.floor(i/5)+.5)*.5);patch.scale.set(1.08,1,.73);patch.renderOrder=1;bath.add(patch);patches.push(patch);}
  const flashes:Mesh<PlaneGeometry,MeshBasicMaterial>[]=[],previousDirt=new Float64Array(20),flashAt=new Float64Array(20).fill(-Infinity);let previousRun:RunState|null=null;
  for(let i=0;i<20;i++){
    const material=new MeshBasicMaterial({color:0xe8f8d0,transparent:true,depthWrite:false,opacity:0,side:DoubleSide});materials.push(material);
    const flash=new Mesh(patchGeometry,material);flash.position.set(-2.2+(i%5+.5)*.88,SCRUB_Y+.005,-1+(Math.floor(i/5)+.5)*.5);flash.scale.set(.84,1,.46);flash.visible=false;bath.add(flash);flashes.push(flash);
  }
  const drainGeometry=new CylinderGeometry(.085,.085,.013,20);geometries.push(drainGeometry);const drain=new Mesh(drainGeometry,chrome);drain.position.set(1.65,-.215,0);bath.add(drain);
  const ambient=new AmbientLight(0xf1fbff,.35),hemisphere=new HemisphereLight(0xc3efff,0x4a8b98,1.2),sun=new DirectionalLight(0xf2fbff,2.3);sun.position.set(-3,7,4);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-6;sun.shadow.camera.right=6;sun.shadow.camera.top=5;sun.shadow.camera.bottom=-5;sun.shadow.normalBias=.035;sun.shadow.bias=-.0005;root.add(ambient,hemisphere,sun);
  let level=-1;
  return {root,update(run,time){
    clock.value=time;let dirt=0;
    const replaced=run!==previousRun;previousRun=run;
    for(let i=0;i<20;i++){
      const value=run.dirt[i];dirt+=value;patches[i].material.opacity=value*.85;
      if(replaced)flashAt[i]=-Infinity;else if(previousDirt[i]-value>.02)flashAt[i]=time;
      previousDirt[i]=value;const opacity=.55*Math.max(0,1-(time-flashAt[i])/.20);
      flashes[i].material.opacity=opacity;flashes[i].visible=opacity>0;
    }
    turbidity.value=dirt/20;
    if(level!==run.bathLevel){level=run.bathLevel;const bounds=waterBounds(level);bath.scale.set(bounds.x/2.2,1,bounds.z);}
  },ripple(x,z,time){(ripples.array[nextRipple] as Vector3).set(x,z,time);nextRipple=(nextRipple+1)%8;},dispose(){root.removeFromParent();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();dirtTexture.dispose();sun.shadow.dispose();}};
}
