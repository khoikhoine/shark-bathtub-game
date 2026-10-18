import { BufferGeometry, Color, Float32BufferAttribute, Uint16BufferAttribute, Vector3 } from 'three/webgpu';
import type { Point3 } from './surface-nets.ts';

export interface SkinWeights {
  readonly indices:readonly [number,number,number,number];
  readonly weights:readonly [number,number,number,number];
}
export type Influence = readonly [number,number,number] | SkinWeights;
export interface SurfaceSample {
  point:Point3;
  normal:Point3;
  skin:SkinWeights;
}
export interface SurfaceSampler {
  sample(out:SurfaceSample,at:Readonly<Point3>,axis:0|1|2,side:-1|1):boolean;
}
export const WHITE_UV:readonly [number,number]=[.984,.984];
const WHITE=new Color(0xffffff);
export const clamp=(n:number,a=0,b=1):number=>Math.max(a,Math.min(b,n));
export const mix=(a:number,b:number,t:number):number=>a+(b-a)*t;
export const lerpPoint=(a:Point3,b:Point3,t:number):Point3=>[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];

/** Shape-preserving cubic Hermite; local extrema have zero slope. */
export function monotone(t:number,stations:readonly number[],values:readonly number[]):number {
  let i=0;while(i<stations.length-2&&t>stations[i+1])i++;
  const slope=(j:number)=>(values[j+1]-values[j])/(stations[j+1]-stations[j]);
  const tangent=(j:number)=>{
    if(j===0)return slope(0);if(j===values.length-1)return slope(j-1);
    const a=slope(j-1),b=slope(j);if(a*b<=0)return 0;
    const h0=stations[j]-stations[j-1],h1=stations[j+1]-stations[j];
    return (3*(h0+h1))/((2*h1+h0)/a+(h1+2*h0)/b);
  };
  const h=stations[i+1]-stations[i],u=clamp((t-stations[i])/h),u2=u*u,u3=u2*u;
  return Math.max(0,(2*u3-3*u2+1)*values[i]+(u3-2*u2+u)*h*tangent(i)+(-2*u3+3*u2)*values[i+1]+(u3-u2)*h*tangent(i+1));
}

/** Cubic path interpolation, used for flowing edges rather than polygon fans. */
export function curve(points:readonly Point3[],t:number):Point3 {
  const s=clamp(t)*(points.length-1),i=Math.min(points.length-2,Math.floor(s)),u=s-i;
  const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],d=points[Math.min(points.length-1,i+2)];
  return [0,1,2].map(k=>clamp(.5*((2*b[k])+(-a[k]+c[k])*u+(2*a[k]-5*b[k]+4*c[k]-d[k])*u*u+(-a[k]+3*b[k]-3*c[k]+d[k])*u*u*u),Math.min(b[k],c[k]),Math.max(b[k],c[k]))) as Point3;
}

export interface SweepStation { point:Point3; width:number; upper:number; lower:number; t:number }
export class FishGeometry {
  positions:number[]=[];indices:number[]=[];uv:number[]=[];colors:number[]=[];skin:number[]=[];weights:number[]=[];
  private seamPairs:Array<readonly [number,number]>=[];
  private normals=new Map<number,Point3>();
  private readonly bodyInset:number;
  constructor(bodyInset=1/512) {this.bodyInset=bodyInset;}
  bodyUV(t:number,circumference:number):readonly [number,number] {
    return [t,this.bodyInset+circumference*(.75-2*this.bodyInset)];
  }
  vertex(p:Point3,uv:readonly [number,number],influence:Influence,color=WHITE):number {
    const index=this.positions.length/3;this.positions.push(...p);this.uv.push(...uv);this.colors.push(color.r,color.g,color.b);
    if('indices' in influence){this.skin.push(...influence.indices);this.weights.push(...influence.weights);}
    else{this.skin.push(influence[0],influence[1],0,0);this.weights.push(1-influence[2],influence[2],0,0);}
    return index;
  }
  triangle(a:number,b:number,c:number):void {this.indices.push(a,b,c);}
  /** Freeze the body topology before details and mouth cuts are appended. */
  createSurfaceSampler():SurfaceSampler {
    const indices=new Uint32Array(this.indices),positions=this.positions,skin=this.skin,weights=this.weights;
    const normals=new Float64Array(positions.length),faceNormals=new Float64Array(indices.length);
    for(let i=0;i<indices.length;i+=3){
      const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
      const ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2];
      const vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2];
      const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;
      faceNormals[i]=x;faceNormals[i+1]=y;faceNormals[i+2]=z;
      for(let corner=0;corner<3;corner++){const vertex=indices[i+corner]*3;normals[vertex]+=x;normals[vertex+1]+=y;normals[vertex+2]+=z;}
    }
    // Join the unnormalized area sums, so seam vertices retain the same weighting.
    for(const [a,b] of this.seamPairs)for(let k=0;k<3;k++){
      const sum=normals[a*3+k]+normals[b*3+k];normals[a*3+k]=sum;normals[b*3+k]=sum;
    }
    for(const [index,normal] of this.normals)normals.set(normal,index*3);
    for(let i=0;i<normals.length;i+=3){
      const length=Math.hypot(normals[i],normals[i+1],normals[i+2])||1;
      normals[i]/=length;normals[i+1]/=length;normals[i+2]/=length;
    }
    // At most twelve contributions per hit; scratch is reused across all build-time casts.
    const bones=new Uint16Array(12),boneWeights=new Float64Array(12),epsilon=1e-6;
    return {sample(out,at,axis,side):boolean {
      const uAxis=(axis+1)%3,vAxis=(axis+2)%3;
      let hit=-1,best=-Infinity,hitU=0,hitV=0,hitW=0;
      for(let i=0;i<indices.length;i+=3){
        if(side*faceNormals[i+axis]<=0)continue;
        const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
        const au=positions[a+uAxis],av=positions[a+vAxis],bu=positions[b+uAxis],bv=positions[b+vAxis],cu=positions[c+uAxis],cv=positions[c+vAxis];
        const denominator=(bv-cv)*(au-cu)+(cu-bu)*(av-cv);
        if(denominator===0)continue;
        let u=((bv-cv)*(at[uAxis]-cu)+(cu-bu)*(at[vAxis]-cv))/denominator;
        let v=((cv-av)*(at[uAxis]-cu)+(au-cu)*(at[vAxis]-cv))/denominator,w=1-u-v;
        if(u< -epsilon||v< -epsilon||w< -epsilon)continue;
        // Epsilon accepts edge hits, but must not introduce negative skin weights.
        u=Math.max(0,u);v=Math.max(0,v);w=Math.max(0,w);
        const sum=u+v+w;u/=sum;v/=sum;w/=sum;
        const coordinate=u*positions[a+axis]+v*positions[b+axis]+w*positions[c+axis];
        if(side*coordinate>best){best=side*coordinate;hit=i;hitU=u;hitV=v;hitW=w;}
      }
      if(hit<0)return false;
      let count=0;
      for(let corner=0;corner<3;corner++){
        const index=indices[hit+corner],factor=corner===0?hitU:corner===1?hitV:hitW;
        for(let slot=0;slot<4;slot++){
          const bone=skin[index*4+slot],weight=weights[index*4+slot]*factor;
          if(weight<=0)continue;
          let j=0;while(j<count&&bones[j]!==bone)j++;
          if(j===count){bones[count]=bone;boneWeights[count]=0;count++;}
          boneWeights[j]+=weight;
        }
      }
      // Selection of just the largest four avoids sorting or allocating per-vertex entries.
      const resultIndices:[number,number,number,number]=[0,0,0,0],resultWeights:[number,number,number,number]=[0,0,0,0];
      let total=0;
      for(let slot=0;slot<Math.min(4,count);slot++){
        let selected=-1;
        for(let j=0;j<count;j++)if(boneWeights[j]>0&&(selected<0||boneWeights[j]>boneWeights[selected]||(boneWeights[j]===boneWeights[selected]&&bones[j]<bones[selected])))selected=j;
        if(selected<0)break;
        resultIndices[slot]=bones[selected];resultWeights[slot]=boneWeights[selected];total+=boneWeights[selected];boneWeights[selected]=0;
      }
      for(let slot=0;slot<4;slot++)resultWeights[slot]/=total;
      const a=indices[hit]*3,b=indices[hit+1]*3,c=indices[hit+2]*3;
      let nx=0,ny=0,nz=0;
      for(let k=0;k<3;k++)out.point[k]=hitU*positions[a+k]+hitV*positions[b+k]+hitW*positions[c+k];
      nx=hitU*normals[a]+hitV*normals[b]+hitW*normals[c];
      ny=hitU*normals[a+1]+hitV*normals[b+1]+hitW*normals[c+1];
      nz=hitU*normals[a+2]+hitV*normals[b+2]+hitW*normals[c+2];
      let length=Math.hypot(nx,ny,nz);
      if(length===0){nx=faceNormals[hit];ny=faceNormals[hit+1];nz=faceNormals[hit+2];length=Math.hypot(nx,ny,nz);}
      out.normal[0]=nx/length;out.normal[1]=ny/length;out.normal[2]=nz/length;
      out.skin={indices:resultIndices,weights:resultWeights};
      return true;
    }};
  }
  /** Cut a convex aperture from the skin, so a recessed opening is not hidden by the body. */
  openMouth(center:Point3,width:number,height:number,ventral:boolean):void {
    const axis=ventral?1:2,tangent=ventral?2:1,result:number[]=[],source=this.indices;
    const projected=(index:number):readonly [number,number]=>[(this.positions[index*3]-center[0])/width,(this.positions[index*3+tangent]-center[tangent])/height];
    const intersect=(a:number,b:number,t:number):number=>{
      const p:Point3=[mix(this.positions[a*3],this.positions[b*3],t),mix(this.positions[a*3+1],this.positions[b*3+1],t),mix(this.positions[a*3+2],this.positions[b*3+2],t)];
      const color=new Color().setRGB(mix(this.colors[a*3],this.colors[b*3],t),mix(this.colors[a*3+1],this.colors[b*3+1],t),mix(this.colors[a*3+2],this.colors[b*3+2],t));
      return this.vertex(p,[mix(this.uv[a*2],this.uv[b*2],t),mix(this.uv[a*2+1],this.uv[b*2+1],t)],[0,0,0],color);
    };
    for(let triangle=0;triangle<source.length;triangle+=3){
      const ids=[source[triangle],source[triangle+1],source[triangle+2]],p=ids.map(projected);
      const outward=(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]);
      if(outward<=1e-12){result.push(...ids);continue;}
      if(ids.every(i=>Math.abs(this.positions[i*3+axis]-center[axis])>.035)||Math.min(...p.map(v=>v[0]))>1||Math.max(...p.map(v=>v[0]))< -1||Math.min(...p.map(v=>v[1]))>1||Math.max(...p.map(v=>v[1]))< -1){result.push(...ids);continue;}
      let remaining=ids;
      // Triangle minus a regular 16-gon: retain each exterior slice, discard the interior.
      for(let edge=0;edge<16&&remaining.length>=3;edge++){
        const angle=(edge+.5)/16*Math.PI*2,nx=Math.cos(angle),ny=Math.sin(angle),limit=Math.cos(Math.PI/16),inside:number[]=[],outside:number[]=[];
        for(let i=0;i<remaining.length;i++){
          const a=remaining[i],b=remaining[(i+1)%remaining.length],pa=projected(a),pb=projected(b),da=limit-pa[0]*nx-pa[1]*ny,db=limit-pb[0]*nx-pb[1]*ny;
          if(da>=0)inside.push(a);else outside.push(a);
          if((da>=0)!==(db>=0)){const point=intersect(a,b,da/(da-db));inside.push(point);outside.push(point);}
        }
        for(let i=1;i<outside.length-1;i++)result.push(outside[0],outside[i],outside[i+1]);
        remaining=inside;
      }
    }
    this.indices=result;
  }
  /** Project a lip's outer rim onto the adjacent skin, leaving its inner rim recessed. */
  attachToSkin(point:Point3,ventral:boolean):void {
    const axis=ventral?1:2,tangent=ventral?2:1;let nearest=.04,coordinate=point[axis];
    for(let i=0;i<this.indices.length;i+=3){
      const a=this.indices[i]*3,b=this.indices[i+1]*3,c=this.indices[i+2]*3;
      const ax=this.positions[a],ay=this.positions[a+tangent],bx=this.positions[b],by=this.positions[b+tangent],cx=this.positions[c],cy=this.positions[c+tangent];
      const denominator=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(denominator)<1e-12)continue;
      const u=((by-cy)*(point[0]-cx)+(cx-bx)*(point[tangent]-cy))/denominator,v=((cy-ay)*(point[0]-cx)+(ax-cx)*(point[tangent]-cy))/denominator;
      if(u< -1e-6||v< -1e-6||u+v>1+1e-6)continue;
      const value=u*this.positions[a+axis]+v*this.positions[b+axis]+(1-u-v)*this.positions[c+axis],distance=Math.abs(value-point[axis]);
      if(distance<nearest){nearest=distance;coordinate=value;}
    }
    point[axis]=coordinate;
  }
  normal(index:number,n:Point3):void {this.normals.set(index,n);}
  sweep(stations:readonly SweepStation[],influence:(t:number)=>Influence,sides=24):void {
    const start=this.positions.length/3,frames:Point3[]=[];
    for(let j=0;j<stations.length;j++){
      const a=stations[Math.max(0,j-1)].point,b=stations[Math.min(stations.length-1,j+1)].point;
      // All centerlines live in YZ: this parallel frame remains continuous through the spiral.
      const tangent=new Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]).normalize();
      const up=new Vector3(1,0,0).cross(tangent).normalize();frames.push([up.x,up.y,up.z]);
      const s=stations[j];
      for(let i=0;i<=sides;i++){
        const theta=i/sides*Math.PI*2,sine=Math.sin(theta),height=sine>=0?s.upper:s.lower;
        this.vertex([s.point[0]+Math.cos(theta)*s.width,s.point[1]+up.y*sine*height,s.point[2]+up.z*sine*height],this.bodyUV(s.t,i/sides),influence(s.t));
      }
      this.seamPairs.push([start+j*(sides+1),start+j*(sides+1)+sides]);
    }
    for(let j=0;j<stations.length-1;j++)for(let i=0;i<sides;i++){
      const a=start+j*(sides+1)+i,b=a+1,d=a+sides+1,c=d+1;this.indices.push(a,d,b,b,d,c);
    }
    // Independent cap vertices keep cap normals out of the sweep's smooth surface.
    for(const j of [0,stations.length-1]){
      const s=stations[j],up=frames[j],center=this.vertex(s.point,[s.t,.375],influence(s.t)),ring=this.positions.length/3;
      for(let i=0;i<sides;i++){
        const theta=i/sides*Math.PI*2,sy=Math.sin(theta),height=sy>=0?s.upper:s.lower;
        this.vertex([s.point[0]+Math.cos(theta)*s.width,s.point[1]+up[1]*sy*height,s.point[2]+up[2]*sy*height],this.bodyUV(s.t,i/sides),influence(s.t));
      }
      for(let i=0;i<sides;i++)if(j===0)this.triangle(center,ring+i,ring+(i+1)%sides);else this.triangle(center,ring+(i+1)%sides,ring+i);
    }
  }
  /** Twelve curved rays, each with four chordwise membrane segments. */
  membrane(root:readonly Point3[],edge:readonly Point3[],influence:(span:number,distal:number,root:Readonly<Point3>,rootSkin?:SkinWeights)=>Influence,options:{fold?:number;uvScale?:number;solid?:Color;island?:readonly [number,number];surface?:{sampler:SurfaceSampler;axis:0|1|2;side:-1|1;region:string}}={}):void {
    const start=this.positions.length/3,roots:Point3[]=[],skins:Array<SkinWeights|undefined>=[],surface=options.surface;
    const sample:SurfaceSample={point:[0,0,0],normal:[0,0,0],skin:{indices:[0,0,0,0],weights:[1,0,0,0]}};
    const project=(at:Readonly<Point3>,axis:0|1|2,side:-1|1):void=>{
      if(!surface!.sampler.sample(sample,at,axis,side))throw new Error(`missing ${surface!.region} surface`);
    };
    // Project each emitted root once; adjacent projected roots also define its tangent.
    for(let ray=0;ray<=12;ray++){
      const a=curve(root,ray/12);
      if(surface){
        if(surface.axis===0){
          const guide:Point3=[0,a[1],a[2]];
          project(guide,1,-1);const low=sample.point[1];
          project(guide,1,1);const high=sample.point[1],margin=.1*(high-low);
          a[1]=clamp(a[1],low+margin,high-margin);
        }
        project(a,surface.axis,surface.side);
        for(let k=0;k<3;k++)a[k]=sample.point[k]-.002*sample.normal[k];
        skins.push(sample.skin);
      }
      roots.push(a);
    }
    for(let ray=0;ray<=12;ray++){
      const span=ray/12,a=roots[ray],b=curve(edge,span),previous=roots[Math.max(0,ray-1)],next=roots[Math.min(12,ray+1)];
      const tx=next[0]-previous[0],ty=next[1]-previous[1],tz=next[2]-previous[2],dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];
      const nx=ty*dz-tz*dy,ny=tz*dx-tx*dz,nz=tx*dy-ty*dx,length=Math.hypot(nx,ny,nz),fold=options.fold??.004;
      for(let chord=0;chord<=4;chord++){
        const distal=chord/4,p=lerpPoint(a,b,distal);
        if(chord>0&&chord<4&&length>1e-12){
          const camber=fold*Math.sin(Math.PI*distal)*(Math.sin(Math.PI*span)+.35*Math.cos(12*Math.PI*span))/length;
          p[0]+=nx*camber;p[1]+=ny*camber;p[2]+=nz*camber;
        }
        const u=distal*(options.uvScale??1),v=.75+span*.25;
        this.vertex(p,options.island??(options.solid?WHITE_UV:[u,u>.95&&v>.955?.955:v]),influence(span,distal,a,skins[ray]),options.solid??WHITE);
      }
    }
    for(let ray=0;ray<12;ray++)for(let chord=0;chord<4;chord++){
      const a=start+ray*5+chord,b=a+1,d=a+5,c=d+1;this.indices.push(a,b,d,b,c,d);
    }
  }
  /** Small tapered skin spines/teeth; never square-ended rods. */
  cone(a:Point3,b:Point3,r:number,influence:Influence,color=WHITE,sides=5,tipInfluence:Influence=influence):void {
    const axis=new Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]).normalize();
    const u=new Vector3(Math.abs(axis.y)>.9?1:0,Math.abs(axis.y)>.9?0:1,0).cross(axis).normalize(),v=axis.clone().cross(u);
    const start=this.positions.length/3;
    for(let i=0;i<sides;i++){const angle=i/sides*Math.PI*2;this.vertex([a[0]+r*(u.x*Math.cos(angle)+v.x*Math.sin(angle)),a[1]+r*(u.y*Math.cos(angle)+v.y*Math.sin(angle)),a[2]+r*(u.z*Math.cos(angle)+v.z*Math.sin(angle))],WHITE_UV,influence,color);}
    const tip=this.vertex(b,WHITE_UV,tipInfluence,color),base=this.vertex(a,WHITE_UV,influence,color);
    for(let i=0;i<sides;i++){this.triangle(start+i,start+(i+1)%sides,tip);this.triangle(base,start+(i+1)%sides,start+i);}
  }
  /** Thin curved lip/gill/feeler ribbon with six-sided continuous cross section. */
  line(points:readonly Point3[],radius:number,influence:Influence,color:Color,segments=12):void {
    const start=this.positions.length/3;
    for(let j=0;j<=segments;j++){
      const t=j/segments,p=curve(points,t),a=curve(points,Math.max(0,t-.001)),b=curve(points,Math.min(1,t+.001));
      const axis=new Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]).normalize();
      const u=new Vector3(Math.abs(axis.y)>.9?1:0,Math.abs(axis.y)>.9?0:1,0).cross(axis).normalize(),v=axis.clone().cross(u);
      const r=radius*(.4+.6*Math.sin(Math.PI*t));
      for(let i=0;i<6;i++){const angle=i/6*Math.PI*2;this.vertex([p[0]+r*(u.x*Math.cos(angle)+v.x*Math.sin(angle)),p[1]+r*(u.y*Math.cos(angle)+v.y*Math.sin(angle)),p[2]+r*(u.z*Math.cos(angle)+v.z*Math.sin(angle))],WHITE_UV,influence,color);}
    }
    for(let j=0;j<segments;j++)for(let i=0;i<6;i++){const a=start+j*6+i,b=start+j*6+(i+1)%6,d=a+6,c=b+6;this.indices.push(a,b,d,b,c,d);}
  }
  ellipsoid(center:Point3,radius:Point3,influence:Influence,color:Color,rings=6,sides=10):void {
    const start=this.positions.length/3;
    for(let j=0;j<=rings;j++)for(let i=0;i<=sides;i++){
      const phi=j/rings*Math.PI,theta=i/sides*Math.PI*2;
      this.vertex([center[0]+radius[0]*Math.sin(phi)*Math.cos(theta),center[1]+radius[1]*Math.cos(phi),center[2]+radius[2]*Math.sin(phi)*Math.sin(theta)],WHITE_UV,influence,color);
    }
    for(let j=0;j<rings;j++)for(let i=0;i<sides;i++){
      const a=start+j*(sides+1)+i,b=a+1,d=a+sides+1,c=d+1;this.indices.push(a,b,d,b,c,d);
    }
  }
  /** Local X follows the skin normal; local Y stays upright in its tangent plane. */
  orientedEllipsoid(center:Point3,normal:Point3,radii:Point3,influence:Influence,color:Color,rings=6,sides=12):void {
    const length=Math.hypot(...normal);
    if(!(length>0))throw new Error('Invalid ellipsoid normal');
    const nx=normal[0]/length,ny=normal[1]/length,nz=normal[2]/length;
    const useZ=Math.abs(ny)>.99,dot=useZ?nz:ny;
    let yx=-dot*nx,yy=(useZ?0:1)-dot*ny,yz=(useZ?1:0)-dot*nz;
    const yLength=Math.hypot(yx,yy,yz);yx/=yLength;yy/=yLength;yz/=yLength;
    const zx=ny*yz-nz*yy,zy=nz*yx-nx*yz,zz=nx*yy-ny*yx,start=this.positions.length/3;
    for(let j=0;j<=rings;j++)for(let i=0;i<=sides;i++){
      const phi=j/rings*Math.PI,theta=i/sides*Math.PI*2;
      const x=radii[0]*Math.sin(phi)*Math.cos(theta),y=radii[1]*Math.cos(phi),z=radii[2]*Math.sin(phi)*Math.sin(theta);
      this.vertex([center[0]+nx*x+yx*y+zx*z,center[1]+ny*x+yy*y+zy*z,center[2]+nz*x+yz*y+zz*z],WHITE_UV,influence,color);
    }
    for(let j=0;j<rings;j++)for(let i=0;i<sides;i++){
      const a=start+j*(sides+1)+i,b=a+1,d=a+sides+1,c=d+1;this.indices.push(a,b,d,b,c,d);
    }
  }
  finish():BufferGeometry {
    const geometry=new BufferGeometry();
    try{
      geometry.setAttribute('position',new Float32BufferAttribute(this.positions,3));geometry.setAttribute('uv',new Float32BufferAttribute(this.uv,2));geometry.setAttribute('color',new Float32BufferAttribute(this.colors,3));
      geometry.setAttribute('skinIndex',new Uint16BufferAttribute(this.skin,4));geometry.setAttribute('skinWeight',new Float32BufferAttribute(this.weights,4));geometry.setIndex(this.indices);geometry.computeVertexNormals();
      const normal=geometry.getAttribute('normal');
      for(const [a,b] of this.seamPairs){const x=normal.getX(a)+normal.getX(b),y=normal.getY(a)+normal.getY(b),z=normal.getZ(a)+normal.getZ(b),length=Math.hypot(x,y,z)||1;normal.setXYZ(a,x/length,y/length,z/length);normal.setXYZ(b,x/length,y/length,z/length);}
      for(const [i,n] of this.normals)normal.setXYZ(i,n[0],n[1],n[2]);
      geometry.computeBoundingSphere();return geometry;
    }catch(error){geometry.dispose();throw error;}
  }
}
