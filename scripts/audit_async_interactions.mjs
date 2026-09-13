import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Task 24 reopen #7 - repository-wide async interaction audit.
 *
 * The Finance candidate path was fixed first, which only proved the helper
 * works. This scanner walks every browser module, finds the handlers that can
 * wait on the network and reports which of them reach their first `await`
 * without any visible feedback.
 *
 * Two outputs:
 *  - `artifacts/async-interaction-audit.md`: the full inventory (evidence).
 *  - a non-zero exit when a path in [REQUIRED_FEEDBACK] lost its feedback, so a
 *    later refactor cannot silently reintroduce a dead-feeling button.
 */

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ARTIFACT_DIR = path.join(ROOT, "artifacts");
const MODULES = [
  "app.js",
  "tools.js",
  "workflows.js",
  "learning-sync.js",
  "changelog.js",
  ...fs
    .readdirSync(path.join(ROOT, "js"), { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith(".js"))
    .map((entry) => `js/${entry.replaceAll("\\", "/")}`),
];

/**
 * Paths that must show feedback before the first await. `match` is a substring
 * of the registration site or of the handler body.
 */
const REQUIRED_FEEDBACK = [
  { file: "js/finance/candidates.js", match: "finance-candidate-confirm", note: "Finance 候选一键确认" },
  { file: "js/finance/candidates.js", match: "finance-candidate-reject", note: "Finance 候选拒绝" },
  { file: "js/transfer/app.js", match: "transferCompleteBtn", note: "创建分享链接" },
  { file: "js/transfer/app.js", match: "transferDownload", note: "分享下载" },
  { file: "js/transfer/app.js", match: "transferRevoke", note: "撤销分享" },
  { file: "app.js", match: "learningSyncNowBtn", note: "学习数据立即同步" },
  { file: "app.js", match: "submitRechargeBtn", note: "提交充值申请" },
  { file: "app.js", match: "adminToggleBanBtn", note: "管理员用户操作" },
  { file: "app.js", match: "data-recharge-approve", note: "管理员确认充值" },
  { file: "tools.js", match: "runFileToolBtn", note: "文件工具运行" },
  { file: "tools.js", match: "runImageToolBtn", note: "图片工具运行" },
];

const NETWORK_HINTS = [
  "await ",
  "/api/",
  "fetch(",
  "request(",
  "apiGet(",
  "apiPost(",
  "publicApi(",
  "bridge.",
  "controller.",
  "load",
  "sync",
  "submit",
  "save",
  "confirm",
  "register",
  "login",
  "logout",
  "download",
  "upload",
  "revoke",
];

/** Feedback can be a helper, an explicit attribute or an inline status message. */
const FEEDBACK_HINTS = [
  "attachInteractionFeedback",
  "withInteractionFeedback",
  "withInteractionFeedbackQuiet",
  "withFeedback",
  "data-pending",
  "dataset.pending",
  "aria-busy",
  "setAttribute(\"aria-busy\"",
  "disabled = true",
  "disabled = shouldDisable",
  "setBusy(",
  "setMessage(",
  "setStatus(",
  "showStatus(",
  "renderLoading(",
  "loading = true",
  "classList.add(\"is-loading\"",
  "classList.add('is-loading'",
  "\u6b63\u5728",
  "\u5904\u7406\u4e2d",
];

/**
 * A comment-only registration must not count as a handler. Comment bodies are
 * detected per match line instead of by stripping the file: a naive `/*` strip
 * also truncates at regex literals or strings that contain comment markers,
 * which silently hid half of tools.js.
 */
function isCommentLine(text) {
  return /^\s*(?:\/\/|\*|\/\*)/.test(text);
}

/** Char index of the `{` that opens the body after [from], or -1. */
function bodyStart(source, from) {
  const brace = source.indexOf("{", from);
  const arrow = source.indexOf("=>", from);
  if (brace === -1) return -1;
  if (arrow !== -1 && arrow < brace && source.slice(arrow, brace).includes("{")) return brace;
  return brace;
}

function blockAt(source, start) {
  if (start < 0) return "";
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
}

function functionBodies(source, name) {
  const bodies = [];
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`, "g");
  const assignment = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`, "g");
  const windowAssignment = new RegExp(`window\\.[\\w$.]*${name}\\s*=\\s*(?:async\\s*)?function`, "g");
  for (const pattern of [declaration, assignment, windowAssignment]) {
    let match = pattern.exec(source);
    while (match) {
      bodies.push(blockAt(source, bodyStart(source, match.index + match[0].length - 1)));
      match = pattern.exec(source);
    }
  }
  return bodies;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function scanFile(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) return [];
  const raw = fs.readFileSync(absolute, "utf8");
  const source = raw;
  const findings = [];
  const registration = /addEventListener\(\s*["'`](click|submit|change|input)["'`]\s*,\s*/g;
  let match = registration.exec(source);
  while (match) {
    const afterEvent = match.index + match[0].length;
    const tail = source.slice(afterEvent, afterEvent + 120);
    const named = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*[,)]/.exec(tail);
    const inlineStart = bodyStart(source, afterEvent);
    const inlineBody = inlineStart !== -1 && inlineStart < afterEvent + 200 ? blockAt(source, inlineStart) : "";
    const namedBodies = named ? functionBodies(source, named[1]) : [];
    const body = [inlineBody, ...namedBodies].join("\n");
    // Feedback is often applied by a function the handler delegates to (for
    // example a document-level click handler that calls decide()/download()).
    // Follow one callee level so the audit sees the real interaction, not the
    // indirection.
    const calleeBodies = [];
    const called = new Set([...body.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)].map((hit) => hit[1]));
    for (const callee of called) {
      if (["if", "for", "while", "switch", "catch", "return", "function", "await", "typeof"].includes(callee)) continue;
      calleeBodies.push(...functionBodies(source, callee));
    }
    const context = source.slice(Math.max(0, match.index - 240), match.index + 240) + body + calleeBodies.join("\n");
    const handlerName = named ? named[1] : "<inline>";
    const awaitsNetwork = body.includes("await ") && NETWORK_HINTS.some((hint) => body.includes(hint));
    const hasFeedback = FEEDBACK_HINTS.some((hint) => context.includes(hint));
    const lineText = raw.split("\n")[lineOf(source, match.index) - 1] || "";
    if (isCommentLine(lineText)) {
      match = registration.exec(source);
      continue;
    }
    findings.push({
      file: relativePath,
      line: lineOf(source, match.index),
      event: match[1],
      handler: handlerName,
      awaitsNetwork,
      hasFeedback,
      // Registration + body, so a delegated selector inside the handler counts.
      context: context.toLowerCase(),
      snippet: lineText.trim().slice(0, 120),
    });
    match = registration.exec(source);
  }
  return findings;
}

const findings = MODULES.flatMap((module) => scanFile(module));
const gaps = findings.filter((entry) => entry.awaitsNetwork && !entry.hasFeedback);
const wired = findings.filter((entry) => entry.awaitsNetwork && entry.hasFeedback);

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
const reportPath = path.join(ARTIFACT_DIR, "async-interaction-audit.md");
const report = [
  "# Async interaction audit (Task 24 reopen #7)",
  "",
  `Scanned ${MODULES.length} browser modules; ${findings.length} click/submit/change handlers.`,
  `Network-waiting handlers with feedback: ${wired.length}. Without feedback: ${gaps.length}.`,
  "",
  "## Handlers that can wait on the network",
  "",
  "| file:line | event | handler | feedback |",
  "| --- | --- | --- | --- |",
  ...[...findings]
    .filter((entry) => entry.awaitsNetwork)
    .map((entry) => `| ${entry.file}:${entry.line} | ${entry.event} | ${entry.handler} | ${entry.hasFeedback ? "yes" : "**no**"} |`),
  "",
  "## Required feedback paths",
  "",
  "| path | requirement | status |",
  "| --- | --- | --- |",
  ...REQUIRED_FEEDBACK.map((requirement) => {
    const target = findings.find(
      (entry) => entry.file === requirement.file && entry.context.includes(requirement.match.toLowerCase()),
    );
    if (!target) return `| ${requirement.file} · ${requirement.match} | ${requirement.note} | missing handler |`;
    const wiredHere = findings.some(
      (entry) =>
        entry.file === requirement.file &&
        entry.context.includes(requirement.match.toLowerCase()) &&
        entry.hasFeedback,
    );
    return `| ${requirement.file} · ${requirement.match} | ${requirement.note} | ${wiredHere ? "wired" : "**no feedback**"} |`;
  }),
  "",
].join("\n");
fs.writeFileSync(reportPath, report, "utf8");

const violations = [];
for (const requirement of REQUIRED_FEEDBACK) {
  const target = findings.find(
    (entry) => entry.file === requirement.file && entry.context.includes(requirement.match.toLowerCase()),
  );
  if (!target) {
    violations.push(`${requirement.file}: handler for ${requirement.match} (${requirement.note}) was not found`);
    continue;
  }
  const anyFeedback = findings.some(
    (entry) =>
      entry.file === requirement.file &&
      entry.context.includes(requirement.match.toLowerCase()) &&
      entry.hasFeedback,
  );
  if (!target.hasFeedback && !anyFeedback) {
    violations.push(`${requirement.file}:${target.line} ${requirement.handler} (${requirement.note}) reaches its first await without feedback`);
  }
}

console.log(
  `[async-interaction-audit] ${findings.length} handlers, ${wired.length} network-waiting with feedback, ${gaps.length} without; report=${path.relative(ROOT, reportPath)}`,
);
if (process.env.WYJ_AUDIT_DEBUG) {
  const wanted = process.env.WYJ_AUDIT_DEBUG;
  for (const entry of findings.filter((item) => item.file === wanted)) {
    console.log(`  [${entry.file}:${entry.line}] ${entry.event} ${entry.handler} network=${entry.awaitsNetwork} feedback=${entry.hasFeedback}`);
  }
}
if (gaps.length) {
  console.log("[async-interaction-audit] still unreviewed network handlers (informational):");
  for (const gap of gaps.slice(0, 60)) {
    console.log(`  - ${gap.file}:${gap.line} ${gap.handler}`);
  }
}
if (violations.length) {
  console.error("[async-interaction-audit] required paths lost their feedback:");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log("[async-interaction-audit] all required interaction paths show feedback before the first await.");
