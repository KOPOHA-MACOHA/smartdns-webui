const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const {configDiff} = require('../config-review.js');
test('comparison retains changed blocks, repeated lines and final newline changes', () => {
    assert.equal(configDiff('same\n','same\n'),'');
    assert.match(configDiff('a\nsame\na\n','a\nnew\na\n'), /- same\n\+ new/);
    assert.notEqual(configDiff('a','a\n'),'');
    assert.match(configDiff('', 'server 1.1.1.1'), /\+ server 1.1.1.1/);
    assert(configDiff('a\n'.repeat(20000),'b\n'.repeat(20000)).length > 100000);
});
test('review uses plain text, cancels with Escape, and requires explicit save', async () => {
    const dom = new JSDOM('<button id="prior">prior</button>',{runScripts:'outside-only'});
    const w=dom.window;
    w.HTMLDialogElement.prototype.showModal=function() {this.open=true;};
    w.HTMLDialogElement.prototype.close=function() {this.open=false;};
    w.eval(fs.readFileSync(require.resolve('../config-review.js'),'utf8'));
    try {
        w.document.getElementById('prior').focus();
        const cancelled=w.reviewConfigChanges('old','<img src=x onerror=alert(1)>');
        assert.equal(w.document.querySelector('dialog img'),null);
        assert(w.document.querySelector('pre').textContent.includes('<img'));
        w.document.querySelector('dialog').dispatchEvent(new w.Event('cancel',{cancelable:true}));
        assert.equal(await cancelled,false);
        assert.equal(w.document.activeElement.id,'prior');
        const accepted=w.reviewConfigChanges('old','new');
        w.document.querySelector('dialog .btn-primary').click();
        assert.equal(await accepted,true);
        assert.equal(w.document.querySelector('dialog'),null);
    } finally {w.close();}
});
const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
const saveFunction=app.slice(app.indexOf('async function globalSave()'),app.indexOf('async function loadConfig()'));
function harness(accepted, readError=false) {
    const calls=[];
    const context={validateConfigOnServer:async()=>({errors:[],warnings:[],info:[]}),configRevision:'a'.repeat(64),configSnapshotMode:false,isTestMode:false,readConfigSnapshot:async()=>{calls.push('get_config_snapshot');if(readError)throw Error('offline');return {revision:'a'.repeat(64),content:'disk'};},activeTab:'settings',currentSettingsMode:'ui',gatherSectionsText:()=> 'new',
        validateConfigLogical:async()=>null, window:{reviewValidationReport:async()=>true,reviewConfigChanges:async(before,after)=>{assert.equal(before,'disk');assert.equal(after,'new');return accepted;}},
        apiCall:async(action)=>{calls.push(action);if(readError)throw Error('offline');return 'OK\nREVISION '+'b'.repeat(64)+'\n';},
        alert:()=>{},originalConfigContent:'old',updateSaveButtonState:()=>{}};
    context.changes=new (require('../change-center.js').ChangeController)();
    context.changes.open('config:live',{text:'old'},{revision:'a'.repeat(64)});
    context.currentDocumentId=()=> 'config:live';context.captureCurrentDraft=()=>({text:'new'});
    vm.createContext(context);vm.runInContext(saveFunction,context);
    return {context,calls};
}
test('cancel and read failure do not write config; approval writes reviewed content',async()=>{
    for(const [accepted,error] of [[false,false],[true,true],[true,false]]) {
        const h=harness(accepted,error);
        assert.equal(await h.context.globalSave(),accepted&&!error);
        assert.deepEqual(h.calls,accepted&&!error?['get_config_snapshot','save_config']:['get_config_snapshot']);
        assert.equal(h.context.changes.get().saved.text,accepted&&!error?'new':'old');
    }
});

test('separated edits keep intervening lines once and preserve both originals',()=>{
    const {diffLines}=require('../config-review.js');
    const before='head\nold\nkeep one\nkeep two\nold two\ntail';
    const after='head\nnew\nkeep one\nkeep two\nnew two\ntail';
    const rows=diffLines(before,after);
    assert.equal(rows.filter(r=>r.text==='keep one').length,1);
    assert.equal(rows.filter(r=>r.text==='keep two').length,1);
    assert.equal(rows.filter(r=>r.type==='remove').length,2);
    assert.equal(rows.filter(r=>r.type==='add').length,2);
    assert.equal(rows.filter(r=>r.type!=='add').map(r=>r.text).join('\n'),before);
    assert.equal(rows.filter(r=>r.type!=='remove').map(r=>r.text).join('\n'),after);
    for(const [a,b] of [['a\nb\na','b\na\nb'],['','x'],['x',''],['x\nx','x']]){
        const r=diffLines(a,b);
        assert.equal(r.filter(l=>l.type!=='add').map(l=>l.text).join('\n'),a);
        assert.equal(r.filter(l=>l.type!=='remove').map(l=>l.text).join('\n'),b);
    }
});
test('review marks additions/deletions and collapses long unchanged context',async()=>{
    const dom=new JSDOM('<html data-theme="dark"><body></body></html>',{runScripts:'outside-only'});
    const w=dom.window;
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
    w.HTMLDialogElement.prototype.close=function(){this.open=false};
    w.eval(fs.readFileSync(require.resolve('../config-review.js'),'utf8'));
    try{
        const prefix=Array.from({length:30},(_,i)=>'same '+i).join('\n');
        const promise=w.reviewConfigChanges(prefix+'\nold\ntail',prefix+'\nnew\ntail');
        const dialog=w.document.querySelector('dialog');
        assert(dialog.classList.contains('config-review'));
        assert(!dialog.classList.contains('bg-body'));
        assert.equal(dialog.querySelector('.config-diff-remove').textContent,'- old');
        assert.equal(dialog.querySelector('.config-diff-add').textContent,'+ new');
        assert(dialog.querySelector('.config-diff-gap'));
        assert.equal(dialog.querySelectorAll('.config-diff-line').length,7);
        dialog.querySelector('.btn-secondary').click();assert.equal(await promise,false);
        const css=fs.readFileSync(require.resolve('../ui.css'),'utf8');
        assert(css.includes('.config-review { background: var(--surface); color: var(--text);'));
        assert(css.includes(':root[data-theme="dark"] .config-diff-remove'));
        assert(css.includes(':root[data-theme="dark"] .config-diff-add'));
    }finally{w.close()}
});

test('stale snapshot and server-side conflict preserve edits and loaded revision',async()=>{
    const stale=harness(true);
    stale.context.readConfigSnapshot=async()=>({revision:'c'.repeat(64),content:'foreign'});
    assert.equal(await stale.context.globalSave(),false);
    assert(!stale.calls.includes('save_config'));
    const race=harness(true);
    race.context.apiCall=async()=> 'CONFLICT: changed';
    assert.equal(await race.context.globalSave(),false);
    assert.equal(race.context.changes.get().revision,'a'.repeat(64));
    assert.equal(race.context.changes.get().saved.text,'old');
    const ok=harness(true);
    assert.equal(await ok.context.globalSave(),true);
    assert.equal(ok.context.changes.get().revision,'b'.repeat(64));
});
test('snapshot parser preserves file bytes and rejects an error response',async()=>{
    const helper=app.slice(app.indexOf('async function readConfigSnapshot()'),app.indexOf('async function globalSave()'));
    const content='bind :53\r\n# trailing\r\n';
    const context={apiCall:async()=> 'REVISION '+'a'.repeat(64)+'\n'+content};
    vm.createContext(context);vm.runInContext(helper,context);
    const result=await context.readConfigSnapshot();
    assert.equal(result.content,content);assert.equal(result.revision,'a'.repeat(64));
    context.apiCall=async()=> 'ERROR: read';
    await assert.rejects(context.readConfigSnapshot());
});

test('server validation errors stop saving before diff or write',async()=>{
    const h=harness(true);
    h.context.validateConfigOnServer=async()=>({errors:['bad'],warnings:[],info:[]});
    h.context.window.reviewValidationReport=async report=>report.errors.length===0;
    assert.equal(await h.context.globalSave(),false);
    assert.equal(h.calls.length,0);
});
test('validation dialog blocks errors, allows warning acknowledgement and escapes diagnostic text',async()=>{
    const dom=new JSDOM('<body></body>',{runScripts:'outside-only'});const w=dom.window;
    w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};
    w.eval(fs.readFileSync(require.resolve('../config-review.js'),'utf8'));
    try{
        const result=w.reviewValidationReport({profile:'46.1',errors:['<img src=x>'],warnings:[],info:[]});
        assert.equal(w.document.querySelector('dialog img'),null);
        assert.equal(w.document.querySelector('dialog .btn-primary'),null);
        w.document.querySelector('dialog .btn-secondary').click();assert.equal(await result,false);
        const warning=w.reviewValidationReport({profile:'46.1',errors:[],warnings:['unsupported'],info:['disabled']});
        assert(w.document.querySelector('dialog details'));
        w.document.querySelector('dialog .btn-primary').click();assert.equal(await warning,true);
        assert.equal(await w.reviewValidationReport({profile:'46.1',errors:[],warnings:[],info:['disabled']}),true);
    }finally{w.close()}
});
test('saving an approved snapshot does not erase edits typed while the request is pending',async()=>{
 const h=harness(true);let resume;h.context.apiCall=()=>new Promise(resolve=>{resume=resolve});const pending=h.context.globalSave();await new Promise(setImmediate);h.context.changes.change('config:live',{text:'later'});resume('OK\nREVISION '+'b'.repeat(64)+'\n');assert.equal(await pending,true);assert.equal(h.context.changes.get().saved.text,'new');assert.equal(h.context.changes.get().draft.text,'later');assert(h.context.changes.dirty());assert.equal(h.context.changes.operation,null);
});
test('preview diff offers only Close and cannot write a file',async()=>{
 const dom=new JSDOM('<body/>',{runScripts:'outside-only'});const w=dom.window;w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};w.eval(fs.readFileSync(require.resolve('../config-review.js'),'utf8'));try{const done=w.reviewConfigChanges('old','new',{preview:true,title:'a.list'});assert.equal(w.document.querySelectorAll('dialog button').length,1);assert.equal(w.document.querySelector('button').textContent,'Закрыть');w.document.querySelector('button').click();assert.equal(await done,false);}finally{w.close()}
});
