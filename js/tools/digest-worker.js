import { md5Bytes } from './file.js?release=20261109-aeris-p07-production-r2';
self.onmessage = event => {
  try { self.postMessage({ hash: md5Bytes(new Uint8Array(event.data.buffer)) }); }
  catch (_) { self.postMessage({ error: '文件哈希计算失败' }); }
};
