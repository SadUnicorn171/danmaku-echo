"use strict";

const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const extensionPath = path.join(root, "build", "extension");
const artifactRoot = path.join(root, "test-results", "browser-e2e");
const requestedBrowser = String(
  process.argv.find((argument) => argument.startsWith("--browser="))?.slice("--browser=".length)
    || "all",
).toLowerCase();
const requestedScenario = String(
  process.argv.find((argument) => argument.startsWith("--scenario="))?.slice("--scenario=".length)
    || "",
);

const scenarios = [
  { name: "settings-zh", kind: "settings", locale: "zh-CN" },
  { name: "settings-en", kind: "settings", locale: "en-US" },
  { name: "huya-side", host: "www.huya.com", platform: "huya", query: "platform=huya" },
  {
    name: "huya-image-emoji",
    host: "www.huya.com",
    platform: "huya",
    query: "platform=huya&nativeemoji=1&skipSide=1",
  },
  {
    name: "huya-fullscreen",
    host: "www.huya.com",
    platform: "huya",
    query: "platform=huya&fullscreen=1&fullscreenViewportConflict=1",
  },
  { name: "douyu-side", host: "www.douyu.com", platform: "douyu", query: "platform=douyu" },
  {
    name: "douyu-image-emoji",
    host: "www.douyu.com",
    platform: "douyu",
    query: "platform=douyu&nativeemoji=1&skipSide=1",
  },
  {
    name: "douyu-pe3-image-emoji",
    host: "www.douyu.com",
    platform: "douyu",
    query: "platform=douyu&nativeemoji=1&pe3emoji=1&skipSide=1",
  },
  {
    name: "douyu-fullscreen",
    host: "www.douyu.com",
    platform: "douyu",
    query: "platform=douyu&fullscreen=1",
  },
  {
    name: "bilibili-side",
    host: "live.bilibili.com",
    platform: "bilibili",
    query: "platform=bilibili",
  },
  {
    name: "bilibili-standard-emoji",
    host: "live.bilibili.com",
    platform: "bilibili",
    query: "platform=bilibili&rich=1&skipSide=1&emojionly=1",
    timeout: 100_000,
  },
  {
    name: "bilibili-first-room-emoji",
    host: "live.bilibili.com",
    platform: "bilibili",
    query: "platform=bilibili&rich=1&coldroomemoji=1&skipSide=1",
    timeout: 40_000,
  },
  {
    name: "bilibili-unrelated-emoji-guard",
    host: "live.bilibili.com",
    platform: "bilibili",
    query: "platform=bilibili&rich=1&unrelatedemoji=1&skipSide=1",
    timeout: 40_000,
  },
  {
    name: "bilibili-badge-name-emoji",
    host: "live.bilibili.com",
    platform: "bilibili",
    query: "platform=bilibili&rich=1&badgenameemoji=1&skipSide=1",
    timeout: 40_000,
  },
  {
    name: "bilibili-name-only-emoji",
    host: "live.bilibili.com",
    platform: "bilibili",
    query: "platform=bilibili&rich=1&nameonlypanel=1&skipSide=1",
    timeout: 180_000,
  },
  {
    name: "bilibili-rich",
    host: "live.bilibili.com",
    platform: "bilibili",
    query: "platform=bilibili&rich=1&skipSide=1",
    timeout: 180_000,
  },
  {
    name: "bilibili-fullscreen",
    host: "live.bilibili.com",
    platform: "bilibili",
    query: "platform=bilibili&rich=1&fullscreen=1",
    timeout: 120_000,
  },
  {
    name: "bilibili-hover-performance",
    host: "live.bilibili.com",
    platform: "bilibili",
    query: "platform=bilibili&rich=1&hoverperf=1&skipSide=1",
    timeout: 150_000,
  },
  {
    name: "douyin-side",
    host: "live.douyin.com",
    platform: "douyin",
    query: "platform=douyin",
    timeout: 60_000,
  },
  {
    name: "douyin-fullscreen",
    host: "live.douyin.com",
    platform: "douyin",
    query: "platform=douyin&fullscreen=1",
    timeout: 60_000,
  },
];

function environmentPath(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  return "";
}

function browserCandidates() {
  const programFiles = environmentPath("ProgramFiles", "PROGRAMFILES");
  const programFilesX86 = environmentPath("ProgramFiles(x86)", "PROGRAMFILES(X86)");
  const localAppData = environmentPath("LOCALAPPDATA", "LocalAppData");
  return {
    chrome: [
      process.env.DANMAKU_E2E_CHROME_PATH,
      programFiles && path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      programFilesX86 && path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      localAppData && path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    ].filter(Boolean),
    edge: [
      process.env.DANMAKU_E2E_EDGE_PATH,
      programFilesX86 && path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      programFiles && path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    ].filter(Boolean),
  };
}

function selectedBrowsers() {
  if (!["all", "chrome", "edge"].includes(requestedBrowser)) {
    throw new Error(`Unknown browser '${requestedBrowser}'. Use chrome, edge, or all.`);
  }
  const candidates = browserCandidates();
  const names = requestedBrowser === "all" ? ["chrome", "edge"] : [requestedBrowser];
  return names.map((name) => {
    const executable = candidates[name].find((candidate) => existsSync(candidate));
    if (!executable) {
      throw new Error(
        `${name} executable was not found. Set DANMAKU_E2E_${name.toUpperCase()}_PATH.`,
      );
    }
    return { executable, name };
  });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function startFixtureServer(port) {
  const child = spawn(process.execPath, [path.join(root, "tests", "fixture-server.cjs")], {
    cwd: root,
    env: {
      ...process.env,
      BCP_FIXTURE_PORT: String(port),
      BCP_FIXTURE_TIMEOUT: String(20 * 60_000),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Fixture server did not start: ${stderr.slice(-1_000)}`));
    }, 10_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      if (!chunk.toString().includes("READY ")) return;
      clearTimeout(timer);
      resolve(child);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Fixture server exited with code ${code}: ${stderr.slice(-1_000)}`));
    });
  });
}

function runProcess(command, args, timeout) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code === null ? 2 : Number(code), signal, stderr, stdout, timedOut });
    });
  });
}

function parsedResult(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function parsedAssertionFailures(parsed) {
  if (!parsed || typeof parsed !== "object") return [];
  return [
    parsed.bilibiliRichRegression,
    parsed.douyinDomRegression,
    parsed.douyinRichRegression,
    parsed.nativeEmojiRegression,
    parsed.sideChatRegression,
  ].flatMap((result) => Array.isArray(result?.assertionFailures)
    ? result.assertionFailures.map(String)
    : []);
}

async function runScenario(browser, fixturePort, scenario, attempt) {
  const cdpPort = await availablePort();
  const profile = mkdtempSync(path.join(os.tmpdir(), `danmaku-echo-${browser.name}-`));
  const artifactDirectory = path.join(artifactRoot, browser.name);
  mkdirSync(artifactDirectory, { recursive: true });
  const hostRules = [
    "MAP www.huya.com 127.0.0.1",
    "MAP live.bilibili.com 127.0.0.1",
    "MAP www.douyu.com 127.0.0.1",
    "MAP live.douyin.com 127.0.0.1",
    "EXCLUDE localhost",
  ].join(", ");
  const targetUrl = `http://${scenario.host}:${fixturePort}/?${scenario.query}&manual=1`;
  const artifactName = `${browser.name}-${scenario.name}-attempt-${attempt}`;
  try {
    if (scenario.kind === "settings") {
      const execution = await runProcess(
        process.execPath,
        [
          path.join(root, "tests", "inspect-settings-page.cjs"),
          browser.executable,
          profile,
          extensionPath,
          scenario.locale,
          artifactDirectory,
          artifactName,
        ],
        scenario.timeout || 60_000,
      );
      return { ...execution, attempt, parsed: parsedResult(execution.stdout) };
    }
    const execution = await runProcess(
      process.execPath,
      [
        path.join(root, "tests", "inspect-live-dom.cjs"),
        browser.executable,
        targetUrl,
        profile,
        String(cdpPort),
        extensionPath,
        "2500",
        "none",
        hostRules,
        `${scenario.platform}-extension`,
        "--compact",
        `--artifact-dir=${artifactDirectory}`,
        `--scenario=${artifactName}`,
      ],
      scenario.timeout || 60_000,
    );
    return { ...execution, attempt, parsed: parsedResult(execution.stdout) };
  } finally {
    try {
      rmSync(profile, { force: true, maxRetries: 20, recursive: true, retryDelay: 100 });
    } catch (error) {
      process.stderr.write(
        `WARN profile cleanup failed for ${profile}: ${String(error)}\n`,
      );
    }
  }
}

async function main() {
  if (!existsSync(path.join(extensionPath, "manifest.json"))) {
    throw new Error("Build output is missing. Run npm run build first.");
  }
  const browsers = selectedBrowsers();
  if (requestedScenario && !scenarios.some((entry) => entry.name === requestedScenario)) {
    throw new Error(
      `Unknown scenario '${requestedScenario}'. Use one of: ${scenarios.map((entry) => entry.name).join(", ")}.`,
    );
  }
  mkdirSync(artifactRoot, { recursive: true });
  const fixturePort = await availablePort();
  const fixture = await startFixtureServer(fixturePort);
  const summary = [];
  try {
    for (const browser of browsers) {
      for (const scenario of scenarios.filter((entry) =>
        !requestedScenario || entry.name === requestedScenario
      )) {
        let result = await runScenario(browser, fixturePort, scenario, 1);
        const startupFailure = result.timedOut || result.code === 2 || !result.parsed;
        if (startupFailure) {
          result = await runScenario(browser, fixturePort, scenario, 2);
        }
        const assertionFailures = parsedAssertionFailures(result.parsed);
        const passed = result.code === 0
          && !result.timedOut
          && Boolean(result.parsed)
          && assertionFailures.length === 0;
        summary.push({
          attempt: result.attempt,
          browser: browser.name,
          code: result.code,
          passed,
          scenario: scenario.name,
          signal: result.signal,
          stderr: result.stderr.slice(-2_000),
          stdout: result.stdout.slice(-2_000),
          timedOut: result.timedOut,
          assertionFailures,
        });
        process.stdout.write(`${passed ? "PASS" : "FAIL"} ${browser.name} ${scenario.name}\n`);
      }
    }
  } finally {
    fixture.kill();
  }
  writeFileSync(
    path.join(artifactRoot, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  const failures = summary.filter((entry) => !entry.passed);
  if (failures.length) {
    process.stderr.write(`${JSON.stringify({ failures }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error instanceof Error ? error.stack : error)}\n`);
  process.exitCode = 1;
});
