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
  "--disable-background-networking",
  "--disable-gpu",
  "--disable-skia-graphite",
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

// Chrome/Edge 152 can crash its Windows headless GPU child with 0xC000001D.
// These isolated runs only open the unpacked extension page, so moving the GPU
// into this disposable process is a bounded local-test workaround.
if (process.platform === "win32") {
  browserArguments.push("--in-process-gpu", "--no-sandbox");
}
if (isMicrosoftEdge) browserArguments.push(`--disable-extensions-except=${extensionPath}`);
browserArguments.push("about:blank");

const browser = spawn(browserPath, browserArguments, {
  // Linux's browser UI locale also follows the process language environment.
  // Keep the requested fixture locale independent of the developer's desktop.
  env: process.platform === "linux"
    ? { ...process.env, LANGUAGE: locale.replaceAll("-", "_"), LANG: `${locale.replaceAll("-", "_")}.UTF-8` }
    : process.env,
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

  const languageSwitch = await evaluate(`(async () => {
    const root = document.querySelector('.app-shell');
    const autoPlusOneTitle = () => document.querySelector('label[for="repeat-reminder-auto-plus-one"] strong')?.textContent?.trim();
    const scaleDescription = () => document.querySelector('#general-settings .repeat-reminder-mode-setting p')?.textContent || '';
    const defaultChinese = document.documentElement.lang === 'zh-CN'
      && document.querySelector('.topbar h1')?.textContent === '常规设置'
      && autoPlusOneTitle() === '自动 +1 雷达弹幕'
      && document.querySelector('label[for="douyin-hide-gift-messages"] strong')?.textContent === '自动关闭送礼信息'
      && !scaleDescription().includes('3860') && !scaleDescription().includes('3840');
    document.querySelector('.language-switch button[lang="en"]').click();
    for (let attempt = 0; attempt < 30; attempt++) {
      if ((await chrome.storage.sync.get('settingsLanguage')).settingsLanguage === 'en') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const english = document.documentElement.lang === 'en'
      && document.querySelector('.topbar h1')?.textContent === 'General'
      && document.querySelector('#repeat-reminder-tab-bilibili')?.textContent.trim() === 'Bilibili'
      && autoPlusOneTitle() === 'Automatically +1 radar danmaku'
      && document.querySelector('label[for="douyin-hide-gift-messages"] strong')?.textContent === 'Automatically hide gift messages'
      && !scaleDescription().includes('3860') && !scaleDescription().includes('3840');
    const samePage = root === document.querySelector('.app-shell');
    if (${locale.toLowerCase().startsWith('zh')}) {
      document.querySelector('.language-switch button[lang="zh-CN"]').click();
      for (let attempt = 0; attempt < 30; attempt++) {
        if ((await chrome.storage.sync.get('settingsLanguage')).settingsLanguage === 'zh-CN') break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    return { defaultChinese, english, samePage };
  })()`);
  await send('Page.reload', {}, sessionId);
  await delay(1000);
  languageSwitch.persisted = await evaluate(`document.documentElement.lang === ${JSON.stringify(locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en')}`);

  const douyinNativeSettings = await evaluate(`(async () => {
    const controls = [
      ['douyin-hide-gift-messages', 'hideGiftMessages'],
      ['douyin-hide-lucky-bag', 'hideLuckyBagCommands'],
      ['douyin-block-gift-effects', 'blockGiftEffects'],
    ];
    const defaultsOff = controls.every(([id]) => document.getElementById(id)?.checked === false);
    for (const [id, key] of controls) {
      document.getElementById(id).click();
      for (let attempt = 0; attempt < 30; attempt++) {
        if ((await chrome.storage.sync.get('douyinNativeSettings')).douyinNativeSettings?.[key]) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    const stored = (await chrome.storage.sync.get('douyinNativeSettings')).douyinNativeSettings;
    return { defaultsOff, saved: controls.every(([, key]) => stored?.[key] === true) };
  })()`);
  await send('Page.reload', {}, sessionId);
  await delay(1000);
  douyinNativeSettings.persisted = await evaluate(`['douyin-hide-gift-messages', 'douyin-hide-lucky-bag', 'douyin-block-gift-effects'].every(id => document.getElementById(id)?.checked === true)`);

  const viewports = [];
  const polishLayouts = [];
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
    if (width === 800 || width === 1280) {
      for (const section of ['platform-colors', 'favorites-guide']) {
        await evaluate(`(() => {
          if (${JSON.stringify(section)} === 'platform-colors') {
            document.querySelector('.color-platform').open = true;
          }
          document.getElementById(${JSON.stringify(section)}).scrollIntoView({ block: 'start', behavior: 'instant' });
          return true;
        })()`);
        await delay(150);
        const screenshot = await send('Page.captureScreenshot', { captureBeyondViewport: false, format: 'png' }, sessionId);
        writeFileSync(path.join(artifactDirectory, `${scenarioName}-${section}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
      }
      const polishLayout = await evaluate(`(() => {
        const buttons = [...document.querySelectorAll('.color-platform[open] .color-reset')];
        const labels = [...document.querySelectorAll('.color-platform[open] .color-field__label')];
        return {
          buttonsFit: buttons.length > 0 && buttons.every(button => button.scrollWidth <= button.clientWidth),
          labelsFit: labels.length > 0 && labels.every(label => label.scrollWidth <= label.clientWidth),
          pageFits: document.documentElement.scrollWidth <= innerWidth,
        };
      })()`);
      polishLayouts.push({ width, ...polishLayout });
      await evaluate(`(() => {
        document.querySelector('.content-canvas').scrollTo({ top: 0, behavior: 'instant' });
        return true;
      })()`);
      await delay(150);
    }
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

  const sizing = await evaluate(`(async () => {
    const delay = () => new Promise(resolve => setTimeout(resolve, 150));
    const duration = document.getElementById("repeat-reminder-prompt-duration-bilibili");
    const queue = document.getElementById("repeat-reminder-queue-limit-bilibili");
    const size = document.getElementById("repeat-reminder-prompt-scale-bilibili");
    const autoSize = document.querySelector('input[name="interface-scale-mode"][value="auto"]');
    if (!duration || !queue || !size || !autoSize) return false;
    if (duration.disabled || queue.disabled || size.disabled) return false;
    for (const [input, value] of [[duration, 23], [queue, 7], [size, 125]]) {
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await delay();
    }
    autoSize.click();
    await delay();
    document.querySelector('input[name="repeat-reminder-mode"][value="manual"]').click();
    await delay();
    document.querySelector('input[name="repeat-reminder-mode"][value="auto"]').click();
    await delay();
    const saved = await chrome.storage.sync.get(null);
    const selected = saved.repeatReminder?.manual?.bilibili;
    return saved.interfaceScale?.mode === "auto" && saved.repeatReminder?.mode === "auto"
      && selected?.promptDurationSeconds === 23 && selected?.queueLimit === 7
      && selected?.promptScalePercent === 125 && !document.getElementById("repeat-reminder-prompt-scale-bilibili").disabled;
  })()`);
  for (const [label, selector] of [
    ["logs", ".runtime-log-tools"],
    ["sizing", 'input[name="interface-scale-mode"]'],
    ["radar", '#repeat-reminder-settings'],
  ]) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "${label === "radar" ? "start" : "center"}" })`);
    await delay(200);
    const screenshot = await send("Page.captureScreenshot", { captureBeyondViewport: false, format: "png" }, sessionId);
    writeFileSync(path.join(artifactDirectory, `${scenarioName}-${label}.png`), Buffer.from(screenshot.data, "base64"));
  }

  await evaluate(`(() => {
    console.warn('[Danmaku Echo] runtime-log-browser-test', new Error('test warning'), { token: 'log-test-secret', text: 'log-test-chat' });
    return true;
  })()`);
  const beforeReloadLogs = await evaluate(`(async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await chrome.runtime.sendMessage({ type: 'danmaku-echo.runtime-log', action: 'export' });
      if (response?.data?.entries?.some(entry => entry.message === '[Danmaku Echo] runtime-log-browser-test')) return response.data;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  })()`);
  await send("Page.reload", {}, sessionId);
  await delay(1000);
  const runtimeLogs = await evaluate(`(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'danmaku-echo.runtime-log', action: 'export' });
    const saved = response?.data?.entries?.find(entry => entry.message === '[Danmaku Echo] runtime-log-browser-test');
    const serialized = JSON.stringify(saved || {});
    const buttons = document.querySelectorAll('.runtime-log-actions button');
    if (buttons.length !== 3) return false;
    buttons[2].click();
    await new Promise(resolve => setTimeout(resolve, 200));
    const cleared = await chrome.runtime.sendMessage({ type: 'danmaku-echo.runtime-log', action: 'export' });
    return Boolean(saved?.details?.[0]?.stack && saved?.version && saved?.context?.browser
      && !serialized.includes('log-test-secret') && !serialized.includes('log-test-chat')
      && cleared?.ok && cleared.data.entries.length === 0);
  })()`);

  const sendStatistics = await evaluate(`(async () => {
    const current = Math.floor(Date.now() / 1000);
    const previous = current - 86400;
    const day = second => new Date(second * 1000).toISOString().slice(0, 10);
    const key = date => 'danmakuEchoSendStatisticsDayV1:' + date;
    const first = { id: 'browser-attempt-001', platform: 'bilibili', roomId: '123', sentAtSec: current, text: '你好 👋[微笑]' };
    const second = { id: 'browser-attempt-002', platform: 'douyu', roomId: '456', sentAtSec: current, text: '<img src="test">只是文字' };
    const third = { id: 'browser-attempt-003', platform: 'huya', roomId: '789', sentAtSec: previous };
    const index = 'danmakuEchoSendStatisticsIndexV1';
    await chrome.storage.local.set({
      [index]: { schemaVersion: 1, days: [day(previous), day(current)] },
      [key(day(current))]: { schemaVersion: 1, date: day(current), events: [first, second] },
      [key(day(previous))]: { schemaVersion: 1, date: day(previous), events: [third] },
    });
    const buttons = [...document.querySelectorAll('.send-statistics-actions button')];
    if (buttons.length !== 3) return false;
    buttons[0].click();
    for (let attempt = 0; attempt < 30; attempt++) {
      if (document.querySelector('.send-statistics-summary b')?.textContent === '3') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const totals = [...document.querySelectorAll('.send-statistics-summary b')].map(item => item.textContent);
    const daily = [...document.querySelectorAll('.send-statistics-daily-list b')].map(item => item.textContent);
    const perSecond = [...document.querySelectorAll('.send-statistics-recent b')].map(item => item.textContent);
    const messages = [...document.querySelectorAll('.send-statistics-text')].map(item => item.textContent);
    const plainTextRendered = messages.includes(first.text) && messages.includes(second.text)
      && !document.querySelector('.send-statistics-messages img');
    const exported = await chrome.runtime.sendMessage({ type: 'danmaku-echo.send-statistics', action: 'export' });
    const textExported = exported?.data?.events?.some(event => event.id === first.id && event.text === first.text)
      && exported.data.events.some(event => event.id === second.id && event.text === second.text)
      && exported.data.events.some(event => event.id === third.id && !Object.hasOwn(event, 'text'));
    return { totals, daily, perSecond, plainTextRendered, textExported, exported: exported?.ok,
      exportedEvents: exported?.data?.events?.length,
      exportedSeconds: exported?.data?.perSecond?.length,
      passed: totals.join(',') === '3,2,1,0,1,1'
      && daily.join(',') === '2,1'
      && perSecond.join(',') === '×2,×1'
      && exported?.ok && exported.data.events.length === 3
      && exported.data.perSecond.length === 2 && plainTextRendered && textExported };
  })()`);

  const statisticsLayouts = [];
  for (const width of [800, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: 900, mobile: false, screenHeight: 900, screenWidth: width, width }, sessionId);
    await evaluate(`document.querySelector('.send-statistics').scrollIntoView({ block: 'start' })`);
    await delay(100);
    const layout = await evaluate(`(() => {
      const root = document.querySelector('.send-statistics');
      const box = root.getBoundingClientRect();
      return { clip: { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height, scale: 1 },
        fits: document.documentElement.scrollWidth <= innerWidth + 1
          && [...root.querySelectorAll('input,select,button')].every(element => {
            const rect = element.getBoundingClientRect(); return rect.left >= box.left - 1 && rect.right <= box.right + 1;
          }) };
    })()`);
    statisticsLayouts.push({ width, fits: layout.fits });
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: layout.clip }, sessionId);
    writeFileSync(path.join(artifactDirectory, `${scenarioName}-statistics-${width}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  const statisticsCleared = await evaluate(`(async () => {
    window.confirm = () => true;
    document.querySelectorAll('.send-statistics-actions button')[2].click();
    for (let attempt = 0; attempt < 30; attempt++) {
      if (document.querySelector('.send-statistics-summary b')?.textContent === '0') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return !(await chrome.storage.local.get('danmakuEchoSendStatisticsIndexV1')).danmakuEchoSendStatisticsIndexV1;
  })()`);
  if (sendStatistics && typeof sendStatistics === 'object') {
    sendStatistics.cleared = statisticsCleared;
    sendStatistics.layouts = statisticsLayouts;
    sendStatistics.passed = sendStatistics.passed && statisticsCleared && statisticsLayouts.every(layout => layout.fits);
  }

  const failures = [];
  if (Object.values(douyinNativeSettings).some(value => value !== true)) failures.push('douyin-native-settings-persistence');
  if (Object.values(languageSwitch).some(value => value !== true)) failures.push('settings-language-switch');
  for (const layout of polishLayouts) {
    if (!layout.buttonsFit || !layout.labelsFit || !layout.pageFits) failures.push(`${layout.width}:settings-detail-overflow`);
  }
  if (!beforeReloadLogs || !runtimeLogs) failures.push("persistent-runtime-logs");
  if (!sendStatistics?.passed) failures.push("send-statistics-ui-and-export");
  if (!sizing) failures.push("auto-sizing-and-radar-preferences");
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
    languageSwitch,
    douyinNativeSettings,
    runtimeLogs,
    sendStatistics,
    browserStderr: browserStderr.slice(-8_000),
    actionSettings,
    locale,
    persistence,
    protocolEvents,
    viewports,
    polishLayouts,
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
