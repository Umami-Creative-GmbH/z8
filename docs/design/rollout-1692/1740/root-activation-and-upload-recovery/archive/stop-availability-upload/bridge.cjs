const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const target = path.join(root, 'apps/webapp/src/test/1740-upload-independent-bridge.test.tsx');
const pin = path.join(__dirname, 'bridge-pin.json');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
if (process.argv[2] === 'write') {
  if (fs.existsSync(target)) throw Error('Bridge already exists');
  const data = fs.readFileSync(path.join(__dirname, process.argv[3]));
  fs.writeFileSync(target, data, {flag:'wx'});
  fs.writeFileSync(pin, JSON.stringify({target, sha256:hash(data)},null,2));
} else if (process.argv[2] === 'remove') {
  const expected = JSON.parse(fs.readFileSync(pin));
  if (expected.target !== target || hash(fs.readFileSync(target)) !== expected.sha256) throw Error('Bridge ownership mismatch');
  fs.unlinkSync(target);
} else throw Error('Expected write or remove');
