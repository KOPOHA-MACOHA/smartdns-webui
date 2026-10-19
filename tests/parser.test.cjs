const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'parser.js'), 'utf8');
const context = { window: {}, document: {} };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'parser.js' });

const config = [
  'domain-set -name my.route -file /opt/etc/smartdns/domains/a.list',
  'nameserver /domain-set:my.route/group.name',
  'domain-set -name malformed -unknown option',
  ''
].join('\\n');
const html = context.parseConfigToSections(config);

assert.match(html, /value="my\\.route"/, 'dotted domain-set name should survive parsing');
assert.match(html, /value="group\\.name"/, 'dotted nameserver group should survive parsing');
assert.match(html, /domain-set -name malformed -unknown option/, 'unsupported domain-set directive should remain in Other');
console.log('parser round-trip regression checks passed');
