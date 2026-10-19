const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSmartDnsConfig } = require('../validator.js');

test('accepts core directives and encrypted upstream types', () => {
    const result = validateSmartDnsConfig([
        'bind :53',
        'cache-size 65536',
        'prefetch-domain yes',
        'serve-expired yes',
        'response-mode fastest-response',
        'speed-check-mode tcp:443,ping',
        'log-level notice',
        'server-https https://dns.example/dns-query -group secure',
        'server-tls tls://dns.example -group secure',
        'server-quic quic://dns.example -group secure',
        'server-h3 h3://dns.example/dns-query -group secure',
        'domain-set -name ads -file /opt/etc/smartdns/domains/ads.list',
        'nameserver /domain-set:ads/secure',
        '# comment',
        ''
    ].join('\n'));
    assert.deepEqual(result.errors, []);
});

test('reports unclosed quotes with the source line', () => {
    const result = validateSmartDnsConfig('bind :53\nserver-https "https://dns.example/dns-query');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Строка 2/);
    assert.match(result.errors[0], /незакрытая кавычка/);
});

test('reports missing required values', () => {
    const result = validateSmartDnsConfig('cache-size\nserver-https\nnameserver');
    assert.equal(result.errors.length, 3);
    assert.match(result.errors[0], /Строка 1/);
    assert.match(result.errors[1], /Строка 2/);
    assert.match(result.errors[2], /Строка 3/);
});

test('reports invalid numeric cache size, booleans, log level and bind port', () => {
    const result = validateSmartDnsConfig([
        'cache-size lots',
        'prefetch-domain maybe',
        'log-level verbose',
        'bind :70000'
    ].join('\n'));
    assert.equal(result.errors.length, 4);
});

test('reports missing -group argument but leaves unknown directives alone', () => {
    const result = validateSmartDnsConfig('server-https https://dns.example/dns-query -group\ncustom-new-directive whatever');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /-group/);
});
