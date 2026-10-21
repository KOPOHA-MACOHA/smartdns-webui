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
function editor(config) {
    const dom = new JSDOM('<main></main>', {runScripts:'outside-only'});
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
