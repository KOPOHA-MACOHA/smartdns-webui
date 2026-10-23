const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {JSDOM}=require('jsdom');
const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
const source=app.slice(app.indexOf('async function preflightCurrentConfig()'),app.indexOf('// === ОСНОВНОЕ СОХРАНЕНИЕ'));
function editor(accept=true,fail=false){
 const dom=new JSDOM('<button id="preflight-config-btn">Тест DNS</button><button id="restart-service-btn">Restart</button>');const calls=[],alerts=[];const doc=dom.window.document;
 const context={document:doc,activeTab:'settings',preflightBusy:false,currentSettingsMode:'ui',captureConfigDraft:()=> ({text:'candidate'}),validateConfigLogical:async()=>null,validateConfigOnServer:async()=>({errors:[],warnings:[],info:[]}),
 window:{reviewValidationReport:async()=>accept,parseValidationReport:require('../validator.js').parseValidationReport},alert:m=>alerts.push(m),
 apiCall:async(action,target,body)=>{assert.equal(action,'preflight_config');assert.equal(body,'candidate');assert(doc.getElementById('restart-service-btn').disabled);calls.push(action);if(fail)throw Error('offline');return 'PROFILE\t46.1\tpreflight\nI\t0\tpassed\n'}};
 context.changes=new (require('../change-center.js').ChangeController)({onChange:state=>{
  doc.getElementById('restart-service-btn').disabled=!!state.operation;
  doc.getElementById('preflight-config-btn').disabled=!!state.operation;
 }});
 vm.createContext(context);vm.runInContext(source,context);return {dom,doc,context,calls,alerts};
}
test('native test sends only the candidate-test request and restores controls',async()=>{
 const e=editor();try{await e.context.preflightCurrentConfig();assert.deepEqual(e.calls,['preflight_config']);assert.equal(e.context.changes.operation,null);assert.equal(e.doc.getElementById('restart-service-btn').disabled,false);assert.equal(e.doc.getElementById('preflight-config-btn').textContent,'Тест DNS');}finally{e.dom.window.close()}
});
test('cancelled static check or a failed network request leaves working-service controls intact',async()=>{
 for(const [accept,fail] of [[false,false],[true,true]]){const e=editor(accept,fail);try{e.doc.getElementById('restart-service-btn').disabled=true;await e.context.preflightCurrentConfig();assert.equal(e.doc.getElementById('restart-service-btn').disabled,false);assert.equal(e.context.changes.operation,null);assert.equal(e.calls.length,accept?1:0);assert.equal(e.alerts.length,fail?1:0)}finally{e.dom.window.close()}}
});
test('repeated clicks cannot start parallel native tests',async()=>{
 const e=editor();try{let resume;e.context.validateConfigOnServer=()=>new Promise(resolve=>{resume=resolve});const first=e.context.preflightCurrentConfig();await Promise.resolve();await e.context.preflightCurrentConfig();resume({errors:[],warnings:[],info:[]});await first;assert.equal(e.calls.length,1)}finally{e.dom.window.close()}
});
test('native results are labelled as candidate snapshots rather than static-only checks',async()=>{
 const dom=new JSDOM('<body></body>',{runScripts:'outside-only'});const w=dom.window;w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};w.eval(fs.readFileSync(require.resolve('../config-review.js'),'utf8'));
 try{const report=require('../validator.js').parseValidationReport('PROFILE\t46.1\tpreflight\nI\t0\tgroup passed\n');const promise=w.reviewValidationReport(report,true);assert.match(w.document.querySelector('h2').textContent,/Тест DNS/);assert.match(w.document.querySelector('p').textContent,/снимок редактора/);assert.match(w.document.querySelector('summary').textContent,/Подробности/);w.document.querySelector('button').click();await promise;}finally{w.close()}
});
