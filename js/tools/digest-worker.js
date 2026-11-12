import { md5Bytes } from './file.js?release=20261112-aeris-v63-azure-tts-r1';
self.onmessage = event => {
  try { self.postMessage({ hash: md5Bytes(new Uint8Array(event.data.buffer)) }); }
  catch (_) { self.postMessage({ error: '文件哈希计算失败' }); }
};
