import { waterBounds } from '../data/balance.ts';
export const WATER_Y=1.27;
export const FLOOR_Y=-.235;
export const SCRUB_Y=-.21;
export const SCRUB_RADIUS=.55;
export function isInsideWater(level:number,x:number,z:number):boolean {
  if(!Number.isFinite(x)||!Number.isFinite(z))return false;
  const b=waterBounds(level),lx=x/(b.x/2.2),lz=z/b.z;
  if(Math.abs(lx)>2.2||Math.abs(lz)>1)return false;
  const dx=Math.max(Math.abs(lx)-1.7,0),dz=Math.max(Math.abs(lz)-.5,0);
  return dx*dx+dz*dz<=.25;
}
export function waterSignedDistance(level:number,x:number,z:number):number {
  if(!Number.isFinite(x)||!Number.isFinite(z))return Infinity;
  const b=waterBounds(level),sx=b.x/2.2,sz=b.z,qx=Math.abs(x/sx)-1.7,qz=Math.abs(z/sz)-.5;
  return (Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0)-.5)*Math.min(sx,sz);
}
export function getScrubCellMask(level:number,x:number,z:number):number {
  if(!isInsideWater(level,x,z))return 0;
  const b=waterBounds(level);let mask=0;
  for(let i=0;i<20;i++){
    const cx=-b.x+(i%5+.5)*2*b.x/5,cz=-b.z+(Math.floor(i/5)+.5)*2*b.z/4;
    const dx=Math.max(0,Math.abs(cx-x)-b.x/5),dz=Math.max(0,Math.abs(cz-z)-b.z/4);
    if(dx*dx+dz*dz<=SCRUB_RADIUS*SCRUB_RADIUS)mask|=1<<i;
  }
  return mask;
}
