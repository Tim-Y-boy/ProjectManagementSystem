const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const filename = path.join(__dirname, '../src/utils/task-assets.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
const context = { exports: {}, URL };
vm.runInNewContext(code, context);
const { assetDisplayTitle, assetLinkUrl } = context.exports;

test('legacy Feishu hostname and URL titles become readable labels', () => {
  const host = 'j0eukrlohu.feishu.cn';
  for (const title of ['', host, `https://${host}/docx/AbCd123`]) {
    assert.equal(assetDisplayTitle({ title, url: `https://${host}/docx/AbCd123` }), '飞书文档');
  }
  assert.equal(assetDisplayTitle({ url: `https://${host}/sheets/abc` }), '飞书表格');
  assert.equal(assetDisplayTitle({ url: `https://${host}/wiki/abc` }), '飞书知识库文档');
  assert.equal(assetDisplayTitle({ url: `https://${host}/base/abc` }), '飞书多维表格');
});

test('real document titles and file names are preserved; lookalike hosts are not called Feishu', () => {
  assert.equal(assetDisplayTitle({ title: '设备培训纪要', url: 'https://team.feishu.cn/docx/abc' }), '设备培训纪要');
  assert.equal(assetDisplayTitle({ originalName: '质量标准.doc' }), '质量标准.doc');
  assert.equal(assetDisplayTitle({ url: 'https://feishu.cn.example.com/abc' }), '外部资料链接');
});

test('only HTTP(S) URLs become clickable hyperlinks', () => {
  assert.equal(assetLinkUrl({ url: 'javascript:alert(1)' }), '');
  assert.equal(assetLinkUrl({ url: 'data:text/html,test' }), '');
  assert.equal(assetLinkUrl({ url: 'https://team.feishu.cn/docx/abc' }), 'https://team.feishu.cn/docx/abc');
});
