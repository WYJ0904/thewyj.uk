/**
 * Official Android download page controller.
 *
 * The release metadata comes from the same `/api/app/config` payload the app
 * itself uses for update checks, so the website and the app can never disagree
 * about the current version, size or SHA-256.
 */
export function createAndroidDownloadController({
  apiGet,
  document: doc = document,
  onMessage = () => {},
} = {}) {
  let bound = false;
  let release = null;

  const element = (id) => doc.getElementById(id);

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes <= 0) return "未知大小";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
  }

  function formatDate(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "待发布";
    return text;
  }

  function render(app) {
    release = app || null;
    const version = String(app?.latest_version_name || "1.0.0");
    const code = Number(app?.latest_version_code || 1);
    const url = String(app?.download_url || "/api/app/download");
    const sha = String(app?.apk_sha256 || "").toLowerCase();
    const fileName = String(app?.apk_file_name || "thewyj-android.apk");
    const size = formatBytes(app?.apk_size_bytes);
    const date = formatDate(app?.release_date);

    if (element("downloadVersion")) element("downloadVersion").textContent = `v${version} (${code})`;
    if (element("downloadReleaseDate")) element("downloadReleaseDate").textContent = date;
    if (element("downloadApkSize")) element("downloadApkSize").textContent = size;
    if (element("downloadApkName")) element("downloadApkName").textContent = fileName;
    if (element("downloadSha")) element("downloadSha").textContent = sha || "待校验值";
    if (element("downloadMainBtn")) element("downloadMainBtn").setAttribute("href", url);
    if (element("downloadSecondaryBtn")) element("downloadSecondaryBtn").setAttribute("href", url);
    if (element("downloadNotice")) {
      element("downloadNotice").textContent = sha
        ? "下载后可用 SHA-256 校验安装包完整性。"
        : "安装包校验值将在正式发布后显示。";
    }
  }

  async function reload() {
    try {
      const payload = await apiGet("/api/app/config");
      render(payload?.app || {});
    } catch (error) {
      // Graceful fallback: keep the static page and the stable download link so
      // users can still install the app when the metadata call fails.
      render(release || {});
      onMessage("无法获取最新版本信息，仍可直接下载正式安装包。");
    }
  }

  function handleClick(event) {
    const copyButton = event.target.closest("#downloadCopyShaBtn");
    if (copyButton) {
      const sha = String(release?.apk_sha256 || "");
      if (!sha) {
        onMessage("校验值暂不可用。");
        return;
      }
      const write = navigator.clipboard?.writeText?.(sha);
      if (write?.then) write.then(() => onMessage("SHA-256 已复制。")).catch(() => onMessage(sha));
      else onMessage(sha);
    }
  }

  function show() {
    if (!bound) {
      bound = true;
      element("downloadPage")?.addEventListener("click", handleClick);
    }
    return reload();
  }

  return Object.freeze({ show, reload, render, formatBytes });
}
