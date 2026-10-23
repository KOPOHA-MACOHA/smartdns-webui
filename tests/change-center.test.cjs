const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');const {ChangeController}=require('../change-center.js');const vm=require('node:vm');
test('shared history coalesces typing, separates documents and retains edits made during saving',()=>{
 let now=1;const c=new ChangeController({limit:2,now:()=>now});c.open('a',{text:'old'});c.change('a',{text:'n'},{group:'field'});now+=10;c.change('a',{text:'new'},{group:'field'});assert.equal(c.get().undo.length,1);assert.equal(c.undo().text,'old');assert(!c.dirty());assert.equal(c.redo().text,'new');const reviewed=c.get().draft;c.change('a',{text:'later'});c.saved('a',reviewed,'rev');assert(c.dirty());assert.equal(c.get().draft.text,'later');c.open('b',{text:'other'});assert(!c.dirty());c.activate('a');assert(c.dirty());c.applyState('a','VERIFYING','new');assert.equal(c.get().applied,null);c.applyState('a','COMMITTED','new');assert.equal(c.get().applied,'new');c.discard();assert(!c.dirty());assert.equal(c.undo().text,'later');c.change('a',{text:'branch'});assert.equal(c.redo(),null);c.begin('apply');assert.equal(c.undo(),null);assert.equal(c.begin('save'),false);c.end();assert(c.get().undo.length<=2);
});
const config='bind :53\nbind-tcp :53\ncache-size 8192\nserver-tcp 1.1.1.1\nlog-level info\n';
async function editor(fixture=config){
 const html=fs.readFileSync(require.resolve('../template.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://localhost/settings',runScripts:'dangerously'});const w=dom.window,calls=[],alerts=[];
 w.alert=s=>alerts.push(s);w.confirm=()=>true;
 w.Sortable=class{static get(){return true}};
 w.CodeMirror={defineSimpleMode(){},fromTextArea(el){let value=el.value,change;return {on(type,fn){change=fn},getValue:()=>value,setValue(v){value=v;change?.()},clearHistory(){},refresh(){}}}};
 for(const file of ['parser.js','validator.js','change-center.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),dom.getInternalVMContext());
 vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8').replace(/initApp\(\);\s*$/,''),dom.getInternalVMContext());
 w.eval(`apiCall=async function(action,target,body){window.calls.push({action,target,body});if(action==='get_config_snapshot')return 'REVISION '+ 'a'.repeat(64)+'\\n'+window.fixture;if(action==='get_lists')return 'a.list\\nb.list\\n';if(action==='get_list')return target==='a.list'?'alpha\\n':'beta\\n';if(action==='save_list'||action==='delete_list')return true;throw Error('Unexpected '+action)};`);
 w.calls=calls;w.fixture=fixture;w.reviewConfigChanges=async()=>true;
 await w.switchTab('settings',null,false);
 const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve()};await settle();
 return {w,dom,calls,alerts,state:()=>vm.runInContext('changes',dom.getInternalVMContext()),settle,close:()=>w.close()};
}
test('visual and Raw changes share undo and survive tab switches without rewriting unchanged config',async()=>{
 const e=await editor();const {w}=e;try{
  assert(!e.state().dirty());assert.equal(w.gatherSectionsText(),config);assert.match(w.document.getElementById('change-detail').textContent,/не проверялось/);
  const field=w.document.getElementById('core-cache-size');assert(field);field.value='4096';field.dispatchEvent(new w.Event('input',{bubbles:true}));assert(e.state().dirty());
  w.switchSettingsMode('raw');assert.match(w.rawEditor.getValue(),/cache-size 4096/);w.rawEditor.setValue(w.rawEditor.getValue().replace('4096','2048'));w.undoEditorChange();assert.match(w.rawEditor.getValue(),/4096/);w.undoEditorChange();assert.equal(w.rawEditor.getValue(),config);assert(!e.state().dirty());w.redoEditorChange();w.switchSettingsMode('ui');assert.equal(w.document.getElementById('core-cache-size').value,'4096');
  await w.switchTab('lists',null,false);await w.switchTab('settings',null,false);assert.equal(w.document.getElementById('core-cache-size').value,'4096');assert.equal(e.calls.filter(x=>x.action==='get_config_snapshot').length,1);assert.equal(e.alerts.length,0);
 }finally{e.close()}
});
test('list drafts and staged file deletion share the central history and do not write before Save',async()=>{
 const e=await editor();const {w}=e;try{
  await w.switchTab('lists',null,false);let ta=w.document.getElementById('list-content');ta.value='edited\n';ta.dispatchEvent(new w.Event('input',{bubbles:true}));await w.selectList('b.list');await w.selectList('a.list');assert.equal(ta.value,'edited\n');
  await w.deleteList('a.list');assert(ta.disabled);assert.equal(e.calls.filter(x=>x.action==='delete_list').length,0);w.undoEditorChange();assert(!ta.disabled);assert.equal(ta.value,'edited\n');assert.equal(await w.globalSave(),true);assert.equal(e.calls.find(x=>x.action==='save_list').body,'edited\n');assert(!e.state().dirty());
 }finally{e.close()}
});
test('incomplete visual cards remain undoable and cannot be silently lost by switching to Raw',async()=>{
 const e=await editor();const {w}=e;try{
  w.document.getElementById('dynamic-groups-container').insertAdjacentHTML('beforeend',vm.runInContext("UI.groupCard('','')",e.dom.getInternalVMContext()));w.markConfigDirty();assert(e.state().dirty());w.switchSettingsMode('raw');assert.equal(vm.runInContext('currentSettingsMode',e.dom.getInternalVMContext()),'ui');w.undoEditorChange();assert(!e.state().dirty());assert.equal(w.document.querySelectorAll('.group-item').length,0);
 }finally{e.close()}
});

test('new empty lists are drafts until Save, and their creation can be cancelled with undo',async()=>{
 const e=await editor();const {w}=e;try{
  await w.switchTab('lists',null,false);w.document.getElementById('new-list-name').value='new';await w.createList();assert.equal(e.calls.filter(x=>x.action==='save_list').length,0);assert(e.state().dirty());w.undoEditorChange();assert(!e.state().dirty());assert(w.document.getElementById('list-content').disabled);w.redoEditorChange();assert.equal(await w.globalSave(),true);assert.equal(e.calls.find(x=>x.action==='save_list').target,'new.list');assert(!e.state().dirty());
 }finally{e.close()}
});
test('deleting a saved list writes only after Save; undo can restore its contents',async()=>{
 const e=await editor();const {w}=e;try{
  await w.switchTab('lists',null,false);await w.deleteList('a.list');assert.equal(await w.globalSave(),true);assert.equal(e.calls.filter(x=>x.action==='delete_list').length,1);assert.equal(e.calls.filter(x=>x.action==='save_list').length,0);assert(!e.state().dirty());w.undoEditorChange();assert.equal(w.document.getElementById('list-content').value,'alpha\n');assert.equal(await w.globalSave(),true);assert.equal(e.calls.find(x=>x.action==='save_list').body,'alpha\n');
 }finally{e.close()}
});
test('select and checkbox changes undo independently, and Ctrl+Z uses the shared history',async()=>{
 const e=await editor();const {w}=e;try{
  const select=w.document.getElementById('sec-logging-select');select.value='debug';select.dispatchEvent(new w.Event('change',{bubbles:true}));const check=w.document.getElementById('core-prefetch');assert(check);const old=check.checked;check.checked=!old;check.dispatchEvent(new w.Event('change',{bubbles:true}));w.undoEditorChange();assert.equal(w.document.getElementById('core-prefetch').checked,old);assert.equal(w.document.getElementById('sec-logging-select').value,'debug');const el=w.document.getElementById('sec-logging-select');el.focus();el.dispatchEvent(new w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(w.document.getElementById('sec-logging-select').value,'info');assert(!e.state().dirty());
 }finally{e.close()}
});
test('live and test drafts have separate histories, and leaving the page warns about any dirty file',async()=>{
 const e=await editor();const {w}=e;try{
  const field=w.document.getElementById('core-cache-size');field.value='4096';field.dispatchEvent(new w.Event('input',{bubbles:true}));await w.toggleTestMode(true);assert.equal(w.document.getElementById('core-cache-size').value,'8192');await w.toggleTestMode(false);assert.equal(w.document.getElementById('core-cache-size').value,'4096');const event=new w.Event('beforeunload',{cancelable:true});w.dispatchEvent(event);assert(event.defaultPrevented);assert.equal(e.state().dirtyCount(),1);
 }finally{e.close()}
});
test('Russian-layout Ctrl+Z undoes route group selection and works after focus returns to body',async()=>{
 const fixture=config+'server 9.9.9.9 -group first -exclude-default-group\nserver 8.8.8.8 -group second -exclude-default-group\ndomain-set -name route -file /opt/etc/smartdns/domains/a.list\nnameserver /domain-set:route/first\n';
 const e=await editor(fixture);const {w}=e;try{
  const select=w.document.querySelector('.route-group');select.value='second';select.dispatchEvent(new w.Event('change',{bubbles:true}));assert(e.state().dirty());select.focus();select.dispatchEvent(new w.KeyboardEvent('keydown',{key:'я',code:'KeyZ',ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(w.document.querySelector('.route-group').value,'first');assert(!e.state().dirty());
  const box=w.document.getElementById('core-prefetch');const previous=box.checked;box.click();box.blur();w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'я',code:'KeyZ',ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(w.document.getElementById('core-prefetch').checked,previous);assert(!e.state().dirty());
 }finally{e.close()}
});
test('keyboard undo and redo cover switches, checkboxes and selects in either keyboard layout',async()=>{
 const e=await editor();const {w}=e;try{
  for(const id of ['core-prefetch','speed-ping','core-force-aaaa-soa','sec-logging-select']){
   let el=w.document.getElementById(id);const before=el.type==='checkbox'?el.checked:el.value;
   if(el.type==='checkbox')el.click();else {el.value=id==='sec-logging-select'?'debug':'yes';el.dispatchEvent(new w.Event('change',{bubbles:true}));}
   const after=el.type==='checkbox'?el.checked:el.value;el.blur();
   const key=(name,code,shiftKey=false)=>w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:name,code,shiftKey,ctrlKey:true,bubbles:true,cancelable:true}));
   key('я','KeyZ');el=w.document.getElementById(id);assert.equal(el.type==='checkbox'?el.checked:el.value,before,id);
   key('н','KeyY');el=w.document.getElementById(id);assert.equal(el.type==='checkbox'?el.checked:el.value,after,id);
   key('z','KeyZ');assert(!e.state().dirty(),id);
  }
  const input=w.document.getElementById('new-list-name');input.focus();const event=new w.KeyboardEvent('keydown',{key:'я',code:'KeyZ',ctrlKey:true,bubbles:true,cancelable:true});input.dispatchEvent(event);assert(!event.defaultPrevented);
 }finally{e.close()}
});
