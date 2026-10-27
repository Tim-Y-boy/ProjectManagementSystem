// Run from web: node scripts/test-upload-config.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'src/api/index.ts'), 'utf8');
const nginxConf = fs.readFileSync(path.join(root, 'nginx.conf'), 'utf8');

const uploadBlock = apiSource.match(/uploadAsset:[\s\S]*?downloadAsset:/)?.[0] || '';

assert.match(uploadBlock, /\/tasks\/\$\{id\}\/assets\/upload/);
assert.doesNotMatch(uploadBlock, /Content-Type/i);
assert.doesNotMatch(uploadBlock, /multipart\/form-data/i);

const progressBlock = apiSource.match(/saveProgress:[\s\S]*?createDailyUpdate:/)?.[0] || '';
assert.match(progressBlock, /\/tasks\/\$\{id\}\/progress-save/);
assert.doesNotMatch(progressBlock, /Content-Type/i);

assert.match(nginxConf, /client_max_body_size\s+201m\s*;/);

console.log('upload config ok');
