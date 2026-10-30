const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(require.resolve('../parser.js'),'utf8');
const base='bind :53\nserver 1.1.1.1\nserver-tcp 1.0.0.1 -exclude-default-group -group images\nlog-level info\n';
function editor(config){const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});const w=dom.window;w.markConfigDirty=()=>{};vm.runInContext(source,dom.getInternalVMContext());w.document.querySelector('main').innerHTML=w.parseConfigToSections(config);w.refreshRouteGroupOptions();return {w,doc:w.document,save:()=>w.gatherSectionsText(),close:()=>w.close()};}
const policy=' domain-rules /ytimg.com/ -nameserver images -response-mode fastest-ip -speed-check-mode tcp:443 -no-serve-expired\n https-record /ytimg.com/#\n';
test('domain policies preserve exact source, duplicate rules, comments and unrepresented options',()=>{
 const config=base+'# custom comment\n'+policy+'domain-rules /ytimg.com/ -response-mode fastest-ip\n# domain-rules /disabled.test/ -no-cache -no-serve-expired\nhttps-record /other.test/ipv4hint=1.2.3.4\n';
 const e=editor(config);try{assert.equal(e.save(),config);assert.equal(e.doc.querySelectorAll('.domain-policy').length,2);assert(e.doc.querySelector('.domain-policy.is-disabled'));e.doc.getElementById('core-cache-size').value='1024';assert.equal(e.save(),config.replace('bind :53\n','bind :53\ncache-size 1024\n'));}finally{e.close();}
});
test('editing a policy changes only selected settings; HTTPS filtering stays separate from address',()=>{
 const config=base+policy+'address /fixed.test/1.2.3.4\n';const e=editor(config);try{
 e.doc.querySelector('.policy-response').value='first-ping';assert.equal(e.save(),config.replace('-response-mode fastest-ip','-response-mode first-ping'));
 e.doc.querySelector('.policy-enabled').checked=false;const out=e.save();assert.match(out,/# domain-rules \/ytimg.com\//);assert.match(out,/# https-record \/ytimg.com\/#/);assert.match(out,/address \/fixed.test\/1.2.3.4/);
 }finally{e.close();}
});
test('new policy supports several domains or domain-set without creating fixed addresses',()=>{
 const e=editor(base);try{e.w.addDomainPolicy();const p=e.doc.querySelector('.domain-policy');p.querySelector('.policy-domain').value='ytimg.com\ndomain-set:images';p.querySelector('.policy-group').value='images';p.querySelector('.policy-https').value='block';const out=e.save();assert.match(out,/domain-rules \/ytimg.com\/ -nameserver images/);assert.match(out,/https-record \/domain-set:images\/#/);assert(!/^address /m.test(out));p.querySelector('.policy-domain').value='https://bad.test';assert.throws(e.save,/без/);}finally{e.close();}
});
test('standalone HTTPS rule can be edited and removed without changing other directives',()=>{
 const e=editor(base+'https-record /example.test/#\n');try{e.doc.querySelector('.policy-domain').value='other.test';assert.match(e.save(),/https-record \/other.test\/#/);assert(!/domain-rules/.test(e.save()));e.doc.querySelector('.domain-policy').remove();assert.equal(e.save(),base);}finally{e.close();}
});
test('scoped and unsupported rules remain editable only as original raw text',()=>{
 const input=base+'group-begin office\ndomain-rules /example.test/ -no-cache\ngroup-end\n';const e=editor(input);try{assert.equal(e.doc.querySelectorAll('.domain-policy').length,0);assert.equal(e.save(),input);}finally{e.close();}
});
test('renaming DNS group updates domain policy references and retains other options',()=>{
 const e=editor(base+policy);try{const name=e.doc.querySelector('.group-name-input');name.value='renamed';e.w.renameDnsGroup(name);assert.equal(e.doc.querySelector('.policy-group').value,'renamed');assert.match(e.save(),/domain-rules \/ytimg.com\/ -nameserver renamed -response-mode fastest-ip -speed-check-mode tcp:443 -no-serve-expired/);}finally{e.close();}
});

test('partial duplicate rules fold into effective settings and equal domains stay in one card after reload',()=>{
 const input=base+'domain-rules /a.test/ -response-mode fastest-ip\ndomain-rules /a.test/ -nameserver images -no-serve-expired\ndomain-rules /b.test/ -nameserver images -response-mode fastest-ip -no-serve-expired\n';const e=editor(input);try{assert.equal(e.doc.querySelectorAll('.domain-policy').length,1);assert.equal(e.doc.querySelector('.policy-domain').value,'a.test\nb.test');e.doc.querySelector('.policy-response').value='first-ping';const saved=e.save();assert.equal((saved.match(/^domain-rules /gm)||[]).length,2);const again=editor(saved);try{assert.equal(again.doc.querySelectorAll('.domain-policy').length,1);}finally{again.close()}}finally{e.close()}
});
