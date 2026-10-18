export interface FeedGesture {pointerId:number|null;nextAtMs:number}
export function createFeedGesture():FeedGesture {return {pointerId:null,nextAtMs:Infinity};}
export function startFeedGesture(state:FeedGesture,pointerId:number,nowMs:number):void {
  if(state.pointerId!==null)return;
  state.pointerId=pointerId;state.nextAtMs=nowMs+300;
}
export function pollFeedGesture(state:FeedGesture,nowMs:number):boolean {
  if(state.pointerId===null||nowMs<state.nextAtMs)return false;
  state.nextAtMs=nowMs+250;return true;
}
export function cancelFeedGesture(state:FeedGesture):void {state.pointerId=null;state.nextAtMs=Infinity;}
