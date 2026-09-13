"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { unzipSync } = require("fflate");
const { packageArchive } = require("../../scripts/package.cjs");

function fixtureProject() {
  const root = mkdtempSync(path.join(os.tmpdir(), "danmaku-echo-package-"));
  const extension = path.join(root, "build", "extension");
  const files = {
    "manifest.json": JSON.stringify({ version: "9.8.7" }),
    "index.html": "<!doctype html>",
    "assets/danmaku-echo-icon.png": "icon",
    "assets/icons/icon-128.png": "icon",
    "background/service-worker.js": "void 0",
    "src/shared.js": "void 0",
    "src/content.js": "void 0",
    "src/douyin-bootstrap.js": "void 0",
    "src/douyin-page-hook.js": "void 0",
    "src/douyin-content.js": "void 0",
    "src/douyin-content.css": "body{}",
  };
  for (const [relative, value] of Object.entries(files)) {
    const destination = path.join(extension, ...relative.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, value);
  }
  writeFileSync(path.join(root, "LICENSE"), "test license");
  return root;
}

test("creates the same deterministic archive without a platform shell", () => {
  const root = fixtureProject();
  try {
    const first = packageArchive({ root, outputDir: "first output" });
    const second = packageArchive({ root, outputDir: "second output" });
    assert.equal(first.hash, second.hash);
    assert.deepEqual(first.entries, second.entries);
    assert.equal(path.basename(first.destination), "danmaku-echo-v9.8.7.zip");
    const contents = unzipSync(readFileSync(first.destination));
    assert.equal(Buffer.from(contents.LICENSE).toString("utf8"), "test license");
    assert.ok(Object.keys(contents).every((name) => !name.includes("\\")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects incomplete build output before writing a release", () => {
  const root = fixtureProject();
  try {
    rmSync(path.join(root, "build", "extension", "src", "content.js"));
    assert.throws(
      () => packageArchive({ root }),
      /ZIP is missing required entry: src\/content\.js/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
