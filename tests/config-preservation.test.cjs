const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { validateSmartDnsConfig } = require('../validator.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'parser.js'), 'utf8');
const base = 'bind :53\ncache-size 4096\nprefetch-domain yes\nserve-expired yes\nresponse-mode fastest-response\nlog-level info\n';
const active = s => s.split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')).sort();
function editor(config, storage) {
    const dom = new JSDOM('<main></main>', {runScripts:'outside-only'});
    if(storage) Object.defineProperty(dom.window,'localStorage',{value:storage});
    vm.runInContext(source, dom.getInternalVMContext());
    dom.window.document.querySelector('main').innerHTML = dom.window.parseConfigToSections(config);
    return {window:dom.window, document:dom.window.document, save:()=>dom.window.gatherSectionsText(), close:()=>dom.window.close()};
}
test('visual load/save preserves complete upstream membership, flags, bind and addresses', () => {
    const input = base + [
        'bind 127.0.0.1:6053 -group team.a',
        'bind [::1]:6054',
        'server 1.1.1.1 -bootstrap-dns -group bootstrap.extra',
        'server 9.9.9.9 -exclude-default-group',
        'server 8.8.8.8 -e',
        'server-https https://dns.example/dns-query -group team.a -group team.b',
        'server-tls dns.other -group team.a -exclude-default-group -tls-host-verify dns.other',
        'server 1.0.0.1 -group fallback',
        'server 9.9.9.10 -g short -e',
        '#server-tls disabled.example -group team.a',
        'domain-set -name route.a -file /opt/etc/smartdns/domains/a.list',
        'nameserver /domain-set:route.a/team.a',
        'address /example.org/1.2.3.4,5.6.7.8,2001:db8::1',
        '# address /disabled.example/1.2.3.4,5.6.7.8',
        'custom-future-directive keep-this-value',
        ''
    ].join('\n');
    const ui=editor(input);
    try {
        assert.deepEqual(active(ui.save()),active(input));
        assert.match(ui.save(), /#\s*address \/disabled.example\/1.2.3.4,5.6.7.8/);
        assert.match(ui.save(), /#\s*server-tls disabled.example -group team.a/);
        ui.document.getElementById('sec-logging-select').value='notice';
        assert.deepEqual(active(ui.save()),active(input.replace('log-level info','log-level notice')));
    } finally {ui.close();}
});
test('speed-check-mode is not added when absent, and explicit none is retained', () => {
    for (const mode of ['', 'none', 'ping,tcp:443', 'tcp:853,ping']) {
        const input=base+(mode?`speed-check-mode ${mode}\n`:'');
        const ui=editor(input);
        try {assert.deepEqual(active(ui.save()),active(input));} finally {ui.close();}
    }
    const ui=editor(base);
    try {
        ui.document.getElementById('speed-ping').checked=true;
        assert.match(ui.save(), /^speed-check-mode ping$/m);
    } finally {ui.close();}
});
test('changing supported speed checks retains custom checks', () => {
    const ui=editor(base+'speed-check-mode tcp:853,ping\n');
    try {
        ui.document.getElementById('speed-ping').checked=false;
        assert.match(ui.save(), /^speed-check-mode tcp:853$/m);
    } finally {ui.close();}
});
test('bind accepts a full address, IPv6, options and shorthand port', () => {
    for (const value of ['127.0.0.1:6053','[::1]:6053',':53 -group team.a','53']) {
        const ui=editor(base);
        try {
            ui.document.getElementById('core-bind').value=value;
            assert(ui.save().includes(`bind ${value==='53'?':53':value}\n`));
        } finally {ui.close();}
    }
});
test('group rename changes only its membership and retains other groups/default inclusion', () => {
    const ui=editor(base+'server 1.1.1.1 -group team.a -group team.b\n');
    try {
        ui.document.querySelector('.group-name-input').value='renamed';
        assert.match(ui.save(), /^server 1.1.1.1 -group renamed -group team.b$/m);
        assert(!ui.save().includes('-exclude-default-group'));
    } finally {ui.close();}
});
test('new group endpoints receive membership while explicit options remain intact', () => {
    const ui=editor(base+'server 1.1.1.1 -group team.a\n');
    try {
        ui.document.querySelector('.group-dns-list').value+='\nhttps://new.example/dns-query';
        assert.match(ui.save(), /^server-https https:\/\/new.example\/dns-query -exclude-default-group -group team.a$/m);
        assert.match(ui.save(), /^server 1.1.1.1 -group team.a$/m);
    } finally {ui.close();}
});
test('quoted text resembling options does not change server membership', () => {
    const input=base+'server 1.1.1.1 -http-host "test -group fake"\n';
    const ui=editor(input);
    try {assert.deepEqual(active(ui.save()),active(input)); assert.equal(ui.document.querySelectorAll('.group-item').length,0);} finally {ui.close();}
});
test('response modes match SmartDNS and invalid imported values are never silently replaced', () => {
    for (const mode of ['first-ping','fastest-ip','fastest-response','tcp-fastest']) {
        const ui=editor(base.replace('fastest-response',mode));
        try {
            assert.equal(ui.document.getElementById('core-response-mode').value,mode);
            assert.match(ui.save(),new RegExp(`^response-mode ${mode}$`,'m'));
            assert.equal(validateSmartDnsConfig(ui.save()).errors.length,mode==='tcp-fastest'?1:0);
        } finally {ui.close();}
    }
});
test('several DoH endpoints require separate directives, URL-valued options remain valid', () => {
    assert.equal(validateSmartDnsConfig('server-https https://one.example/dns-query https://two.example/dns-query').errors.length,1);
    assert.deepEqual(validateSmartDnsConfig('server-https https://one.example/dns-query\nserver-https https://two.example/dns-query').errors,[]);
    assert.deepEqual(validateSmartDnsConfig('server-https https://one.example/dns-query -proxy https://proxy-name').errors,[]);
});

test('visual DNS fields show addresses only and retain options after reorder, removal and editing', () => {
    const ui=editor(base+'server-https https://one.example/dns-query -group team -http-host one.example\nserver-tls two.example -group team -tls-host-verify two.example\nserver 1.1.1.1 -bootstrap-dns\n');
    try {
        const field=ui.document.querySelector('.group-dns-list');
        assert.equal(field.value,'https://one.example/dns-query\ndot://two.example');
        assert.equal(ui.document.getElementById('sec-bootstrap').value,'1.1.1.1');
        field.value='dot://two.example\nhttps://one.example/dns-query';
        assert.match(ui.save(), /server-tls two.example -group team -tls-host-verify two.example/);
        field.value='https://changed.example/dns-query\ndot://two.example';
        assert.match(ui.save(), /server-https https:\/\/changed.example\/dns-query -group team -http-host one.example/);
        field.value='# dot://two.example';
        assert.match(ui.save(), /#server-tls two.example -group team -tls-host-verify two.example/);
        assert(!ui.save().includes('https://one.example'));
    } finally {ui.close();}
});

test('saving without edits preserves source byte for byte, including comments and line endings',()=>{
    const source='# My own header #\r\n\r\nbind    :53\r\n# upstream deliberately here\r\nserver 1.1.1.1\r\nlog-level info\r\n# keep this at EOF\r\n';
    const ui=editor(source);
    try {assert.equal(ui.save(),source);}finally{ui.close()}
});
test('enabling one imported DNS line leaves all other bytes and comments untouched',()=>{
    const source=base+'# Recovery: working UDP upstreams\nserver 1.1.1.1\nserver 1.0.0.1\n# Custom header #\n#server-https https://ns1.opennameserver.org/dns-query\n# Unsupported on current binary\n#server-quic quic://dns.example -group example\n# do not move this\ncache-persist no\n';
    const ui=editor(source);
    try {
        const field=ui.document.getElementById('sec-upstream');
        field.value=field.value.replace('# https://ns1.opennameserver.org/dns-query','https://ns1.opennameserver.org/dns-query');
        const expected=source.replace('#server-https https://ns1.opennameserver.org/dns-query','server-https https://ns1.opennameserver.org/dns-query');
        assert.equal(ui.save(),expected);
        const reloaded=editor(ui.save());
        try{assert.equal(reloaded.save(),expected)}finally{reloaded.close()}
    }finally{ui.close()}
});
test('changing a core value preserves spacing elsewhere and never creates default directives',()=>{
    const source='bind :53\n# cache explanation\n  cache-size    4096\n# end\n';
    const ui=editor(source);
    try {
        ui.document.getElementById('core-cache-size').value='8192';
        assert.equal(ui.save(),source.replace('  cache-size    4096','  cache-size 8192'));
    }finally{ui.close()}
});
test('removing and adding upstreams preserves comments and unsupported directives',()=>{
    const source=base+'# first note\nserver 1.1.1.1\n# second note\nserver 9.9.9.9\nunknown-config keep\n';
    const ui=editor(source);
    try{
        ui.document.getElementById('sec-upstream').value='1.1.1.1\n8.8.8.8';
        assert.equal(ui.save(),source.replace('server 9.9.9.9','server 8.8.8.8'));
        ui.document.getElementById('sec-upstream').value='1.1.1.1';
        assert.equal(ui.save(),source.replace('server 9.9.9.9\n',''));
    }finally{ui.close()}
});

test('intentional upstream reordering is retained without normalizing other source sections',()=>{
    const source='# Leave header alone #\nserver 1.1.1.1\nserver 9.9.9.9\nbind :53\nlog-level info\n';
    const ui=editor(source);
    try{
        ui.document.getElementById('sec-upstream').value='9.9.9.9\n1.1.1.1';
        assert.equal(ui.save(),source.replace('server 1.1.1.1\nserver 9.9.9.9','server 9.9.9.9\nserver 1.1.1.1'));
    }finally{ui.close()}
});

test('TCP listeners, AAAA filtering and persistent cache are editable without losing other directives',()=>{
    const source=base+'bind-tcp [::]:53\nbind-tcp 127.0.0.1:6053 -group team\nforce-AAAA-SOA yes\ncache-persist no\n# bind-tcp :5353\nmax-reply-ip-num 2\nfuture-setting keep\n';
    const ui=editor(source);
    try {
        assert.equal(ui.save(),source);
        assert.equal(ui.document.getElementById('core-bind-tcp').value,'[::]:53\n127.0.0.1:6053 -group team');
        assert.equal(ui.document.getElementById('core-force-aaaa-soa').value,'yes');
        assert.equal(ui.document.getElementById('core-cache-persist').value,'no');
        assert.equal(ui.document.getElementById('sec-core-others').tagName,'TEXTAREA');
        assert.match(ui.document.getElementById('sec-core-others').value,/max-reply-ip-num 2/);
        ui.document.getElementById('core-force-aaaa-soa').value='no';
        assert.equal(ui.save(),source.replace('force-AAAA-SOA yes','force-AAAA-SOA no'));
        ui.document.getElementById('core-bind-tcp').value='';
        const saved=ui.save();
        assert(!/^bind-tcp /m.test(saved));
        assert.match(saved,/# bind-tcp :5353/);
        assert.match(saved,/future-setting keep/);
    } finally {ui.close()}
});

test('absent optional settings stay absent until explicitly edited',()=>{
    const ui=editor(base);
    try {
        assert.equal(ui.document.getElementById('core-force-aaaa-soa').value,'');
        assert.equal(ui.document.getElementById('core-cache-persist').value,'');
        ui.document.getElementById('core-bind-tcp').value='53\n[::1]:6053';
        const saved=ui.save();
        assert.match(saved,/^bind-tcp :53$/m);
        assert.match(saved,/^bind-tcp \[::1\]:6053$/m);
        assert(!saved.includes('force-AAAA-SOA'));
        assert(!saved.includes('cache-persist'));
    } finally {ui.close()}
});

test('invalid imported optional values are visible and retained',()=>{
    const source=base+'force-AAAA-SOA invalid\ncache-persist invalid\n';
    const ui=editor(source);
    try {
        assert.equal(ui.save(),source);
        assert.equal(ui.document.getElementById('core-force-aaaa-soa').value,'invalid');
        ui.document.getElementById('core-cache-persist').value='no';
        assert.equal(ui.save(),source.replace('cache-persist invalid','cache-persist no'));
    } finally {ui.close()}
});

test('every standard core control and visual section has keyboard-accessible help',()=>{
    const ui=editor(base+'server 1.1.1.1\nserver 9.9.9.9 -group team\naddress /test.example/192.0.2.1\ndomain-set -name test -file /test.list\nnameserver /domain-set:test/team\n');
    try {
        for (const id of ['core-bind','core-bind-tcp','core-cache-size','core-prefetch','core-serve-expired','core-response-mode','core-force-aaaa-soa','core-cache-persist']) {
            assert(ui.document.getElementById(id).closest('.row').querySelector('summary[aria-label="Пояснение"]'),id);
        }
        for (const id of ['speed-ping','speed-tcp443','speed-tcp80']) assert(ui.document.getElementById(id).parentElement.querySelector('.setting-help'),id);
        for (const id of ['sec-bootstrap','sec-upstream','dynamic-groups-container','dynamic-routes-container','dynamic-addresses-container']) assert(ui.document.getElementById(id).closest('.card').querySelector('.card-header .setting-help'),id);
        ui.window.addConfigHelp(ui.document);
        assert.equal(ui.document.querySelectorAll('#core-bind').length,1);
        assert.equal(ui.document.getElementById('core-bind').closest('.row').querySelectorAll('.setting-help').length,1);
    } finally {ui.close()}
});

test('explicit DNS organization moves misplaced servers by membership without changing their arguments',()=>{
    const source='# header\r\n##########\r\n# Основные параметры (Core) #\r\n##########\r\nbind :53\r\n# retain this note\r\nserver 1.1.1.1\r\nserver 9.9.9.9 -b -g team\r\n#server-tls dns.example -g team -tls-host-verify dns.example\r\n##########\r\n# Вышестоящие DNS (Основная группа) #\r\n##########\r\nserver 1.0.0.1\r\nserver 8.8.8.8 -group fallback\r\nunknown-setting keep\r\n';
    const ui=editor(source);
    try {
        assert.equal(ui.save(),source,'ordinary save must preserve layout');
        const organized=ui.window.organizeDnsSource(source);
        assert.deepEqual(active(organized),active(source));
        assert.match(organized,/# Вышестоящие DNS \(Основная группа\) #[\s\S]*server 1\.1\.1\.1/);
        assert.match(organized,/# Bootstrap DNS #[\s\S]*server 9\.9\.9\.9 -b -g team/);
        assert.match(organized,/# Групповые записи #[\s\S]*#server-tls dns.example -g team -tls-host-verify dns.example/);
        assert.match(organized,/# Групповые записи #[\s\S]*server 8\.8\.8\.8 -group fallback/);
        assert(organized.includes('# retain this note\r\n'));
        assert.equal(ui.window.organizeDnsSource(organized),organized,'organization must be idempotent');
        const reloaded=editor(organized);
        try {assert.equal(reloaded.save(),organized)} finally {reloaded.close()}
    } finally {ui.close()}
});

test('organization keeps final newline state and refuses scoped configurations',()=>{
    const ui=editor(base);
    try {
        for (const ending of ['', '\n']) {
            const organized=ui.window.organizeDnsSource('bind :53\nserver 1.1.1.1'+ending);
            assert.equal(organized.endsWith('\n'),!!ending);
            assert.equal(ui.window.organizeDnsSource(organized),organized);
        }
        assert.throws(()=>ui.window.organizeDnsSource('group-begin office\nserver 1.1.1.1\ngroup-end\n'),/области/);
    } finally {ui.close()}
});

test('one numeric port changes both UDP and TCP while retaining the listening address',()=>{
    for (const address of ['[::]', '[::1]', '', '0.0.0.0', '127.0.0.1']) {
        const source=base.replace('bind :53',`bind ${address}:53`)+`bind-tcp ${address}:53\n`;
        const ui=editor(source);
        try {
            const port=ui.document.getElementById('core-dns-port');
            assert.equal(port.dataset.simple,'yes');
            assert.equal(port.value,'53');
            assert.equal(ui.save(),source);
            port.value='5353';
            assert.equal(ui.save(),source.replace(`bind ${address}:53`,`bind ${address}:5353`).replace(`bind-tcp ${address}:53`,`bind-tcp ${address}:5353`));
            for (const invalid of ['', '0','65536','1.5']) {
                port.value=invalid;
                assert.throws(()=>ui.save(),/Порт DNS/);
            }
        } finally {ui.close()}
    }
});

test('advanced bind controls preserve complex imports and are harmless to open',()=>{
    for (const tail of ['', 'bind-tcp :54\n', 'bind-tcp :53 -group team\n', 'bind-tcp :53\nbind :6053\n']) {
        const ui=editor(base+tail);
        try {
            assert.equal(ui.document.getElementById('core-dns-port').dataset.simple,'no');
            assert.equal(ui.save(),base+tail);
        } finally {ui.close()}
    }
    const source=base.replace('bind :53','bind [::]:53')+'bind-tcp [::]:53\n';
    const ui=editor(source);
    try {
        ui.window.useAdvancedDnsBind();
        assert.equal(ui.save(),source);
        assert(!ui.document.getElementById('core-bind').closest('.row').classList.contains('d-none'));
    } finally {ui.close()}
});

test('bind mode switches both ways, keeps edits and remembers selection without changing config',()=>{
    const values=new Map();
    const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
    const source=base.replace('bind :53','bind [::]:53')+'bind-tcp [::]:53\n';
    const ui=editor(source,storage);
    try {
        ui.window.useAdvancedDnsBind();
        assert.equal(ui.save(),source);
        assert.equal(storage.getItem('smartdns-ui-bind-mode'),'advanced');
        const loaded=editor(source,storage);
        try {
            assert.equal(loaded.document.getElementById('core-dns-port').dataset.simple,'no');
            assert.equal(loaded.save(),source);
        } finally {loaded.close()}
        ui.document.getElementById('core-bind').value='[::]:5353';
        ui.document.getElementById('core-bind-tcp').value='[::]:5353';
        assert.equal(ui.window.useSimplifiedDnsBind(),true);
        assert.equal(ui.document.getElementById('core-dns-port').value,'5353');
        assert.equal(storage.getItem('smartdns-ui-bind-mode'),'simple');
        assert.equal(ui.save(),source.replaceAll(':53',':5353'));
        const reloaded=editor(source,storage);
        try {assert.equal(reloaded.document.getElementById('core-dns-port').dataset.simple,'yes')}finally{reloaded.close()}
    } finally {ui.close()}
});

test('simple mode never discards mismatched listeners or extra bind arguments',()=>{
    const source=base+'bind-tcp :53 -group team\n';
    const ui=editor(source);
    try {
        assert.equal(ui.window.useSimplifiedDnsBind(),false);
        assert.equal(ui.save(),source);
        assert.match(ui.document.getElementById('dns-bind-mode-hint').textContent,/Нельзя объединить/);
    } finally {ui.close()}
});

test('DNS organization action belongs to the central change panel',()=>{
    const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'..','template.html'),'utf8'));
    try {
        const action=dom.window.document.querySelector('[onclick="organizeDnsBlocks()"]');
        assert.equal(action.closest('#change-center').id,'change-center');
        assert(!dom.window.document.getElementById('btn-mode-raw').parentElement.contains(action));
    } finally {dom.window.close()}
});

test('fallback is an ordinary named group, without a dedicated Core card',()=>{
 const input=base+'# retained comment\nserver-tls dns.example -group fallback -exclude-default-group\n#server 9.9.9.9 -g fallback\nnameserver /domain-set:example/fallback\n';
 const ui=editor(input);try{
  assert.equal(ui.document.getElementById('sec-fallback'),null);
  const group=[...ui.document.querySelectorAll('.group-item')].find(g=>g.querySelector('.group-name-input').value==='fallback');assert(group);
  assert.equal(ui.save(),input);ui.document.getElementById('core-cache-size').value='2048';
  assert.deepEqual(active(ui.save()),active(input.replace('cache-size 4096','cache-size 2048')));
 }finally{ui.close()}
});

test('rule organization preserves overlapping selector precedence and line endings',()=>{const source='bind :53\r\nserver 1.1.1.1\r\n##########\r\n# Логирование #\r\n##########\r\nlog-level info\r\ndomain-set -name a -file /tmp/a.list\r\nnameserver /domain-set:a/one\r\ndomain-rules /example.test/ -nameserver two\r\nhttps-record /example.test/#\r\nnameserver /example.test/three';const e=editor(source);try{const out=e.window.organizeDnsSource(source);const relevant=s=>s.split(/\r?\n/).filter(line=>/^(domain-set|nameserver|domain-rules|https-record) /.test(line));assert.deepEqual(relevant(out),relevant(source));assert(!out.endsWith('\n'));assert.equal(e.window.organizeDnsSource(out),out);assert(out.indexOf('domain-set ')<out.indexOf('# Логирование'));}finally{e.close()}});
