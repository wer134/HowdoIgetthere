// A classic Worker isolates decompression/parsing from the UI. Termination cancels all work.
self.onmessage = async ({ data: { buffer, fileName } }) => {
  try {
    const {checkFileSize, verifyZipExpansion} = await import('./file-limits.js');
    checkFileSize(buffer.byteLength);
    if (/\.(xlsx|xlsm)$/i.test(fileName)) await verifyZipExpansion(buffer);
    importScripts('../vendor/xlsx.full.min.js');
    const {readWorkbook, parseSheet, autoMap} = await import('./excel.js');
    const workbook = readWorkbook(buffer, fileName);
    if (!workbook.SheetNames?.length || workbook.SheetNames.length > 50) throw new Error('시트가 없거나 50개를 초과해요.');
    const parsedSheets = {}; let defaultSheet = null, fallback = null;
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (sheet?.['!ref']) {
        const range = XLSX.utils.decode_range(sheet['!ref']);
        if (range.e.r-range.s.r>20000 || range.e.c-range.s.c>=200) throw new Error('일정은 시트당 20,000행·200열 이하로 나눠 주세요.');
      }
      const parsed = parseSheet(workbook,name); parsedSheets[name]=parsed;
      if(parsed.records.length) {fallback ??= name;if(autoMap(parsed.headers).name>=0)defaultSheet ??= name;}
    }
    self.postMessage({ workbook, parsedSheets, defaultSheet:defaultSheet || fallback || workbook.SheetNames[0], buffer }, [buffer]);
  } catch(error) { self.postMessage({error:error.message || '파일을 읽지 못했어요.'}); }
};
