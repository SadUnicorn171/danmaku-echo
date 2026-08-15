"use strict";

const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const browserPath = process.argv[2];
const profilePath = process.argv[3];
const extensionPath = process.argv[4];
const locale = process.argv[5] || "zh-CN";
const artifactDirectory = path.resolve(process.argv[6] || "test-results/browser-e2e");
const scenarioName = String(process.argv[7] || `settings-${locale}`)
  .replace(/[^a-z0-9._-]+/gi, "-")
  .slice(0, 80);
const isMicrosoftEdge = /msedge/i.test(path.basename(browserPath || ""));
const expectedText = locale.toLowerCase().startsWith("zh")
  ? { feedback: "反馈", globalStatus: "全局状态", heading: "常规设置", help: "帮助" }
  : { feedback: "Feedback", globalStatus: "Global status", heading: "General", help: "Help" };

if (!browserPath || !profilePath || !extensionPath) {
  throw new Error(
    "Usage: node inspect-settings-page.cjs <browser> <profile> <extension> [locale] [artifacts] [scenario]",
  );
}

const browserArguments = [
  "--headless=new",
  "--disable-gpu",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-breakpad",
  "--disable-crash-reporter",
  `--lang=${locale}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-pipe",
  "--enable-unsafe-extension-debugging",
  `--user-data-dir=${profilePath}`,
];

if (isMicrosoftEdge) {
  browserArguments.push(`--disable-extensions-except=${extensionPath}`);
}
browserArguments.push("about:blank");

const browser = spawn(browserPath, browserArguments, {
  stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
  windowsHide: true,
});
let browserStderr = "";
browser.stderr.on("data", (chunk) => {
  browserStderr = `${browserStderr}${chunk.toString()}`.slice(-20_000);
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stopBrowser() {
  if (browser.exitCode !== null || browser.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      browser.kill("SIGKILL");
      resolve();
    }, 5_000);
    browser.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    browser.kill();
  });
}

async function inspect() {
  const pending = new Map();
  const protocolEvents = [];
  let nextId = 1;
  let pipeBuffer = Buffer.alloc(0);

  browser.once("exit", (code, signal) => {
    const error = new Error(
      `Browser exited before settings inspection completed (${code ?? signal ?? "unknown"}): ${browserStderr.slice(-2_000)}`,
    );
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  });

  browser.stdio[4].on("data", (chunk) => {
    pipeBuffer = Buffer.concat([pipeBuffer, chunk]);
    let delimiterIndex = pipeBuffer.indexOf(0);
    while (delimiterIndex >= 0) {
      const payload = pipeBuffer.subarray(0, delimiterIndex).toString("utf8");
      pipeBuffer = pipeBuffer.subarray(delimiterIndex + 1);
      if (payload) {
        const message = JSON.parse(payload);
        if (message.id && pending.has(message.id)) {
          const request = pending.get(message.id);
          pending.delete(message.id);
          clearTimeout(request.timer);
          if (message.error) request.reject(new Error(message.error.message));
          else request.resolve(message.result);
        } else if (["Log.entryAdded", "Runtime.exceptionThrown"].includes(message.method)) {
          protocolEvents.push(message);
        }
      }
      delimiterIndex = pipeBuffer.indexOf(0);
    }
  });

  function send(method, params = {}, sessionId = "", timeout = 10_000) {
    const id = nextId;
    nextId += 1;
    const request = { id, method, params };
    if (sessionId) request.sessionId = sessionId;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}`));
      }, timeout);
      pending.set(id, { reject, resolve, timer });
    });
    browser.stdio[3].write(`${JSON.stringify(request)}\0`);
    return response;
  }

  const loaded = await send("Extensions.loadUnpacked", {
    enableInIncognito: false,
    path: path.resolve(extensionPath),
  }, "", 25_000);
  if (!loaded?.id) throw new Error("Browser did not return the extension id.");

  const targets = await send("Target.getTargets");
  const pageTarget = targets.targetInfos.find((target) => target.type === "page");
  if (!pageTarget) throw new Error("Browser did not expose a page target.");
  const attached = await send("Target.attachToTarget", {
    flatten: true,
    targetId: pageTarget.targetId,
  });
  const sessionId = attached.sessionId;

  await send("Runtime.enable", {}, sessionId);
  await send("Log.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  await send("Page.navigate", {
    url: `chrome-extension://${loaded.id}/index.html`,
  }, sessionId);
  await delay(1_500);
  await send("Target.activateTarget", { targetId: pageTarget.targetId });
  await send("Page.bringToFront", {}, sessionId);
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    }, sessionId);
    if (result.exceptionDetails || !("value" in (result.result || {}))) {
      throw new Error(
        result.exceptionDetails?.exception?.description
          || result.exceptionDetails?.text
          || "Settings evaluation returned no value",
      );
    }
    return result.result.value;
  }

  const viewports = [];
  for (const width of [800, 1013, 1280]) {
    await send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 1,
      height: 700,
      mobile: false,
      screenHeight: 700,
      screenWidth: width,
      width,
    }, sessionId);
    await delay(100);
    const layout = await evaluate(`(() => {
      const topbar = document.querySelector(".topbar");
      const heading = topbar?.querySelector("h1");
      const actions = topbar?.querySelector(".topbar__actions");
      const help = topbar?.querySelector(".resource-links a span");
      const feedback = topbar?.querySelector("#feedback-copy span");
      const diagnostics = topbar?.querySelector("#diagnostics-copy span");
      const feedbackCode = topbar?.querySelector("#feedback-copy code");
      const globalStatus = topbar?.querySelector(".master-control span");
      const actionItems = [...(topbar?.querySelectorAll(
        ".resource-links a, .resource-links button, .master-control"
      ) || [])];
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return {
          bottom: Math.round(box.bottom),
          height: Math.round(box.height),
          left: Math.round(box.left),
          right: Math.round(box.right),
          top: Math.round(box.top),
          width: Math.round(box.width)
        };
      };
      const headingRect = heading?.getBoundingClientRect();
      const actionsRect = actions?.getBoundingClientRect();
      return {
        actionItems: actionItems.map((item) => ({
          ...rect(item),
          text: String(item.innerText || "").trim().replace(/\\s+/g, " "),
          whiteSpace: getComputedStyle(item).whiteSpace
        })),
        feedbackCodeDisplay: feedbackCode ? getComputedStyle(feedbackCode).display : "missing",
        heading: heading ? { ...rect(heading), text: heading.innerText } : null,
        labels: {
          diagnostics: diagnostics?.innerText || "",
          feedback: feedback?.innerText || "",
          globalStatus: globalStatus?.innerText || "",
          help: help?.innerText || ""
        },
        noHeadingOverlap: Boolean(
          headingRect && actionsRect && headingRect.right <= actionsRect.left
        ),
        resourceLabelsVisible: [help, feedback, diagnostics].every((item) => (
          item && getComputedStyle(item).display !== "none"
        )),
        topbarClientWidth: topbar?.clientWidth || 0,
        topbarFits: Boolean(topbar && topbar.scrollWidth <= topbar.clientWidth + 1),
        topbarScrollWidth: topbar?.scrollWidth || 0,
        viewportWidth: document.documentElement.clientWidth
      };
    })()`);
    const screenshot = await send("Page.captureScreenshot", {
      captureBeyondViewport: false,
      format: "png",
    }, sessionId);
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(
      path.join(artifactDirectory, `${scenarioName}-${width}.png`),
      Buffer.from(screenshot.data, "base64"),
    );
    viewports.push({ width, ...layout });
  }

  const persistence = await evaluate(`(async () => {
    const input = document.getElementById("action-reply");
    if (!input) return { present: false };
    const original = input.checked;
    input.checked = !original;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const saved = await chrome.storage.sync.get(null);
    const persisted = saved.actions?.reply === !original;
    input.checked = original;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { persisted, present: true, restored: input.checked === original };
  })()`);

  const actionSettings = await evaluate(`(async () => {
    const ids = ["action-plus-one", "action-reply", "action-favorite", "action-copy"];
    const inputs = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    if (Object.values(inputs).some((input) => !input)) return { present: false };
    const initial = Object.fromEntries(Object.entries(inputs).map(([id, input]) => [id, input.checked]));
    const copy = inputs["action-copy"];
    copy.checked = true;
    copy.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const copySaved = (await chrome.storage.sync.get(null)).actions?.copy === true;
    await chrome.storage.sync.set({
      actions: { plusOne: true, reply: false, favorite: false, copy: false }
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const plusOne = inputs["action-plus-one"];
    const lastActionDisabled = plusOne.disabled && plusOne.checked;
    plusOne.checked = false;
    plusOne.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const saved = await chrome.storage.sync.get(null);
    const minimumPreserved = saved.actions?.plusOne === true
      && Object.values(saved.actions || {}).some(Boolean);
    await chrome.storage.sync.set({
      actions: {
        plusOne: initial["action-plus-one"],
        reply: initial["action-reply"],
        favorite: initial["action-favorite"],
        copy: initial["action-copy"]
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {
      copyDefaultOff: initial["action-copy"] === false,
      copySaved,
      lastActionDisabled,
      minimumPreserved,
      present: true
    };
  })()`);

  const failures = [];
  for (const viewport of viewports) {
    if (!viewport.topbarFits) failures.push(`${viewport.width}:topbar-overflow`);
    if (!viewport.noHeadingOverlap) failures.push(`${viewport.width}:heading-overlap`);
    if (!viewport.heading || viewport.heading.height > 32) failures.push(`${viewport.width}:heading-wrap`);
    if (viewport.actionItems.some((item) => item.height > 32 || item.whiteSpace !== "nowrap")) {
      failures.push(`${viewport.width}:action-wrap`);
    }
    if (viewport.width === 800 && viewport.resourceLabelsVisible) {
      failures.push(`${viewport.width}:compact-labels-visible`);
    }
    if (viewport.width > 900 && !viewport.resourceLabelsVisible) {
      failures.push(`${viewport.width}:resource-labels-hidden`);
    }
    const feedbackCodeVisible = viewport.feedbackCodeDisplay !== "none"
      && viewport.feedbackCodeDisplay !== "missing";
    if ((viewport.width <= 1200 && feedbackCodeVisible)
      || (viewport.width > 1200 && !feedbackCodeVisible)) {
      failures.push(`${viewport.width}:feedback-email-${viewport.feedbackCodeDisplay}`);
    }
  }
  const widest = viewports.at(-1);
  if (widest.heading?.text !== expectedText.heading) failures.push("locale-heading");
  if (widest.labels.help !== expectedText.help) failures.push("locale-help");
  if (widest.labels.feedback !== expectedText.feedback) failures.push("locale-feedback");
  if (widest.labels.globalStatus !== expectedText.globalStatus) failures.push("locale-global-status");
  if (!persistence.present || !persistence.persisted || !persistence.restored) {
    failures.push("settings-persistence");
  }
  if (!actionSettings.present || !actionSettings.copyDefaultOff || !actionSettings.copySaved
      || !actionSettings.lastActionDisabled || !actionSettings.minimumPreserved) {
    failures.push("action-settings-invariant");
  }
  if (protocolEvents.some((event) => event.method === "Runtime.exceptionThrown")) {
    failures.push("runtime-exception");
  }

  return {
    assertionFailures: failures,
    browserStderr: browserStderr.slice(-8_000),
    actionSettings,
    locale,
    persistence,
    protocolEvents,
    viewports,
  };
}

inspect()
  .then((result) => {
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(
      path.join(artifactDirectory, `${scenarioName}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.assertionFailures.length) process.exitCode = 1;
  })
  .catch((error) => {
    const failure = {
      browserExitCode: browser.exitCode,
      browserSignal: browser.signalCode,
      browserStderr: browserStderr.slice(-8_000),
      locale,
      scenario: scenarioName,
      startupError: String(error instanceof Error ? error.message : error).slice(0, 1_000),
    };
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(
      path.join(artifactDirectory, `${scenarioName}-startup.json`),
      `${JSON.stringify(failure, null, 2)}\n`,
      "utf8",
    );
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 2;
  })
  .finally(stopBrowser);
