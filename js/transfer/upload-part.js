/** One immutable multipart PUT; progress only maintains an IO watchdog. */
export async function putPartWithRecovery({
  url, body, headers, signal, createRequest = () => new XMLHttpRequest(),
  idleTimeoutMs = 30000, acknowledgementTimeoutMs = 30000, attempts = 3, retryDelayMs = 250,
}) {
  const aborted = () => Object.assign(new Error("上传已暂停或取消。"), { name: "AbortError", code: "request_aborted" });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) throw aborted();
    try {
      return await new Promise((resolve, reject) => {
        const xhr = createRequest();let timer, acknowledgementTimer, settled = false;
        let uploaded = -1, received = -1, readyState = 0;
        const finish = (error, value) => {
          if (settled) return;settled = true;clearTimeout(timer);clearTimeout(acknowledgementTimer);
          signal?.removeEventListener("abort", cancel);
          error ? reject(error) : resolve(value);
        };
        const cancel = () => {finish(aborted());xhr.abort();};
        const touch = () => {
          if (settled) return;
          clearTimeout(timer);timer = setTimeout(() => {
            finish(Object.assign(new Error("分片连接长时间没有响应，请继续上传。"), { code: "part_idle_timeout", retryable: true }));
            xhr.abort();
          }, idleTimeoutMs);
        };
        xhr.open("PUT", url, true);
        for (const [key,value] of Object.entries(typeof headers === "function" ? headers() : headers || {})) xhr.setRequestHeader(key,value);
        // Repeated notifications of the same byte count/state are not IO
        // progress and must not keep a stalled request alive indefinitely.
        xhr.upload.onprogress = event => {if (event.loaded > uploaded) {uploaded = event.loaded;touch();}};
        xhr.onprogress = event => {if (event.loaded > received) {received = event.loaded;touch();}};
        xhr.onreadystatechange = () => {
          if (xhr.readyState >= 2 && xhr.readyState !== readyState && !settled) {readyState = xhr.readyState;touch();}
        };
        xhr.upload.onload = () => {
          if (settled) return;
          // Slow but progressing uploads retain the idle policy. Once the body
          // is sent, response events cannot extend the acknowledgement budget.
          acknowledgementTimer = setTimeout(() => {
            finish(Object.assign(new Error("分片已发送，但服务器尚未确认，正在重试。"), {code:"part_ack_timeout",retryable:true}));
            xhr.abort();
          }, acknowledgementTimeoutMs);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return finish(null,{status:xhr.status,text:xhr.responseText});
          let data={};try{data=JSON.parse(xhr.responseText||'{}');}catch{}
          finish(Object.assign(new Error(data.error || `分片上传失败（HTTP ${xhr.status}）`), {
            status:xhr.status,code:data.code||"part_failed",retryable:[408,502,503,504].includes(xhr.status),
          }));
        };
        xhr.onerror = () => finish(Object.assign(new Error("分片网络连接中断，请继续上传。"),{code:"part_network_error",retryable:true}));
        xhr.onabort = () => finish(aborted());
        signal?.addEventListener("abort",cancel,{once:true});
        if(signal?.aborted)return cancel();touch();
        try{xhr.send(body);}catch(error){finish(error);}
      });
    } catch (error) {
      if(signal?.aborted || error.name === "AbortError")throw aborted();
      if(!error.retryable || attempt + 1 >= attempts)throw error;
      // Same URL, bytes and SHA-256: the server's existing part PUT is idempotent.
      await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
    }
  }
}
