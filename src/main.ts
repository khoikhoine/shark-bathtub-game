import './style.css';
import { applyScrubMask, collapseMotionInterpolation, createGame, dispatchAction, isBankrupt, resetRunRuntime, restartGame, step, getFishStats } from './sim/engine.ts';
import { species } from './data/catalog.ts';
import { FIXED_DT } from './data/balance.ts';
import { getScrubCellMask, isInsideWater } from './sim/water.ts';
import { decodeSave, encodeSave, loadStoredSave, reconcileOffline, SAVE_KEY, storeSave } from './persistence/save.ts';
import { createAquarium } from './render/scene.ts';
import type { Aquarium } from './render/scene.ts';
import { createPanel } from './ui/panel.ts';
import { t, formatNumber } from './ui/i18n.ts';
import { createAudio } from './audio.ts';
import type { ActionResult, GameAction, GameEvent, Locale, Mode, SaveV1, WaterPointerSample } from './sim/types.ts';

const root=document.querySelector<HTMLElement>('#app')!;
const audio=createAudio();
let save:SaveV1|undefined, aquarium:Aquarium|undefined;
let mode:Mode='inspect', foreign=false, gpuFailed=false, modalPause=false, revealBusy=false, uiModalOpen=false, sheetOpen=false, bankruptDialog=false;
let accumulator=0,lastFrame=0,lastUI=0,lastSave=0;
let pendingScrubMask=0,selectedFishId:string|null=null;
let lastScrub:{x:number;z:number}|null=null;
const seed=():number=>{const values=new Uint32Array(1);do{crypto.getRandomValues(values);}while(values[0]===0);return values[0];};
const locale=():Locale=>save?.settings.language??'vi';
const panel=createPanel(root,{
 onAction:action=>{void act(action);},
 onMode:next=>{clearPendingInput();mode=next;aquarium?.setMode(next);panel.setMode(next);syncInteractionEnabled();},
 onLanguage:language=>{if(!save||foreign||gpuFailed)return;save.settings.language=language;document.documentElement.lang=language;panel.update(save);if(document.querySelector('#storage-warning'))showStorageWarning();checkpoint();},
 onMute:()=>{if(!save||foreign||gpuFailed)return;save.settings.muted=!save.settings.muted;audio.setMuted(save.settings.muted);panel.update(save);checkpoint();},
 onExport:()=>{if(save)download(encodeSave({...save,savedAtMs:Date.now()}));},
 onImport:file=>{void importFile(file);},
 onRestart:()=>{void restart();},
 onDialogChange:open=>{uiModalOpen=open;syncInteractionEnabled();},
 onSheetChange:open=>{sheetOpen=open;clearPendingInput();syncInteractionEnabled();if(!open)void checkBankruptcy();},
 onSelectFish:id=>{if(actionEnabled())selectFish(id,true);},
});
function actionEnabled():boolean {
 return !!save&&!foreign&&!gpuFailed&&!document.hidden&&!modalPause&&!uiModalOpen&&!revealBusy;
}
function worldInteractionEnabled():boolean {return actionEnabled()&&!sheetOpen;}
function clearPendingInput():void {pendingScrubMask=0;lastScrub=null;aquarium?.cancelInteraction();}
function syncInteractionEnabled():void {
 const enabled=worldInteractionEnabled();if(!enabled){pendingScrubMask=0;lastScrub=null;}aquarium?.setInteractionEnabled(enabled);
}
function selectFish(id:string|null,openDetails=false):void {
 selectedFishId=id&&save?.run.fish.some(f=>f.id===id)?id:null;
 panel.selectFish(selectedFishId,openDetails);aquarium?.setSelectedFish(selectedFishId);
}
function replaceSave(next:SaveV1,clearSelection:boolean):void {
 if(save&&save.run!==next.run)resetRunRuntime(save.run);
 clearPendingInput();accumulator=0;lastFrame=0;
 save=next;document.documentElement.lang=next.settings.language;audio.setMuted(next.settings.muted);
 panel.update(next);selectFish(clearSelection?null:selectedFishId);
 syncInteractionEnabled();aquarium?.update(next.run,0,performance.now()/1000);
}
function download(text:string):void {
 const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`bathtub-aquarium-save-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function checkpoint():void {
 if(!save||foreign||gpuFailed)return;
 save.savedAtMs=Date.now();
 try{storeSave(encodeSave(save));}catch{showStorageWarning();}
 lastSave=performance.now();
}
function showStorageWarning():void {
 let banner=document.querySelector<HTMLElement>('#storage-warning');
 if(!banner){banner=document.createElement('div');banner.id='storage-warning';banner.className='system-warning';banner.setAttribute('role','alert');root.prepend(banner);}
 banner.textContent=t(locale(),'storage-failed');
}
async function confirmation(title:string,body:string):Promise<boolean> {
 modalPause=true;syncInteractionEnabled();audio.suspend();
 try{return await panel.confirm(title,body);}finally{clearPendingInput();if(save)collapseMotionInterpolation(save.run);lastFrame=0;accumulator=0;modalPause=false;syncInteractionEnabled();}
}
function performAction(action:GameAction):ActionResult|null {
 if(!actionEnabled()||!save)return null;
 const result=dispatchAction(save,action);
 if(!result.ok){panel.notify(t(locale(),result.code));return result;}
 // Every successful portion is committed synchronously before another poll.
 checkpoint();panel.update(save,result.events);selectFish(selectedFishId);aquarium?.handleEvents(result.events);
 if(action.type==='drop-food')audio.play('feed');if(action.type==='collect-all')audio.play('collect');
 void checkBankruptcy();return result;
}
async function act(action:GameAction):Promise<void> {
 if(!actionEnabled()||!save)return;
 if(action.type==='sell'){
  const fish=save.run.fish.find(f=>f.id===action.fishId);if(!fish)return;
  const spec=species(fish.speciesId),price=getFishStats(spec,fish.growth).saleValue;
  if(!await confirmation(t(locale(),'sell-title'),t(locale(),'sell-body',{name:spec.name[locale()],id:fish.id,price:formatNumber(locale(),price)})))return;
 }
 const result=performAction(action);if(!result?.ok)return;
 const acquired=result.events.find(e=>e.type==='fish-acquired');
 if(action.type==='roll'&&acquired?.type==='fish-acquired'){
  revealBusy=true;syncInteractionEnabled();audio.play('reveal');
  try{await panel.reveal(species(acquired.speciesId));}finally{revealBusy=false;syncInteractionEnabled();}
 }
}
async function restart():Promise<void> {
 if(!actionEnabled()||!save)return;
 if(!await confirmation(t(locale(),'restart-title'),t(locale(),'restart-body')))return;
 if(foreign||gpuFailed||!save)return;
 replaceSave(restartGame(save,Date.now(),seed()),true);checkpoint();
}
async function checkBankruptcy():Promise<void> {
 if(!save||foreign||gpuFailed||bankruptDialog||modalPause||uiModalOpen||sheetOpen||revealBusy||document.hidden||!isBankrupt(save))return;
 bankruptDialog=true;
 try{if(await confirmation(t(locale(),'bankruptTitle'),t(locale(),'bankruptBody'))&&!foreign&&!gpuFailed){replaceSave(restartGame(save,Date.now(),seed()),true);checkpoint();}}finally{bankruptDialog=false;}
}
async function importFile(file:File):Promise<void> {
 if(!actionEnabled())return;clearPendingInput();
 try{
  if(file.size>1048576)throw new Error('file-too-large');
  const candidate=decodeSave(await file.text());
  if(!actionEnabled())return;
  const accepted=await confirmation(t(locale(),'import-title'),t(locale(),'import-body',{fish:candidate.run.fish.length,coins:candidate.run.wallet,discovered:candidate.discovered.length}));
  if(!accepted||!actionEnabled())return;
  const result=reconcileOffline(candidate,Date.now());replaceSave(result.save,true);
  checkpoint();panel.notify(t(locale(),'imported'));void checkBankruptcy();
 }catch{panel.notify(t(locale(),'import-invalid'));}
}
function onScrub(sample:WaterPointerSample):void {
 if(!worldInteractionEnabled())return;
 if(!('x' in sample)){lastScrub=null;return;}
 if(mode!=='scrub')return;
 const {x,z}=sample;if(!save||!isInsideWater(save.run.bathLevel,x,z)){lastScrub=null;return;}
 const previous=sample.phase==='move'?lastScrub:null;
 const count=previous?Math.max(1,Math.ceil(Math.hypot(x-previous.x,z-previous.z)/.1)):1;
 for(let i=1;i<=count;i++)pendingScrubMask|=getScrubCellMask(save.run.bathLevel,previous?previous.x+(x-previous.x)*i/count:x,previous?previous.z+(z-previous.z)*i/count:z);
 lastScrub={x,z};
}
function frame(timeMs:number):void {
 if(!save||!aquarium)return;
 if(document.hidden||foreign||gpuFailed||modalPause){lastFrame=0;return;}
 const elapsed=lastFrame?Math.min(.25,(timeMs-lastFrame)/1000):0;lastFrame=timeMs;accumulator+=elapsed;
 const events:GameEvent[]=[];
 let ticks=0;
 while(accumulator>=FIXED_DT&&ticks<5){
  if(pendingScrubMask){applyScrubMask(save.run,pendingScrubMask);pendingScrubMask=0;audio.play('scrub');}
  events.push(...step(save.run,FIXED_DT));accumulator-=FIXED_DT;ticks++;
 }
 if(ticks===5&&accumulator>=FIXED_DT)accumulator%=FIXED_DT;
 if(events.length){aquarium.handleEvents(events);selectFish(selectedFishId);}
 aquarium.update(save.run,accumulator/FIXED_DT,timeMs/1000);
 if(events.length||timeMs-lastUI>=250){panel.update(save,events);lastUI=timeMs;}
 if(timeMs-lastSave>=5000)checkpoint();
 if(events.some(e=>e.type==='fish-left'))void checkBankruptcy();
}
function gpuError(message:string):void {
 if(gpuFailed)return;
 // Preserve the last live snapshot before disabling every simulation path.
 checkpoint();gpuFailed=true;syncInteractionEnabled();clearPendingInput();audio.suspend();aquarium?.setAnimationLoop(null);panel.setBlocked(`${t(locale(),'gpu-failed')} ${message}`);
}
async function start():Promise<void> {
 try{
  aquarium=await createAquarium(panel.sceneHost,{onFeed:(x,z)=>worldInteractionEnabled()?performAction({type:'drop-food',x,z}):null,onScrub,onFish:id=>{if(worldInteractionEnabled())selectFish(id,true);},onFeedback:feedback=>panel.setSceneFeedback(feedback),onError:gpuError});syncInteractionEnabled();
 }catch(error){gpuError(error instanceof Error?error.message:String(error));return;}
 let raw:string|null=null;
 try{raw=loadStoredSave();}catch{showStorageWarning();}
 if(raw!==null){
  try{save=decodeSave(raw);}catch{
   panel.showRecovery(raw,()=>{replaceSave(createGame(Date.now(),seed()),true);finishStart(false);});return;
  }
 }else save=createGame(Date.now(),seed());
 finishStart(raw!==null);
}
function finishStart(reconcile:boolean):void {
 if(!save||foreign||gpuFailed)return;
 const result=reconcile?reconcileOffline(save,Date.now()):{save,summary:{seconds:0,coins:0,adults:0}};replaceSave(result.save,false);
 checkpoint();
 if(result.summary.seconds>=1)panel.showOffline(result.summary);
 aquarium?.setAnimationLoop(frame);void checkBankruptcy();
}
document.addEventListener('visibilitychange',()=>{
 if(foreign||gpuFailed||!save)return;
 if(document.hidden){checkpoint();audio.suspend();lastFrame=0;accumulator=0;clearPendingInput();collapseMotionInterpolation(save.run);syncInteractionEnabled();}
 else {const result=reconcileOffline(save,Date.now());replaceSave(result.save,false);checkpoint();}
});
window.addEventListener('pagehide',()=>{checkpoint();clearPendingInput();aquarium?.setInteractionEnabled(false);audio.suspend();});
window.addEventListener('blur',clearPendingInput);
window.addEventListener('keydown',event=>{if(event.key==='Escape')clearPendingInput();});
window.addEventListener('storage',event=>{
 if(event.key!==SAVE_KEY||foreign)return;
 foreign=true;lastFrame=0;accumulator=0;syncInteractionEnabled();clearPendingInput();audio.suspend();aquarium?.setAnimationLoop(null);panel.setBlocked(t(locale(),'foreign-save'));
});
void start();
