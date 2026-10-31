export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
export function checkFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) throw new Error('빈 파일은 가져올 수 없어요.');
  if (size > MAX_FILE_BYTES) throw new Error('일정 파일은 20MB 이하로 선택해 주세요.');
}
export function zipEntries(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => { throw new Error('올바른 XLSX ZIP 구조가 아니거나 지원하지 않는 압축 형식입니다.'); };
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) invalid();
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true), total = 0;
  if (!count || count > 1024 || at + size > end || view.getUint16(end + 4,true) || view.getUint16(end + 6,true)) invalid();
  const result = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) invalid();
    const flags=view.getUint16(at+8,true), method=view.getUint16(at+10,true), compressed=view.getUint32(at+20,true), expanded=view.getUint32(at+24,true);
    const length=view.getUint16(at+28,true), extra=view.getUint16(at+30,true), comment=view.getUint16(at+32,true), local=view.getUint32(at+42,true);
    if ((flags & 1) || ![0,8].includes(method) || at+46+length+extra+comment>end || local+30>bytes.length || view.getUint32(local,true)!==0x04034b50) invalid();
    const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
    if (start+compressed>bytes.length) invalid();
    total += expanded;
    if (total > MAX_EXPANDED_BYTES) throw new Error('압축을 푼 일정 파일은 64MB 이하만 가져올 수 있어요. 시트를 나눠 주세요.');
    result.push({name:new TextDecoder().decode(bytes.subarray(at+46,at+46+length)),method,compressed,expanded,start});
    at += 46+length+extra+comment;
  }
  return result;
}
// Count actual inflated bytes before SheetJS allocation; central-directory sizes are untrusted.
export async function verifyZipExpansion(buffer) {
  const bytes = new Uint8Array(buffer); let total = 0;
  for (const entry of zipEntries(buffer)) {
    const chunk = bytes.subarray(entry.start, entry.start + entry.compressed);
    let actual = 0;
    if (entry.method === 0) actual = chunk.length;
    else {
      if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 안전한 XLSX 압축 검사를 지원하지 않아요. 최신 브라우저 또는 CSV를 사용해 주세요.');
      const reader = new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      try { for (;;) { const {done,value}=await reader.read(); if(done)break; actual+=value.byteLength;
        if(total+actual>MAX_EXPANDED_BYTES || actual>entry.expanded) {await reader.cancel();throw new Error('압축 해제 크기가 허용 범위를 초과하거나 파일 정보와 달라요.');}
      } } finally { reader.releaseLock(); }
    }
    if(actual!==entry.expanded) throw new Error('XLSX 압축 크기 정보가 올바르지 않아요.');
    total += actual;
    if(total>MAX_EXPANDED_BYTES) throw new Error('압축 해제 크기가 허용 범위를 초과해요.');
  }
}
