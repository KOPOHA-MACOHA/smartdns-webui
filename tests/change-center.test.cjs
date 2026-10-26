const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');const {ChangeController}=require('../change-center.js');const vm=require('node:vm');
test('shared history coalesces typing, separates documents and retains edits made during saving',()=>{
 let now=1;const c=new ChangeController({limit:2,now:()=>now});c.open('a',{text:'old'});c.change('a',{text:'n'},{group:'field'});now+=10;c.change('a',{text:'new'},{group:'field'});assert.equal(c.get().undo.length,1);assert.equal(c.undo().text,'old');assert(!c.dirty());assert.equal(c.redo().text,'new');const reviewed=c.get().draft;c.change('a',{text:'later'});c.saved('a',reviewed,'rev');assert(c.dirty());assert.equal(c.get().draft.text,'later');c.open('b',{text:'other'});assert(!c.dirty());c.activate('a');assert(c.dirty());c.applyState('a','VERIFYING','new');assert.equal(c.get().applied,null);c.applyState('a','COMMITTED','new');assert.equal(c.get().applied,'new');c.discard();assert(!c.dirty());assert.equal(c.undo().text,'later');c.change('a',{text:'branch'});assert.equal(c.redo(),null);c.begin('apply');assert.equal(c.undo(),null);assert.equal(c.begin('save'),false);c.end();assert(c.get().undo.length<=2);
});
const config='bind :53\nbind-tcp :53\ncache-size 8192\nserver-tcp 1.1.1.1\nlog-level info\n';
async function editor(fixture=config,mobile=false){
 const html=fs.readFileSync(require.resolve('../template.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
 const dom=new JSDOM(html,{url:'http://localhost/settings',runScripts:'dangerously'});const w=dom.window,calls=[],alerts=[];
 w.alert=s=>alerts.push(s);w.confirm=()=>true;w.scrollTo=()=>{};
 const media={matches:mobile,addEventListener(type,fn){this.listener=fn}};w.matchMedia=()=>media;
 w.Sortable=class{static get(){return true}};
 w.CodeMirror={defineSimpleMode(){},fromTextArea(el){let value=el.value,change;return {on(type,fn){change=fn},getValue:()=>value,setValue(v){value=v;change?.()},clearHistory(){},refresh(){}}}};
 for(const file of ['parser.js','validator.js','change-center.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+file),'utf8'),dom.getInternalVMContext());
 vm.runInContext(fs.readFileSync(require.resolve('../shell.js'),'utf8'),dom.getInternalVMContext());
 vm.runInContext(fs.readFileSync(require.resolve('../app.js'),'utf8').replace(/initApp\(\);\s*$/,''),dom.getInternalVMContext());
 w.eval(`apiCall=async function(action,target,body){window.calls.push({action,target,body});if(action==='get_config_snapshot')return 'REVISION '+ 'a'.repeat(64)+'\\n'+window.fixture;if(action==='get_lists')return 'a.list\\nb.list\\n';if(action==='get_log')return window.logFixture||'[2026-10-24 12:00:00,100][ERROR] failure example.org\\n[2026-10-24 12:00:01,200][INFO] <img src=x onerror=alert(1)> example.net\\nunknown record\\n';if(action==='get_list')return target==='a.list'?'alpha\\n':'beta\\n';if(action==='save_list'||action==='delete_list')return true;throw Error('Unexpected '+action)};`);
 w.calls=calls;w.fixture=fixture;w.reviewConfigChanges=async()=>true;
 await w.switchTab('settings',null,false);
 const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve()};await settle();
 return {w,dom,calls,alerts,media,state:()=>vm.runInContext('changes',dom.getInternalVMContext()),settle,close:()=>w.close()};
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
test('top tabs preserve drafts, undo history and active page',async()=>{
 const e=await editor();const {w}=e;try{
  const field=w.document.getElementById('core-cache-size');field.value='4096';field.dispatchEvent(new w.Event('input',{bubbles:true}));const history=e.state().get().undo.length;
  await w.openSettingsSection('groups');assert.equal(w.document.getElementById('page-title').textContent,'Группы DNS');assert.equal(w.document.querySelector('#settings-section-tabs [aria-current=page]').dataset.section,'groups');
  assert.equal(e.state().get().undo.length,history);assert.equal(w.document.querySelector('#app-navigation [aria-current=page]').dataset.page,'settings');
  await w.openShellPage('lists');await w.openSettingsSection('core');assert.equal(w.document.getElementById('core-cache-size').value,'4096');assert(e.state().dirty());w.undoEditorChange();assert(!e.state().dirty());assert.equal(e.calls.filter(x=>!x.action.startsWith('get_')).length,0);assert.equal(e.alerts.length,0);
 }finally{e.close()}
});

test('undo restores configuration data without moving the selected settings section',async()=>{
 const e=await editor();const {w}=e;try{
  const input=w.document.getElementById('core-cache-size');input.value='4096';input.dispatchEvent(new w.Event('input',{bubbles:true}));await w.openSettingsSection('groups');w.undoEditorChange();assert(!e.state().dirty());assert.equal(w.document.querySelector('.settings-subtab-panel.active').id,'settings-subtab-groups');assert.equal(w.document.getElementById('page-title').textContent,'Группы DNS');assert.equal(w.document.querySelector('#settings-section-tabs [aria-current=page]').dataset.section,'groups');
 }finally{e.close()}
});


test('action drawer owns all actions, restores focus and never writes on opening',async()=>{
 const e=await editor();const {w}=e;try{
  assert(!w.document.querySelector('main #change-center'));w.toggleActionPanel();assert(!w.document.getElementById('action-panel').hidden);assert(w.document.querySelector('.app-shell').inert);
  for(const id of ['global-save-btn','restart-service-btn','validate-config-btn','preflight-config-btn'])assert(w.document.getElementById(id).closest('#action-panel'));
  assert(!w.document.getElementById('validate-config-btn').closest('details'));assert(w.document.getElementById('test-mode-toggle').closest('details'));
  w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert(w.document.getElementById('action-panel').hidden);assert(!w.document.querySelector('.app-shell').inert);assert.equal(w.document.activeElement.id,'settings-toggle');
  const field=w.document.getElementById('core-cache-size');field.value='2048';field.dispatchEvent(new w.Event('input',{bubbles:true}));assert(w.document.getElementById('settings-toggle').classList.contains('has-changes'));w.undoEditorChange();assert(!w.document.getElementById('settings-toggle').classList.contains('has-changes'));assert(e.calls.every(call=>call.action.startsWith('get_')));
 }finally{e.close()}
});
test('log viewer filters levels and search, preserves unknown text and escapes markup',async()=>{
 const e=await editor();const {w}=e;try{
  await w.openShellPage('logs');assert.equal(w.document.querySelectorAll('#log-view tbody tr').length,3);assert(!w.document.querySelector('#log-view img'));assert.match(w.document.getElementById('log-summary').textContent,/ошибок: 1/);
  w.document.getElementById('log-level-filter').value='problems';w.renderLogView();assert.equal(w.document.querySelectorAll('#log-view tbody tr').length,1);assert.match(w.document.querySelector('#log-view .log-message').textContent,/example.org/);
  w.document.getElementById('log-search').value='absent';w.renderLogView();assert.match(w.document.getElementById('log-view').textContent,/Нет событий/);
  w.document.getElementById('log-raw-toggle').checked=true;w.renderLogView();assert(!w.document.getElementById('log-content').hidden);assert.match(w.document.getElementById('log-content').value,/unknown record/);assert.equal(e.calls.filter(call=>call.action==='get_log').length,1);
 }finally{e.close()}
});
test('horizontal list tabs and line presentation preserve draft history',async()=>{
 const e=await editor();const {w}=e;try{
  await w.openShellPage('lists');const editor=w.document.getElementById('list-content');editor.value='# comment\nalpha.org\nbeta.org\n';editor.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(w.document.getElementById('list-line-numbers').textContent,'1\n2\n3\n4');assert.match(w.document.getElementById('list-stats').textContent,/Домены: 2/);
  await w.selectList('b.list');await w.selectList('a.list');assert.match(editor.value,/beta.org/);w.undoEditorChange();assert.equal(editor.value,'alpha\n');assert.equal(w.document.getElementById('list-line-numbers').textContent,'1\n2');assert(e.calls.every(call=>call.action.startsWith('get_')));
 }finally{e.close()}
});
test('rule card retains multiple domain files and adding a file stays undoable',async()=>{
 const fixture=config+'server 9.9.9.9 -group first -exclude-default-group\ndomain-set -name services -file /opt/etc/smartdns/domains/a.list\ndomain-set -name services -file /opt/etc/smartdns/domains/b.list\nnameserver /domain-set:services/first\n';
 const e=await editor(fixture);const {w}=e;try{
  await w.openSettingsSection('routing');assert.equal(w.document.querySelectorAll('.route-file-select').length,2);assert.equal(w.gatherSectionsText(),fixture);
  w.document.querySelector('.route-add-file').click();assert.equal(w.document.querySelectorAll('.route-file-select').length,3);assert(e.state().dirty());w.undoEditorChange();assert.equal(w.document.querySelectorAll('.route-file-select').length,2);assert.equal(w.gatherSectionsText(),fixture);assert(!e.state().dirty());
 }finally{e.close()}
});
test('large logs render a bounded page while search covers the full snapshot',async()=>{
 const e=await editor();const {w}=e;try{
  w.logFixture=Array.from({length:600},(_,i)=>'[2026-10-24 12:00:00,100][INFO] event-'+i).join('\n');await w.openShellPage('logs');assert.equal(w.document.querySelectorAll('#log-view tbody tr').length,250);assert.match(w.document.querySelector('#log-view .log-message').textContent,/event-599/);
  w.changeLogPage(1);assert.match(w.document.querySelector('#log-view .log-message').textContent,/event-349/);w.document.getElementById('log-search').value='event-0';w.renderLogView(true);assert.equal(w.document.querySelectorAll('#log-view tbody tr').length,1);assert.match(w.document.querySelector('#log-view .log-message').textContent,/event-0/);assert.equal(e.calls.filter(call=>call.action==='get_log').length,1);
 }finally{e.close()}
});
test('comment highlighting and group summaries preserve original config and undo',async()=>{
 const fixture=config+'server-https https://dns.example/dns-query -group team -exclude-default-group\n#server-tls dns.example -group team -exclude-default-group\n';
 const e=await editor(fixture);const {w}=e;try{
  assert.equal(w.gatherSectionsText(),fixture);assert.match(w.document.querySelector('.group-summary').textContent,/1 вкл. · 1 откл. · DoH/);assert.match(w.document.querySelector('.group-item .visual-comment').textContent,/#/);assert(w.document.querySelector('label[for="sec-logging-select"] .setting-help'));
  const field=w.document.querySelector('.group-dns-list');field.value+='\n# 9.9.9.9';field.dispatchEvent(new w.Event('input',{bubbles:true}));w.undoEditorChange();assert.equal(w.gatherSectionsText(),fixture);assert(!e.state().dirty());
 }finally{e.close()}
});
test('moving files into a shared rule keeps one nameserver for the complete domain set',async()=>{
 const fixture=config+'server 9.9.9.9 -group first -exclude-default-group\ndomain-set -name social -file /opt/etc/smartdns/domains/a.list\nnameserver /domain-set:social/first\ndomain-set -name rus -file /opt/etc/smartdns/domains/b.list\nnameserver /domain-set:rus/first\n';
 const e=await editor(fixture);const {w}=e;try{
  const cards=[...w.document.querySelectorAll('.route-item')],target=cards.find(c=>c.querySelector('.route-name').value==='rus');cards.find(c=>c!==target).remove();w.addRouteFileUI(target.querySelector('.route-add-file'));await w.refreshRouteFileOptions();const select=[...target.querySelectorAll('.route-file-select')].at(-1);select.value='/opt/etc/smartdns/domains/a.list';select.dispatchEvent(new w.Event('change',{bubbles:true}));
  const result=w.gatherSectionsText();assert.equal((result.match(/^nameserver \/domain-set:rus\/first$/gm)||[]).length,1);assert.match(result,/domain-set -name rus -file \/opt\/etc\/smartdns\/domains\/a.list/);assert.match(result,/domain-set -name rus -file \/opt\/etc\/smartdns\/domains\/b.list/);assert(!result.includes('domain-set:social'));
 }finally{e.close()}
});
test('Apply disables only for the confirmed current draft and re-enables on edits',async()=>{
 const e=await editor();const {w}=e;try{
  const state=e.state(),id=state.get().id,button=w.document.getElementById('restart-service-btn');assert(!button.disabled);
  state.applyState(id,'AWAITING_CONFIRMATION',config);assert(!button.disabled);state.applyState(id,'COMMITTED',config);assert(button.disabled);assert.match(button.textContent,/Применено/);
  const field=w.document.getElementById('core-cache-size');field.value='4096';field.dispatchEvent(new w.Event('input',{bubbles:true}));assert(!button.disabled);w.undoEditorChange();assert(button.disabled);state.applyState(id,'REJECTED',config);assert(!button.disabled);
 }finally{e.close()}
});
test('domain-list duplicates are highlighted without rewriting text or counting comments',async()=>{
 const e=await editor();const {w}=e;try{
  await w.openShellPage('lists');const field=w.document.getElementById('list-content');const text='Example.org\n example.org. \n# example.org\nsub.example.org\n<img src=x>\n';field.value=text;field.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(field.value,text);assert.equal(w.document.querySelectorAll('#list-paint .domain-duplicate').length,2);assert.equal(w.document.querySelectorAll('#list-paint .visual-comment').length,1);assert(!w.document.querySelector('#list-paint img'));assert.match(w.document.getElementById('list-stats').textContent,/повторов: 1/);assert(!w.document.getElementById('list-next-duplicate').hidden);
  field.setSelectionRange(0,0);w.nextListDuplicate();assert.equal(field.selectionStart,0);w.nextListDuplicate();assert.equal(field.selectionStart,'Example.org\n'.length);w.undoEditorChange();assert.equal(field.value,'alpha\n');assert(w.document.getElementById('list-next-duplicate').hidden);assert(!e.state().dirty());
 }finally{e.close()}
});
test('DNS group name help precedes the name and summary belongs to the same heading',async()=>{
 const fixture=config+'server 9.9.9.9 -group first -exclude-default-group\n';const e=await editor(fixture);const {w}=e;try{
  const group=w.document.querySelector('.group-item'),name=group.querySelector('.group-editable-name'),help=name.querySelector('.setting-help');assert(help);assert.equal(name.firstElementChild,help);assert(group.querySelector('.group-heading .group-summary'));assert.equal(w.gatherSectionsText(),fixture);
 }finally{e.close()}
});
test('advanced TCP addresses use a compact plain field and preserve multiple listeners',async()=>{
 const fixture=config.replace('bind :53','bind [::]:53').replace('bind-tcp :53','bind-tcp [::]:53')+'bind-tcp 127.0.0.1:5353\n';const e=await editor(fixture);const {w}=e;try{
  w.useAdvancedDnsBind();const tcp=w.document.getElementById('core-bind-tcp');assert(!tcp.closest('.visual-code-editor'));assert(!tcp.classList.contains('code-font'));assert.equal(tcp.rows,1);assert.equal(tcp.style.height,'36px');assert.equal(tcp.value,'[::]:53\n127.0.0.1:5353');assert.equal(w.gatherSectionsText(),fixture);assert(!e.state().dirty());
 }finally{e.close()}
});
