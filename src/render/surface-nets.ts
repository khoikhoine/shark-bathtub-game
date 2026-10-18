export type Point3 = [number, number, number];
const EDGES = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]] as const;

/** Surface-nets extraction, ported from the original hammerhead's scalar-field mesh. */
export function buildSurfaceNets(field: (x: number, y: number, z: number) => number, min: Point3, max: Point3, spacing: number): { positions: Float32Array; indices: Uint32Array } {
  if (!(spacing > 0) || !Number.isFinite(spacing)) throw new Error('Surface spacing must be positive.');
  const nx = Math.ceil((max[0]-min[0])/spacing), ny = Math.ceil((max[1]-min[1])/spacing), nz = Math.ceil((max[2]-min[2])/spacing);
  const sx=nx+1, sy=ny+1, index=(x:number,y:number,z:number)=>x+sx*(y+sy*z);
  const samples=new Float32Array(sx*sy*(nz+1));
  for(let z=0;z<=nz;z++) for(let y=0;y<=ny;y++) for(let x=0;x<=nx;x++) samples[index(x,y,z)]=field(min[0]+x*spacing,min[1]+y*spacing,min[2]+z*spacing);
  const cells=new Int32Array(nx*ny*nz).fill(-1), cell=(x:number,y:number,z:number)=>x+nx*(y+ny*z);
  const positions:number[]=[], indices:number[]=[], values=new Float64Array(8);
  for(let z=0;z<nz;z++) for(let y=0;y<ny;y++) for(let x=0;x<nx;x++) {
    let mask=0;
    for(let k=0;k<8;k++) { values[k]=samples[index(x+(k&1),y+((k>>1)&1),z+((k>>2)&1))]; if(values[k]<0) mask|=1<<k; }
    if(mask===0||mask===255) continue;
    let px=0,py=0,pz=0,count=0;
    for(const [a,b] of EDGES) {
      if((values[a]<0)===(values[b]<0)) continue;
      const t=values[a]/(values[a]-values[b]);
      px+=(a&1)+t*((b&1)-(a&1)); py+=((a>>1)&1)+t*(((b>>1)&1)-((a>>1)&1)); pz+=((a>>2)&1)+t*(((b>>2)&1)-((a>>2)&1)); count++;
    }
    cells[cell(x,y,z)]=positions.length/3;
    positions.push(min[0]+(x+px/count)*spacing,min[1]+(y+py/count)*spacing,min[2]+(z+pz/count)*spacing);
  }
  const quad=(a:number,b:number,c:number,d:number,flip:boolean)=>{if(a<0||b<0||c<0||d<0)return; if(flip)indices.push(a,c,b,a,d,c);else indices.push(a,b,c,a,c,d);};
  for(let z=1;z<nz;z++) for(let y=1;y<ny;y++) for(let x=1;x<nx;x++) {
    const v=samples[index(x,y,z)];
    if((v<0)!==(samples[index(x+1,y,z)]<0))quad(cells[cell(x,y-1,z-1)],cells[cell(x,y,z-1)],cells[cell(x,y,z)],cells[cell(x,y-1,z)],v>=0);
    if((v<0)!==(samples[index(x,y+1,z)]<0))quad(cells[cell(x-1,y,z-1)],cells[cell(x-1,y,z)],cells[cell(x,y,z)],cells[cell(x,y,z-1)],v>=0);
    if((v<0)!==(samples[index(x,y,z+1)]<0))quad(cells[cell(x-1,y-1,z)],cells[cell(x,y-1,z)],cells[cell(x,y,z)],cells[cell(x-1,y,z)],v>=0);
  }
  return {positions:new Float32Array(positions),indices:new Uint32Array(indices)};
}
export function ell(x:number,y:number,z:number,a:number,b:number,c:number):number {
  const k0=Math.hypot(x/a,y/b,z/c),k1=Math.hypot(x/(a*a),y/(b*b),z/(c*c));
  return k1>1e-8?k0*(k0-1)/k1:-Math.min(a,b,c);
}
export function union(a:number,b:number,k=.13):number {const h=Math.max(0,Math.min(1,.5+.5*(b-a)/k));return b+(a-b)*h-k*h*(1-h);}
export function polygon(x:number,y:number,p:readonly number[]):number {
  let d=Infinity,inside=false;
  for(let i=0,j=p.length-2;i<p.length;j=i,i+=2){const ax=p[j],ay=p[j+1],bx=p[i],by=p[i+1],vx=bx-ax,vy=by-ay;const t=Math.max(0,Math.min(1,((x-ax)*vx+(y-ay)*vy)/(vx*vx+vy*vy)));d=Math.min(d,Math.hypot(x-ax-t*vx,y-ay-t*vy));if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;}
  return inside?-d:d;
}
export function extrude(d:number,t:number,r:number):number {return Math.hypot(Math.max(d,0),Math.max(t,0))+Math.min(Math.max(d,t),0)-r;}
