import { checkFileSize } from './file-limits.js';
export function parseWorkbookAsync(file, {signal, timeout = 20000} = {}) {
  checkFileSize(file.size);
  return new Promise((resolve, reject) => {
    if(signal?.aborted) {reject(signal.reason);return;}
    if(typeof Worker === 'undefined') {reject(new Error('안전한 파일 처리를 위해 Web Worker를 지원하는 최신 브라우저를 사용해 주세요.'));return;}
    const worker = new Worker(new URL('./excel-worker.js', import.meta.url));
    let settled = false;
    const finish = (error, value) => {
      if(settled)return;settled=true;clearTimeout(timer);worker.terminate();signal?.removeEventListener('abort',abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(signal.reason || new DOMException('취소됨','AbortError'));
    const timer = setTimeout(()=>finish(new Error('파일 처리 시간이 초과됐어요. 파일을 나눠 다시 시도해 주세요.')),timeout);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onerror = () => finish(new Error('파일 처리 작업을 시작하지 못했어요. 새로고침 후 다시 시도해 주세요.'));
    worker.onmessage = ({data}) => data.error ? finish(new Error(data.error)) : finish(null,data);
    file.arrayBuffer().then(buffer=>{if(!settled)worker.postMessage({buffer,fileName:file.name},[buffer]);}).catch(error=>finish(error));
  });
}
