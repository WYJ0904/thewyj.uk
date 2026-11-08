/* Preflight Core Web Vitals & Performance Instrumentation Probe. Injected before application scripts. */
(() => {
  const started = performance.now();
  let fcp = 0;
  let lcp = 0;
  let lcpElement = null;
  let cls = 0;
  const clsEntries = [];
  let tbt = 0;
  const longTasks = [];
  let fid = 0;
  let inp = 0;
  const interactionEntries = [];

  // 1. Paint timing (FCP)
  try {
    const poPaint = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (entry.name === 'first-contentful-paint') {
          fcp = entry.startTime;
        }
      }
    });
    poPaint.observe({ type: 'paint', buffered: true });
  } catch (_) {}

  // 2. Largest Contentful Paint (LCP)
  try {
    const poLcp = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      if (entries.length > 0) {
        const lastEntry = entries[entries.length - 1];
        lcp = lastEntry.renderTime || lastEntry.loadTime || lastEntry.startTime;
        if (lastEntry.element) {
          lcpElement = {
            tagName: lastEntry.element.tagName,
            id: lastEntry.element.id || '',
            className: lastEntry.element.className || '',
            size: lastEntry.size,
            inSplash: Boolean(lastEntry.element.closest('#entryScreen')),
            workspace: lastEntry.element.closest('.v3-workspace, #publicHome, #projectApp')?.id || null,
            ancestorIds: Array.from((function* (node) { for (let i=0; node && i<6; i++,node=node.parentElement) yield node.id || node.tagName; })(lastEntry.element)),
          };
        }
      }
    });
    poLcp.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (_) {}

  // 3. Cumulative Layout Shift (CLS)
  try {
    const poCls = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (!entry.hadRecentInput) {
          cls += entry.value;
          clsEntries.push({
            value: entry.value,
            startTime: entry.startTime,
            sources: (entry.sources || []).map((s) => ({
              tagName: s.node?.tagName,
              id: s.node?.id,
              currentRect: s.currentRect,
              previousRect: s.previousRect,
            })),
          });
        }
      }
    });
    poCls.observe({ type: 'layout-shift', buffered: true });
  } catch (_) {}

  // 4. Long Tasks & Total Blocking Time (TBT)
  try {
    const poLongTask = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        const blockingDuration = Math.max(0, entry.duration - 50);
        tbt += blockingDuration;
        longTasks.push({
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration,
          blockingDuration,
        });
      }
    });
    poLongTask.observe({ type: 'longtask', buffered: true });
  } catch (_) {}

  // 5. First Input Delay (FID) & Interaction to Next Paint (INP)
  try {
    const poFid = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        fid = entry.processingStart - entry.startTime;
      }
    });
    poFid.observe({ type: 'first-input', buffered: true });
  } catch (_) {}

  try {
    const poEvent = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (entry.interactionId) {
          interactionEntries.push({
            name: entry.name,
            interactionId: entry.interactionId,
            duration: entry.duration,
            startTime: entry.startTime,
          });
          if (entry.duration > inp) {
            inp = entry.duration;
          }
        }
      }
    });
    poEvent.observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch (_) {}

  // Global reader interface
  window.__aerisPreflightProbe = {
    getMetrics: () => {
      const navEntry = performance.getEntriesByType('navigation')[0] || {};
      const ttfb = navEntry.responseStart ? Math.max(0, navEntry.responseStart - navEntry.requestStart) : 0;
      const domInteractive = navEntry.domInteractive || 0;
      const domContentLoaded = navEntry.domContentLoadedEventEnd || 0;
      const loadComplete = navEntry.loadEventEnd || 0;

      const resources = performance.getEntriesByType('resource').map((r) => ({
        name: r.name,
        path: new URL(r.name, location.href).pathname,
        initiatorType: r.initiatorType,
        transferSize: r.transferSize || 0,
        decodedBodySize: r.decodedBodySize || 0,
        duration: r.duration,
      }));

      const totalTransferBytes = resources.reduce((acc, r) => acc + r.transferSize, 0);
      const totalDecodedBytes = resources.reduce((acc, r) => acc + r.decodedBodySize, 0);

      const heap = performance.memory
        ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
          }
        : null;

      return {
        elapsed: performance.now() - started,
        ttfb,
        fcp,
        lcp,
        lcpElement,
        cls: Number(cls.toFixed(4)),
        clsEntriesCount: clsEntries.length,
        clsEntries,
        tbt: Math.round(tbt),
        longTasksCount: longTasks.length,
        longTasks,
        fid: Math.round(fid),
        inp: Math.round(inp),
        domInteractive,
        domContentLoaded,
        loadComplete,
        resourceCount: resources.length,
        totalTransferBytes,
        totalDecodedBytes,
        resources,
        heap,
        domNodeCount: document.querySelectorAll('*').length,
      };
    },
  };
})();
