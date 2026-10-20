// 앱의 "양식 내려받기"와 같은 예시 파일(지도_양식.xlsx)을 프로젝트 폴더에 만든다
// 실행: npm run sample
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
globalThis.XLSX = require('../vendor/xlsx.full.min.js');
XLSX.set_fs(fs);

const { buildTemplateWorkbook } = await import('../js/excel.js');
const out = fileURLToPath(new URL('../지도_양식.xlsx', import.meta.url));
XLSX.writeFile(buildTemplateWorkbook(), out);
console.log(`만들었습니다: ${out}`);
