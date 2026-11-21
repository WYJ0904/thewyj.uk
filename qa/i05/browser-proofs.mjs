import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isAllowedPagesFile } from "../../scripts/stage_pages_deploy.mjs";

const sha256 = data => createHash("sha256").update(data).digest("hex");
const isInput = file => isAllowedPagesFile(file) ||
  /^cloudflare\/migrations\/\d{4}_.+\.sql$/.test(file) ||
  /^qa\/i05\/browser-(?:acceptance|proofs)\.mjs$/.test(file) ||
  ["qa/p07-f/vendor/axe.min.js", "local-backend/browser_harness.mjs",
    "package.json", "package-lock.json", "scripts/stage_pages_deploy.mjs", "wrangler.jsonc"].includes(file);

export async function captureSource(root) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const commit = git("rev-parse", "HEAD").trim();
  const affected = git("status", "--porcelain=v1", "--no-renames", "-z")
    .split("\0").filter(Boolean).map(line => ({
      status: line.slice(0, 2).trim(),
      file: line.length > 2 ? line.slice(3) : "",
    }));
  const files = [...new Set(git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
    .split("\0").filter(isInput))].sort();
  const recorded = await Promise.all(files.map(async file => {
    const data = await readFile(path.join(root, file));
    return { file, sha256: sha256(data) };
  }));
  const changedInputs = affected.filter(({ file }) => isInput(file));
  return {
    commit,
    tree: git("rev-parse", "HEAD^{tree}").trim(),
    branch: git("branch", "--show-current").trim(),
    sourceMatchesCommit: changedInputs.length === 0,
    changedInputs,
    inputsSha256: sha256(JSON.stringify(recorded)),
    inputs: recorded,
  };
}

export function pngProof(png) {
  assert.ok(png.length >= 33 && png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    && png.toString("ascii", 12, 16) === "IHDR", "Screenshot must have a PNG IHDR");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), sha256: sha256(png) };
}

export async function viewportProof(page) {
  return page.evaluate(`({
    width: window.innerWidth, height: window.innerHeight,
    visualWidth: window.visualViewport.width, visualHeight: window.visualViewport.height,
    scale: window.visualViewport.scale, dpr: window.devicePixelRatio,
  })`);
}

export async function assertViewport(page, width, height) {
  const measured = await viewportProof(page);
  assert.deepEqual(
    [measured.width, measured.height, measured.dpr, measured.scale], [width, height, 1, 1],
    `Unexpected browser viewport: ${JSON.stringify(measured)}`,
  );
  // A desktop scrollbar can occupy part of the measured visual viewport.
  assert.ok(measured.visualWidth > width - 24 && measured.visualWidth <= width &&
    measured.visualHeight > height - 24 && measured.visualHeight <= height,
  `Unexpected visual viewport: ${JSON.stringify(measured)}`);
  return measured;
}

export async function verifyAdminColumns(page, key, rowSelector, actionColumn = false) {
  const result = await page.evaluate(`(() => {
    const head = document.querySelector('.admin-list-head[data-admin-cols="' + ${JSON.stringify(key)} + '"]');
    const rows = [...document.querySelectorAll(${JSON.stringify(rowSelector)})];
    if (!head || !rows.length || !head.getBoundingClientRect().height) return null;
    const headers = [...head.children].map(node => node.getBoundingClientRect());
    const dataColumns = headers.length - Number(${actionColumn});
    const headTracks = getComputedStyle(head).gridTemplateColumns.split(' ').map(parseFloat);
    return {
      dataColumns, totalColumns: headers.length, headTracks,
      rows: rows.map(row => {
        const cells = [...row.children].map(node => node.getBoundingClientRect());
        const rowTracks = getComputedStyle(row).gridTemplateColumns.split(' ').map(parseFloat);
        const labelTrack = headers.at(-1);
        const actions = cells.at(-1);
        return {
          dataDrifts: headers.slice(0, dataColumns).map((cell, index) => Math.abs(cell.left - cells[index]?.left)),
          trackDrifts: headTracks.map((value, index) => Math.abs(value - rowTracks[index])),
          action: ${actionColumn} && actions ? {
            trackLeft: labelTrack.left, trackRight: labelTrack.right,
            actionsLeft: actions.left, actionsRight: actions.right,
          } : null,
        };
      }),
    };
  })()`);
  assert.ok(result && result.dataColumns > 0 && result.headTracks.length === result.totalColumns, `Missing visible ${key} header or data rows`);
  for (const row of result.rows) {
    assert.ok([...row.dataDrifts, ...row.trackDrifts].every(drift => Number.isFinite(drift) && drift <= 1.5),
      `Admin ${key} data column/track mismatch: ${JSON.stringify(row)}`);
    if (actionColumn) {
      assert.ok(row.action && row.action.actionsLeft >= row.action.trackLeft - 1.5 &&
        Math.abs(row.action.actionsRight - row.action.trackRight) <= 1.5,
      `Admin ${key} actions outside their right-aligned grid track: ${JSON.stringify(row)}`);
    }
  }
  return result;
}

export async function exerciseReleaseChannel(page, pointerClick) {
  const channels = ["stable", "beta", "experimental"];
  const fetchChannel = async () => {
    const snapshot = await page.evaluate(`(async () => {
      const token = localStorage.getItem("wyjAccountSession");
      const response = await fetch("/api/release-channel", {
        credentials: "include", cache: "no-store",
        headers: token ? { "X-Session-Token": token } : {},
      });
      const body = await response.json();
      return { status: response.status, channel: body.channel, revision: body.revision };
    })()`);
    assert.equal(snapshot.status, 200, "Authoritative release-channel read failed");
    assert.ok(channels.includes(snapshot.channel) && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0,
      "Invalid authoritative release-channel snapshot");
    return snapshot;
  };
  const readSelected = () => page.evaluate("document.getElementById('releaseChannelSelect')?.value");
  const waitForReady = () => page.waitFor(
    "document.documentElement.dataset.bootState === 'ready' && location.pathname === '/account' && " +
    "document.querySelector('#releaseChannelSection:not(.hidden) #releaseChannelSelect:not(:disabled)')?.options.length > 0",
    20_000, "authenticated /account release channel ready",
  );
  const reload = async () => {
    await page.navigate("/account");
    await waitForReady();
    return readSelected();
  };
  const save = async channel => {
    await page.evaluate(`(() => {
      const control = document.getElementById("releaseChannelSelect");
      control.value = ${JSON.stringify(channel)};
      control.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    const hit = await pointerClick("#saveReleaseChannelBtn", page);
    await page.waitFor(
      "document.querySelector('#releaseChannelStatus')?.textContent === '体验通道已保存' && " +
      "document.querySelector('#saveReleaseChannelBtn:not(:disabled)') !== null",
      15_000, "release-channel save succeeded and unlocked",
    );
    return hit;
  };

  await waitForReady();
  const original = await fetchChannel();
  assert.equal(await readSelected(), original.channel, "Initial UI did not reflect authoritative channel");
  const next = original.channel === "beta" ? "experimental" : "beta";
  const proof = { original, targetChannel: next };
  let exerciseError;
  try {
    proof.saveHit = await save(next);
    proof.saved = await fetchChannel();
    assert.equal(proof.saved.channel, next);
    assert.equal(proof.saved.revision, original.revision + 1);
    proof.reloadedChannel = await reload();
    assert.equal(proof.reloadedChannel, next);
  } catch (error) {
    exerciseError = error;
  } finally {
    try {
      const observed = await fetchChannel();
      if (observed.channel === next && observed.revision === original.revision + 1) {
        if (await readSelected() !== next) await reload();
        await save(original.channel);
        proof.restored = await fetchChannel();
        assert.equal(proof.restored.revision, observed.revision + 1);
      } else {
        // A failure before the edit left the original value. A newer revision
        // belongs to another update and must not be overwritten by this test.
        assert.deepEqual(observed, original, "Release channel changed outside this isolated test");
        proof.restored = observed;
      }
      assert.equal(proof.restored.channel, original.channel);
      proof.restoredAfterReload = await reload();
      assert.equal(proof.restoredAfterReload, original.channel);
    } catch (restoreError) {
      if (exerciseError) throw new AggregateError([exerciseError, restoreError], "Release-channel verification and restoration both failed");
      throw restoreError;
    }
  }
  if (exerciseError) throw exerciseError;
  return proof;
}
