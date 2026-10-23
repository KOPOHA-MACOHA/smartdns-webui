const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {JSDOM}=require('jsdom');
const {parseApplyStatus}=require('../safe-apply.js');
test('application status parser fails closed on malformed or unknown replies',()=>{
 assert.equal(parseApplyStatus('STATUS AWAITING_CONFIRMATION\nDEADLINE 123\n').state,'AWAITING_CONFIRMATION');
 for(const reply of ['OK','STATUS OK\nDEADLINE 12','STATUS COMMITTED\nDEADLINE nope','STATUS COMMITTED\nDEADLINE 12\nhtml'])assert.throws(()=>parseApplyStatus(reply));
});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
test('DNS success never automatically confirms; explicit confirmation is sent once',async()=>{
 const dom=new JSDOM('<button id="focus">Apply</button>',{url:'http://localhost',runScripts:'outside-only'});const w=dom.window;let scheduled;const calls=[];
 w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};w.setTimeout=f=>{scheduled=f;return 1};w.clearTimeout=()=>{};
 w.eval(fs.readFileSync(require.resolve('../safe-apply.js'),'utf8'));
 try{
  w.document.getElementById('focus').focus();
  const promise=w.monitorSafeApply('tx-ABCDEFGHIJKL',async(action,id)=>{calls.push(action);assert.equal(id,'tx-ABCDEFGHIJKL');return `STATUS ${action==='confirm_apply'?'COMMITTED':'AWAITING_CONFIRMATION'}\nDEADLINE ${Math.floor(Date.now()/1000)+60}\n`});
  await flush();assert.deepEqual(calls,['get_apply_status']);
  const buttons=w.document.querySelectorAll('dialog button');assert.equal(buttons[0].disabled,false);
  buttons[0].click();await flush();assert.deepEqual(calls,['get_apply_status','confirm_apply']);assert.equal(buttons[0].disabled,true);
  assert.equal(w.document.querySelector('dialog'),null);assert.equal(await promise,true);assert.equal(w.document.activeElement.id,'focus');
 }finally{w.close()}
});

test('rollback and rejected outcomes remain visible until explicitly closed',async()=>{
 for(const state of ['ROLLED_BACK','REJECTED','ROLLBACK_FAILED']) {
  const dom=new JSDOM('<body/>',{url:'http://localhost',runScripts:'outside-only'});const w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};
  w.eval(fs.readFileSync(require.resolve('../safe-apply.js'),'utf8'));
  try {
   const promise=w.monitorSafeApply('tx-ABCDEFGHIJKL',async()=>`STATUS ${state}\nDEADLINE 123\n`);
   await flush();assert(w.document.querySelector('dialog'),state);
   const buttons=w.document.querySelectorAll('dialog button');
   assert.equal(buttons[0].disabled,true);assert.equal(buttons[2].textContent,'Закрыть');
   buttons[2].click();await promise;
  }finally{w.close()}
 }
});

test('committed operation closes automatically even when browser storage is unavailable',async()=>{
 const dom=new JSDOM('<body/>',{runScripts:'outside-only'});const w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};
 w.eval(fs.readFileSync(require.resolve('../safe-apply.js'),'utf8'));
 try {
  const calls=[];
  assert.equal(await w.monitorSafeApply('tx-ABCDEFGHIJKL',async action=>{calls.push(action);return 'STATUS COMMITTED\nDEADLINE 123\n'}),true);
  assert.equal(w.document.querySelector('dialog'),null);
  assert.deepEqual(calls,['get_apply_status']);
 }finally{w.close()}
});
test('hiding progress does not send confirmation or disable the independent rollback',async()=>{
 const dom=new JSDOM('<body/>',{url:'http://localhost',runScripts:'outside-only'});const w=dom.window;const calls=[];
 w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};w.setTimeout=()=>1;w.clearTimeout=()=>{};
 w.eval(fs.readFileSync(require.resolve('../safe-apply.js'),'utf8'));
 try{
  const promise=w.monitorSafeApply('tx-ABCDEFGHIJKL',async action=>{calls.push(action);return 'STATUS VERIFYING\nDEADLINE 9999999999\n'});
  await flush();w.document.querySelector('dialog').dispatchEvent(new w.Event('cancel',{cancelable:true}));assert.equal(await promise,false);assert.deepEqual(calls,['get_apply_status']);
 }finally{w.close()}
});
test('lost status response disables confirmation and displays an unknown result',async()=>{
 const dom=new JSDOM('<body/>',{url:'http://localhost',runScripts:'outside-only'});const w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};w.setTimeout=()=>1;w.clearTimeout=()=>{};w.eval(fs.readFileSync(require.resolve('../safe-apply.js'),'utf8'));
 try{const promise=w.monitorSafeApply('tx-ABCDEFGHIJKL',async()=>{throw Error('offline')});await flush();assert.equal(w.document.querySelector('dialog button').disabled,true);assert.match(w.document.querySelector('[role=status]').textContent,/неизвестен/);w.document.querySelectorAll('dialog button')[2].click();await promise;}finally{w.close()}
});
const app=fs.readFileSync(require.resolve('../app.js'),'utf8');const source=app.slice(app.indexOf('let safeApplyBusy ='),app.indexOf('async function loadLists()'));
function editor({accept=true,stale=false,testMode=false}={}) {
 const dom=new JSDOM('<button id="restart-service-btn">Apply</button>',{url:'http://localhost'});const calls=[];const storage=new Map();let text='candidate';
 const context={document:dom.window.document,activeTab:'settings',safeApplyBusy:false,preflightBusy:false,isTestMode:testMode,configSnapshotMode:testMode,configRevision:'original',currentSettingsMode:'ui',originalConfigContent:'before',
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
  gatherSectionsText:()=>text,validateConfigLogical:async()=>null,validateConfigOnServer:async()=>({errors:[]}),
  readConfigSnapshot:async()=>({content:'before',revision:stale?'changed':'original'}),confirm:()=>accept,alert:()=>{},updateSaveButtonState:()=>{},
  window:{reviewValidationReport:async()=>true,reviewConfigChanges:async()=>true,monitorSafeApply:async()=>{text='edited while applying'}},
  apiCall:async(action,target,body,strict,revision)=>{calls.push(action);if(action==='get_active_apply')return 'NONE\n';assert.equal(action,'apply_config');assert.equal(body,'candidate');assert.equal(revision,'original');return 'OK\nTRANSACTION tx-ABCDEFGHIJKL\n'}
 };
 vm.createContext(context);vm.runInContext(source,context);return {dom,context,calls,getText:()=>text};
}
test('apply sends the reviewed snapshot directly, without saving it before arming rollback',async()=>{
 const e=editor();try{await e.context.restartService();assert.deepEqual(e.calls,['get_active_apply','apply_config']);assert.equal(e.getText(),'edited while applying');assert.equal(e.dom.window.document.querySelector('button').disabled,false);}finally{e.dom.window.close()}
});
test('cancel, stale revision and UI test mode cannot launch live application',async()=>{
 for(const options of [{accept:false},{stale:true},{testMode:true}]){const e=editor(options);try{await e.context.restartService();assert(!e.calls.includes('apply_config'));assert(!e.calls.includes('save_config'));assert(!e.calls.includes('restart_service'));assert.equal(e.context.configRevision,'original');}finally{e.dom.window.close()}}
});
