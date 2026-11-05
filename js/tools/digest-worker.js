import { md5Bytes } from './file.js?v=20261105-aeris-p07-r4a-runtime-r2';
self.onmessage = event => {
  try { self.postMessage({ hash: md5Bytes(new Uint8Array(event.data.buffer)) }); }
  catch (_) { self.postMessage({ error: '文件哈希计算失败' }); }
};
