// Task 23 release guard: the Android build, the published release metadata,
// the Cloudflare variables and the changelog must describe one release.
//
// Usage:
//   node scripts/check_android_release.mjs
//   node scripts/check_android_release.mjs --apk <path>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const require = (condition, message) => {
  if (!condition) problems.push(message);
};

const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, "android", "release-metadata.json"), "utf8"));
const gradle = fs.readFileSync(path.join(ROOT, "android", "app", "build.gradle.kts"), "utf8");
const wrangler = JSON.parse(
  fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""),
);
const changelog = fs.readFileSync(path.join(ROOT, "changelog.js"), "utf8");
const downloadPage = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

require(new RegExp(`versionCode = ${metadata.versionCode}\\b`).test(gradle), "build.gradle versionCode differs from release metadata");
require(gradle.includes(`versionName = "${metadata.versionName}"`), "build.gradle versionName differs from release metadata");
require(/applicationId = "uk\.thewyj\.app"/.test(gradle), "formal applicationId changed");

for (const [label, vars] of [
  ["default", wrangler.vars],
  ["preview", wrangler.env?.preview?.vars],
  ["production", wrangler.env?.production?.vars],
]) {
  require(Boolean(vars), `${label} vars missing`);
  if (!vars) continue;
  require(Number(vars.ANDROID_LATEST_VERSION_CODE) === metadata.versionCode, `${label} latest versionCode mismatch`);
  require(String(vars.ANDROID_LATEST_VERSION_NAME) === metadata.versionName, `${label} latest versionName mismatch`);
  require(Number(vars.ANDROID_MINIMUM_VERSION_CODE) === metadata.minimumVersionCode, `${label} minimum versionCode mismatch`);
  require(String(vars.ANDROID_RELEASE_DATE) === metadata.releaseDate, `${label} release date mismatch`);
  require(String(vars.ANDROID_APK_FILE_NAME) === metadata.apkFileName, `${label} apk file name mismatch`);
  require(String(vars.ANDROID_APK_KEY) === metadata.apkKey, `${label} apk object key mismatch`);
  require(String(vars.ANDROID_RELEASE_BUILD) === metadata.releaseBuild, `${label} release build mismatch`);
  require(
    String(vars.ANDROID_RELEASE_NOTES || "") === String(metadata.releaseNotes || ""),
    `${label} release notes mismatch`,
  );
  const sha = String(vars.ANDROID_APK_SHA256 || "");
  require(/^[0-9a-f]{64}$/.test(sha), `${label} ANDROID_APK_SHA256 must be a published sha256 (got "${sha}")`);
  if (metadata.apkSha256) require(sha === metadata.apkSha256, `${label} sha256 differs from release metadata`);
  require(Number(vars.ANDROID_APK_SIZE_BYTES) > 0, `${label} ANDROID_APK_SIZE_BYTES must be published`);
  if (metadata.apkSizeBytes) {
    require(Number(vars.ANDROID_APK_SIZE_BYTES) === metadata.apkSizeBytes, `${label} apk size differs from release metadata`);
  }
}

require(changelog.includes(metadata.releaseBuild), "changelog is missing this release build id");
require(downloadPage.includes('id="downloadPage"'), "index.html has no download page");
require(downloadPage.includes('href="/download"'), "index.html has no /download entry link");
require(downloadPage.includes('id="downloadMainBtn"'), "download page has no primary download action");

const apkIndex = process.argv.indexOf("--apk");
if (apkIndex >= 0 && process.argv[apkIndex + 1]) {
  const apkPath = path.resolve(process.argv[apkIndex + 1]);
  require(fs.existsSync(apkPath), `apk not found at ${apkPath}`);
  if (fs.existsSync(apkPath)) {
    const bytes = fs.readFileSync(apkPath);
    const sha = crypto.createHash("sha256").update(bytes).digest("hex");
    require(bytes.length === metadata.apkSizeBytes, `apk size ${bytes.length} differs from metadata ${metadata.apkSizeBytes}`);
    require(sha === metadata.apkSha256, `apk sha256 ${sha} differs from metadata ${metadata.apkSha256}`);
  }
}

if (problems.length) {
  console.error("Android release check failed:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `Android release check passed: v${metadata.versionName} (${metadata.versionCode}), ${metadata.apkFileName}, ` +
    `sha256=${metadata.apkSha256 ? metadata.apkSha256.slice(0, 16) + "…" : "pending"}, key=${metadata.apkKey}`,
  );
}
