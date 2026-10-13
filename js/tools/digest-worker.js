import { md5Bytes } from './file.js?v=20261013-aeris-task26-r8';
self.onmessage = event => {
  try { self.postMessage({ hash: md5Bytes(new Uint8Array(event.data.buffer)) }); }
  catch (_) { self.postMessage({ error: '文件哈希计算失败' }); }
};
