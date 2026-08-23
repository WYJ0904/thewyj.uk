import { fetchWithTimeout } from "./api.js";

const CHANGELOG_TIMEOUT_MS = 3500;

function cleanList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 100)
    : [];
}

function cleanEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const version = String(value.version || "").trim().slice(0, 80);
  const build = String(value.build || "").trim().slice(0, 120);
  const date = String(value.date || "").trim();
  const title = String(value.title || "").trim().slice(0, 160);
  if (!version || !build || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) return null;
  return Object.freeze({
    version,
    build,
    date,
    title,
    features: Object.freeze(cleanList(value.features)),
    improvements: Object.freeze(cleanList(value.improvements)),
    fixes: Object.freeze(cleanList(value.fixes)),
    security: Object.freeze(cleanList(value.security)),
  });
}

export function staticChangelogEntries(root = globalThis) {
  return Object.freeze((Array.isArray(root.WYJ_CHANGELOG) ? root.WYJ_CHANGELOG : [])
    .map(cleanEntry)
    .filter(Boolean));
}

export function mergeChangelogEntries(...collections) {
  const byBuild = new Map();
  collections.forEach((collection) => {
    (Array.isArray(collection) ? collection : []).forEach((value) => {
      const entry = cleanEntry(value);
      if (entry && !byBuild.has(entry.build)) byBuild.set(entry.build, entry);
    });
  });
  return Object.freeze([...byBuild.values()].sort((left, right) => (
    right.date.localeCompare(left.date)
    || right.version.localeCompare(left.version, undefined, { numeric: true })
    || right.build.localeCompare(left.build)
  )));
}

export async function loadCloudChangelog(options = {}) {
  const fetcher = options.fetcher || fetchWithTimeout;
  const response = await fetcher("/api/changelog", {
    method: "GET",
    cache: "default",
    credentials: "same-origin",
  }, options.timeoutMs || CHANGELOG_TIMEOUT_MS);
  if (!response.ok) throw new Error(`changelog unavailable (${response.status})`);
  const payload = await response.json();
  const entries = (Array.isArray(payload?.entries) ? payload.entries : [])
    .map(cleanEntry)
    .filter(Boolean);
  if (!entries.length) throw new Error("changelog response was empty");
  return Object.freeze(entries);
}

export const __testing = { cleanEntry, cleanList };
