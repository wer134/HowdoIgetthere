import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { safeUrl } from '../js/util.js';
import { readWorkbook, placeUrl } from '../js/excel.js';
import { writeEditedWorkbook } from '../js/xlsxedit.js';

const sandbox = {};
vm.runInNewContext(fs.readFileSync(new URL('../vendor/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
globalThis.XLSX = sandbox.XLSX;

test('untrusted URL protocols are rejected while encoded HTTPS remains usable', () => {
  for (const value of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,x', '/relative', 'file:///tmp/a']) assert.equal(safeUrl(value), '');
  assert.equal(safeUrl('https://example.test/한글'), 'https://example.test/%ED%95%9C%EA%B8%80');
  assert.match(placeUrl({url:'javascript:alert(1)',id:'safe'}), /^https:\/\/www.google.com\/maps/);
});

test('XLSX content validation accepts real workbooks and rejects renamed text and ZIPs without a workbook', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['장소'], ['테스트']]), '일정');
  const data = XLSX.write(wb, {type:'array', bookType:'xlsx'});
  assert.equal(readWorkbook(data,'valid.xlsx').Sheets['일정'].A2.v, '테스트');
  assert.throws(() => readWorkbook(new TextEncoder().encode('장소\n테스트').buffer,'fake.xlsx'), /XLSX/);
  const zip = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(zip, 'unrelated.txt', new TextEncoder().encode('test'));
  assert.throws(() => readWorkbook(XLSX.CFB.write(zip,{type:'array',fileType:'zip'}),'fake.xlsm'), /통합 문서/);
  assert.equal(readWorkbook(new TextEncoder().encode('장소\n테스트').buffer,'valid.csv').Sheets.Sheet1.A2.v, '테스트');
});

test('CSV neutralizes formula-shaped strings without changing numbers or the in-memory workbook', () => {
  const values = ['=1+2', '+SUM(A1)', '@A1', '-1+2', '\t=1+2', '정상 메모', -123];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(values.map(v=>[v])), '일정');
  const before = JSON.stringify(wb);
  const out = writeEditedWorkbook({workbook:wb,fileName:'test.csv',sheetName:'일정',edits:[]});
  const parsed = XLSX.read(out.data.replace(/^\uFEFF/,''), {type:'string',raw:true,FS:','}).Sheets.Sheet1;
  values.forEach((v,i)=>assert.equal(parsed[`A${i+1}`].v, typeof v==='string' && /^[\s]*[=+@-]/.test(v) ? "'"+v : String(v)));
  assert.equal(JSON.stringify(wb),before);
});
