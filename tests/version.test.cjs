const test = require('node:test');
const assert = require('node:assert/strict');
const { compareSmartDnsVersions } = require('../version.js');

test('compares numeric semantic version components rather than strings', () => {
    assert.equal(compareSmartDnsVersions('1.0.6', '1.0.4'), -1);
    assert.equal(compareSmartDnsVersions('1.0.6', '1.0.7'), 1);
    assert.equal(compareSmartDnsVersions('1.9.9', '1.10.0'), 1);
    assert.equal(compareSmartDnsVersions('2.0.0', '1.99.99'), -1);
    assert.equal(compareSmartDnsVersions('1.0.7', '1.0.7'), 0);
});

test('rejects malformed versions rather than treating them as updates', () => {
    assert.equal(compareSmartDnsVersions('1.0.6', '1.0'), null);
    assert.equal(compareSmartDnsVersions('1.0.6', 'main'), null);
    assert.equal(compareSmartDnsVersions('', '1.0.7'), null);
});
