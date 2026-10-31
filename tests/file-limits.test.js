import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { checkFileSize, zipEntries, verifyZipExpansion, MAX_FILE_BYTES, MAX_EXPANDED_BYTES } from '../js/file-limits.js';
const XLSX=createRequire(import.meta.url)('../vendor/xlsx.full.min.js');
function workbook() {const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['장소'],['공원']]),'일정');return new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx',compression:true}));}
test('upload boundaries are checked before parsing',()=>{assert.throws(()=>checkFileSize(0));assert.throws(()=>checkFileSize(MAX_FILE_BYTES+1));assert.doesNotThrow(()=>checkFileSize(MAX_FILE_BYTES));});
test('actual ZIP inflation validates a normal XLSX',async()=>{const bytes=workbook();assert(zipEntries(bytes).some(e=>e.name==='xl/workbook.xml'));await verifyZipExpansion(bytes);});
test('oversized declared expansion is rejected without decompressing',()=>{
 const bytes=workbook(),view=new DataView(bytes.buffer);let at=-1;for(let i=0;i<bytes.length-46;i++)if(view.getUint32(i,true)===0x02014b50){at=i;break;}
 assert(at>=0);view.setUint32(at+24,MAX_EXPANDED_BYTES+1,true);assert.throws(()=>zipEntries(bytes),/64MB/);
});
test('lying ZIP expanded sizes are rejected by the streaming check',async()=>{
 const bytes=workbook(),view=new DataView(bytes.buffer);let at=-1;for(let i=0;i<bytes.length-46;i++)if(view.getUint32(i,true)===0x02014b50){at=i;break;}
 view.setUint32(at+24,0,true);view.setUint32(22,0,true);await assert.rejects(verifyZipExpansion(bytes),/크기/);
});

test('forged local ZIP sizes cannot bypass the central-directory limit',()=>{
 const bytes=workbook(),view=new DataView(bytes.buffer);view.setUint32(22,0x7fffffff,true);
 assert.throws(()=>zipEntries(bytes),/ZIP/);
});
