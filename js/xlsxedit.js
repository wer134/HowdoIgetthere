/* global XLSX */
// 고친 일정을 원래 엑셀 파일에 써 넣는다.
// SheetJS로 통째로 다시 쓰면 글꼴·색·테두리 같은 서식이 사라지므로, .xlsx는 압축을 풀어 바뀐 칸의 XML만 바꿔 끼운다
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const escapeXml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const unescapeXml = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e]));
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

/**
 * @param {object} o
 * @param {ArrayBuffer} o.buffer 올린 파일 그대로
 * @param {string} o.fileName 올린 파일 이름
 * @param {object} o.workbook SheetJS로 읽은 통합 문서 (xlsx가 아닐 때 다시 쓰는 데 쓴다)
 * @param {string} o.sheetName 고칠 시트
 * @param {Array<{ref: string, text: string, minutes?: number|null, number?: number|null}>} o.edits 칸 주소(B16)와 새 글자.
 *   원래 칸이 엑셀 시간 값(숫자)이고 minutes가 있으면 숫자로 써서 표시 형식을 살린다. number가 있으면 숫자 칸(위도·경도)으로 쓴다
 * @returns {{data: Uint8Array|string, fileName: string, type: string, keptFormat: boolean}}
 */
export function writeEditedWorkbook({ buffer, fileName, workbook, sheetName, edits }) {
  const ext = (fileName.match(/\.([^.]+)$/)?.[1] || 'xlsx').toLowerCase();
  const base = fileName.replace(/\.[^.]+$/, '');
  if (ext === 'xlsx' || ext === 'xlsm') {
    try {
      return {
        data: patchXlsx(buffer, sheetName, edits),
        fileName: `${base}_수정.${ext}`,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        keptFormat: true,
      };
    } catch (err) {
      console.warn('엑셀 파일을 직접 고치지 못해 새로 만듭니다:', err);
    }
  }
  return rewriteWithSheetJS({ workbook, sheetName, edits, base, ext });
}

function entryOf(zip, path) {
  const i = zip.FullPaths.findIndex((p) => p.replace(/^[^/]*\//, '') === path);
  if (i < 0) throw new Error(`${path}가 없습니다`);
  return zip.FileIndex[i];
}

const readText = (zip, path) => decoder.decode(new Uint8Array(entryOf(zip, path).content));

// 시트 이름 → 압축 안의 시트 XML 경로 (workbook.xml의 r:id → workbook.xml.rels의 Target)
function sheetPath(zip, sheetName) {
  const workbookXml = readText(zip, 'xl/workbook.xml');
  const tag = [...workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)].map((m) => m[0])
    .find((t) => unescapeXml(attr(t, 'name') ?? '') === sheetName);
  const rid = tag?.match(/\s(?:\w+:)?id="([^"]*)"/)?.[1];
  if (!rid) throw new Error(`${sheetName} 시트를 찾지 못했습니다`);
  const rels = readText(zip, 'xl/_rels/workbook.xml.rels');
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => attr(t, 'Id') === rid);
  const target = rel && attr(rel, 'Target');
  if (!target) throw new Error(`${sheetName} 시트 파일을 찾지 못했습니다`);
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

function patchXlsx(buffer, sheetName, edits) {
  const zip = XLSX.CFB.read(new Uint8Array(buffer), { type: 'array' });
  const path = sheetPath(zip, sheetName);
  let xml = readText(zip, path);
  for (const edit of edits) xml = patchCell(xml, edit);
  const entry = entryOf(zip, path);
  entry.content = encoder.encode(xml);
  entry.size = entry.content.length;
  return new Uint8Array(XLSX.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true }));
}

// <c r="B16" s="3" t="inlineStr"><is><t>17:40–17:55</t></is></c> 하나를 바꾼다. 서식 번호(s)는 그대로 둔다
function patchCell(xml, { ref, text, minutes, number }) {
  const found = xml.match(new RegExp(`<c\\b(?=[^>]*\\sr="${ref}")[^>]*?(?:/>|>[\\s\\S]*?</c>)`));
  if (!found) return insertCell(xml, { ref, text, number });
  const cell = found[0];
  const open = cell.match(/^<c\b[^>]*>/)[0];
  if (/<f[\s>]/.test(cell)) throw new Error(`${ref} 칸이 수식입니다`);
  const style = attr(open, 's');
  const type = attr(open, 't') || 'n';
  const old = cell.match(/<v>([^<]*)<\/v>/)?.[1];
  const s = style != null ? ` s="${style}"` : '';
  let next;
  if (number != null) {
    next = `<c r="${ref}"${s}><v>${number}</v></c>`;
  } else if (type === 'n' && old && minutes != null) {
    // 날짜와 시각이 함께 든 값이면 날짜(정수 부분)는 살린다
    next = `<c r="${ref}"${s}><v>${Math.floor(Number(old)) + minutes / 1440}</v></c>`;
  } else {
    next = `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
  }
  return xml.slice(0, found.index) + next + xml.slice(found.index + cell.length);
}

// 빈 칸은 XML에 아예 없을 수 있다(예: 끼니 행의 장소 칸). 그 행 안의 열 순서 자리에 새 칸을 끼우고, 바로 위 행의 같은 열 서식을 빌린다
function insertCell(xml, { ref, text, number }) {
  const [, col, row] = ref.match(/^([A-Z]+)(\d+)$/);
  const rowTag = xml.match(new RegExp(`<row\\b(?=[^>]*\\sr="${row}")[^>]*?(?:/>|>[\\s\\S]*?</row>)`));
  if (!rowTag) throw new Error(`${row}행을 찾지 못했습니다`);
  let style = '';
  for (let r = Number(row) - 1; r >= Math.max(1, Number(row) - 5) && !style; r--) {
    const above = xml.match(new RegExp(`<c\\b[^>]*\\sr="${col}${r}"[^>]*>`));
    const s = above && attr(above[0], 's');
    if (s != null) style = ` s="${s}"`;
  }
  const cell = number != null
    ? `<c r="${ref}"${style}><v>${number}</v></c>`
    : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
  let rowXml = rowTag[0];
  if (rowXml.endsWith('/>')) {
    rowXml = `${rowXml.slice(0, -2)}>${cell}</row>`;
  } else {
    const at = colNumber(col);
    const next = [...rowXml.matchAll(/<c\b[^>]*\sr="([A-Z]+)\d+"/g)].find((m) => colNumber(m[1]) > at);
    const pos = next ? next.index : rowXml.lastIndexOf('</row>');
    rowXml = rowXml.slice(0, pos) + cell + rowXml.slice(pos);
  }
  return xml.slice(0, rowTag.index) + rowXml + xml.slice(rowTag.index + rowTag[0].length);
}

const colNumber = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

// .xls·.csv 또는 직접 고치지 못한 파일: 바뀐 칸만 갈아 끼운 사본을 SheetJS로 쓴다 (서식은 남지 않는다)
function rewriteWithSheetJS({ workbook, sheetName, edits, base, ext }) {
  const sheet = { ...workbook.Sheets[sheetName] };
  for (const { ref, text, number } of edits) sheet[ref] = number != null ? { t: 'n', v: number } : { t: 's', v: text };
  // 범위 밖 칸(빈 열)을 채웠으면 시트 범위를 넓힌다
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  for (const { ref } of edits) {
    const c = XLSX.utils.decode_cell(ref);
    range.e.r = Math.max(range.e.r, c.r);
    range.e.c = Math.max(range.e.c, c.c);
  }
  sheet['!ref'] = XLSX.utils.encode_range(range);
  const book = { ...workbook, Sheets: { ...workbook.Sheets, [sheetName]: sheet } };
  if (ext === 'csv') {
    // 엑셀이 한글을 깨뜨리지 않도록 BOM을 붙인 UTF-8로
    const csv = XLSX.write(book, { bookType: 'csv', type: 'string', sheet: sheetName });
    return { data: `﻿${csv}`, fileName: `${base}_수정.csv`, type: 'text/csv;charset=utf-8', keptFormat: true };
  }
  return {
    data: new Uint8Array(XLSX.write(book, { bookType: 'xlsx', type: 'array' })),
    fileName: `${base}_수정.xlsx`,
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    keptFormat: false,
  };
}
