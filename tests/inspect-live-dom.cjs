'use strict'

const { spawn } = require('node:child_process')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const edgePath = process.argv[2]
const targetUrl = process.argv[3]
const profilePath = process.argv[4]
const port = Number(process.argv[5] || 9333)
const extensionPath = process.argv[6] && process.argv[6] !== 'none' ? process.argv[6] : ''
const waitMilliseconds = Number(process.argv[7] || 15_000)
const shouldProbeDouyin = process.argv[8] === '--probe-douyin'
const hostResolverRules = process.argv[9] && process.argv[9] !== 'none' ? process.argv[9] : ''
const injectPlatform = process.argv[10] || ''
const lateDouyinHook = injectPlatform === 'douyin-late'
const extensionOnlyPlatform = injectPlatform.endsWith('-extension')
  ? injectPlatform.slice(0, -'-extension'.length)
  : ''
const useExtensionDebuggingPipe = Boolean(extensionPath && extensionOnlyPlatform)
const normalizedInjectPlatform = lateDouyinHook ? 'douyin' : extensionOnlyPlatform || injectPlatform
const compactOutput = process.argv.includes('--compact')
const artifactDirectoryArgument = process.argv.find((argument) =>
  argument.startsWith('--artifact-dir='),
)
const scenarioArgument = process.argv.find((argument) => argument.startsWith('--scenario='))
const artifactDirectory = artifactDirectoryArgument
  ? path.resolve(artifactDirectoryArgument.slice('--artifact-dir='.length))
  : ''
const scenarioName = String(
  scenarioArgument?.slice('--scenario='.length) || normalizedInjectPlatform || 'inspection',
)
  .replace(/[^a-z0-9._-]+/gi, '-')
  .slice(0, 80)
const targetParameters = new URL(targetUrl).searchParams
const isMicrosoftEdge = /msedge/i.test(path.basename(edgePath || ''))
const expectedDouyinReplyMention =
  targetParameters.get('nativefill') === '1'
    ? '@native用户ID '
    : targetParameters.get('idonly') === '1'
      ? '@731234567890 '
      : '@弹幕用户 '

if (!edgePath || !targetUrl || !profilePath) {
  throw new Error('Usage: node inspect-live-dom.cjs <edge> <url> <profile> [port]')
}

const browserArguments = [
  '--headless=new',
  '--disable-gpu',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-breakpad',
  '--disable-crash-reporter',
  '--lang=en-US',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profilePath}`,
]

if (useExtensionDebuggingPipe) {
  browserArguments.push('--remote-debugging-pipe')
  browserArguments.push('--enable-unsafe-extension-debugging')
  if (isMicrosoftEdge) {
    browserArguments.push(`--disable-extensions-except=${extensionPath}`)
  }
} else {
  browserArguments.push('--remote-debugging-address=127.0.0.1')
  browserArguments.push(`--remote-debugging-port=${port}`)
}

if (extensionPath && !useExtensionDebuggingPipe) {
  browserArguments.push(`--disable-extensions-except=${extensionPath}`)
  browserArguments.push(`--load-extension=${extensionPath}`)
} else if (!extensionPath) {
  // A signed-in Edge profile can otherwise sync unrelated extensions and open
  // their welcome pages, causing the CDP fixture runner to select the wrong tab.
  browserArguments.push('--disable-extensions')
}
if (hostResolverRules) {
  browserArguments.push(`--host-resolver-rules=${hostResolverRules}`)
  browserArguments.push('--no-proxy-server')
}
browserArguments.push(useExtensionDebuggingPipe ? 'about:blank' : targetUrl)

const browser = spawn(edgePath, browserArguments, {
  stdio: useExtensionDebuggingPipe
    ? ['ignore', 'ignore', 'pipe', 'pipe', 'pipe']
    : ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
})
let browserStderr = ''
browser.stderr.on('data', (chunk) => {
  browserStderr = `${browserStderr}${chunk.toString()}`.slice(-20_000)
})

function stopBrowser() {
  if (browser.exitCode !== null || browser.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      browser.kill('SIGKILL')
      resolve()
    }, 5_000)
    browser.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    browser.kill()
  })
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function findPageTarget() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (browser.exitCode !== null || browser.signalCode !== null) {
      throw new Error(
        `Browser exited before CDP became ready (${browser.exitCode ?? browser.signalCode}): ${browserStderr.slice(-2_000)}`,
      )
    }
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
        response.json(),
      )
      const target = targets.find((item) => item.type === 'page' && /^https?:/i.test(item.url))
      if (target) {
        return target
      }
    } catch {
      // Browser debugging endpoint is not ready yet.
    }
    await delay(200)
  }
  throw new Error(`Could not find the live page debugging target: ${browserStderr.slice(-2_000)}`)
}

async function listDebugTargets() {
  try {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
      response.json(),
    )
    return targets.map((item) => ({
      title: String(item.title || '').slice(0, 200),
      type: String(item.type || ''),
      url: String(item.url || '').replace(/chrome-extension:\/\/[^/]+/i, 'chrome-extension://<id>'),
    }))
  } catch {
    return []
  }
}

async function inspect() {
  const pending = new Map()
  const consoleEvents = []
  const executionContexts = []
  let nextId = 1
  let pageSessionId = ''
  let evaluationContextId = 0
  let socket = null
  let browserTargets = []

  function handleProtocolMessage(message) {
    if (message.method === 'Runtime.consoleAPICalled') {
      consoleEvents.push({
        level: String(message.params?.type || 'log'),
        text: (message.params?.args || [])
          .map((argument) => String(argument.value ?? argument.description ?? '').slice(0, 500))
          .join(' ')
          .slice(0, 1_000),
        timestamp: Number(message.params?.timestamp) || 0,
      })
      if (consoleEvents.length > 100) consoleEvents.splice(0, consoleEvents.length - 100)
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleEvents.push({
        level: 'exception',
        text: String(
          message.params?.exceptionDetails?.exception?.description ||
            message.params?.exceptionDetails?.text ||
            'Unknown runtime exception',
        ).slice(0, 2_000),
        timestamp: Number(message.params?.timestamp) || 0,
      })
    }
    if (message.method === 'Runtime.executionContextCreated') {
      executionContexts.push({
        id: message.params?.context?.id,
        name: String(message.params?.context?.name || ''),
        origin: String(message.params?.context?.origin || ''),
        type: String(message.params?.context?.auxData?.type || ''),
      })
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) {
        reject(new Error(message.error.message))
      } else {
        resolve(message.result)
      }
    }
  }

  function createRequest(method, params = {}, sessionId = '') {
    const id = nextId
    nextId += 1
    const request = { id, method, params }
    if (sessionId) request.sessionId = sessionId
    const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    return { promise, request }
  }

  let sendBrowser
  if (useExtensionDebuggingPipe) {
    let pipeBuffer = Buffer.alloc(0)
    browser.stdio[4].on('data', (chunk) => {
      pipeBuffer = Buffer.concat([pipeBuffer, chunk])
      let delimiterIndex = pipeBuffer.indexOf(0)
      while (delimiterIndex >= 0) {
        const payload = pipeBuffer.subarray(0, delimiterIndex).toString('utf8')
        pipeBuffer = pipeBuffer.subarray(delimiterIndex + 1)
        if (payload) handleProtocolMessage(JSON.parse(payload))
        delimiterIndex = pipeBuffer.indexOf(0)
      }
    })
    sendBrowser = (method, params = {}, sessionId = '') => {
      const { promise, request } = createRequest(method, params, sessionId)
      browser.stdio[3].write(`${JSON.stringify(request)}\0`)
      return promise
    }
    const loaded = await sendBrowser('Extensions.loadUnpacked', {
      enableInIncognito: false,
      path: path.resolve(extensionPath),
    })
    if (!loaded?.id)
      throw new Error('Browser did not return an extension id after loading Danmaku Echo.')
    const targetResult = await sendBrowser('Target.getTargets')
    const target = targetResult.targetInfos.find((item) => item.type === 'page')
    if (!target)
      throw new Error('Could not find the browser page target after loading the extension.')
    const attached = await sendBrowser('Target.attachToTarget', {
      flatten: true,
      targetId: target.targetId,
    })
    pageSessionId = attached.sessionId
    await sendBrowser('Runtime.enable', {}, pageSessionId)
    await sendBrowser('Page.enable', {}, pageSessionId)
    await sendBrowser('Page.bringToFront', {}, pageSessionId)
    await sendBrowser('Page.navigate', { url: targetUrl }, pageSessionId)
    await sendBrowser('Page.bringToFront', {}, pageSessionId)
    await delay(waitMilliseconds)
    // Edge may open a sync-confirmation page shortly after startup and move the
    // fixture into a background lifecycle state. Re-activate the fixture after
    // the startup wait and emulate focus so short performance timers are not
    // suspended by browser-owned UI.
    const startupTargets = await sendBrowser('Target.getTargets')
    for (const startupTarget of startupTargets.targetInfos) {
      if (
        startupTarget.targetId !== target.targetId &&
        startupTarget.type === 'page' &&
        String(startupTarget.url || '').startsWith('edge://sync-confirmation')
      ) {
        await sendBrowser('Target.closeTarget', { targetId: startupTarget.targetId })
      }
    }
    await sendBrowser('Target.activateTarget', { targetId: target.targetId })
    await sendBrowser('Page.bringToFront', {}, pageSessionId)
    await sendBrowser(
      'Emulation.setFocusEmulationEnabled',
      {
        enabled: true,
      },
      pageSessionId,
    )
    await sendBrowser(
      'Emulation.setIdleOverride',
      {
        isScreenUnlocked: true,
        isUserActive: true,
      },
      pageSessionId,
    )
    browserTargets = (await sendBrowser('Target.getTargets')).targetInfos.map((item) => ({
      title: String(item.title || '').slice(0, 200),
      type: String(item.type || ''),
      url: String(item.url || '').replace(/chrome-extension:\/\/[^/]+/i, 'chrome-extension://<id>'),
    }))
  } else {
    const target = await findPageTarget()
    browserTargets = await listDebugTargets()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    socket.addEventListener('message', (event) => handleProtocolMessage(JSON.parse(event.data)))
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    sendBrowser = (method, params = {}) => {
      const { promise, request } = createRequest(method, params)
      socket.send(JSON.stringify(request))
      return promise
    }
    await sendBrowser('Runtime.enable')
    await sendBrowser('Page.enable')
    await delay(waitMilliseconds)
  }

  const send = (method, params = {}) => sendBrowser(method, params, pageSessionId)

  let extensionProbe = null
  if (extensionOnlyPlatform) {
    const isolatedContext = [...executionContexts]
      .reverse()
      .find(
        (context) =>
          context.type === 'isolated' && context.origin.startsWith('chrome-extension://'),
      )
    const mainProbe = await send('Runtime.evaluate', {
      expression: `({
        portalCount: document.querySelectorAll(".bcp-one-portal").length,
        readyState: document.readyState,
        url: location.href
      })`,
      returnByValue: true,
    })
    let isolatedProbe = null
    if (isolatedContext) {
      if (normalizedInjectPlatform !== 'douyin') {
        evaluationContextId = isolatedContext.id
      }
      const isolatedResult = await send('Runtime.evaluate', {
        contextId: isolatedContext.id,
        expression: `({
          loaded: Boolean(globalThis.__bulletPlusOneLoaded),
          platform: globalThis.DanmakuEchoShared?.detectPlatform(location.hostname) || null,
          runtimeId: globalThis.chrome?.runtime?.id || null,
          shared: Boolean(globalThis.DanmakuEchoShared)
        })`,
        returnByValue: true,
      })
      isolatedProbe = isolatedResult.result.value
    }
    extensionProbe = {
      isolated: isolatedProbe,
      main: mainProbe.result.value,
    }
  }

  async function evaluateValue(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      ...(evaluationContextId ? { contextId: evaluationContextId } : {}),
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails || !('value' in (result.result || {}))) {
      const evaluationError = String(
        result.exceptionDetails?.exception?.description ||
          result.exceptionDetails?.text ||
          result.result?.description ||
          'Runtime.evaluate returned no serializable value',
      ).slice(0, 2_000)
      consoleEvents.push({
        level: 'evaluation-error',
        text: evaluationError,
        timestamp: Date.now(),
      })
      throw new Error(evaluationError)
    }
    return result.result.value
  }

  function dispatchMouse(type, x, y, extra = {}) {
    return send(
      'Input.dispatchMouseEvent',
      Object.assign(
        {
          type,
          x: Math.round(x),
          y: Math.round(y),
          button: type === 'mouseMoved' ? 'none' : 'left',
          buttons: type === 'mousePressed' ? 1 : 0,
          clickCount: type === 'mouseMoved' ? 0 : 1,
          pointerType: 'mouse',
        },
        extra,
      ),
    )
  }

  if (normalizedInjectPlatform && !extensionOnlyPlatform) {
    const root = path.resolve(__dirname, '..')
    const extensionRoot = path.join(root, 'build', 'extension')
    const sharedSource = `${readFileSync(path.join(extensionRoot, 'src', 'shared.js'), 'utf8')}
;(() => {
  const shared = globalThis.DanmakuEchoShared;
  globalThis.DanmakuEchoShared = Object.freeze({
    ...shared,
    detectPlatform: () => ${JSON.stringify(normalizedInjectPlatform)}
  });
})();`
    const isDouyinInjection = normalizedInjectPlatform === 'douyin'
    const contentFile = isDouyinInjection ? 'douyin-content.js' : 'content.js'
    const cssFile = isDouyinInjection ? 'douyin-content.css' : 'content.css'
    const contentSource = readFileSync(path.join(extensionRoot, 'src', contentFile), 'utf8')
    const cssSource = readFileSync(path.join(extensionRoot, 'src', cssFile), 'utf8')
    const storageMockSource = `(() => {
      if (globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.local) return;
      const values = { sync: {}, local: {} };
      const listeners = new Set();
      const area = (name) => ({
        get(keys, callback) {
          const result = keys == null
            ? { ...values[name] }
            : typeof keys === "string"
              ? { [keys]: values[name][keys] }
              : { ...values[name] };
          if (typeof callback === "function") {
            callback(result);
            return;
          }
          return Promise.resolve(result);
        },
        set(update, callback) {
          const changes = {};
          Object.entries(update || {}).forEach(([key, value]) => {
            changes[key] = { oldValue: values[name][key], newValue: value };
            values[name][key] = value;
          });
          callback?.();
          listeners.forEach((listener) => listener(changes, name));
          if (typeof callback !== "function") return Promise.resolve();
        }
      });
      const writeFavorite = (request, callback) => {
        const storageKey = "danmakuEchoFavoritesV1";
        const backupKey = "danmakuEchoFavoritesBackupV2";
        const current = values.local[storageKey] || {
          items: [],
          revision: 0,
          schemaVersion: 2,
          updatedAt: 0,
          writeId: ""
        };
        const database = structuredClone(current);
        const room = request.room;
        const operation = request.operation || "favorite";
        let added = false;
        if (operation === "favorite") {
          const text = String(request.text || "").normalize("NFKC").trim();
          const key = text.toLocaleLowerCase();
          let item = database.items.find((entry) => entry.normalizedText === key);
          added = !item;
          if (!item) {
            const now = Date.now();
            item = {
              createdAt: now,
              globalPinned: false,
              id: crypto.randomUUID(),
              lastSentAt: 0,
              normalizedText: key,
              origins: [],
              payload: request.payload || {
                assets: [],
                parts: [{ text, type: "text" }],
                plainText: text,
                text
              },
              roomStats: {},
              text,
              totalSendCount: 0,
              updatedAt: now
            };
            database.items.push(item);
          }
          if (!item.origins.some((origin) => origin.roomKey === room.roomKey)) {
            item.origins.push({
              collectedAt: Date.now(),
              platform: room.platform,
              roomId: room.roomId,
              roomKey: room.roomKey,
              roomName: room.roomName
            });
          }
          item.roomStats[room.roomKey] = {
            ...(item.roomStats[room.roomKey] || {
              lastSentAt: 0,
              pinned: false,
              sendCount: 0
            }),
            addedToRoomAt: item.roomStats[room.roomKey]?.addedToRoomAt || Date.now()
          };
        } else {
          const item = database.items.find((entry) => entry.id === request.id);
          if (item && operation === "record-sent") {
            const stats = item.roomStats[room.roomKey] || {
              lastSentAt: 0,
              pinned: false,
              sendCount: 0
            };
            stats.lastSentAt = Date.now();
            stats.sendCount += 1;
            item.roomStats[room.roomKey] = stats;
            item.lastSentAt = stats.lastSentAt;
            item.totalSendCount += 1;
            item.updatedAt = stats.lastSentAt;
          } else if (item && operation === "add-to-room") {
            item.roomStats[room.roomKey] = {
              ...(item.roomStats[room.roomKey] || {
                lastSentAt: 0,
                pinned: false,
                sendCount: 0
              }),
              addedToRoomAt: Date.now()
            };
          } else if (item && operation === "remove") {
            database.items = database.items.filter((entry) => entry.id !== request.id);
          }
        }
        database.revision += 1;
        database.updatedAt = Date.now();
        database.writeId = crypto.randomUUID();
        area("local").set({
          [storageKey]: database,
          [backupKey]: database
        }, () => callback?.({ ok: true, added }));
      };
      globalThis.chrome = {
        ...(globalThis.chrome || {}),
        runtime: {
          getManifest: () => ({ version: "test" }),
          id: "fixture-extension",
          lastError: null,
          sendMessage(request, callback) {
            if (request?.type === "danmaku-echo.favorite-write") {
              queueMicrotask(() => writeFavorite(request, callback));
              return;
            }
            queueMicrotask(() => callback?.({ ok: false, error: "unsupported-fixture-message" }));
          }
        },
        storage: {
          local: area("local"),
          sync: area("sync"),
          onChanged: {
            addListener: (listener) => listeners.add(listener),
            removeListener: (listener) => listeners.delete(listener)
          }
        }
      };
    })();`
    await send('Page.enable')
    let pageHookSource = ''
    if (isDouyinInjection) {
      pageHookSource = readFileSync(path.join(extensionRoot, 'src', 'douyin-page-hook.js'), 'utf8')
      if (!lateDouyinHook) {
        await send('Page.addScriptToEvaluateOnNewDocument', { source: pageHookSource })
      }
    }
    await send('Page.navigate', { url: targetUrl })
    await delay(500)
    if (lateDouyinHook) {
      await send('Runtime.evaluate', { expression: pageHookSource })
    }
    await send('Runtime.evaluate', {
      expression: `(() => { const style = document.createElement("style"); style.textContent = ${JSON.stringify(cssSource)}; document.documentElement.appendChild(style); })()`,
    })
    await send('Runtime.evaluate', { expression: storageMockSource })
    await send('Runtime.evaluate', { expression: sharedSource })
    await send('Runtime.evaluate', { expression: contentSource })
    await delay(lateDouyinHook ? 3_200 : 2_000)
  }

  if (
    extensionOnlyPlatform &&
    targetParameters.get('fullscreen') === '1' &&
    targetParameters.get('simulatedfullscreen') !== '1'
  ) {
    await send('Runtime.evaluate', {
      expression: `document.querySelector('.bpx-player-container,#player-wrap')?.requestFullscreen?.()`,
      awaitPromise: true,
      userGesture: true,
    })
    await delay(250)
  }

  const hasDouyinFixture =
    shouldProbeDouyin || normalizedInjectPlatform === 'douyin'
      ? await evaluateValue('Boolean(window.__douyinDomFixture)')
      : false
  let douyinProbe = null
  if (shouldProbeDouyin && !hasDouyinFixture && normalizedInjectPlatform !== 'douyin') {
    const probeResult = await send('Runtime.evaluate', {
      expression: String.raw`(async () => {
        const host = document.createElement("div");
        host.className = "CanvasDanmakuPlugin";
        Object.assign(host.style, {
          position: "fixed",
          // Keep the synthetic barrage and its +1 button away from the viewport edge
          // so the follow assertion is not masked by the button's edge clamping.
          left: "-200px",
          top: "60px",
          width: "640px",
          height: "360px",
          zIndex: "1000",
          pointerEvents: "none"
        });
        const canvas = document.createElement("canvas");
        canvas.width = 1280;
        canvas.height = 720;
        canvas.style.width = "640px";
        canvas.style.height = "360px";
        document.body.appendChild(host);

        const chatMessage = document.createElement("div");
        chatMessage.className = "webcast-chatroom___item";
        const chatContent = document.createElement("span");
        chatContent.className = "message-content";
        chatContent.appendChild(document.createTextNode("一起"));
        const chatEmoji = document.createElement("img");
        chatEmoji.className = "emoji-image";
        chatEmoji.alt = "[加油]";
        chatContent.appendChild(chatEmoji);
        chatContent.appendChild(document.createTextNode("加油"));
        chatMessage.appendChild(chatContent);
        document.body.appendChild(chatMessage);

        let transferResult = "not-called";
        if (typeof canvas.transferControlToOffscreen === "function") {
          transferResult = canvas.transferControlToOffscreen();
        }
        host.appendChild(canvas);
        const workerMain = () => {
          const instances = new Map();
          const edges = (value) => {
            const list = Array.isArray(value) ? value : [value || 0];
            const top = Number(list[0]) || 0;
            const right = Number(list[1] == null ? top : list[1]) || 0;
            const bottom = Number(list[2] == null ? top : list[2]) || 0;
            const left = Number(list[3] == null ? right : list[3]) || 0;
            return { top, right, bottom, left };
          };
          const flatten = (item, inherited, result) => {
            if (!item || typeof item !== "object") return;
            const style = Object.assign({}, inherited, item);
            if (item.type === "text" || item.type === "image") {
              result.push(style);
              return;
            }
            (Array.isArray(item.content) ? item.content : []).forEach(
              (child) => flatten(child, style, result)
            );
          };
          const measure = (instance, options) => {
            const items = [];
            flatten(options, { fontSize: instance.config.fontSize || 20 }, items);
            const padding = edges(options.padding);
            let width = padding.left + padding.right;
            let height = 0;
            for (const item of items) {
              const fontSize = Number(item.fontSize) || instance.config.fontSize || 20;
              if (item.type === "text") {
                instance.context.font = (item.fontWeight || 400) + " "
                  + (fontSize * instance.dpr) + "px " + (item.fontFamily || "Arial");
                width += instance.context.measureText(item.text || "").width / instance.dpr;
                height = Math.max(height, fontSize);
              } else {
                width += Number(item.width || item.height || fontSize);
                height = Math.max(height, Number(item.height || fontSize));
              }
            }
            return { items, padding, width, height };
          };
          const draw = (instance) => {
            if (!instance.active) return;
            const context = instance.context;
            const dpr = instance.dpr;
            context.clearRect(0, 0, instance.canvas.width, instance.canvas.height);
            instance.barrages.forEach((barrage, channel) => {
              const layout = measure(instance, barrage);
              const duration = Number(barrage.duration || instance.config.duration || 15_000);
              const elapsed = Math.max(0, Date.now() - Number(barrage.startTime || Date.now()));
              const left = instance.config.width
                - elapsed * (instance.config.width + layout.width) / duration;
              let x = (left + layout.padding.left) * dpr;
              const top = (channel * instance.config.channelHeight + 2) * dpr;
              for (const item of layout.items) {
                const fontSize = Number(item.fontSize) || instance.config.fontSize || 20;
                if (item.type === "text") {
                  context.font = (item.fontWeight || 400) + " "
                    + (fontSize * dpr) + "px " + (item.fontFamily || "Arial");
                  context.textBaseline = "top";
                  context.lineWidth = 2 * dpr;
                  context.strokeStyle = item.strokeColor || "#000";
                  context.fillStyle = item.color || "#fff";
                  context.strokeText(item.text || "", x, top);
                  context.fillText(item.text || "", x, top);
                  x += context.measureText(item.text || "").width;
                } else {
                  const width = Number(item.width || item.height || fontSize) * dpr;
                  const height = Number(item.height || fontSize) * dpr;
                  context.fillStyle = "#ffd84d";
                  context.fillRect(x, top, width, height);
                  x += width;
                }
              }
            });
          };
          setInterval(() => instances.forEach(draw), 16);
          self.addEventListener("message", (event) => {
            const message = event.data || {};
            const params = message.params || {};
            self.postMessage({ observedMethod: message.method || "" });
            if (message.method === "createInstance") {
              const canvas = params.offscrrenCanvas || params.offscreenCanvas;
              const config = params.config || {};
              instances.set(message._uniqueId, {
                canvas,
                context: canvas.getContext("2d"),
                config,
                dpr: Number(config.devicePixelRatio) || 1,
                barrages: Array.isArray(params.barrages) ? params.barrages.slice() : [],
                active: true
              });
              self.postMessage({
                method: "createInstanceResult",
                isSuccess: true,
                _uniqueId: message._uniqueId
              });
              return;
            }
            const instance = instances.get(message._uniqueId);
            if (!instance) return;
            if (message.method === "addBarrage") instance.barrages.push(params);
            if (message.method === "stop") instance.active = false;
            if (message.method === "start") instance.active = true;
            if (message.method === "clear") instance.barrages = [];
            if (message.method === "destroy") instances.delete(message._uniqueId);
          });
        };
        const workerUrl = URL.createObjectURL(new Blob([
          "(" + workerMain.toString() + ")()"
        ], { type: "text/javascript" }));
        const channel = new Worker(workerUrl, { name: "probe-canvas-danmaku" });
        const workerControls = [];
        channel.addEventListener("message", (event) => workerControls.push(event.data));
        const firstBarrageStartedAt = Date.now();
        channel.postMessage({
          method: "createInstance",
          _uniqueId: "probe-worker-instance",
          params: {
            config: {
              width: 640,
              height: 360,
              devicePixelRatio: 2,
              fontSize: 20,
              channelHeight: 48,
              duration: 4_000,
              gap: 20
            },
            offscrrenCanvas: transferResult,
            barrages: []
          }
        }, { transfer: [transferResult] });
        channel.postMessage({
          method: "addBarrage",
          _uniqueId: "probe-worker-instance",
          params: {
            id: "probe-barrage",
            startTime: firstBarrageStartedAt,
            reserveDuration: 5_000,
            padding: [4, 4, 4, 4],
            content: [
              { type: "text", text: "一起", fontSize: 40, color: "#fff" },
              {
                type: "image",
                src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Ccircle cx='20' cy='20' r='18' fill='%23ffd84d'/%3E%3C/svg%3E",
                width: 40,
                height: 40
              },
              { type: "text", text: "加油", fontSize: 40, color: "#fff" }
            ]
          }
        });
        setTimeout(() => channel.postMessage({
          method: "addBarrage",
          _uniqueId: "probe-worker-instance",
          params: {
            id: "probe-other-barrage",
            startTime: Date.now(),
            reserveDuration: 5_000,
            padding: [4, 4, 4, 4],
            content: [
              { type: "text", text: "其他弹幕继续移动", fontSize: 40, color: "#fff" }
            ]
          }
        }), 200);
        // Let both synthetic barrages enter the visible area before probing.
        await new Promise((resolve) => setTimeout(resolve, 1_400));

        const canvasRect = canvas.getBoundingClientRect();
        const elapsed = Date.now() - firstBarrageStartedAt;
        const expectedWidth = 208;
        const expectedLeft = canvasRect.right
          - (canvasRect.width + expectedWidth) * elapsed / 4_000;
        const pointerX = expectedLeft + expectedWidth / 2;
        const pointerY = canvasRect.top + 24;
        const hoverStartedAt = performance.now();
        canvas.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          composed: true,
          clientX: pointerX,
          clientY: pointerY,
          pointerType: "mouse"
        }));
        for (let attempt = 0; attempt < 40 && !document.querySelector(
          "[data-bcp-douyin-interaction-card='true']:not([hidden])"
        ); attempt += 1) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        await new Promise((resolve) => setTimeout(resolve, 40));

        const card = document.querySelector(
          "[data-bcp-douyin-interaction-card='true']:not([hidden])"
        );
        const button = card && card.querySelector(".bcp-douyin-button");
        const cardRect = card && card.getBoundingClientRect();
        const hoverLatency = card ? performance.now() - hoverStartedAt : null;
        const buttonVisible = Boolean(button && button.getBoundingClientRect().width > 0);
        const previewText = card
          ? card.querySelector(".bcp-douyin-preview").textContent
          : "";
        const previewImageCount = card
          ? card.querySelectorAll(".bcp-douyin-preview img").length
          : 0;
        const cardMessage = button
          ? String(button.getAttribute("aria-label") || "").replace(/^弹幕加一：/, "")
          : "";
        await new Promise((resolve) => setTimeout(resolve, 160));
        const stableRect = card && card.getBoundingClientRect();
        const cardDrift = cardRect && stableRect
          ? Math.max(Math.abs(stableRect.left - cardRect.left), Math.abs(stableRect.top - cardRect.top))
          : null;

        const controls = document.createElement("div");
        Object.assign(controls.style, {
          position: "fixed",
          left: "20px",
          bottom: "20px",
          zIndex: "1001"
        });
        const input = document.createElement("textarea");
        input.placeholder = "说点什么";
        input.style.width = "180px";
        input.style.height = "40px";
        const send = document.createElement("button");
        send.dataset.e2e = "chat-room-send";
        send.textContent = "发送";
        let sentValue = "";
        const consumeInput = () => {
          sentValue = input.value;
          input.value = "";
        };
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") consumeInput();
        });
        send.addEventListener("click", consumeInput);
        controls.append(input, send);
        document.body.appendChild(controls);
        if (button) {
          button.click();
          await new Promise((resolve) => setTimeout(resolve, 520));
        }

        const result = {
          transferWasBlocked: transferResult === null,
          transferStayedNative: transferResult !== null,
          mainThreadCanvasMethodsUntouched:
            CanvasRenderingContext2D.prototype.fillText.name !== "bulletPlusOneCanvasText",
          cardVisible: Boolean(card),
          buttonVisible,
          hoverLatency,
          cardRect: cardRect ? [cardRect.left, cardRect.top, cardRect.width, cardRect.height] : null,
          cardDrift,
          previewText,
          previewImageCount,
          cardMessage,
          sentValue,
          inputValue: input.value,
          inputFocusedAfterSend: document.activeElement === input,
          nativeCanvasUntouched: getComputedStyle(canvas).visibility !== "hidden"
            && getComputedStyle(canvas).display !== "none",
          workerStopWasNotSent: !workerControls.some(
            (message) => message && message.observedMethod === "stop"
          ),
          trackerDomNodeCount: document.querySelectorAll(
            "[data-bcp-douyin-canvas='true'],[data-bcp-douyin-worker-overlay]"
          ).length,
          legacyFreezeNodeCount: document.querySelectorAll(
            ".bcp-one-frozen,.bcp-one-resuming"
          ).length,
          expectedNativeTravelDuringCardCheck: (canvasRect.width + expectedWidth) * 160 / 4_000,
          cardClearedAfterSend: Boolean(card && card.hidden)
        };
        controls.remove();
        channel.terminate();
        URL.revokeObjectURL(workerUrl);
        host.remove();
        chatMessage.remove();
        return result;
      })()`,
      returnByValue: true,
      awaitPromise: true,
    })
    douyinProbe = probeResult.result.value
  }

  let douyinDomRegression = null
  let douyinRichRegression = null
  if (normalizedInjectPlatform === 'douyin' || hasDouyinFixture) {
    const readTakeoverState = () =>
      evaluateValue(String.raw`(() => {
      const canvas = document.querySelector(".CanvasDanmakuPlugin canvas, #DanmakuLayout canvas");
      const layer = document.querySelector(".bcp-douyin-dom-layer");
      const rectValue = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
      };
      const nodes = Array.from(document.querySelectorAll(".bcp-douyin-dom-barrage"))
        .map((node) => {
          const track = node.closest(".bcp-douyin-dom-track");
          const action = track && track.querySelector(":scope > .bcp-douyin-dom-action");
          const plusOne = action && action.querySelector('[data-action="plus-one"]');
          const reply = action && action.querySelector('[data-action="reply"]');
          const favorite = action && action.querySelector('[data-action="favorite"]');
          const content = node.querySelector(".bcp-douyin-dom-content");
          const nodeStyle = getComputedStyle(node);
          const contentStyle = content ? getComputedStyle(content) : null;
          return {
            message: node.dataset.message || (action && action.dataset.message)
              || String(node.textContent || "").replace(/\+1\s*$/, "").trim(),
            trackId: node.dataset.trackId || (action && action.dataset.trackId) || "",
            instanceId: node.dataset.instanceId || (action && action.dataset.instanceId) || "",
            own: node.dataset.own || "",
            ownFrame: Boolean(contentStyle && contentStyle.boxShadow !== "none"),
            backgroundColor: nodeStyle.backgroundColor,
            frameShadow: nodeStyle.boxShadow,
            hovered: track && track.dataset.hovered || "",
            sending: track && track.dataset.sending || "",
            trackRect: rectValue(track),
            trackPointerEvents: track ? getComputedStyle(track).pointerEvents : "missing",
            rect: rectValue(node),
            contentRect: rectValue(content),
            actionRect: rectValue(action),
            plusOneRect: rectValue(plusOne),
            replyRect: rectValue(reply),
            favoriteRect: rectValue(favorite),
            actionText: plusOne ? String(plusOne.textContent || "").trim() : "",
            actionLabels: action ? Array.from(action.querySelectorAll(
              ".bcp-douyin-dom-action-item"
            )).map((item) => String(item.textContent || "").trim()) : [],
            actionKeys: action ? Array.from(action.querySelectorAll(
              ".bcp-douyin-dom-action-item"
            )).map((item) => String(item.dataset.action || "")) : [],
            actionDividerCount: action ? action.querySelectorAll(
              ".bcp-douyin-dom-action-divider"
            ).length : 0,
            actionGap: action
              ? action.getBoundingClientRect().left - node.getBoundingClientRect().right
              : null,
            trailingHoverSpace: action && track
              ? track.getBoundingClientRect().right - action.getBoundingClientRect().right
              : null,
            actionAfterContent: Boolean(action && node.nextElementSibling === action
              && node.parentElement === action.parentElement && !node.contains(action)),
            contentInset: content ? {
              left: content.getBoundingClientRect().left - node.getBoundingClientRect().left,
              top: content.getBoundingClientRect().top - node.getBoundingClientRect().top,
              right: node.getBoundingClientRect().right - content.getBoundingClientRect().right,
              bottom: node.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom
            } : null,
            actionVisibility: action ? getComputedStyle(action).visibility : "missing",
            actionPointerEvents: action ? getComputedStyle(action).pointerEvents : "missing"
          };
        });
      const canvasRect = rectValue(canvas);
      const canvasStyle = canvas ? getComputedStyle(canvas) : null;
      const layerStyle = layer ? getComputedStyle(layer) : null;
      let pageDebug = null;
      try {
        const marker = document.getElementById("bcp-douyin-page-debug");
        pageDebug = marker ? JSON.parse(marker.textContent || "null") : null;
      } catch (_error) {
        pageDebug = null;
      }
      const fixtureState = window.__douyinDomFixture || null;
      const chatRow = document.querySelector("[data-e2e='chat-message']");
      const chatCard = document.querySelector(
        "[data-bcp-douyin-interaction-card='true']:not([hidden])"
      );
      return {
        fixture: Boolean(fixtureState),
        delayedMountMode: Boolean(fixtureState && fixtureState.delayedMountMode),
        fullscreenMode: Boolean(fixtureState && fixtureState.fullscreenMode),
        unsupportedMode: Boolean(fixtureState && fixtureState.unsupportedMode),
        richMode: Boolean(fixtureState && fixtureState.richMode),
        rendererBlocked: Boolean(pageDebug && Array.isArray(pageDebug.instances)
          && pageDebug.instances.some((item) => item.renderer && item.renderer.blocked)),
        skippedBarrageCount: Number(pageDebug && pageDebug.counters
          && pageDebug.counters.skippedBarrages) || 0,
        viewport: {
          width: document.documentElement.clientWidth || innerWidth,
          height: document.documentElement.clientHeight || innerHeight
        },
        canvasRect,
        canvasVisibility: canvasStyle ? canvasStyle.visibility : "missing",
        canvasDisplay: canvasStyle ? canvasStyle.display : "missing",
        layerPresent: Boolean(layer),
        layerHidden: Boolean(layer && (layer.hidden || getComputedStyle(layer).display === "none")),
        layerClipsToCanvas: Boolean(layerStyle
          && layerStyle.overflowX === "hidden"
          && layerStyle.overflowY === "hidden"),
        chatRowRect: rectValue(chatRow),
        chatCardVisible: Boolean(chatCard),
        visibleToastCount: document.querySelectorAll(
          ".bcp-douyin-toast.is-visible"
        ).length,
        nodes,
        target: nodes.find((item) => item.message.includes("抖音画面弹幕")) || null,
        other: nodes.find((item) => item.message.includes("其他弹幕继续移动")) || null,
        sent: document.body.dataset.douyinSent || "",
        sentRich: document.body.dataset.douyinSentRich || "",
        ownChatRows: Array.from(document.querySelectorAll(
          "[data-bcp-douyin-own-chat='true']"
        )).map((row) => ({
          kind: row.dataset.fixtureSentKind || "",
          text: String(row.textContent || "").trim(),
          framed: Boolean(row.querySelector("[data-bcp-douyin-own-chat-content='true']"))
        })),
        workerStopWasNotSent: document.body.dataset.douyinWorkerStopWasNotSent || "",
        lateCanvasVisibleBeforeClean:
          document.body.dataset.douyinLateCanvasVisibleBeforeClean || "",
        lateLayerInactiveBeforeClean:
          document.body.dataset.douyinLateLayerInactiveBeforeClean || "",
        lateCleanBoundarySent: document.body.dataset.douyinLateCleanBoundarySent || ""
      };
    })()`)

    let initial = await readTakeoverState()
    if (initial && initial.fixture && initial.unsupportedMode) {
      // Stay beyond the real-room failure window while decorative and empty
      // official barrages continue arriving.
      await delay(20_000)
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      initial = await readTakeoverState()
      const actionInsideCanvas =
        initial &&
        initial.target &&
        initial.target.actionRect &&
        initial.target.trackRect &&
        initial.canvasRect &&
        initial.target.trackRect.right <= initial.canvasRect.right - 2 &&
        initial.target.actionRect.left >= initial.canvasRect.left + 2 &&
        initial.target.trackRect.right <= initial.viewport.width - 2
      if (
        initial &&
        initial.fixture &&
        initial.canvasVisibility === 'hidden' &&
        !initial.layerHidden &&
        initial.target &&
        initial.other &&
        actionInsideCanvas
      ) {
        break
      }
      await delay(50)
    }

    if (!initial || !initial.target || !initial.other) {
      douyinDomRegression = {
        ready: false,
        reason: 'dom-barrages-not-ready',
        initial,
      }
    } else {
      if (initial.chatRowRect) {
        await dispatchMouse(
          'mouseMoved',
          initial.chatRowRect.left + initial.chatRowRect.width / 2,
          initial.chatRowRect.top + initial.chatRowRect.height / 2,
        )
        await delay(120)
      }
      const afterChatHover = await readTakeoverState()
      await dispatchMouse('mouseMoved', 1, 449)
      await dispatchMouse(
        'mouseMoved',
        initial.target.rect.left + initial.target.rect.width / 2,
        initial.target.rect.top + initial.target.rect.height / 2,
      )
      await delay(80)
      const hoverStart = await readTakeoverState()
      await delay(320)
      const hoverEnd = await readTakeoverState()

      const distance = (first, second) =>
        first && second
          ? Math.max(Math.abs(second.left - first.left), Math.abs(second.top - first.top))
          : null
      const targetDrift = distance(
        hoverStart.target && hoverStart.target.rect,
        hoverEnd.target && hoverEnd.target.rect,
      )
      const otherTravel = distance(
        hoverStart.other && hoverStart.other.rect,
        hoverEnd.other && hoverEnd.other.rect,
      )
      const sizeDelta =
        hoverEnd.target && initial.target
          ? Math.max(
              Math.abs(hoverEnd.target.rect.width - initial.target.rect.width),
              Math.abs(hoverEnd.target.rect.height - initial.target.rect.height),
            )
          : null

      const action = hoverEnd.target && hoverEnd.target.actionRect
      const clickedMessage = hoverEnd.target ? hoverEnd.target.message : ''
      let gapHover = null
      let trailingHover = null
      let replyResult = null
      let favoriteResult = null
      let richFavoriteResult = null
      if (action) {
        const barrage = hoverEnd.target.rect
        if (barrage && action.left > barrage.right) {
          await dispatchMouse(
            'mouseMoved',
            barrage.right + (action.left - barrage.right) / 2,
            action.top + action.height / 2,
          )
          await delay(280)
          gapHover = await readTakeoverState()
        }
        const trackRect = hoverEnd.target.trackRect
        if (trackRect && trackRect.right > action.right) {
          await dispatchMouse(
            'mouseMoved',
            action.right + Math.min(6, (trackRect.right - action.right) / 2),
            action.top + action.height / 2,
          )
          await delay(280)
          trailingHover = await readTakeoverState()
        }
        const favoriteTarget = hoverEnd.target.favoriteRect
        if (favoriteTarget) {
          const favoriteX = Math.max(
            1,
            Math.min(hoverEnd.viewport.width - 1, favoriteTarget.left + favoriteTarget.width / 2),
          )
          const favoriteY = Math.max(
            1,
            Math.min(hoverEnd.viewport.height - 1, favoriteTarget.top + favoriteTarget.height / 2),
          )
          await dispatchMouse('mouseMoved', favoriteX, favoriteY)
          await dispatchMouse('mousePressed', favoriteX, favoriteY)
          await dispatchMouse('mouseReleased', favoriteX, favoriteY)
          await delay(280)
          richFavoriteResult = await evaluateValue(`(() => {
            const button = Array.from(document.querySelectorAll(
              ".bcp-douyin-dom-action-item[data-action='favorite']"
            )).find((item) => item.dataset.message === ${JSON.stringify(clickedMessage)});
            const warning = document.querySelector(
              ".bcp-douyin-toast--warning.is-visible"
            );
            return {
              buttonPresent: Boolean(button),
              buttonText: String(button && button.textContent || "").trim(),
              buttonTitle: String(button && button.title || "").trim(),
              warningText: String(warning && warning.textContent || "").trim(),
              warningVisible: Boolean(warning)
            };
          })()`)
        }
        const replyTarget = hoverEnd.target.replyRect
        if (replyTarget) {
          const replyX = Math.max(
            1,
            Math.min(hoverEnd.viewport.width - 1, replyTarget.left + replyTarget.width / 2),
          )
          const replyY = Math.max(
            1,
            Math.min(hoverEnd.viewport.height - 1, replyTarget.top + replyTarget.height / 2),
          )
          await dispatchMouse('mouseMoved', replyX, replyY)
          await dispatchMouse('mousePressed', replyX, replyY)
          await dispatchMouse('mouseReleased', replyX, replyY)
          await delay(650)
          replyResult = await evaluateValue(`(() => {
            const active = document.activeElement;
            const input = active && active.matches(
              "input,textarea,[contenteditable]:not([contenteditable='false']),[role='textbox']"
            ) ? active : null;
            const error = document.querySelector(
              ".bcp-douyin-toast--error.is-visible"
            );
            return {
              value: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
                ? input.value
                : input && input.textContent || "",
              focused: document.activeElement === input,
              surface: input && input.dataset.fixtureReplySurface || "",
              sent: document.body.dataset.douyinSent || "",
              errorText: String(error && error.textContent || "").trim(),
              nativeFilled: document.body.dataset.douyinNativeReplyFilled || ""
            };
          })()`)
        }
        const clickTarget = hoverEnd.target.plusOneRect || action
        const visibleLeft = Math.max(0, clickTarget.left)
        const visibleRight = Math.min(hoverEnd.viewport.width - 1, clickTarget.right)
        const visibleTop = Math.max(0, clickTarget.top)
        const visibleBottom = Math.min(hoverEnd.viewport.height - 1, clickTarget.bottom)
        const clickX = visibleLeft + Math.max(1, visibleRight - visibleLeft) / 2
        const clickY = visibleTop + Math.max(1, visibleBottom - visibleTop) / 2
        await dispatchMouse('mouseMoved', clickX, clickY)
        await delay(60)
        await dispatchMouse('mousePressed', clickX, clickY)
        await dispatchMouse('mouseReleased', clickX, clickY)
      }
      // Poll through the success edge so an immediate one-frame spring cannot
      // hide inside a coarse post-click delay.
      let releaseStart = null
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await delay(20)
        const sample = await readTakeoverState()
        releaseStart = sample
        if (sample.sent === clickedMessage && sample.target && sample.target.hovered !== 'true') {
          break
        }
      }
      const resumeSamples = [releaseStart]
      for (let sample = 0; sample < 6; sample += 1) {
        await delay(60)
        resumeSamples.push(await readTakeoverState())
      }
      const afterClick = resumeSamples[resumeSamples.length - 1]
      const ownEcho = afterClick.nodes.find(
        (item) => item.message === clickedMessage && item.own === 'true',
      )

      // The selected fixture barrage contains an official image asset and must
      // be rejected by the text-only first version.  Verify a second, plain
      // barrage separately so rejection is not mistaken for a broken store.
      const favoriteCandidate = afterClick.other
      if (favoriteCandidate && favoriteCandidate.rect) {
        await dispatchMouse(
          'mouseMoved',
          favoriteCandidate.rect.left + favoriteCandidate.rect.width / 2,
          favoriteCandidate.rect.top + favoriteCandidate.rect.height / 2,
        )
        await delay(100)
        const hoveredFavoriteCandidate = await readTakeoverState()
        const plainFavoriteTarget =
          hoveredFavoriteCandidate.other && hoveredFavoriteCandidate.other.favoriteRect
        if (plainFavoriteTarget) {
          const favoriteX = Math.max(
            1,
            Math.min(
              hoveredFavoriteCandidate.viewport.width - 1,
              plainFavoriteTarget.left + plainFavoriteTarget.width / 2,
            ),
          )
          const favoriteY = Math.max(
            1,
            Math.min(
              hoveredFavoriteCandidate.viewport.height - 1,
              plainFavoriteTarget.top + plainFavoriteTarget.height / 2,
            ),
          )
          await dispatchMouse('mouseMoved', favoriteX, favoriteY)
          await dispatchMouse('mousePressed', favoriteX, favoriteY)
          await dispatchMouse('mouseReleased', favoriteX, favoriteY)
          await delay(280)
          await send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            modifiers: 1,
            key: 'q',
            code: 'KeyQ',
            windowsVirtualKeyCode: 81,
            nativeVirtualKeyCode: 81,
          })
          await delay(40)
          await send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            modifiers: 1,
            key: 'q',
            code: 'KeyQ',
            windowsVirtualKeyCode: 81,
            nativeVirtualKeyCode: 81,
          })
          await delay(120)
          favoriteResult = await evaluateValue(`(() => {
            const host = document.querySelector(".bcp-favorites-host");
            const root = host?.shadowRoot || document;
            const panel = root.querySelector(".bcp-favorites-panel");
            const texts = Array.from(panel?.querySelectorAll(".bcp-favorites-text") || [])
              .map((item) => String(item.textContent || ""));
            return {
              panelVisible: Boolean(panel),
              singleton: document.querySelectorAll(".bcp-favorites-host").length === 1
                && host?.dataset.bcpFavoritesUiVersion === "3",
              currentRoomFocused: Boolean(panel
                && panel.querySelector(
                  ".bcp-favorites-tabs [data-view='current'][aria-selected='true']"
                )),
              listed: texts.some((text) => text.includes("其他弹幕继续移动")),
              richAssetAbsent: !texts.some((text) => text.includes(${JSON.stringify(clickedMessage)}))
            };
          })()`)
          await send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Escape',
            code: 'Escape',
            windowsVirtualKeyCode: 27,
            nativeVirtualKeyCode: 27,
          })
          await send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Escape',
            code: 'Escape',
            windowsVirtualKeyCode: 27,
            nativeVirtualKeyCode: 27,
          })
          await delay(80)
        }
      }

      const disableRenderer = () =>
        evaluateValue(String.raw`(() => {
        window.dispatchEvent(new MessageEvent("message", {
          source: window,
          data: {
            source: "danmaku-echo-douyin-content",
            type: "renderer-settings",
            enabled: false,
            reason: "fixture-disable-regression"
          }
        }));
        return true;
      })()`)
      await disableRenderer()
      await delay(60)
      const afterDisable = await readTakeoverState()

      if (initial.richMode) {
        const manualButtonRect = await evaluateValue(`(() => {
          const input = document.querySelector("textarea[placeholder='说点什么']");
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          setter.call(input, "我自己发送的侧边消息");
          input.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            composed: true,
            data: "我自己发送的侧边消息",
            inputType: "insertText"
          }));
          const button = document.querySelector(".sendButton");
          Object.assign(button.style, {
            position: "fixed",
            left: "220px",
            top: "420px",
            zIndex: "10"
          });
          const rect = button.getBoundingClientRect();
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        })()`)
        const manualX = manualButtonRect.left + manualButtonRect.width / 2
        const manualY = manualButtonRect.top + manualButtonRect.height / 2
        await dispatchMouse('mouseMoved', manualX, manualY)
        await dispatchMouse('mousePressed', manualX, manualY)
        await dispatchMouse('mouseReleased', manualX, manualY)
        let manualState = null
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await delay(60)
          manualState = await readTakeoverState()
          if (manualState.ownChatRows.some((row) => row.kind === 'manual' && row.framed)) {
            break
          }
        }
        douyinRichRegression = {
          emojiIncludedInPlusOne: afterClick.sentRich === '抖音😀画面弹幕',
          emojiOwnChatFramed: afterClick.ownChatRows.some(
            (row) => row.kind === 'emoji' && row.framed,
          ),
          manualOwnChatFramed: Boolean(
            manualState &&
            manualState.ownChatRows.some((row) => row.kind === 'manual' && row.framed),
          ),
          sideChatPlusOneAbsent: afterClick.chatCardVisible === false,
          manualSentRich: (manualState && manualState.sentRich) || '',
          manualRows: (manualState && manualState.ownChatRows) || [],
        }
        douyinRichRegression.assertionFailures = [
          'emojiIncludedInPlusOne',
          'emojiOwnChatFramed',
          'manualOwnChatFramed',
          'sideChatPlusOneAbsent',
        ].filter((key) => douyinRichRegression[key] !== true)
      }

      const targetResumePositions = resumeSamples
        .map((sample) => sample.target && sample.target.rect && sample.target.rect.left)
        .filter(Number.isFinite)
      const otherResumePositions = resumeSamples
        .map((sample) => sample.other && sample.other.rect && sample.other.rect.left)
        .filter(Number.isFinite)
      const targetResumeSteps = targetResumePositions
        .slice(1)
        .map((left, index) => targetResumePositions[index] - left)
      const otherResumeSteps = otherResumePositions
        .slice(1)
        .map((left, index) => otherResumePositions[index] - left)
      const targetResumeTravel =
        targetResumePositions.length > 1
          ? targetResumePositions[0] - targetResumePositions[targetResumePositions.length - 1]
          : null
      const otherResumeTravel =
        otherResumePositions.length > 1
          ? otherResumePositions[0] - otherResumePositions[otherResumePositions.length - 1]
          : null
      const resumeSpeedRatio =
        targetResumeTravel > 0 && otherResumeTravel > 0
          ? targetResumeTravel / otherResumeTravel
          : null
      const resumeMaxStep = targetResumeSteps.length ? Math.max(...targetResumeSteps) : null
      const otherResumeMaxStep = otherResumeSteps.length ? Math.max(...otherResumeSteps) : null
      const releaseTargetTravel =
        hoverEnd.target && releaseStart && releaseStart.target
          ? hoverEnd.target.rect.left - releaseStart.target.rect.left
          : null
      const releaseOtherTravel =
        hoverEnd.other && releaseStart && releaseStart.other
          ? hoverEnd.other.rect.left - releaseStart.other.rect.left
          : null
      const noReleaseSpring =
        releaseTargetTravel != null &&
        releaseOtherTravel != null &&
        releaseTargetTravel >= -0.5 &&
        releaseTargetTravel <= Math.max(3, releaseOtherTravel * 1.35 + 3)
      const previousDouyinActionSettings = await evaluateValue("chrome.storage.sync.get('actions')")
      await evaluateValue(`chrome.storage.sync.set({ actions: {
        plusOne: true,
        reply: true,
        favorite: true,
        copy: true
      } })`)
      await delay(180)
      const copyEnabledState = await readTakeoverState()
      const copyActionAvailable = Boolean(
        copyEnabledState.target &&
        copyEnabledState.target.actionKeys.includes('copy') &&
        copyEnabledState.target.actionDividerCount === 3,
      )
      await evaluateValue(
        `chrome.storage.sync.set({ actions: ${JSON.stringify(
          previousDouyinActionSettings.actions || {},
        )} })`,
      )
      await delay(100)
      douyinDomRegression = {
        ready: initial.canvasVisibility === 'hidden' && !initial.layerHidden,
        layerPresent: initial.layerPresent,
        layerClipsToCanvas: initial.layerClipsToCanvas,
        rightChatPlusOneAbsent: !afterChatHover.chatCardVisible,
        barrageCount: initial.nodes.length,
        canvasHiddenAfterReady: initial.canvasVisibility === 'hidden',
        canvasDisplayPreserved: initial.canvasDisplay !== 'none',
        hoveredMessage: hoverEnd.target ? hoverEnd.target.message : '',
        hoveredOnlyTarget: Boolean(
          hoverEnd.target &&
          hoverEnd.target.hovered === 'true' &&
          hoverEnd.other &&
          hoverEnd.other.hovered !== 'true',
        ),
        hoverUsesTransparentThemeFrame: Boolean(
          hoverEnd.target &&
          hoverEnd.target.backgroundColor === 'rgba(0, 0, 0, 0)' &&
          hoverEnd.target.frameShadow.includes('rgb(253, 129, 1)') &&
          hoverEnd.target.frameShadow.includes('3px'),
        ),
        targetDrift,
        targetPaused: targetDrift != null && targetDrift <= 1.5,
        otherTravel,
        otherContinued: otherTravel != null && otherTravel >= 2,
        sizeDelta,
        sizeStable: sizeDelta != null && sizeDelta <= 0.5,
        actionVisible: Boolean(
          hoverEnd.target &&
          hoverEnd.target.actionVisibility !== 'hidden' &&
          hoverEnd.target.actionPointerEvents !== 'none',
        ),
        actionFullyRendered: Boolean(
          hoverEnd.target &&
          hoverEnd.target.trackRect &&
          hoverEnd.target.actionRect &&
          hoverEnd.target.actionRect.width >= 155.5 &&
          hoverEnd.target.actionRect.height >= 39.5 &&
          hoverEnd.target.actionRect.left >= hoverEnd.target.trackRect.left - 1.5 &&
          hoverEnd.target.actionRect.top >= hoverEnd.target.trackRect.top - 1.5 &&
          hoverEnd.target.actionRect.right <= hoverEnd.target.trackRect.right + 1.5 &&
          hoverEnd.target.actionRect.bottom <= hoverEnd.target.trackRect.bottom + 1.5,
        ),
        threeActionUi: Boolean(
          hoverEnd.target &&
          JSON.stringify(hoverEnd.target.actionKeys) ===
            JSON.stringify(['plus-one', 'reply', 'favorite']) &&
          hoverEnd.target.actionDividerCount === 2,
        ),
        copyActionAvailable,
        actionBehindMessage: Boolean(
          hoverEnd.target &&
          hoverEnd.target.contentRect &&
          hoverEnd.target.actionRect &&
          hoverEnd.target.actionAfterContent &&
          hoverEnd.target.actionRect.left >= hoverEnd.target.contentRect.right - 1,
        ),
        trackOwnsHover: Boolean(hoverEnd.target && hoverEnd.target.trackPointerEvents !== 'none'),
        actionGapReserved: Boolean(hoverEnd.target && hoverEnd.target.actionGap >= 7.5),
        trailingHoverReserved: Boolean(
          hoverEnd.target && hoverEnd.target.trailingHoverSpace >= 11.5,
        ),
        gapHoverKeptPaused: Boolean(
          gapHover &&
          gapHover.target &&
          gapHover.target.hovered === 'true' &&
          distance(hoverEnd.target.rect, gapHover.target.rect) <= 1.5,
        ),
        trailingHoverKeptPaused: Boolean(
          trailingHover &&
          trailingHover.target &&
          trailingHover.target.hovered === 'true' &&
          distance(
            ((gapHover && gapHover.target) || hoverEnd.target).rect,
            trailingHover.target.rect,
          ) <= 1.5,
        ),
        messagePaddingExpanded: Boolean(
          hoverEnd.target &&
          hoverEnd.target.contentInset &&
          hoverEnd.target.contentInset.left >= 7.5 &&
          hoverEnd.target.contentInset.right >= 7.5 &&
          hoverEnd.target.contentInset.top >= 3.5 &&
          hoverEnd.target.contentInset.bottom >= 3.5,
        ),
        messagePaddingUniform: Boolean(
          hoverEnd.target &&
          hoverEnd.target.contentInset &&
          Math.max(...Object.values(hoverEnd.target.contentInset)) -
            Math.min(...Object.values(hoverEnd.target.contentInset)) <=
            0.5,
        ),
        replyButtonAvailable: Boolean(hoverEnd.target && hoverEnd.target.replyRect),
        replyPrefilled: Boolean(replyResult && replyResult.value === expectedDouyinReplyMention),
        replyInputFocused: Boolean(replyResult && replyResult.focused),
        replyDidNotSend: Boolean(replyResult && replyResult.sent === initial.sent),
        replyErrorAbsent: Boolean(replyResult && !replyResult.errorText),
        replySurfaceCorrect: Boolean(
          replyResult && replyResult.surface === (initial.fullscreenMode ? 'quick' : 'side'),
        ),
        replyResult,
        favoriteButtonAvailable: Boolean(hoverEnd.target && hoverEnd.target.favoriteRect),
        favoriteRichAssetsRejected: Boolean(
          richFavoriteResult &&
          richFavoriteResult.buttonPresent &&
          richFavoriteResult.warningVisible &&
          favoriteResult &&
          favoriteResult.richAssetAbsent,
        ),
        favoriteSavedAndListed: Boolean(favoriteResult && favoriteResult.listed),
        favoriteUiSingleton: Boolean(favoriteResult && favoriteResult.singleton),
        favoriteCurrentRoomFocused: Boolean(favoriteResult && favoriteResult.currentRoomFocused),
        richFavoriteResult,
        favoriteResult,
        singleSuccessFeedback: Boolean(
          afterClick.visibleToastCount === 1 &&
          afterClick.target &&
          afterClick.target.actionText === '+1',
        ),
        clickedMessage,
        sentMessage: afterClick.sent,
        clickSentMatchingMessage: Boolean(clickedMessage && afterClick.sent === clickedMessage),
        ownMessageFramed: Boolean(ownEcho && ownEcho.ownFrame),
        targetResumeTravel,
        otherResumeTravel,
        resumeSpeedRatio,
        resumeMaxStep,
        otherResumeMaxStep,
        releaseTargetTravel,
        releaseOtherTravel,
        noReleaseSpring,
        resumedFromHeldPositionAtNormalSpeed: Boolean(
          noReleaseSpring &&
          targetResumeTravel != null &&
          targetResumeTravel >= 8 &&
          targetResumeSteps.every((step) => step >= -0.5) &&
          resumeMaxStep != null &&
          otherResumeMaxStep != null &&
          resumeMaxStep <= otherResumeMaxStep * 1.35 + 3 &&
          resumeSpeedRatio != null &&
          resumeSpeedRatio >= 0.75 &&
          resumeSpeedRatio <= 1.25,
        ),
        workerStopWasNotSent: afterClick.workerStopWasNotSent === 'true',
        canvasRestoredAfterDisable:
          afterDisable.canvasVisibility !== 'hidden' && afterDisable.canvasDisplay !== 'none',
        layerInactiveAfterDisable: !afterDisable.layerPresent || afterDisable.layerHidden,
        unsupportedStayedActive:
          !initial.unsupportedMode ||
          Boolean(
            !initial.rendererBlocked &&
            initial.canvasVisibility === 'hidden' &&
            initial.skippedBarrageCount >= 2,
          ),
        lateCanvasVisibleBeforeClean: initial.lateCanvasVisibleBeforeClean,
        lateLayerInactiveBeforeClean: initial.lateLayerInactiveBeforeClean,
        lateCleanBoundarySent: initial.lateCleanBoundarySent,
        beforeHover: initial,
        afterChatHover,
        hoverStart,
        hoverEnd,
        gapHover,
        trailingHover,
        resumeSamples,
        afterClick,
        afterDisable,
      }

      await evaluateValue(`(() => {
        const result = ${JSON.stringify(douyinDomRegression)};
        document.body.dataset.douyinHoveredMessage = result.hoveredMessage || "";
        document.body.dataset.douyinSingleHoverPaused = String(result.targetPaused);
        document.body.dataset.douyinOtherBarrageContinued = String(result.otherContinued);
        document.body.dataset.douyinHoverSizeStable = String(result.sizeStable);
        document.body.dataset.douyinClickedMessage = result.clickedMessage || "";
        document.body.dataset.douyinClickSentMatchingMessage = String(result.clickSentMatchingMessage);
        document.body.dataset.douyinCanvasRestoredAfterDisable = String(
          result.canvasRestoredAfterDisable
        );
        return true;
      })()`)
    }
  }

  let sideChatRegression = null
  if (
    targetParameters.get('skipSide') !== '1' &&
    (normalizedInjectPlatform === 'huya' ||
      normalizedInjectPlatform === 'bilibili' ||
      normalizedInjectPlatform === 'douyu')
  ) {
    sideChatRegression = await evaluateValue(`(async () => {
      const platform = ${JSON.stringify(normalizedInjectPlatform)};
      const fullscreenMode = new URL(location.href).searchParams.get("fullscreen") === "1";
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const nextPaint = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const previousSideChatSettings = await chrome.storage.sync.get([
        "actions",
        "enabled",
        "sideChatCapsule"
      ]);
      await chrome.storage.sync.set({
        sideChatCapsule: {
          ...(previousSideChatSettings.sideChatCapsule || {}),
          [platform]: true
        }
      });
      await delay(80);
      let douyuControls = null;
      let douyuInput = null;
      let douyuPlayer = null;
      let douyuOverlay = null;
      let douyuOverlayAnimation = null;
      let nativeDouyuCapsuleHidden = true;
      let nativeDouyuCapsuleRestoredWhenDisabled = true;
      if (platform === "douyu") {
        douyuControls = document.createElement("section");
        douyuControls.className = "ChatSpeak";
        Object.assign(douyuControls.style, {
          position: "fixed",
          left: "20px",
          top: "360px",
          width: "300px",
          height: "44px",
          zIndex: "1000"
        });
        const currentUser = document.createElement("span");
        currentUser.className = "FansMedalEnter-enterName";
        currentUser.textContent = "测试用户5";
        douyuInput = document.createElement("div");
        douyuInput.className = "ChatSend-txt";
        douyuInput.contentEditable = "true";
        douyuInput.dataset.placeholder = "这里输入聊天内容";
        douyuInput.dataset.fixtureReplySurface = "side";
        Object.assign(douyuInput.style, {
          display: "inline-block",
          width: "220px",
          height: "32px",
          background: "#fff"
        });
        const douyuSend = document.createElement("button");
        douyuSend.className = "ChatSend-button";
        douyuSend.type = "button";
        douyuSend.textContent = "发送";
        douyuSend.addEventListener("click", () => {
          document.body.dataset.douyuSent = douyuInput.textContent || "";
          douyuInput.textContent = "";
          douyuInput.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            composed: true,
            data: "",
            inputType: "deleteContentBackward"
          }));
        });
        douyuControls.append(currentUser, douyuInput, douyuSend);
        document.body.appendChild(douyuControls);

        douyuPlayer = document.createElement("section");
        douyuPlayer.id = "js-player-main";
        Object.assign(douyuPlayer.style, {
          position: "fixed",
          left: "380px",
          top: "220px",
          width: "500px",
          height: "280px",
          background: "#111",
          zIndex: "900"
        });
        // Real Douyu layouts can apply a horizontal player transform without
        // exposing the same ratio through the danmaku item's own offset box.
        // Keep the fixture at its visual size while exercising that inherited
        // stretch on absolutely nested capsule children.
        const douyuMotionLayer = document.createElement("div");
        Object.assign(douyuMotionLayer.style, {
          position: "absolute",
          inset: "0",
          transform: "scaleX(1.42)",
          transformOrigin: "0 0",
          width: "352.112676px"
        });
        douyuOverlay = document.createElement("div");
        douyuOverlay.className = "danmuItem-fixture";
        douyuOverlay.dataset.commentUuid = "fixture-overlay-message";
        Object.assign(douyuOverlay.style, {
          position: "absolute",
          left: "120px",
          top: "80px",
          color: "#fff",
          transform: "translate3d(0px, 0, 0)"
        });
        const douyuInheritedActionStyles = document.createElement("style");
        douyuInheritedActionStyles.textContent = [
          ".danmuItem-fixture > .bcp-one-actions > .bcp-one-action {",
          "flex: 0 0 86px !important;",
          "min-width: 86px !important;",
          "width: 86px !important;",
          "}"
        ].join("");
        document.head.appendChild(douyuInheritedActionStyles);
        const overlayUser = document.createElement("span");
        overlayUser.className = "hostname-fixture";
        overlayUser.textContent = "画面用户";
        const overlayText = document.createElement("span");
        overlayText.className = "text-fixture";
        overlayText.textContent = "全屏弹幕也能复读";
        const nativePlusOne = document.createElement("button");
        nativePlusOne.className = "interactive-element-fixture";
        nativePlusOne.textContent = "+1";
        const nativeReply = document.createElement("button");
        nativeReply.className = "reply-button-fixture";
        nativeReply.textContent = "回复";
        const nativeFavorite = document.createElement("button");
        nativeFavorite.className = "action-button-fixture";
        nativeFavorite.textContent = "收藏";
        douyuOverlay.append(
          overlayUser,
          overlayText,
          nativePlusOne,
          nativeReply,
          nativeFavorite
        );
        douyuMotionLayer.appendChild(douyuOverlay);
        douyuPlayer.appendChild(douyuMotionLayer);
        document.body.appendChild(douyuPlayer);
        // Match the current Douyu renderer: a Web Animation owns the computed
        // transform while the element's inline transform remains unchanged.
        douyuOverlayAnimation = douyuOverlay.animate([
          { transform: "translate3d(0px, 0, 0)" },
          { transform: "translate3d(-500px, 0, 0)" }
        ], {
          duration: 20000,
          fill: "both",
          iterations: Infinity
        });
        douyuOverlay.addEventListener("mouseover", () => {
          douyuOverlayAnimation.pause();
        });
        douyuOverlay.addEventListener("pointerout", () => {
          douyuOverlayAnimation.play();
        });
        douyuOverlay.addEventListener("mouseout", () => {
          douyuOverlayAnimation.play();
        });
        await delay(100);
        const nativeActions = [nativePlusOne, nativeReply, nativeFavorite];
        nativeDouyuCapsuleHidden = nativeActions.every(
          (action) => getComputedStyle(action).visibility === "hidden"
            && getComputedStyle(action).display !== "none"
        );
        await chrome.storage.sync.set({ enabled: false });
        await delay(100);
        nativeDouyuCapsuleRestoredWhenDisabled = nativeActions.every(
          (action) => getComputedStyle(action).display !== "none"
            && getComputedStyle(action).visibility !== "hidden"
        );
        await chrome.storage.sync.set({
          enabled: previousSideChatSettings.enabled !== false
        });
        await delay(100);
      }
      const root = document.createElement("section");
      root.className = platform === "bilibili"
        ? "chat-history-list"
        : platform === "douyu"
          ? "Barrage-container"
          : "room-chat-messages";
      Object.assign(root.style, {
        position: "fixed",
        left: "20px",
        top: "220px",
        width: "300px",
        height: "120px",
        overflowY: "auto",
        background: "#18181c",
        zIndex: "1000"
      });
      let targetRow = null;
      let targetContent = null;
      let targetUser = null;
      let ownContent = null;
      let advertisementAction = null;
      let missingSenderContent = null;
      for (let index = 0; index < 24; index += 1) {
        const row = document.createElement(platform === "douyu" ? "li" : "div");
        row.className = platform === "bilibili"
          ? "danmaku-item"
          : platform === "douyu"
            ? "Barrage-listItem"
            : "J_msg";
        row.style.height = "28px";
        const user = document.createElement("span");
        user.className = platform === "bilibili"
          ? "user-name"
          : platform === "douyu"
            ? "Barrage-nickName js-nick"
            : "name";
        user.textContent = "测试用户" + index + (platform === "douyu" ? "" : "：");
        if (platform === "huya") user.title = "点击查看个人信息";
        if (platform === "douyu") {
          user.title = "测试用户" + index;
          user.dataset.uid = String(10_000 + index);
        }
        const content = document.createElement("span");
        content.className = platform === "bilibili"
          ? "danmaku-content"
          : platform === "douyu"
            ? "Barrage-content"
            : "msg";
        if (platform === "douyu") content.dataset.chatid = "fixture-chat-" + index;
        content.textContent = index === 6 ? "侧边聊天滚动测试" : "填充聊天消息" + index;
        row.appendChild(user);
        if (platform === "douyu") {
          const colon = document.createElement("span");
          colon.className = "Barrage-nickName is-colon";
          colon.textContent = "：";
          row.appendChild(colon);
        }
        row.appendChild(content);
        root.appendChild(row);
        if (index === 6) {
          targetRow = row;
          targetContent = content;
          targetUser = user;
        }
        if (index === 5) ownContent = content;
      }
      const missingSenderRow = document.createElement(platform === "douyu" ? "li" : "div");
      missingSenderRow.className = platform === "bilibili"
        ? "danmaku-item"
        : platform === "douyu"
          ? "Barrage-listItem"
          : "J_msg";
      missingSenderRow.style.height = "28px";
      missingSenderContent = document.createElement("span");
      missingSenderContent.className = platform === "bilibili"
        ? "danmaku-content"
        : platform === "douyu"
          ? "Barrage-content"
          : "msg";
      if (platform === "douyu") {
        missingSenderContent.dataset.chatid = "fixture-chat-missing-sender";
      }
      missingSenderContent.textContent = "缺少发送者的测试弹幕";
      missingSenderRow.appendChild(missingSenderContent);
      root.appendChild(missingSenderRow);
      if (platform === "bilibili") {
        const advertisement = document.createElement("div");
        advertisement.className = "danmaku-item chat-ad-card";
        advertisement.dataset.adReport = "fixture-promotion";
        const label = document.createElement("span");
        label.className = "ad-label";
        label.textContent = "广告";
        advertisementAction = document.createElement("a");
        advertisementAction.href = "#fixture-ad";
        advertisementAction.textContent = "直播活动，立即查看";
        advertisement.append(label, advertisementAction);
        root.appendChild(advertisement);
      }
      const outside = document.createElement("div");
      outside.style.position = "fixed";
      outside.style.left = "360px";
      outside.style.top = "220px";
      outside.style.width = "20px";
      outside.style.height = "20px";
      document.body.append(root, outside);
      root.scrollTop = 120;
      let panel = null;
      let report = null;
      if (platform === "bilibili") {
        targetUser.addEventListener("click", () => {
          panel = document.createElement("div");
          panel.className = "user-card-popover";
          panel.setAttribute("role", "dialog");
          report = document.createElement("button");
          report.textContent = "@用户并举报";
          panel.appendChild(report);
          document.body.appendChild(panel);
        }, { once: true });
      }
      const autoScroll = setInterval(() => {
        root.scrollTop = Math.min(root.scrollTop + 5, root.scrollHeight - root.clientHeight);
      }, 16);
      await delay(70);
      targetContent.dispatchEvent(new PointerEvent("pointerover", {
        bubbles: true,
        composed: true,
        pointerType: "mouse"
      }));
      await delay(70);
      await nextPaint();
      const button = document.querySelector(".bcp-one-button");
      const actionBar = document.querySelector(".bcp-one-actions");
      const messagePlusOneAvailable = Boolean(button && !button.hidden
        && String(button.getAttribute("aria-label") || "").includes("侧边聊天滚动测试"));
      const threeActionUi = Boolean(actionBar
        && JSON.stringify(Array.from(actionBar.querySelectorAll(".bcp-one-action"))
          .map((item) => String(item.dataset.action || "")))
          === JSON.stringify(["plus-one", "reply", "favorite"])
        && actionBar.querySelectorAll(".bcp-one-action-divider").length === 2);
      await chrome.storage.sync.set({
        actions: {
          plusOne: previousSideChatSettings.actions?.plusOne !== false,
          reply: previousSideChatSettings.actions?.reply !== false,
          favorite: previousSideChatSettings.actions?.favorite !== false,
          copy: true
        }
      });
      await delay(100);
      targetContent.dispatchEvent(new PointerEvent("pointerover", {
        bubbles: true,
        composed: true,
        pointerType: "mouse"
      }));
      await delay(60);
      const copyActionAvailable = Boolean(document.querySelector(
        ".bcp-one-actions:not([hidden]) .bcp-one-action[data-action='copy']"
      ));
      const scrollPauseMarkerAbsent = root.dataset.bcpOneScrollPaused !== "true";
      const scrollStart = root.scrollTop;
      await delay(220);
      await nextPaint();
      const scrollEnd = root.scrollTop;
      const scrollingRemainsEnabled = scrollEnd - scrollStart >= 10;
      clearInterval(autoScroll);
      const manualScrollTarget = Math.max(0, root.scrollTop - 30);
      root.scrollTop = manualScrollTarget;
      root.dispatchEvent(new Event("scroll", { bubbles: false }));
      await delay(80);
      const manualScrollPosition = root.scrollTop;
      const manualScrollPreserved = Math.abs(manualScrollPosition - manualScrollTarget) <= 1;

      targetContent.dispatchEvent(new PointerEvent("pointerover", {
        bubbles: true,
        composed: true,
        pointerType: "mouse"
      }));
      await delay(60);
      const favoriteButton = document.querySelector(
        ".bcp-one-actions:not([hidden]) .bcp-one-action[data-action='favorite']"
      );
      if (favoriteButton) favoriteButton.click();
      await delay(140);
      document.dispatchEvent(new KeyboardEvent("keydown", {
        altKey: true, bubbles: true, code: "KeyQ", key: "q"
      }));
      await delay(40);
      document.dispatchEvent(new KeyboardEvent("keyup", {
        altKey: true, bubbles: true, code: "KeyQ", key: "q"
      }));
      await delay(100);
      const favoritesPortal = document.querySelector(".bcp-favorites-host");
      const favoritesRoot = favoritesPortal?.shadowRoot || document;
      const favoritesPanel = favoritesRoot.querySelector(".bcp-favorites-panel");
      const favoriteUiSingleton = document.querySelectorAll(".bcp-favorites-host").length === 1
        && favoritesPortal?.dataset.bcpFavoritesUiVersion === "3";
      const favoriteSavedAndListed = Boolean(favoriteButton && favoritesPanel
        && Array.from(favoritesPanel.querySelectorAll(".bcp-favorites-text"))
          .some((item) => String(item.textContent || "").includes("侧边聊天滚动测试")));
      const favoriteRow = Array.from(favoritesPanel?.querySelectorAll(".bcp-favorites-list li") || [])
        .find((item) => String(item.textContent || "").includes("侧边聊天滚动测试"));
      const pinButton = favoriteRow?.querySelector(".bcp-favorites-pin");
      if (pinButton) pinButton.click();
      await delay(180);
      const pinnedRow = Array.from(favoritesPanel?.querySelectorAll(".bcp-favorites-list li") || [])
        .find((item) => String(item.textContent || "").includes("侧边聊天滚动测试"));
      const favoritePinWorked = Boolean(pinButton && pinnedRow?.classList.contains("is-pinned"));
      const tagsButton = pinnedRow?.querySelector(".bcp-favorites-tags-button");
      if (tagsButton) tagsButton.click();
      await delay(40);
      const tagsInput = pinnedRow?.querySelector(".bcp-favorites-tag-editor input");
      if (tagsInput) {
        tagsInput.value = "回归, 精彩";
        tagsInput.dispatchEvent(new Event("input", { bubbles: true }));
        tagsInput.closest("form")?.requestSubmit();
      }
      await delay(180);
      const taggedRow = Array.from(favoritesPanel?.querySelectorAll(".bcp-favorites-list li") || [])
        .find((item) => String(item.textContent || "").includes("侧边聊天滚动测试"));
      const favoriteTagsWorked = Boolean(tagsInput
        && String(taggedRow?.querySelector(".bcp-favorites-tags")?.textContent || "")
          .includes("#回归"));
      const sortSelect = favoritesPanel?.querySelector(".bcp-favorites-sort select");
      if (sortSelect) {
        sortSelect.value = "custom";
        sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await delay(60);
      const favoriteCustomSortAvailable = Boolean(sortSelect
        && sortSelect.value === "custom"
        && favoritesPanel?.querySelector(".bcp-favorites-order-actions"));
      const currentRoomFocused = Boolean(favoritesPanel
        && favoritesPanel.querySelector(
          ".bcp-favorites-tabs [data-view='current'][aria-selected='true']"
        ));
      const favoriteSendButton = Array.from(
        favoritesPanel?.querySelectorAll(".bcp-favorites-send") || []
      ).find((item) => [
        item.textContent,
        item.getAttribute("aria-label"),
        item.getAttribute("title")
      ].some((value) => String(value || "").includes("侧边聊天滚动测试")));
      if (favoriteSendButton) favoriteSendButton.click();
      await delay(760);
      const favoriteSentValue = platform === "bilibili"
        ? document.body.dataset.bilibiliSent || ""
        : platform === "douyu"
          ? document.body.dataset.douyuSent || ""
          : document.body.dataset.chatSent || "";
      const favoriteSendFeedback = String(
        document.querySelector(".bcp-one-toast.is-visible")?.textContent || ""
      ).trim();
      const favoriteRuntimeSendText = favoritesPortal?.dataset.bcpFavoritesLastSend || "";
      const favoriteRuntimeSendResult = favoritesPortal?.dataset.bcpFavoritesLastSendResult || "";
      const favoriteQuickSendSucceeded = favoriteRuntimeSendText === "侧边聊天滚动测试"
        && favoriteRuntimeSendResult === "success";
      if (favoritesRoot.querySelector(".bcp-favorites-panel")) {
        document.dispatchEvent(new KeyboardEvent("keydown", {
          bubbles: true, code: "Escape", key: "Escape"
        }));
        await delay(40);
      }
      if (favoritesPortal) {
        favoritesPortal.dataset.bcpFavoritesLastSend = "";
        favoritesPortal.dataset.bcpFavoritesLastSendResult = "";
      }
      document.dispatchEvent(new KeyboardEvent("keydown", {
        altKey: true, bubbles: true, code: "KeyQ", key: "q"
      }));
      await delay(230);
      const favoritesRadial = favoritesRoot.querySelector(".bcp-favorites-radial");
      const longPressRadialAvailable = Boolean(favoritesRadial
        && Array.from(favoritesRadial.querySelectorAll(".bcp-favorites-radial-item"))
          .some((item) => String(item.textContent || "").includes("侧边聊天")));
      const favoritesFullscreenHostCorrect = !fullscreenMode || Boolean(
        document.fullscreenElement
          && favoritesPortal?.parentElement === document.fullscreenElement
      );
      const radialFavorite = Array.from(
        favoritesRadial?.querySelectorAll(".bcp-favorites-radial-item.is-favorite") || []
      ).find((item) => String(item.textContent || "").includes("侧边聊天"));
      if (radialFavorite) {
        const rect = radialFavorite.getBoundingClientRect();
        document.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          pointerType: "mouse"
        }));
        await delay(120);
      }
      const radialFavoriteSelected = Boolean(
        radialFavorite && radialFavorite.classList.contains("is-selected")
      );
      document.dispatchEvent(new KeyboardEvent("keyup", {
        altKey: true, bubbles: true, code: "KeyQ", key: "q"
      }));
      await delay(760);
      const radialQuickSendSucceeded = radialFavoriteSelected
        && favoritesPortal?.dataset.bcpFavoritesLastSend === "侧边聊天滚动测试"
        && favoritesPortal?.dataset.bcpFavoritesLastSendResult === "success";

      let usernameActionRejected = true;
      let userPanelRejected = true;
      let advertisementRejected = true;
      if (platform === "bilibili") {
        advertisementAction.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          composed: true,
          pointerType: "mouse",
          relatedTarget: targetContent
        }));
        await delay(40);
        advertisementRejected = Boolean(button && button.hidden);
        targetUser.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          composed: true,
          pointerType: "mouse",
          relatedTarget: targetContent
        }));
        await delay(40);
        usernameActionRejected = Boolean(button && button.hidden);
        targetUser.click();
        report.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          composed: true,
          pointerType: "mouse",
          relatedTarget: targetUser
        }));
        await delay(40);
        userPanelRejected = Boolean(button && button.hidden);
        targetContent.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          composed: true,
          pointerType: "mouse",
          relatedTarget: report
        }));
        await delay(40);
      }

      let replyInput = fullscreenMode
        ? document.querySelector(platform === "bilibili"
          ? ".bpx-player-dm-input"
          : platform === "douyu"
            ? ".inputView-fixture"
            : ".fixture-huya-quick-input")
        : document.querySelector(platform === "bilibili"
          ? "textarea.chat-input"
          : platform === "douyu"
            ? ".ChatSend-txt"
            : "#pub_msg_input");
      const sentBeforeReply = platform === "bilibili"
        ? document.body.dataset.bilibiliSent || ""
        : platform === "douyu"
          ? document.body.dataset.douyuSent || ""
          : document.body.dataset.chatSent || "";
      targetContent.dispatchEvent(new PointerEvent("pointerover", {
        bubbles: true,
        composed: true,
        pointerType: "mouse"
      }));
      await delay(70);
      await nextPaint();
      const replyButton = document.querySelector(
        ".bcp-one-actions:not([hidden]) .bcp-one-action[data-action='reply']"
      );
      if (replyButton) replyButton.click();
      await delay(
        platform === "douyu"
          ? 520
          : platform === "bilibili" && fullscreenMode
            ? 320
            : 120
      );
      const activeReplyInput = document.activeElement instanceof Element
        && document.activeElement.matches(
          "input,textarea,[contenteditable]:not([contenteditable='false']),[role='textbox']"
        ) ? document.activeElement : null;
      if (activeReplyInput && activeReplyInput.dataset.fixtureReplySurface) {
        replyInput = activeReplyInput;
      } else if (!replyInput) {
        replyInput = document.querySelector(
          ".bpx-player-dm-input,[data-fixture-reply-surface='quick']"
        );
      }
      const replyValue = replyInput instanceof HTMLInputElement
        || replyInput instanceof HTMLTextAreaElement
        ? replyInput.value
        : replyInput && replyInput.textContent || "";
      const replyPrefilled = replyValue.replace(/\u00a0/g, " ") === "@测试用户6 ";
      const replyInputFocused = Boolean(replyInput
        && (document.activeElement === replyInput || replyInput.contains(document.activeElement)));
      const sentAfterReply = platform === "bilibili"
        ? document.body.dataset.bilibiliSent || ""
        : platform === "douyu"
          ? document.body.dataset.douyuSent || ""
          : document.body.dataset.chatSent || "";
      const replyDidNotSend = sentAfterReply === sentBeforeReply;
      const replySurface = replyInput && replyInput.dataset.fixtureReplySurface || "";
      const replySurfaceCorrect = replySurface === (fullscreenMode ? "quick" : "side");
      let overlayReplyButtonAvailable = true;
      let overlayReplyPrefilled = true;
      let overlayReplyInputFocused = true;
      let overlayReplyDidNotSend = true;
      let overlayReplyValue = "";
      let overlayReleaseFrameContinuous = true;
      let overlayReleaseMovedForwardOnly = true;
      let overlayReleaseResumed = true;
      let overlayReleaseCloneCleared = true;
      let overlayNativeMotionHeld = true;
      let overlayNativeInternalHoverHeld = true;
      let overlayPortalHoverBody = true;
      let overlayPortalHoverHeld = true;
      let overlayCapsuleStandardWidth = true;
      let overlayCapsuleGeometry = null;
      let overlayGapBridgePresent = true;
      let overlayGapBridgeHeld = true;
      let overlayReleaseSamples = [];
      const overlay = platform === "douyu"
        ? douyuOverlay
        : platform === "bilibili"
          ? document.querySelector(".bili-danmaku-x-dm-content")
          : document.querySelector("#player-wrap .danmu-item");
      const dispatchOverlayNativeEnter = () => {
        const target = platform === "douyu"
          ? overlay?.querySelector(".text-fixture") || overlay
          : overlay;
        target?.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          composed: true,
          pointerType: "mouse"
        }));
        if (platform === "douyu") {
          target?.dispatchEvent(new MouseEvent("mouseover", {
            bubbles: true,
            composed: true
          }));
        }
      };
      let overlayHoverFramed = false;
      if (overlay) {
        dispatchOverlayNativeEnter();
        await delay(100);
        const frozenOverlay = platform === "douyu"
          ? document.querySelector("[class*='danmuItem-'].bcp-one-target")
          : document.querySelector(".bcp-one-frozen.bcp-one-target");
        const frozenStyle = frozenOverlay && getComputedStyle(frozenOverlay);
        overlayHoverFramed = Boolean(
          frozenStyle
            && frozenStyle.outlineStyle !== "none"
            && parseFloat(frozenStyle.outlineWidth || "0") >= 1
            && frozenStyle.clipPath === "none"
        );
        const hoverBridge = document.querySelector(".bcp-one-hover-bridge");
        const visibleActionBar = document.querySelector(".bcp-one-actions:not([hidden])");
        const bridgeRect = hoverBridge?.getBoundingClientRect();
        const actionRect = visibleActionBar?.getBoundingClientRect();
        const heldRect = frozenOverlay?.getBoundingClientRect();
        const heldOverlayLeft = heldRect?.left;
        if (platform === "douyu") {
          const nativeTextChild = overlay.querySelector(".text-fixture");
          const nativeUserChild = overlay.querySelector(".hostname-fixture");
          if (nativeTextChild && nativeUserChild) {
            // A bubbling pointerout/mouseout between two descendants is not a
            // leave from the combined danmaku hover body. Douyu's listener in
            // this fixture intentionally resumes on pointerout so the content
            // script must suppress the internal transition before it bubbles.
            nativeTextChild.dispatchEvent(new PointerEvent("pointerout", {
              bubbles: true,
              composed: true,
              pointerType: "mouse",
              relatedTarget: nativeUserChild
            }));
            nativeTextChild.dispatchEvent(new MouseEvent("mouseout", {
              bubbles: true,
              composed: true,
              relatedTarget: nativeUserChild
            }));
            const internalHoldSamples = [];
            for (let frame = 0; frame < 4; frame += 1) {
              await nextPaint();
              internalHoldSamples.push(overlay.getBoundingClientRect().left);
            }
            overlayNativeInternalHoverHeld = internalHoldSamples.every(
              (left) => Number.isFinite(heldOverlayLeft)
                && Math.abs(left - heldOverlayLeft) <= 1.5
            );
            overlayNativeMotionHeld = overlayNativeInternalHoverHeld;

          }
        }
        if (platform === "bilibili") {
          const nativeRow = overlay.closest(".bili-danmaku-x-dm");
          const heldNativeLeft = nativeRow?.getBoundingClientRect().left;
          for (let frame = 0; frame < 4; frame += 1) await nextPaint();
          const nextNativeLeft = nativeRow?.getBoundingClientRect().left;
          overlayNativeMotionHeld = Boolean(
            nativeRow
              && nativeRow.getAttribute("data-bcp-bilibili-motion-paused") === "true"
              && Number.isFinite(heldNativeLeft)
              && Number.isFinite(nextNativeLeft)
              && Math.abs(nextNativeLeft - heldNativeLeft) <= 0.75
          );
        }
        overlayGapBridgePresent = Boolean(
          hoverBridge && bridgeRect && actionRect && heldRect
            && bridgeRect.width >= 6
            && bridgeRect.height >= Math.min(actionRect.height, heldRect.height) - 1.5
        );
        if (hoverBridge && visibleActionBar) {
          overlay.dispatchEvent(new PointerEvent("pointerout", {
            bubbles: true,
            composed: true,
            pointerType: "mouse",
            relatedTarget: hoverBridge
          }));
          hoverBridge.dispatchEvent(new PointerEvent("pointerenter", {
            bubbles: false,
            composed: true,
            pointerType: "mouse"
          }));
          await delay(220);
          const bridgeHeldOverlay = platform === "douyu"
            ? document.querySelector("[class*='danmuItem-'].bcp-one-target")
            : document.querySelector(".bcp-one-frozen.bcp-one-target");
          overlayGapBridgeHeld = Boolean(
            bridgeHeldOverlay
              && document.querySelector(".bcp-one-actions:not([hidden])")
              && (platform !== "douyu"
                || Math.abs(bridgeHeldOverlay.getBoundingClientRect().left - heldOverlayLeft) <= 1.5)
          );
        }
      }
      if ((platform === "huya" || platform === "douyu") && replyInput) {
        if (replyInput instanceof HTMLTextAreaElement) {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value"
          ).set;
          setter.call(replyInput, "");
        } else {
          replyInput.textContent = "";
        }
        replyInput.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          composed: true,
          data: "",
          inputType: "deleteContentBackward"
        }));
        const overlaySentBeforeReply = platform === "douyu"
          ? document.body.dataset.douyuSent || ""
          : document.body.dataset.overlaySent || "";
        dispatchOverlayNativeEnter();
        await delay(100);
        const overlayReplyButton = document.querySelector(
          ".bcp-one-actions:not([hidden]) .bcp-one-action[data-action='reply']"
        );
        overlayReplyButtonAvailable = Boolean(overlayReplyButton);
        const heldOverlay = platform === "douyu"
          ? document.querySelector("[class*='danmuItem-'].bcp-one-target")
          : document.querySelector(".bcp-one-frozen.bcp-one-target");
        const heldOverlayLeft = heldOverlay?.getBoundingClientRect().left;
        if (platform === "douyu" && overlayReplyButton) {
          const portalActionBar = overlayReplyButton.closest(".bcp-one-actions");
          overlayPortalHoverBody = Boolean(
            portalActionBar?.parentElement?.classList.contains("bcp-one-portal")
              && !overlay.contains(portalActionBar)
          );
          const visibleActionCount = portalActionBar
            ? Array.from(portalActionBar.querySelectorAll(".bcp-one-action"))
              .filter((action) => !action.hidden).length
            : 0;
          const expectedActionWidth = visibleActionCount * 56
            + Math.max(0, visibleActionCount - 1) * 2;
          overlayCapsuleGeometry = portalActionBar ? {
            bar: portalActionBar.getBoundingClientRect().width,
            client: portalActionBar.clientWidth,
            scroll: portalActionBar.scrollWidth,
            expected: expectedActionWidth,
            actions: Array.from(portalActionBar.querySelectorAll(".bcp-one-action"))
              .filter((action) => !action.hidden)
              .map((action) => ({
                rect: action.getBoundingClientRect().width,
                inline: action.getAttribute("style") || "",
                computed: getComputedStyle(action).width,
                flex: getComputedStyle(action).flex
              })),
            dividers: Array.from(portalActionBar.querySelectorAll(".bcp-one-action-divider"))
              .filter((divider) => !divider.hidden)
              .map((divider) => divider.getBoundingClientRect().width)
          } : null;
          overlayCapsuleStandardWidth = Boolean(
            portalActionBar
              && visibleActionCount > 0
              && Math.abs(portalActionBar.getBoundingClientRect().width - expectedActionWidth) <= 1.5
              && Array.from(portalActionBar.querySelectorAll(".bcp-one-action"))
                .filter((action) => !action.hidden)
                .every((action) => Math.abs(action.getBoundingClientRect().width - 56) <= 1.5)
              && Array.from(portalActionBar.querySelectorAll(".bcp-one-action-divider"))
                .filter((divider) => !divider.hidden)
                .every((divider) => Math.abs(divider.getBoundingClientRect().width - 2) <= 1)
              && portalActionBar.scrollWidth <= portalActionBar.clientWidth + 1
          );
          // Moving from the danmaku into the joined toolbar is internal to one
          // hover body. Even a native bubbling pointerout listener must not
          // resume the renderer-owned Web Animation at this boundary.
          overlay.dispatchEvent(new PointerEvent("pointerout", {
            bubbles: true,
            composed: true,
            pointerType: "mouse",
            relatedTarget: overlayReplyButton
          }));
          const portalHoldSamples = [];
          for (let frame = 0; frame < 4; frame += 1) {
            await nextPaint();
            portalHoldSamples.push(overlay.getBoundingClientRect().left);
          }
          overlayPortalHoverHeld = portalHoldSamples.every(
            (left) => Number.isFinite(heldOverlayLeft) && Math.abs(left - heldOverlayLeft) <= 1.5
          );
        }
        if (overlayReplyButton) overlayReplyButton.click();
        if ((platform === "douyu" || platform === "bilibili") && overlayReplyButton) {
          if (platform === "douyu") {
            // Only leaving the complete danmaku + toolbar subtree resumes the
            // native motion timeline.
            overlayReplyButton.dispatchEvent(new PointerEvent("pointerout", {
              bubbles: true,
              composed: true,
              pointerType: "mouse",
              relatedTarget: outside
            }));
          }
          for (let frame = 0; frame < 10; frame += 1) {
            await nextPaint();
            const snapshot = document.querySelector(".bcp-one-frozen.bcp-one-target");
            const originalStyle = getComputedStyle(overlay);
            const source = originalStyle.visibility !== "hidden" ? overlay : snapshot;
            const rect = source?.getBoundingClientRect();
            overlayReleaseSamples.push({
              left: rect?.left ?? null,
              source: snapshot ? "snapshot" : source ? "original" : "missing",
              visible: Boolean(source && rect && rect.width > 0 && rect.height > 0)
            });
          }
          const positions = overlayReleaseSamples
            .map((sample) => sample.left)
            .filter((left) => Number.isFinite(left));
          const steps = positions.slice(1).map((left, index) => left - positions[index]);
          overlayReleaseFrameContinuous = Boolean(
            Number.isFinite(heldOverlayLeft)
              && overlayReleaseSamples.every((sample) => sample.visible)
              && positions.length === overlayReleaseSamples.length
              && Math.abs(positions[0] - heldOverlayLeft) <= 4
              && steps.every((step) => Math.abs(step) <= 8)
          );
          overlayReleaseMovedForwardOnly = steps.every((step) => step <= 1.25);
          overlayReleaseResumed = Boolean(
            positions.length >= 2
              && positions[positions.length - 1] <= positions[0] - (platform === "bilibili" ? 1 : 5)
          );
          overlayReleaseCloneCleared = Boolean(
            !document.querySelector(".bcp-one-frozen")
              && !overlay.closest(".bili-danmaku-x-dm")
                ?.hasAttribute("data-bcp-bilibili-motion-paused")
          );
        }
        await delay(platform === "douyu" ? 520 : 120);
        overlayReplyValue = replyInput instanceof HTMLTextAreaElement
          ? replyInput.value
          : replyInput.textContent || "";
        overlayReplyPrefilled = overlayReplyValue.replace(/\u00a0/g, " ") === "@画面用户 ";
        overlayReplyInputFocused = document.activeElement === replyInput;
        overlayReplyDidNotSend = (platform === "douyu"
          ? document.body.dataset.douyuSent || ""
          : document.body.dataset.overlaySent || "") === overlaySentBeforeReply;
      }
      root.scrollTop = root.scrollHeight;
      if (replyInput instanceof HTMLInputElement || replyInput instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(
          replyInput instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype,
          "value"
        ).set;
        setter.call(replyInput, "");
      } else if (replyInput) {
        replyInput.textContent = "";
      }
      replyInput?.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: "",
        inputType: "deleteContentBackward"
      }));
      await delay(760);
      const missingSenderRect = missingSenderContent.getBoundingClientRect();
      const missingSenderPointer = {
        bubbles: true,
        clientX: missingSenderRect.left + Math.max(2, missingSenderRect.width / 2),
        clientY: missingSenderRect.top + Math.max(2, missingSenderRect.height / 2),
        composed: true,
        pointerType: "mouse"
      };
      missingSenderContent.dispatchEvent(new PointerEvent("pointerover", missingSenderPointer));
      missingSenderContent.dispatchEvent(new PointerEvent("pointermove", missingSenderPointer));
      await delay(180);
      const missingSenderReply = document.querySelector(
        ".bcp-one-actions:not([hidden]) .bcp-one-action[data-action='reply']"
      );
      const previousMissingSenderToast = String(
        document.querySelector(".bcp-one-toast")?.textContent || ""
      ).trim();
      if (missingSenderReply) missingSenderReply.click();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const currentToast = String(
          document.querySelector(".bcp-one-toast")?.textContent || ""
        ).trim();
        if ((currentToast && currentToast !== previousMissingSenderToast) || (
          replyInput instanceof HTMLInputElement || replyInput instanceof HTMLTextAreaElement
            ? replyInput.value
            : replyInput?.textContent
        )) break;
        await delay(100);
      }
      const errorToast = document.querySelector(".bcp-one-toast.is-visible");
      const errorText = String(errorToast && errorToast.textContent || "").trim();
      const missingSenderReplyDraft = replyInput instanceof HTMLInputElement
        || replyInput instanceof HTMLTextAreaElement
        ? replyInput.value
        : replyInput?.textContent || "";
      const contextualReplyError = Boolean(errorToast && errorText && !errorText.includes("+1"));
      const missingSenderSafe = Boolean(missingSenderReply && !missingSenderReplyDraft);
      const ownMessageFramed = platform !== "douyu"
        || ownContent?.getAttribute("data-bcp-douyu-own-chat-content") === "true";
      let disabledSideChatCapsuleStayedHidden = true;
      if (platform === "douyu") {
        // Current Douyu side-chat builds can reuse a danmuItem-like class. The
        // row must still be classified as chat and respect the disabled switch,
        // including during the pointer-coordinate overlay scan.
        targetRow.classList.add("danmuItem-fixture-chat");
        root.scrollTop = Math.max(0, targetRow.offsetTop - 20);
        await chrome.storage.sync.set({
          sideChatCapsule: {
            ...(previousSideChatSettings.sideChatCapsule || {}),
            douyu: false
          }
        });
        await delay(120);
        const targetRect = targetContent.getBoundingClientRect();
        const pointerOptions = {
          bubbles: true,
          clientX: targetRect.left + Math.max(2, targetRect.width / 2),
          clientY: targetRect.top + Math.max(2, targetRect.height / 2),
          composed: true,
          pointerType: "mouse"
        };
        targetContent.dispatchEvent(new PointerEvent("pointerover", pointerOptions));
        targetContent.dispatchEvent(new PointerEvent("pointermove", pointerOptions));
        await delay(120);
        await nextPaint();
        disabledSideChatCapsuleStayedHidden = Boolean(actionBar && actionBar.hidden);
      }

      targetContent.dispatchEvent(new PointerEvent("pointerout", {
        bubbles: true,
        composed: true,
        pointerType: "mouse",
        relatedTarget: outside
      }));
      if (panel) panel.remove();
      root.remove();
      outside.remove();
      douyuOverlayAnimation?.cancel();
      douyuControls?.remove();
      douyuPlayer?.remove();
      await chrome.storage.sync.set({
        actions: previousSideChatSettings.actions || {},
        sideChatCapsule: previousSideChatSettings.sideChatCapsule || {}
      });
      return {
        platform,
        messagePlusOneAvailable,
        threeActionUi,
        copyActionAvailable,
        scrollPauseMarkerAbsent,
        scrollStart,
        scrollEnd,
        scrollingRemainsEnabled,
        manualScrollTarget,
        manualScrollPosition,
        manualScrollPreserved,
        favoriteSavedAndListed,
        favoritePinWorked,
        favoriteTagsWorked,
        favoriteCustomSortAvailable,
        favoriteUiSingleton,
        currentRoomFocused,
        favoriteQuickSendSucceeded,
        favoriteSentValue,
        favoriteSendFeedback,
        favoriteRuntimeSendText,
        favoriteRuntimeSendResult,
        longPressRadialAvailable,
        radialFavoriteSelected,
        radialQuickSendSucceeded,
        favoritesFullscreenHostCorrect,
        replyButtonAvailable: Boolean(replyButton),
        replyPrefilled,
        replyInputFocused,
        replyDidNotSend,
        replyValue,
        replySurface,
        replySurfaceCorrect,
        overlayReplyButtonAvailable,
        overlayReplyPrefilled,
        overlayReplyInputFocused,
        overlayReplyDidNotSend,
        overlayReplyValue,
        overlayHoverFramed,
        overlayReleaseFrameContinuous,
        overlayReleaseMovedForwardOnly,
        overlayReleaseResumed,
        overlayReleaseCloneCleared,
        overlayNativeMotionHeld,
        overlayNativeInternalHoverHeld,
        overlayPortalHoverBody,
        overlayPortalHoverHeld,
        overlayCapsuleStandardWidth,
        overlayCapsuleGeometry,
        overlayGapBridgePresent,
        overlayGapBridgeHeld,
        overlayReleaseSamples,
        ownMessageFramed,
        nativeDouyuCapsuleHidden,
        nativeDouyuCapsuleRestoredWhenDisabled,
        disabledSideChatCapsuleStayedHidden,
        contextualReplyError,
        missingSenderSafe,
        missingSenderReplyAvailable: Boolean(missingSenderReply),
        missingSenderReplyDraft,
        replyErrorText: errorText,
        advertisementRejected,
        usernameActionRejected,
        userPanelRejected
      };
    })()`)
    const sideChatAssertions = [
      'messagePlusOneAvailable',
      'threeActionUi',
      'copyActionAvailable',
      'scrollPauseMarkerAbsent',
      'scrollingRemainsEnabled',
      'manualScrollPreserved',
      'favoriteSavedAndListed',
      'favoritePinWorked',
      'favoriteTagsWorked',
      'favoriteCustomSortAvailable',
      'favoriteUiSingleton',
      'currentRoomFocused',
      'favoriteQuickSendSucceeded',
      'longPressRadialAvailable',
      'radialFavoriteSelected',
      'radialQuickSendSucceeded',
      'favoritesFullscreenHostCorrect',
      'replyButtonAvailable',
      'replyPrefilled',
      'replyInputFocused',
      'replyDidNotSend',
      'replySurfaceCorrect',
      'overlayReplyButtonAvailable',
      'overlayReplyPrefilled',
      'overlayReplyInputFocused',
      'overlayReplyDidNotSend',
      'overlayHoverFramed',
      'overlayReleaseFrameContinuous',
      'overlayReleaseMovedForwardOnly',
      'overlayReleaseResumed',
      'overlayReleaseCloneCleared',
      'overlayNativeMotionHeld',
      'overlayNativeInternalHoverHeld',
      'overlayPortalHoverBody',
      'overlayPortalHoverHeld',
      'overlayCapsuleStandardWidth',
      'overlayGapBridgePresent',
      'overlayGapBridgeHeld',
      'ownMessageFramed',
      'nativeDouyuCapsuleHidden',
      'nativeDouyuCapsuleRestoredWhenDisabled',
      'disabledSideChatCapsuleStayedHidden',
      'missingSenderSafe',
      'advertisementRejected',
      'usernameActionRejected',
      'userPanelRejected',
    ].filter((key) => {
      const fullscreen = targetParameters.get('fullscreen') === '1'
      if ((fullscreen || normalizedInjectPlatform === 'douyu') && key === 'missingSenderSafe')
        return false
      if (
        fullscreen &&
        normalizedInjectPlatform === 'bilibili' &&
        (key === 'replyPrefilled' || key === 'replyInputFocused')
      )
        return false
      return true
    })
    sideChatRegression.assertionFailures = sideChatAssertions.filter(
      (key) => sideChatRegression[key] !== true,
    )
  }

  let nativeEmojiRegression = null
  if (
    targetParameters.get('nativeemoji') === '1' &&
    (normalizedInjectPlatform === 'huya' || normalizedInjectPlatform === 'douyu')
  ) {
    nativeEmojiRegression = await evaluateValue(`(async () => {
      const platform = ${JSON.stringify(normalizedInjectPlatform)};
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const isHuya = platform === "huya";
      const douyuPe3 = !isHuya && new URL(location.href).searchParams.get("pe3emoji") === "1";
      const douyuEmojiName = douyuPe3 ? "像个小丑" : "狗骨头";
      const emojiUrl = isHuya
        ? "https://cdnfile2.msstatic.com/cdnfile/material_manage/web_base_material_16141731879991_pic.png"
        : douyuPe3
          ? "https://sta-op.douyucdn.cn/dygev/2024/04/25/14988198d32369566ecbe3312cbc82c7.png"
          : "https://shark2.douyucdn.cn/front-publish/live-next-player-aside-master/assets/images/gougutou_0fd69bd.png";
      const renderedEmojiUrl = isHuya
        ? "https://fixture.invalid/huya/rendered/opaque-native-emoji.webp"
        : douyuPe3
          ? "https://sta-op.douyucdn.cn/dygev/2024/04/25/14988198d32369566ecbe3312cbc82c7.png/fmtpng"
          : "https://shark2.douyucdn.cn/front-publish/live-next-player-aside-master/assets/images/gougutou_0fd69bd.png/fmtpng";
      document.body.dataset.chatSent = "";
      document.body.dataset.douyuSent = "";
      document.body.dataset.nativeEmojiItemClicks = "0";
      document.body.dataset.nativeEmojiToggleClicks = "0";
      document.body.dataset.nativeEmojiClickedToken = "";

      const controls = document.createElement("section");
      controls.className = isHuya ? "room-chat__input fixture-native-controls" : "ChatSpeak fixture-native-controls";
      Object.assign(controls.style, {
        position: "fixed",
        left: "20px",
        top: "390px",
        width: "360px",
        zIndex: "1200"
      });
      const input = isHuya
        ? document.querySelector("#pub_msg_input")
        : document.createElement("div");
      if (!isHuya) {
        input.className = "ChatSend-txt";
        input.contentEditable = "true";
        input.dataset.placeholder = "这里输入聊天内容";
        controls.appendChild(input);
      }
      const send = isHuya
        ? document.querySelector("#msg_send_bt")
        : document.createElement("button");
      if (!isHuya) {
        send.className = "ChatSend-button";
        send.type = "button";
        send.textContent = "发送";
        send.addEventListener("click", () => {
          document.body.dataset.douyuSent = input.textContent || "";
          input.textContent = "";
          input.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            composed: true,
            data: "",
            inputType: "deleteContentBackward"
          }));
        });
        controls.appendChild(send);
      }

      const toggle = document.createElement(isHuya ? "i" : "button");
      toggle.id = isHuya ? "J_inputEmot" : "";
      toggle.className = isHuya
        ? "room-chat-tool room-chat-tool-smile"
        : "EmotionSwitcher";
      toggle.title = "表情";
      toggle.textContent = isHuya ? "" : "表情";
      const panel = document.createElement("div");
      panel.id = isHuya ? "J_chatEmotLnk" : "";
      panel.className = isHuya
        ? "chat-emotLnk Panel-content--augqGJOgHJhOVRXfghwS"
        : "Emotion-wrap";
      panel.style.display = "none";
      const list = document.createElement(isHuya ? "div" : "ul");
      list.className = isHuya ? "emoticon-list--vvo_5WcTIJJYKKUhNHkI" : "EmotionList";
      const item = document.createElement(isHuya ? "div" : "li");
      item.className = isHuya ? "emot--Qr8drUzCL8qDtNyJrDfy" : "EmotionList-item";
      if (isHuya) item.dataset.id = "29";
      else item.title = "[开心]";
      const panelImage = document.createElement("img");
      panelImage.className = isHuya ? "emot-icon--yiOR1CrLrsaYAPbzXFIL" : "EmotionList-image";
      panelImage.alt = isHuya ? "[傲慢]" : "[开心]";
      panelImage.src = emojiUrl;
      item.appendChild(panelImage);
      if (isHuya) {
        const preview = document.createElement("p");
        preview.className = "emot-preview--mqSgJim3A_fvZEo6YT75";
        const previewImage = panelImage.cloneNode();
        const previewText = document.createElement("span");
        previewText.textContent = "[傲慢]";
        preview.append(previewImage, previewText);
        item.appendChild(preview);
      }
      panel.appendChild(list);
      const douyuCategoryCount = 18;
      if (isHuya) {
        list.appendChild(item);
      } else {
        item.removeAttribute("title");
        panelImage.removeAttribute("alt");
        const itemTitle = document.createElement("div");
        itemTitle.className = "EmotionList-item-title";
        itemTitle.textContent = douyuEmojiName;
        item.appendChild(itemTitle);
        const tabs = document.createElement("ul");
        tabs.className = "EmotionTab";
        const appendDecoy = (index) => {
          const decoy = document.createElement("em");
          decoy.className = "EmotionList-item";
          const image = document.createElement("img");
          image.className = "EmotionList-img";
          image.src = "https://fixture-decoy.invalid/pack/d" + index + ".png";
          decoy.appendChild(image);
          list.replaceChildren(decoy);
        };
        appendDecoy(0);
        for (let index = 0; index < douyuCategoryCount; index += 1) {
          const category = document.createElement("li");
          category.className = "EmotionTab-item" + (index === 0 ? " is-active" : "");
          category.dataset.fixtureCategory = String(index);
          category.addEventListener("click", () => {
            document.body.dataset.douyuEmojiCategoryClicks = String(
              Number(document.body.dataset.douyuEmojiCategoryClicks || 0) + 1
            );
            tabs.querySelectorAll(".EmotionTab-item").forEach((tab) =>
              tab.classList.toggle("is-active", tab === category));
            list.replaceChildren();
            setTimeout(() => {
              if (index === douyuCategoryCount - 1) list.appendChild(item);
              else appendDecoy(index);
            }, index === douyuCategoryCount - 1 ? 520 : 40);
          });
          tabs.appendChild(category);
        }
        panel.appendChild(tabs);
      }
      controls.append(toggle, panel);
      let duplicateHuyaPanel = null;
      let duplicateHuyaItem = null;
      if (isHuya) {
        // Huya keeps normal and player-layout panels mounted together. They
        // contain distinct DOM nodes for the same data-id/material resource.
        duplicateHuyaPanel = panel.cloneNode(true);
        duplicateHuyaPanel.removeAttribute("id");
        duplicateHuyaPanel.classList.add("fixture-duplicate-huya-panel");
        duplicateHuyaPanel.style.display = "none";
        duplicateHuyaItem = duplicateHuyaPanel.querySelector("[class*='emot--']");
        controls.appendChild(duplicateHuyaPanel);
      }
      if (isHuya) document.body.appendChild(controls);
      else document.body.appendChild(controls);

      const chatRoot = document.createElement("section");
      chatRoot.className = isHuya ? "room-chat-messages" : "Barrage-container";
      Object.assign(chatRoot.style, {
        position: "fixed",
        left: "20px",
        top: "220px",
        width: "360px",
        minHeight: "120px",
        background: "#18181c",
        zIndex: "1100"
      });
      const createImageRow = (own = false) => {
        const row = document.createElement(isHuya ? "div" : "li");
        row.className = isHuya
          ? "msg-normal"
          : (own ? "Barrage-listItem" : "fixture-native-image-row");
        const user = document.createElement("span");
        user.className = isHuya ? "name" : "Barrage-nickName js-nick";
        user.textContent = own ? "自己" : "表情用户";
        if (isHuya) user.title = "点击查看个人信息";
        else {
          user.title = user.textContent;
          user.dataset.uid = own ? "10001" : "10002";
        }
        const content = document.createElement("span");
        content.className = isHuya
          ? "msg J_msg"
          : (own ? "Barrage-content" : "fixture-native-image-content");
        if (!isHuya && own) content.dataset.chatid = "fixture-native-own";
        const image = document.createElement("img");
        image.className = isHuya
          ? "emoji-image"
          : douyuPe3
            ? "EmotImagePe-f4134a EmotImagePe3-ba2535"
            : "EmotImage-a24559";
        if (isHuya) image.alt = "[傲慢]";
        else image.setAttribute("rel", douyuEmojiName);
        image.src = renderedEmojiUrl;
        content.appendChild(image);
        row.append(user, content);
        return { content, image, row };
      };
      const source = createImageRow(false);
      chatRoot.appendChild(source.row);
      document.body.appendChild(chatRoot);

      const player = document.createElement("section");
      player.id = isHuya ? "player-wrap-fixture-native" : "js-player-main";
      if (isHuya) player.className = "player-wrap";
      Object.assign(player.style, {
        position: "fixed",
        left: "420px",
        top: "220px",
        width: "420px",
        height: "240px",
        background: "#111",
        zIndex: "1000"
      });
      const overlay = document.createElement("div");
      overlay.className = isHuya ? "danmu-item" : "danmuItem-fixture-native";
      Object.assign(overlay.style, {
        position: "absolute",
        left: "100px",
        top: "80px",
        width: "48px",
        height: "48px"
      });
      const overlayImage = document.createElement("img");
      overlayImage.className = isHuya
        ? "emoji-image"
        : douyuPe3
          ? "EmotImagePe-f4134a EmotImagePe3-ba2535"
          : "EmotImage-a24559";
      // Real player image Emoji can expose only a generic accessibility label.
      // The exact overlay row and resource identity must still be hoverable.
      if (isHuya) overlayImage.alt = "[图片表情]";
      else overlayImage.setAttribute("rel", douyuEmojiName);
      overlayImage.src = renderedEmojiUrl;
      Object.assign(overlayImage.style, { width: "48px", height: "48px" });
      overlay.appendChild(overlayImage);
      player.appendChild(overlay);
      document.body.appendChild(player);
      if (!isHuya) {
        overlay.addEventListener("pointerover", () => {
          overlay.dataset.fixtureDouyuNativeHoverPaused = "true";
          overlay.style.zIndex = "999";
          overlayImage.style.border = "2px solid rgb(2, 255, 255)";
          overlayImage.style.padding = "2px 17px 2px 4px";
          overlayImage.style.marginRight = "-17px";
        });
        overlay.addEventListener("mouseout", (event) => {
          if (event.relatedTarget instanceof Node && overlay.contains(event.relatedTarget)) return;
          delete overlay.dataset.fixtureDouyuNativeHoverPaused;
          overlay.style.zIndex = "0";
          overlayImage.style.removeProperty("border");
          overlayImage.style.removeProperty("padding");
          overlayImage.style.removeProperty("margin-right");
        });
      }

      toggle.addEventListener("click", () => {
        document.body.dataset.nativeEmojiToggleClicks = String(
          Number(document.body.dataset.nativeEmojiToggleClicks || 0) + 1
        );
        panel.style.display = "block";
        if (duplicateHuyaPanel) duplicateHuyaPanel.style.display = "block";
      });
      const appendTransformedEcho = () => {
        const echo = createImageRow(true);
        // Both sites may render the sent resource through a different CDN URL
        // without preserving the original name or panel title.
        echo.image.alt = "[图片表情]";
        echo.image.src = "https://fixture.invalid/native-emoji/sent-opaque.webp";
        echo.row.dataset.fixtureNativeEmojiEcho = "true";
        chatRoot.appendChild(echo.row);
      };
      const expectedEmojiName = isHuya ? "[傲慢]" : "[" + douyuEmojiName + "]";
      send.addEventListener("click", () => {
        const submitted = String(
          input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement
            ? input.value
            : input.textContent || ""
        ).trim();
        document.body.dataset.nativeEmojiNameSubmitted = submitted;
        if (submitted === expectedEmojiName) {
          setTimeout(appendTransformedEcho, 120);
        }
      }, true);
      const handleNativeEmojiItemClick = () => {
        document.body.dataset.nativeEmojiItemClicks = String(
          Number(document.body.dataset.nativeEmojiItemClicks || 0) + 1
        );
        document.body.dataset.nativeEmojiClickedToken = isHuya ? "[傲慢]" : expectedEmojiName;
        if (isHuya) {
          // Current Huya inserts a rich native object first. Its own send
          // button then consumes the editor, while the echo uses another URL.
          input.value = "\uFFFC";
          input.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            composed: true,
            data: null,
            inputType: "insertReplacementText"
          }));
          // Delay the transformed echo beyond the confirmation timeout. The
          // consumed native editor must be sufficient evidence on Huya.
          send.addEventListener("click", () => setTimeout(appendTransformedEcho, 900), {
            once: true
          });
          return;
        }
        // Douyu's built-in item can dispatch directly and close its panel.
        document.body.dataset.douyuNativePe = "3";
        panel.style.display = "none";
        setTimeout(appendTransformedEcho, 120);
      };
      item.addEventListener("click", handleNativeEmojiItemClick);
      if (duplicateHuyaItem) {
        duplicateHuyaItem.addEventListener("click", handleNativeEmojiItemClick);
      }

      await delay(180);
      overlayImage.dispatchEvent(new PointerEvent("pointerover", {
        bubbles: true,
        composed: true,
        pointerType: "mouse"
      }));
      await delay(160);
      const overlayPlusOne = document.querySelector(
        ".bcp-one-actions:not([hidden]) .bcp-one-action[data-action='plus-one']"
      );
      const overlayEmojiHoverable = Boolean(
        overlayPlusOne && overlay.classList.contains("bcp-one-target")
      );
      const nativeHoverPausedBeforeAction = isHuya
        || overlay.dataset.fixtureDouyuNativeHoverPaused === "true";
      if (!isHuya && overlayPlusOne) {
        // Simulate the real pointer transition from the native image into the
        // joined extension capsule. The extension deliberately suppresses the
        // intermediate leave; clicking +1 must later replay it for Douyu.
        overlayImage.dispatchEvent(new PointerEvent("pointerout", {
          bubbles: true,
          composed: true,
          pointerType: "mouse",
          relatedTarget: overlayPlusOne
        }));
        overlayImage.dispatchEvent(new MouseEvent("mouseout", {
          bubbles: true,
          composed: true,
          relatedTarget: overlayPlusOne
        }));
      }

      // Image Emoji +1 is a video-overlay feature. Side-chat capsules are
      // independently disabled by default, so exercise the visible overlay
      // action instead of relying on the legacy side-chat fallback.
      const plusOne = overlayPlusOne;
      const emojiNameExtracted = Boolean(plusOne && [
        plusOne.getAttribute("aria-label"),
        plusOne.getAttribute("title")
      ].some((value) => String(value || "").includes(isHuya ? "图片表情" : douyuEmojiName)));
      const sideEmojiHoverableWithoutKnownRowSelector = null;
      const feedbackMessages = [];
      const captureFeedback = () => {
        const message = String(
          document.querySelector(".bcp-one-toast.is-visible")?.textContent || ""
        ).trim();
        if (message && feedbackMessages[feedbackMessages.length - 1] !== message) {
          feedbackMessages.push(message);
        }
      };
      const feedbackObserver = new MutationObserver(captureFeedback);
      feedbackObserver.observe(document.body, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true
      });
      if (plusOne) plusOne.click();
      await delay(2_800);
      captureFeedback();
      feedbackObserver.disconnect();
      const feedback = feedbackMessages[feedbackMessages.length - 1] || "";
      const nativePanelPathCorrect = isHuya
        ? Number(document.body.dataset.nativeEmojiToggleClicks || 0) === 0
        : Number(document.body.dataset.nativeEmojiToggleClicks || 0) > 0;
      const nativeItemPathCorrect = isHuya
        ? Number(document.body.dataset.nativeEmojiItemClicks || 0) === 0
        : Number(document.body.dataset.nativeEmojiItemClicks || 0) === 1;
      const imageEchoRendered = Boolean(
        chatRoot.querySelector("[data-fixture-native-emoji-echo='true'] img")
      );
      const emojiNameSubmitted = isHuya
        ? document.body.dataset.nativeEmojiNameSubmitted === expectedEmojiName
        : document.body.dataset.nativeEmojiClickedToken === expectedEmojiName;
      const platformReceivedEmojiName = isHuya
        ? document.body.dataset.chatSent === expectedEmojiName
        : document.body.dataset.douyuNativePe === "3"
          && document.body.dataset.douyuSent !== expectedEmojiName;
      const successFeedback = /已发送|sent/i.test(feedback);
      const nativeHoverReleasedAfterAction = isHuya || Boolean(
        overlay.dataset.fixtureDouyuNativeHoverPaused !== "true"
        && overlay.style.zIndex !== "999"
        && !overlayImage.style.border
        && !overlayImage.style.padding
        && !overlayImage.style.marginRight
      );

      chatRoot.remove();
      controls.remove();
      player.remove();
      return {
        platform,
        overlayEmojiHoverable,
        nativeHoverPausedBeforeAction,
        nativeHoverReleasedAfterAction,
        sideEmojiHoverableWithoutKnownRowSelector,
        plusOneAvailable: Boolean(plusOne),
        emojiNameExtracted,
        nativePanelPathCorrect,
        nativeItemPathCorrect,
        imageEchoRendered,
        emojiNameSubmitted,
        platformReceivedEmojiName,
        successFeedback,
        feedback
      };
    })()`)
    nativeEmojiRegression.assertionFailures = [
      'overlayEmojiHoverable',
      'nativeHoverPausedBeforeAction',
      'nativeHoverReleasedAfterAction',
      'plusOneAvailable',
      'nativePanelPathCorrect',
      'nativeItemPathCorrect',
      'imageEchoRendered',
      'emojiNameSubmitted',
      'platformReceivedEmojiName',
      'successFeedback',
    ].filter((key) => nativeEmojiRegression[key] !== true)
    if (normalizedInjectPlatform === 'douyu' && nativeEmojiRegression.emojiNameExtracted !== true) {
      nativeEmojiRegression.assertionFailures.push('emojiNameExtracted')
    }
  }

  let bilibiliRichRegression = null
  if (
    normalizedInjectPlatform === 'bilibili' &&
    new URL(targetUrl).searchParams.get('rich') === '1'
  ) {
    const bilibiliRichEvaluation = evaluateValue(`(async () => {
      document.body.dataset.bilibiliRichStage = "starting";
      const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const legacyExclusiveMode =
        new URL(location.href).searchParams.get("legacyexclusive") === "1";
      const lazyEmojiMode = new URL(location.href).searchParams.get("lazyemoji") === "1";
      const nameOnlyPanelMode =
        new URL(location.href).searchParams.get("nameonlypanel") === "1";
      const emojiOnlyMode = new URL(location.href).searchParams.get("emojionly") === "1";
      const coldRoomEmojiMode =
        new URL(location.href).searchParams.get("coldroomemoji") === "1";
      const unrelatedEmojiMode =
        new URL(location.href).searchParams.get("unrelatedemoji") === "1";
      const badgeNameEmojiMode =
        new URL(location.href).searchParams.get("badgenameemoji") === "1";
      const longHoverMode = ["longhover", "hoverperf"].some(
        (key) => new URL(location.href).searchParams.get(key) === "1"
      );
      const runHoverPerformance = async () => {
        document.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 790,
          clientY: 440,
          pointerType: "mouse"
        }));
        await delay(240);

        const chatRoot = document.querySelector("#chat-history-list");
        const churnContainer = document.querySelector(
          ".bilibili-live-player-video-danmaku"
        );
        if (!chatRoot || !churnContainer) {
          return {
            longHoverLatency: 0,
            longHoverLatencyBounded: false,
            longHoverPositionStable: false,
            longHoverUsesWholeRow: false,
            syncProcessingP95: 0,
            actionVisibleP95: 0,
            actionVisibleMax: 0,
            syncProcessingP95WithinBudget: false,
            actionVisibleP95WithinBudget: false,
            actionVisibleMaxWithinBudget: false,
            stressDurationMs: 0,
            stressDurationMet: false,
            stressHoverCount: 0,
            stressHoverCountMet: false,
            stressNoDuplicateBorders: false,
            stressSenderCorrect: false,
            stressSenderFailures: [{ reason: "fixture roots unavailable" }]
          };
        }

        const stressHost = document.createElement("div");
        stressHost.className = "fixture-long-hover-chat-stress";
        const fragment = document.createDocumentFragment();
        const stressMessages = [];
        for (let index = 0; index < 1_500; index += 1) {
          const row = document.createElement("div");
          row.className = "danmaku-item";
          const sender = document.createElement("span");
          sender.className = "user-name";
          sender.textContent = "长期用户" + index + "：";
          const content = document.createElement("span");
          content.className = "danmaku-content";
          content.textContent = "运行一段时间后的聊天记录" + index;
          if (index >= 1_400) {
            stressMessages.push({
              message: content.textContent,
              sender: "长期用户" + index
            });
          }
          row.append(sender, content);
          fragment.appendChild(row);
        }
        stressHost.appendChild(fragment);
        chatRoot.appendChild(stressHost);

        const hoverRows = stressMessages.map((entry, index) => {
          const row = document.createElement("div");
          row.className = "bili-danmaku-x-dm fixture-stress-hover-row";
          Object.assign(row.style, {
            left: (180 + index % 7) + "px",
            position: "absolute",
            top: (90 + index % 5) + "px"
          });
          const content = document.createElement("span");
          content.className = "bili-danmaku-x-dm-content";
          content.textContent = entry.message;
          row.appendChild(content);
          churnContainer.appendChild(row);
          return { ...entry, content, row };
        });
        await delay(300);

        const syncLatencies = [];
        const visibleLatencies = [];
        const stressSenderFailures = [];
        let longHoverPositionStable = true;
        let longHoverUsesWholeRow = true;
        let stressNoDuplicateBorders = true;
        let stressSenderCorrect = true;
        let stressHoverCount = 0;
        const churnTimer = setInterval(() => {
          const transientRow = document.createElement("div");
          transientRow.className = "bili-danmaku-x-dm";
          transientRow.innerHTML = '<span class="bili-danmaku-x-dm-content">高频播放器弹幕</span>';
          churnContainer.appendChild(transientRow);
          transientRow.remove();
        }, 8);
        const stressStartedAt = performance.now();
        try {
          for (let index = 0; index < hoverRows.length; index += 1) {
            const target = hoverRows[index];
            target.row.style.padding = "4px 9px";
            const beforeRect = target.row.getBoundingClientRect();
            const contentRect = target.content.getBoundingClientRect();
            const startedAt = performance.now();
            target.content.dispatchEvent(new PointerEvent("pointerover", {
              bubbles: true,
              composed: true,
              clientX: beforeRect.left + beforeRect.width / 2,
              clientY: beforeRect.top + beforeRect.height / 2,
              pointerType: "mouse"
            }));
            syncLatencies.push(performance.now() - startedAt);
            let actionBound = false;
            do {
              const plus = document.querySelector(
                ".bcp-one-action[data-action='plus-one']:not([hidden])"
              );
              actionBound = Boolean(plus
                && String(plus.getAttribute("title") || plus.getAttribute("aria-label") || "")
                  .includes(target.message));
              if (!actionBound) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
              }
            } while (!actionBound && performance.now() - startedAt < 150);
            visibleLatencies.push(performance.now() - startedAt);

            const frozen = document.querySelector(".bcp-one-frozen");
            const frozenRect = frozen?.getBoundingClientRect();
            longHoverPositionStable = longHoverPositionStable && Boolean(frozenRect
              && Math.abs(frozenRect.left - beforeRect.left) < 4
              && Math.abs(frozenRect.top - beforeRect.top) < 4);
            longHoverUsesWholeRow = longHoverUsesWholeRow && Boolean(frozenRect
              && Math.abs(frozenRect.width - beforeRect.width) < 3
              && frozenRect.width >= contentRect.width + 12);
            stressNoDuplicateBorders = stressNoDuplicateBorders
              && document.querySelectorAll(".bcp-one-frozen").length === 1;
            const reply = document.querySelector(
              ".bcp-one-action[data-action='reply']:not([hidden])"
            );
            const replyLabel = String(
              reply?.getAttribute("title") || reply?.getAttribute("aria-label") || ""
            );
            const senderMatched = replyLabel.includes(target.sender);
            stressSenderCorrect = stressSenderCorrect && senderMatched;
            if (!senderMatched && stressSenderFailures.length < 10) {
              stressSenderFailures.push({
                index,
                expected: target.sender,
                message: target.message,
                replyLabel
              });
            }
            stressHoverCount += 1;
            document.dispatchEvent(new PointerEvent("pointermove", {
              bubbles: true,
              clientX: 790,
              clientY: 440,
              pointerType: "mouse"
            }));
            const remaining = (index + 1) * 300
              - (performance.now() - stressStartedAt);
            if (remaining > 0) await delay(remaining);
          }
        } finally {
          clearInterval(churnTimer);
          hoverRows.forEach(({ row }) => row.remove());
          stressHost.remove();
        }

        const stressDurationMs = performance.now() - stressStartedAt;
        const percentile95 = (values) => {
          const sorted = [...values].sort((first, second) => first - second);
          return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0;
        };
        const syncProcessingP95 = percentile95(syncLatencies);
        const actionVisibleP95 = percentile95(visibleLatencies);
        const actionVisibleMax = Math.max(0, ...visibleLatencies);
        const syncProcessingP95WithinBudget = syncProcessingP95 <= 16;
        const actionVisibleP95WithinBudget = actionVisibleP95 <= 50;
        const actionVisibleMaxWithinBudget = actionVisibleMax <= 150;
        return {
          longHoverLatency: syncProcessingP95,
          longHoverLatencyBounded: syncProcessingP95WithinBudget
            && actionVisibleP95WithinBudget && actionVisibleMaxWithinBudget,
          longHoverPositionStable,
          longHoverUsesWholeRow,
          syncProcessingP95,
          actionVisibleP95,
          actionVisibleMax,
          syncProcessingP95WithinBudget,
          actionVisibleP95WithinBudget,
          actionVisibleMaxWithinBudget,
          stressDurationMs,
          stressDurationMet: stressDurationMs >= 29_500,
          stressHoverCount,
          stressHoverCountMet: stressHoverCount === 100,
          stressNoDuplicateBorders,
          stressSenderCorrect,
          stressSenderFailures
        };
      };
      if (longHoverMode) {
        const performanceResult = await runHoverPerformance();
        document.body.dataset.bilibiliRichStage = "completed";
        return { longHoverMode, ...performanceResult };
      }
      if (badgeNameEmojiMode) {
        const target = document.querySelector(".fixture-hopeless-overlay-emote");
        target?.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          composed: true,
          pointerType: "mouse"
        }));
        await delay(180);
        const favorite = document.querySelector(
          ".bcp-one-actions:not([hidden]) .bcp-one-action[data-action='favorite']"
        );
        favorite?.click();
        await delay(900);
        document.dispatchEvent(new KeyboardEvent("keydown", {
          altKey: true, bubbles: true, code: "KeyQ", key: "q"
        }));
        await delay(40);
        document.dispatchEvent(new KeyboardEvent("keyup", {
          altKey: true, bubbles: true, code: "KeyQ", key: "q"
        }));
        await delay(180);
        const favoritesHost = document.querySelector(".bcp-favorites-host");
        const favoritesRoot = favoritesHost?.shadowRoot || document;
        const favoriteNames = Array.from(
          favoritesRoot.querySelectorAll(".bcp-favorites-text")
        ).map((item) => String(item.textContent || "").trim());
        const storage = await chrome.storage.local.get("danmakuEchoFavoritesV1");
        const saved = storage.danmakuEchoFavoritesV1?.items?.find(
          (item) => String(item.text || "").includes("生无可恋")
        );
        const savedKeys = saved?.payload?.assets?.flatMap((asset) => asset?.keys || []) || [];
        document.body.dataset.bilibiliRichStage = "completed";
        return {
          badgeNameFavoriteAvailable: Boolean(favorite),
          badgeNameFavoriteRecovered: favoriteNames.some(
            (name) => name.includes("[生无可恋]")
          ),
          badgeNameDescriptionExcluded: !favoriteNames.some(
            (name) => name.includes("荣耀等级勋章")
          ),
          badgeNameNativeIdentityPreserved: savedKeys.includes(
            "native-panel:room_5236391_63397"
          ),
          favoriteNames
        };
      }
      const image = document.querySelector(".fixture-video-emote");
      const fullscreenMode = new URL(location.href).searchParams.get("fullscreen") === "1";
      const replyInput = document.querySelector(fullscreenMode
        ? ".bpx-player-dm-input"
        : "textarea.chat-input");
      if (replyInput) {
        const resetSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value"
        ).set;
        resetSetter.call(replyInput, "");
        replyInput.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          composed: true,
          data: "",
          inputType: "deleteContentBackward"
        }));
      }
      if (coldRoomEmojiMode) {
        image.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          composed: true,
          pointerType: "mouse"
        }));
        await delay(140);
        const coldPlusOne = document.querySelector(".bcp-one-button:not([hidden])");
        if (coldPlusOne) coldPlusOne.click();
        await delay(4_600);
        const coldToast = String(
          document.querySelector(".bcp-one-toast.is-visible")?.textContent || ""
        ).trim();
        document.body.dataset.bilibiliRichStage = "completed";
        return {
          coldRoomEmojiDispatched:
            document.body.dataset.bilibiliColdRoomEmojiDispatched === "true",
          coldRoomEmojiItemUnmounted: !document.querySelector(".fixture-emoji-item"),
          coldRoomEmojiNoConfirmationError:
            !coldToast.includes("图片 Emoji 发送未确认"),
          coldRoomEmojiSent:
            document.body.dataset.bilibiliEmojiSent === "anchor-wave",
          coldRoomEmojiToast: coldToast
        };
      }
      if (unrelatedEmojiMode) {
        image.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          composed: true,
          pointerType: "mouse"
        }));
        await delay(140);
        const plusOne = document.querySelector(".bcp-one-button:not([hidden])");
        plusOne?.click();
        await delay(5_000);
        const toast = String(
          document.querySelector(".bcp-one-toast.is-visible")?.textContent || ""
        ).trim();
        document.body.dataset.bilibiliRichStage = "completed";
        return {
          unrelatedEmojiInjected:
            document.body.dataset.bilibiliUnrelatedEmojiInjected === "true",
          unrelatedEmojiDidNotConfirmTarget:
            document.body.dataset.bilibiliEmojiSent === "official-wow"
            && !toast.includes("已发送"),
          unrelatedEmojiReportedUnconfirmed:
            /(?:图片 Emoji 发送未确认|image-emoji sending was not confirmed)/i.test(toast),
          unrelatedEmojiToast: toast
        };
      }
      image.dispatchEvent(new PointerEvent("pointerover", {
        bubbles: true,
        composed: true,
        pointerType: "mouse"
      }));
      await delay(80);
      const plusOne = document.querySelector(".bcp-one-button:not([hidden])");
      const selectedImageMessage = Boolean(plusOne
        && String(plusOne.getAttribute("aria-label") || "").includes("主播挥手"));
      const favoriteButton = document.querySelector(
        ".bcp-one-actions:not([hidden]) .bcp-one-action[data-action='favorite']"
      );
      if (favoriteButton) favoriteButton.click();
      await delay(100);
      const favoriteWarning = String(
        document.querySelector(".bcp-one-toast.is-visible")?.textContent || ""
      ).trim();
      document.dispatchEvent(new KeyboardEvent("keydown", {
        altKey: true, bubbles: true, code: "KeyQ", key: "q"
      }));
      await delay(40);
      document.dispatchEvent(new KeyboardEvent("keyup", {
        altKey: true, bubbles: true, code: "KeyQ", key: "q"
      }));
      await delay(100);
      const favoritesHost = document.querySelector(".bcp-favorites-host");
      const favoritesRoot = favoritesHost?.shadowRoot || document;
      const favoritesPanel = favoritesRoot.querySelector(".bcp-favorites-panel");
      const favoriteRichAssetsAccepted = Boolean(
        favoriteButton
          && favoritesPanel
          && Array.from(favoritesPanel.querySelectorAll(".bcp-favorites-text"))
            .some((item) => String(item.textContent || "").includes("主播挥手"))
      );
      document.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true, code: "Escape", key: "Escape"
      }));
      await delay(40);
      const replyButton = document.querySelector(
        ".bcp-one-actions:not([hidden]) .bcp-one-action[data-action='reply']"
      );
      const sentBeforeReply = document.body.dataset.bilibiliSent || "";
      if (replyButton) replyButton.click();
      await delay(120);
      const replyValue = replyInput && replyInput.value || "";
      const videoReplyInputFocused = document.activeElement === replyInput;
      const videoReplyDidNotSend =
        (document.body.dataset.bilibiliSent || "") === sentBeforeReply;
      if (replyInput) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value"
        ).set;
        setter.call(replyInput, "");
        replyInput.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          composed: true,
          data: "",
          inputType: "deleteContentBackward"
        }));
      }
      image.dispatchEvent(new PointerEvent("pointerover", {
        bubbles: true,
        composed: true,
        pointerType: "mouse"
      }));
      await delay(100);
      const plusOneAfterReply = document.querySelector(".bcp-one-button:not([hidden])");
      if (plusOneAfterReply) plusOneAfterReply.click();
      for (let attempt = 0; attempt < 30
          && !document.body.dataset.bilibiliEmojiSent; attempt += 1) {
        await delay(60);
      }
      const sentAsImage = document.body.dataset.bilibiliEmojiSent === "anchor-wave";
      document.body.dataset.bilibiliRichStage = "video-image-sent";
      const echoImage = document.querySelector(".fixture-rich-echo img[data-emoticon='anchor-wave']");
      const exerciseBilibiliEmoji = async (
        selector,
        expectedIdentity,
        nativeImage = true,
        waitBeforeClick = 760,
        favoriteFirst = true
      ) => {
        document.body.dataset.bilibiliRichStage = selector + ":preparing";
        // The fixture observes the platform echo before the extension has
        // necessarily finished feedback confirmation and selection cleanup.
        // Let the previous action settle before selecting the next barrage so
        // its finally block cannot clear the new hover target.
        await delay(2_600);
        delete document.body.dataset.bilibiliEmojiSent;
        delete document.body.dataset.bilibiliSent;
        const target = document.querySelector(selector);
        target?.dispatchEvent(new PointerEvent("pointerover", {
          bubbles: true,
          composed: true,
          pointerType: "mouse"
        }));
        document.body.dataset.bilibiliRichStage = selector + ":hovered";
        await delay(120);
        const actionRoot = document.querySelector(".bcp-one-actions:not([hidden])");
        const plus = actionRoot?.querySelector(".bcp-one-button");
        const favorite = actionRoot?.querySelector(
          ".bcp-one-action[data-action='favorite']"
        );
        if (favoriteFirst && favorite) {
          document.body.dataset.bilibiliRichStage = selector + ":favoriting";
          favorite.click();
          await delay(1_350);
        }
        await delay(waitBeforeClick);
        document.body.dataset.bilibiliRichStage = selector + ":clicking-plus-one";
        const toggleClicksBefore = Number(
          document.body.dataset.bilibiliEmojiToggleClicks || 0
        );
        const itemClicksBefore = Number(
          document.body.dataset.bilibiliEmojiItemClicks || 0
        );
        if (plus) plus.click();
        document.body.dataset.bilibiliRichStage = selector + ":plus-one-clicked";
        await delay(120);
        const immediateToast = String(
          document.querySelector(".bcp-one-toast")?.textContent || ""
        ).trim();
        const sentValue = () => nativeImage
          ? document.body.dataset.bilibiliEmojiSent
          : document.body.dataset.bilibiliSent;
        for (let attempt = 0; attempt < 45
            && sentValue() !== expectedIdentity; attempt += 1) {
          document.body.dataset.bilibiliRichStage = selector + ":waiting-" + attempt;
          await delay(80);
        }
        document.body.dataset.bilibiliRichStage = selector + ":finished";
        const editor = document.querySelector("textarea.chat-input");
        const finalToast = String(
          document.querySelector(".bcp-one-toast.is-visible")?.textContent || ""
        ).trim();
        return {
          favoriteAvailable: Boolean(favorite),
          label: String(plus?.getAttribute("aria-label") || ""),
          plusConnected: Boolean(plus?.isConnected),
          sent: sentValue() === expectedIdentity,
          immediateToast,
          itemClicksBefore,
          itemClicksAfter: Number(document.body.dataset.bilibiliEmojiItemClicks || 0),
          toggleClicksBefore,
          toggleClicksAfter: Number(document.body.dataset.bilibiliEmojiToggleClicks || 0),
          inputCleared: !String(editor?.value || "").trim(),
          textSent: String(document.body.dataset.bilibiliSent || ""),
          noConfirmationError: !finalToast.includes("图片 Emoji 发送未确认"),
          toast: finalToast
        };
      };
      const wowEmoji = await exerciseBilibiliEmoji(
        ".fixture-wow-emote",
        "[哇]",
        false,
        760,
        !emojiOnlyMode
      );
      document.body.dataset.bilibiliRichStage = "standard-emoji-sent";
      if (emojiOnlyMode) {
        document.body.dataset.bilibiliRichStage = "completed";
        return {
          emojiOnlyMode,
          standardEmojiNameExtracted: wowEmoji.label.includes("[哇]"),
          standardEmojiSent: wowEmoji.sent,
          standardEmojiUsedTextRecognition: wowEmoji.textSent === "[哇]",
          standardEmojiSkippedNativePanel:
            wowEmoji.toggleClicksAfter === wowEmoji.toggleClicksBefore
            && wowEmoji.itemClicksAfter === wowEmoji.itemClicksBefore,
          standardEmojiImmediateToast: wowEmoji.immediateToast,
          standardEmojiToast: wowEmoji.toast,
          standardEmojiToggleClicks: [wowEmoji.toggleClicksBefore, wowEmoji.toggleClicksAfter],
          standardEmojiItemClicks: [wowEmoji.itemClicksBefore, wowEmoji.itemClicksAfter]
        };
      }
      const cryEmoji = await exerciseBilibiliEmoji(
        ".fixture-cry-emote",
        "[大哭]",
        false,
        760,
        false
      );
      document.body.dataset.bilibiliRichStage = "cry-emoji-sent";
      const cuteEmoji = await exerciseBilibiliEmoji(
        ".fixture-cute-emote",
        "[卖萌]",
        false,
        760,
        false
      );
      document.body.dataset.bilibiliRichStage = "cute-emoji-sent";
      const mixedCryEmoji = await exerciseBilibiliEmoji(
        ".fixture-mixed-cry-emote",
        "加油啊[大哭][大哭]",
        false
      );
      document.body.dataset.bilibiliRichStage = "mixed-emoji-sent";
      const exclusiveEmoji = await exerciseBilibiliEmoji(
        ".fixture-exclusive-emote",
        "room-happy-42",
        true,
        760,
        false
      );
      document.body.dataset.bilibiliRichStage = "exclusive-emoji-sent";
      const exclusiveFavoriteSource = document.querySelector(
        ".fixture-exclusive-favorite-emote"
      );
      exclusiveFavoriteSource?.dispatchEvent(new PointerEvent("pointerover", {
        bubbles: true,
        composed: true,
        pointerType: "mouse"
      }));
      await delay(120);
      const exclusiveFavoriteSourceButton = document.querySelector(
        ".bcp-one-actions:not([hidden]) .bcp-one-action[data-action='favorite']"
      );
      exclusiveFavoriteSourceButton?.click();
      await delay(1_500);
      if (legacyExclusiveMode) {
        const stored = await chrome.storage.local.get("danmakuEchoFavoritesV1");
        const database = structuredClone(stored.danmakuEchoFavoritesV1);
        const favorite = database?.items?.find((item) =>
          String(item.text || "").includes("[主播表情9]")
        );
        const stripNativeIdentity = (asset) => {
          if (!asset || !Array.isArray(asset.keys)) return;
          asset.keys = asset.keys.filter((key) =>
            !String(key || "").startsWith("native-panel:")
            && !String(key || "").startsWith("bili-exclusive:")
          );
        };
        favorite?.payload?.assets?.forEach(stripNativeIdentity);
        favorite?.payload?.parts?.forEach((part) => stripNativeIdentity(part?.asset));
        if (database && favorite) {
          await chrome.storage.local.set({ danmakuEchoFavoritesV1: database });
          await delay(120);
        }
      }
      document.dispatchEvent(new KeyboardEvent("keydown", {
        altKey: true, bubbles: true, code: "KeyQ", key: "q"
      }));
      await delay(40);
      document.dispatchEvent(new KeyboardEvent("keyup", {
        altKey: true, bubbles: true, code: "KeyQ", key: "q"
      }));
      await delay(140);
      const namedFavoritesHost = document.querySelector(".bcp-favorites-host");
      const namedFavoritesRoot = namedFavoritesHost?.shadowRoot || document;
      const favoriteNames = Array.from(
        namedFavoritesRoot.querySelectorAll(".bcp-favorites-text")
      ).map((item) => String(item.textContent || "").trim());
      const exclusiveFavoriteText = Array.from(
        namedFavoritesRoot.querySelectorAll(".bcp-favorites-text")
      ).find((item) => String(item.textContent || "").includes("[主播表情9]"));
      const exclusiveFavoriteSend = exclusiveFavoriteText
        ?.closest("li")
        ?.querySelector(".bcp-favorites-send");
      delete document.body.dataset.bilibiliEmojiSent;
      delete document.body.dataset.bilibiliSent;
      const favoriteItemClicksBefore = Number(
        document.body.dataset.bilibiliEmojiItemClicks || 0
      );
      exclusiveFavoriteSend?.click();
      for (let attempt = 0; attempt < 50
          && document.body.dataset.bilibiliEmojiSent !== "room-happy-42"; attempt += 1) {
        await delay(80);
      }
      const exclusiveFavoriteSentAsImage =
        document.body.dataset.bilibiliEmojiSent === "room-happy-42";
      document.body.dataset.bilibiliRichStage = "exclusive-favorite-sent";
      const exclusiveFavoriteUsedNativePanel = Number(
        document.body.dataset.bilibiliEmojiItemClicks || 0
      ) > favoriteItemClicksBefore;
      const exclusiveFavoriteToast = String(
        document.querySelector(".bcp-one-toast.is-visible")?.textContent || ""
      ).trim();
      const feedbackToast = document.querySelector(".bcp-one-toast");
      let longToastFullyVisible = false;
      if (feedbackToast) {
        const toastProbe = feedbackToast.cloneNode(true);
        toastProbe.removeAttribute("id");
        toastProbe.textContent =
          "未找到官方表情“[会飞的猪]”，已取消发送。请确认当前直播间仍提供此主播专属表情";
        toastProbe.classList.add("is-visible");
        feedbackToast.parentElement?.appendChild(toastProbe);
        const toastStyle = getComputedStyle(toastProbe);
        longToastFullyVisible =
          toastProbe.scrollWidth <= toastProbe.clientWidth + 1
          && toastProbe.scrollHeight <= toastProbe.clientHeight + 1
          && toastProbe.getBoundingClientRect().height > 40
          && toastStyle.whiteSpace === "normal"
          && toastStyle.overflow !== "hidden";
        toastProbe.remove();
      }
      let longHoverLatency = 0;
      let longHoverLatencyBounded = true;
      let longHoverPositionStable = true;
      let longHoverUsesWholeRow = true;
      let syncProcessingP95 = 0;
      let actionVisibleP95 = 0;
      let actionVisibleMax = 0;
      let syncProcessingP95WithinBudget = true;
      let actionVisibleP95WithinBudget = true;
      let actionVisibleMaxWithinBudget = true;
      let stressDurationMs = 0;
      let stressDurationMet = true;
      let stressHoverCount = 0;
      let stressHoverCountMet = true;
      let stressNoDuplicateBorders = true;
      let stressSenderCorrect = true;
      const stressSenderFailures = [];
      if (longHoverMode) {
        document.dispatchEvent(new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 790,
          clientY: 440,
          pointerType: "mouse"
        }));
        await delay(240);
        const stressHost = document.createElement("div");
        stressHost.className = "fixture-long-hover-chat-stress";
        const fragment = document.createDocumentFragment();
        const stressMessages = [];
        for (let index = 0; index < 1_500; index += 1) {
          const row = document.createElement("div");
          row.className = "danmaku-item";
          const sender = document.createElement("span");
          sender.className = "user-name";
          sender.textContent = "长期用户" + index + "：";
          const content = document.createElement("span");
          content.className = "danmaku-content";
          content.textContent = "运行一段时间后的聊天记录" + index;
          // The production sender cache is deliberately bounded to the newest
          // chat rows. Hover those same recent rows so this fixture verifies
          // correlation under load without requiring an unbounded history scan.
          if (index >= 1_400) stressMessages.push({
            message: content.textContent,
            sender: "长期用户" + index
          });
          row.append(sender, content);
          fragment.appendChild(row);
        }
        stressHost.appendChild(fragment);
        document.querySelector("#chat-history-list")?.appendChild(stressHost);
        const churnContainer = document.querySelector(".bilibili-live-player-video-danmaku");
        const hoverRows = stressMessages.map((entry, index) => {
          const row = document.createElement("div");
          row.className = "bili-danmaku-x-dm fixture-stress-hover-row";
          Object.assign(row.style, {
            left: (180 + index % 7) + "px",
            position: "absolute",
            top: (90 + index % 5) + "px"
          });
          const content = document.createElement("span");
          content.className = "bili-danmaku-x-dm-content";
          content.textContent = entry.message;
          row.appendChild(content);
          churnContainer?.appendChild(row);
          return { ...entry, content, row };
        });
        await delay(180);
        const churnTimer = setInterval(() => {
          const transientRow = document.createElement("div");
          transientRow.className = "bili-danmaku-x-dm";
          transientRow.innerHTML = '<span class="bili-danmaku-x-dm-content">高频播放器弹幕</span>';
          churnContainer?.appendChild(transientRow);
          transientRow.remove();
        }, 8);
        const syncLatencies = [];
        const visibleLatencies = [];
        const stressStartedAt = performance.now();
        for (let index = 0; index < hoverRows.length; index += 1) {
          const target = hoverRows[index];
          target.row.style.padding = "4px 9px";
          const beforeRect = target.row.getBoundingClientRect();
          const contentRect = target.content.getBoundingClientRect();
          const startedAt = performance.now();
          target.content.dispatchEvent(new PointerEvent("pointerover", {
            bubbles: true,
            composed: true,
            clientX: beforeRect.left + beforeRect.width / 2,
            clientY: beforeRect.top + beforeRect.height / 2,
            pointerType: "mouse"
          }));
          syncLatencies.push(performance.now() - startedAt);
          let actionBound = false;
          do {
            const plus = document.querySelector(".bcp-one-action[data-action='plus-one']:not([hidden])");
            actionBound = Boolean(plus
              && String(plus.getAttribute("title") || plus.getAttribute("aria-label") || "")
                .includes(target.message));
            if (!actionBound) await new Promise((resolve) => requestAnimationFrame(resolve));
          } while (!actionBound && performance.now() - startedAt < 150);
          visibleLatencies.push(performance.now() - startedAt);
          const frozen = document.querySelector(".bcp-one-frozen");
          const frozenRect = frozen?.getBoundingClientRect();
          longHoverPositionStable = longHoverPositionStable && Boolean(frozenRect
            && Math.abs(frozenRect.left - beforeRect.left) < 4
            && Math.abs(frozenRect.top - beforeRect.top) < 4);
          longHoverUsesWholeRow = longHoverUsesWholeRow && Boolean(frozenRect
            && Math.abs(frozenRect.width - beforeRect.width) < 3
            && frozenRect.width >= contentRect.width + 12);
          stressNoDuplicateBorders = stressNoDuplicateBorders
            && document.querySelectorAll(".bcp-one-frozen").length === 1;
          const reply = document.querySelector(".bcp-one-action[data-action='reply']:not([hidden])");
          const replyLabel = String(
            reply?.getAttribute("title") || reply?.getAttribute("aria-label") || ""
          );
          const senderMatched = replyLabel.includes(target.sender);
          stressSenderCorrect = stressSenderCorrect && senderMatched;
          if (!senderMatched && stressSenderFailures.length < 10) {
            stressSenderFailures.push({
              index,
              expected: target.sender,
              message: target.message,
              replyLabel
            });
          }
          stressHoverCount += 1;
          document.dispatchEvent(new PointerEvent("pointermove", {
            bubbles: true,
            clientX: 790,
            clientY: 440,
            pointerType: "mouse"
          }));
          const targetElapsed = (index + 1) * 300;
          const remaining = targetElapsed - (performance.now() - stressStartedAt);
          if (remaining > 0) await delay(remaining);
        }
        stressDurationMs = performance.now() - stressStartedAt;
        clearInterval(churnTimer);
        const percentile95 = (values) => {
          const sorted = [...values].sort((first, second) => first - second);
          return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0;
        };
        syncProcessingP95 = percentile95(syncLatencies);
        actionVisibleP95 = percentile95(visibleLatencies);
        actionVisibleMax = Math.max(0, ...visibleLatencies);
        longHoverLatency = syncProcessingP95;
        syncProcessingP95WithinBudget = syncProcessingP95 <= 16;
        actionVisibleP95WithinBudget = actionVisibleP95 <= 50;
        actionVisibleMaxWithinBudget = actionVisibleMax <= 150;
        longHoverLatencyBounded = syncProcessingP95WithinBudget
          && actionVisibleP95WithinBudget && actionVisibleMaxWithinBudget;
        stressDurationMet = stressDurationMs >= 29_500;
        stressHoverCountMet = stressHoverCount === 100;
        hoverRows.forEach(({ row }) => row.remove());
        stressHost.remove();
      }
      document.body.dataset.bilibiliRichStage = "completed";
      return {
        legacyExclusiveMode,
        lazyEmojiMode,
        nameOnlyPanelMode,
        longHoverMode,
        longHoverLatency,
        longHoverLatencyBounded,
        longHoverPositionStable,
        longHoverUsesWholeRow,
        syncProcessingP95,
        actionVisibleP95,
        actionVisibleMax,
        syncProcessingP95WithinBudget,
        actionVisibleP95WithinBudget,
        actionVisibleMaxWithinBudget,
        stressDurationMs,
        stressDurationMet,
        stressHoverCount,
        stressHoverCountMet,
        stressNoDuplicateBorders,
        stressSenderCorrect,
        stressSenderFailures,
        videoImageSelected: Boolean(image && image.closest(".bilibili-live-player-video-danmaku")),
        selectedImageMessage,
        favoriteButtonAvailable: Boolean(favoriteButton),
        favoriteRichAssetsAccepted,
        favoriteWarning,
        sentAsImage,
        echoImageRendered: Boolean(echoImage),
        sentInputText: replyInput && replyInput.value || "",
        videoReplyButtonAvailable: Boolean(replyButton),
        videoReplyPrefilled: replyValue === "@主播 ",
        videoReplyInputFocused,
        videoReplyDidNotSend,
        videoReplySurface: replyInput && replyInput.dataset.fixtureReplySurface || "",
        videoReplySurfaceCorrect: Boolean(replyInput
          && replyInput.dataset.fixtureReplySurface === (fullscreenMode ? "quick" : "side")),
        standardEmojiNameExtracted: wowEmoji.label.includes("[哇]"),
        standardEmojiLabel: wowEmoji.label,
        standardEmojiPlusConnected: wowEmoji.plusConnected,
        standardEmojiToast: wowEmoji.toast,
        standardEmojiImmediateToast: wowEmoji.immediateToast,
        standardEmojiToggleClicks: [
          wowEmoji.toggleClicksBefore,
          wowEmoji.toggleClicksAfter
        ],
        standardEmojiItemClicks: [
          wowEmoji.itemClicksBefore,
          wowEmoji.itemClicksAfter
        ],
        standardEmojiFavoriteAvailable: wowEmoji.favoriteAvailable,
        standardEmojiSent: wowEmoji.sent,
        standardEmojiUsedTextRecognition: wowEmoji.textSent === "[哇]",
        standardEmojiSkippedNativePanel:
          wowEmoji.toggleClicksAfter === wowEmoji.toggleClicksBefore
          && wowEmoji.itemClicksAfter === wowEmoji.itemClicksBefore,
        standardEmojiFavoriteNamed: favoriteNames.some((name) => name.includes("[哇]")),
        singleCryEmojiSent: cryEmoji.sent,
        duplicateLabelEmojiSentAsText: cuteEmoji.sent && cuteEmoji.textSent === "[卖萌]",
        mixedCryEmojiSentInOrder: mixedCryEmoji.sent,
        exclusiveEmojiFavoriteAvailable: exclusiveEmoji.favoriteAvailable,
        exclusiveEmojiLabel: exclusiveEmoji.label,
        exclusiveEmojiPlusConnected: exclusiveEmoji.plusConnected,
        exclusiveEmojiToast: exclusiveEmoji.toast,
        exclusiveEmojiImmediateToast: exclusiveEmoji.immediateToast,
        exclusiveEmojiToggleClicks: [
          exclusiveEmoji.toggleClicksBefore,
          exclusiveEmoji.toggleClicksAfter
        ],
        exclusiveEmojiItemClicks: [
          exclusiveEmoji.itemClicksBefore,
          exclusiveEmoji.itemClicksAfter
        ],
        exclusiveEmojiSent: exclusiveEmoji.sent,
        exclusiveEmojiInputCleared: exclusiveEmoji.inputCleared,
        exclusiveEmojiNoConfirmationError: exclusiveEmoji.noConfirmationError,
        exclusiveEmojiNoAssetLookupError:
          !exclusiveEmoji.immediateToast.includes("未在哔哩哔哩直播表情面板中找到对应 Emoji")
          && !exclusiveEmoji.toast.includes("未在哔哩哔哩直播表情面板中找到对应 Emoji"),
        exclusiveEmojiFavoriteNamed: favoriteNames.some(
          (name) => name.includes("[主播表情9]")
        ),
        exclusiveFavoriteNameResolved:
          favoriteNames.some((name) => name.includes("[主播表情9]"))
          && !favoriteNames.some((name) => name === "图片表情"),
        exclusiveFavoriteSourceFavoriteAvailable: Boolean(exclusiveFavoriteSourceButton),
        exclusiveFavoriteSendAvailable: Boolean(exclusiveFavoriteSend),
        exclusiveFavoriteSentAsImage,
        exclusiveFavoriteUsedNativePanel,
        exclusiveFavoriteUsedExpectedPath: exclusiveFavoriteUsedNativePanel,
        exclusiveFavoriteSubmittedNativeIdentity:
          document.body.dataset.bilibiliSubmittedMsg === "room-happy-42",
        exclusiveFavoriteSubmittedDmType:
          document.body.dataset.bilibiliSubmittedDmType === "1",
        exclusiveFavoriteSubmittedEmoticonOptions:
          document.body.dataset.bilibiliSubmittedEmoticonOptions === "[object Object]",
        exclusiveFavoriteDidNotSubmitLiteralName:
          document.body.dataset.bilibiliSubmittedMsg !== "[主播表情9]",
        exclusiveFavoriteNoAssetLookupError:
          !exclusiveFavoriteToast.includes("未在哔哩哔哩直播表情面板中找到对应 Emoji")
          && !exclusiveFavoriteToast.includes("未找到官方表情"),
        longToastFullyVisible,
        favoriteNames,
        emojiToggleClicks: Number(document.body.dataset.bilibiliEmojiToggleClicks || 0),
        emojiItemClicks: Number(document.body.dataset.bilibiliEmojiItemClicks || 0)
      };
    })()`)
    let bilibiliWatchdog = null
    const bilibiliWatchdogTimeout = targetParameters.get('hoverperf') === '1' ? 130_000 : 75_000
    const bilibiliTimeout = new Promise((resolve) => {
      bilibiliWatchdog = setTimeout(
        () =>
          resolve(
            evaluateValue(`({
          fixtureTimeout: true,
          stage: document.body.dataset.bilibiliRichStage || "unknown"
        })`),
          ),
        bilibiliWatchdogTimeout,
      )
    })
    try {
      bilibiliRichRegression = await Promise.race([bilibiliRichEvaluation, bilibiliTimeout])
    } finally {
      clearTimeout(bilibiliWatchdog)
    }
    const bilibiliAssertionKeys =
      targetParameters.get('badgenameemoji') === '1'
        ? [
            'badgeNameFavoriteAvailable',
            'badgeNameFavoriteRecovered',
            'badgeNameDescriptionExcluded',
            'badgeNameNativeIdentityPreserved',
          ]
        : targetParameters.get('coldroomemoji') === '1'
        ? [
            'coldRoomEmojiDispatched',
            'coldRoomEmojiItemUnmounted',
            'coldRoomEmojiNoConfirmationError',
            'coldRoomEmojiSent',
          ]
        : targetParameters.get('unrelatedemoji') === '1'
          ? [
              'unrelatedEmojiInjected',
              'unrelatedEmojiDidNotConfirmTarget',
              'unrelatedEmojiReportedUnconfirmed',
            ]
          : targetParameters.get('emojionly') === '1'
            ? [
                'standardEmojiNameExtracted',
                'standardEmojiSent',
                'standardEmojiUsedTextRecognition',
                'standardEmojiSkippedNativePanel',
              ]
            : targetParameters.get('hoverperf') === '1'
              ? [
                  'longHoverLatencyBounded',
                  'longHoverPositionStable',
                  'longHoverUsesWholeRow',
                  'syncProcessingP95WithinBudget',
                  'actionVisibleP95WithinBudget',
                  'actionVisibleMaxWithinBudget',
                  'stressDurationMet',
                  'stressHoverCountMet',
                  'stressNoDuplicateBorders',
                  'stressSenderCorrect',
                ]
              : [
                  'videoImageSelected',
                  'selectedImageMessage',
                  'favoriteButtonAvailable',
                  'favoriteRichAssetsAccepted',
                  'sentAsImage',
                  'echoImageRendered',
                  'videoReplyButtonAvailable',
                  'videoReplyPrefilled',
                  'videoReplyInputFocused',
                  'videoReplyDidNotSend',
                  'videoReplySurfaceCorrect',
                  'standardEmojiNameExtracted',
                  'standardEmojiFavoriteAvailable',
                  'standardEmojiSent',
                  'standardEmojiUsedTextRecognition',
                  'standardEmojiSkippedNativePanel',
                  'standardEmojiFavoriteNamed',
                  'singleCryEmojiSent',
                  'duplicateLabelEmojiSentAsText',
                  'mixedCryEmojiSentInOrder',
                  'exclusiveEmojiFavoriteAvailable',
                  'exclusiveEmojiSent',
                  'exclusiveEmojiInputCleared',
                  'exclusiveEmojiNoConfirmationError',
                  'exclusiveEmojiNoAssetLookupError',
                  'exclusiveEmojiFavoriteNamed',
                  'exclusiveFavoriteNameResolved',
                  'exclusiveFavoriteSourceFavoriteAvailable',
                  'exclusiveFavoriteSendAvailable',
                  'exclusiveFavoriteSentAsImage',
                  'exclusiveFavoriteUsedExpectedPath',
                  'exclusiveFavoriteSubmittedNativeIdentity',
                  'exclusiveFavoriteSubmittedDmType',
                  'exclusiveFavoriteSubmittedEmoticonOptions',
                  'exclusiveFavoriteDidNotSubmitLiteralName',
                  'exclusiveFavoriteNoAssetLookupError',
                  'longHoverLatencyBounded',
                  'longHoverPositionStable',
                  'longHoverUsesWholeRow',
                ]
    const bilibiliFullscreen = targetParameters.get('fullscreen') === '1'
    bilibiliRichRegression.assertionFailures = bilibiliAssertionKeys
      .filter(
        (key) =>
          !(
            bilibiliFullscreen &&
            (key === 'videoReplyPrefilled' || key === 'videoReplyInputFocused')
          ),
      )
      .filter((key) => bilibiliRichRegression[key] !== true)
  }

  const expression = String.raw`(() => {
    const all = Array.from(document.querySelectorAll("*"));
    const describe = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        className: typeof element.className === "string" ? element.className : "",
        text: String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
        dataE2e: element.getAttribute("data-e2e") || "",
        dataTestid: element.getAttribute("data-testid") || "",
        role: element.getAttribute("role") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        placeholder: element.getAttribute("placeholder") || element.getAttribute("data-placeholder") || "",
        contenteditable: element.getAttribute("contenteditable") || "",
        childCount: element.childElementCount,
        rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
        style: [style.position, style.pointerEvents, style.animationName, style.transform].join(" | "),
        parentClass: element.parentElement && typeof element.parentElement.className === "string"
          ? element.parentElement.className
          : ""
      };
    };
    const semantic = all.filter((element) => {
      const marker = [element.id, element.className, element.getAttribute("data-e2e"), element.getAttribute("data-testid"), element.getAttribute("aria-label")].join(" ");
      return /(danmaku|danmu|bullet|barrage|chat|comment|message|弹幕|聊天)/i.test(marker);
    }).slice(0, 300).map(describe);
    const inputs = all.filter((element) => element.matches("textarea, input, button, [contenteditable='true'], [role='textbox']"))
      .slice(0, 200).map(describe);
    const movingText = all.filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const text = String(element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
      return text.length > 0 && text.length <= 100
        && rect.width >= 4 && rect.width <= 900 && rect.height >= 8 && rect.height <= 120
        && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
        && (style.position === "absolute" || style.position === "fixed" || style.transform !== "none" || style.animationName !== "none");
    }).slice(0, 400).map(describe);
    const canvasLike = all.filter((element) => {
      const marker = [element.tagName, element.id, element.className].join(" ");
      return element.tagName === "CANVAS" || /(canvas|danmaku)/i.test(marker);
    }).slice(0, 100).map((element) => {
      const item = describe(element);
      const before = getComputedStyle(element, "::before");
      const after = getComputedStyle(element, "::after");
      item.shadowRoot = Boolean(element.shadowRoot);
      item.backgroundImage = getComputedStyle(element).backgroundImage.slice(0, 200);
      item.pseudo = [before.content, before.backgroundImage, after.content, after.backgroundImage]
        .join(" | ").slice(0, 400);
      return item;
    });
    const captured = Array.from(document.querySelectorAll(
      ".bcp-douyin-dom-layer,.bcp-douyin-dom-track,.bcp-douyin-dom-barrage,.bcp-douyin-dom-action"
    ))
      .slice(0, 100).map(describe);
    const resources = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => /\.(?:js|mjs)(?:\?|$)/i.test(url) && /(live|webcast|player|danmaku|room)/i.test(url))
      .slice(-200);
    const readDebugMarker = (id) => {
      const marker = document.getElementById(id);
      if (!marker) return null;
      try {
        const parsed = JSON.parse(marker.textContent || "{}");
        return {
          version: parsed.version || marker.dataset.version || "",
          pageReady: parsed.pageReady,
          pageVersion: parsed.pageVersion,
          instanceCount: parsed.instanceCount,
          orphanCount: parsed.orphanCount,
          counters: parsed.counters || null,
          lastCard: parsed.lastCard || null,
          lastError: parsed.lastError || "",
          instances: Array.isArray(parsed.instances) ? parsed.instances.slice(0, 5) : [],
          attempts: Array.isArray(parsed.attempts) ? parsed.attempts.slice(-5) : [],
          events: Array.isArray(parsed.events) ? parsed.events.slice(-12) : []
        };
      } catch (error) {
        return { parseError: String(error) };
      }
    };
    return {
      url: location.href,
      title: document.title,
      bodyText: String(document.body && document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1000),
      viewport: [innerWidth, innerHeight],
      bodyDataset: Object.assign({}, document.body && document.body.dataset),
      liveLinks: Array.from(document.querySelectorAll("a[href*='live.douyin.com/']"))
        .map((anchor) => anchor.href)
        .filter((href, index, values) => values.indexOf(href) === index)
        .slice(0, 50),
      semantic,
      inputs,
      movingText,
      canvasLike,
      captured,
      extensionButtonCount: document.querySelectorAll(
        ".bcp-one-button,.bcp-douyin-button,.bcp-douyin-dom-action"
      ).length,
      activeElement: document.activeElement ? {
        tag: document.activeElement.tagName,
        className: typeof document.activeElement.className === "string" ? document.activeElement.className : "",
        placeholder: document.activeElement.getAttribute("placeholder") || ""
      } : null,
      mainHookInstalled: Boolean(globalThis.__bulletPlusOneDouyinCanvasHook),
      debug: {
        bootstrap: readDebugMarker("bcp-douyin-bootstrap-debug"),
        page: readDebugMarker("bcp-douyin-page-debug"),
        content: readDebugMarker("bcp-douyin-content-debug")
      },
      resources
    };
  })()`

  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  const value = result.result.value
  value.douyinProbe = douyinProbe
  value.douyinDomRegression = douyinDomRegression
  value.douyinRichRegression = douyinRichRegression
  value.nativeEmojiRegression = nativeEmojiRegression
  value.sideChatRegression = sideChatRegression
  value.bilibiliRichRegression = bilibiliRichRegression
  if (hasDouyinFixture && douyinDomRegression) {
    const failures = []
    ;[
      'ready',
      'layerClipsToCanvas',
      'hoverUsesTransparentThemeFrame',
      'targetPaused',
      'otherContinued',
      'sizeStable',
      'actionVisible',
      'actionFullyRendered',
      'threeActionUi',
      'copyActionAvailable',
      'actionBehindMessage',
      'trackOwnsHover',
      'actionGapReserved',
      'trailingHoverReserved',
      'gapHoverKeptPaused',
      'trailingHoverKeptPaused',
      'messagePaddingExpanded',
      'messagePaddingUniform',
      'favoriteButtonAvailable',
      'favoriteRichAssetsRejected',
      'favoriteSavedAndListed',
      'favoriteUiSingleton',
      'favoriteCurrentRoomFocused',
      'replyButtonAvailable',
      'replyPrefilled',
      'replyInputFocused',
      'replyDidNotSend',
      'replyErrorAbsent',
      'replySurfaceCorrect',
      'singleSuccessFeedback',
      'clickSentMatchingMessage',
      'ownMessageFramed',
      'noReleaseSpring',
      'resumedFromHeldPositionAtNormalSpeed',
      'workerStopWasNotSent',
      'canvasRestoredAfterDisable',
      'layerInactiveAfterDisable',
      'rightChatPlusOneAbsent',
    ].forEach((key) => {
      if (douyinDomRegression[key] !== true) failures.push(key)
    })
    if (lateDouyinHook) {
      ;[
        'lateCanvasVisibleBeforeClean',
        'lateLayerInactiveBeforeClean',
        'lateCleanBoundarySent',
      ].forEach((key) => {
        if (douyinDomRegression[key] !== 'true') failures.push(key)
      })
    }
    if (
      douyinDomRegression.beforeHover &&
      douyinDomRegression.beforeHover.unsupportedMode &&
      douyinDomRegression.unsupportedStayedActive !== true
    ) {
      failures.push('unsupported-stayed-active')
    }
    douyinDomRegression.assertionFailures = failures
  }
  value.consoleEvents = consoleEvents
  value.executionContexts = executionContexts
  value.extensionProbe = extensionProbe
  value.browserStderr = browserStderr.slice(-8_000)
  value.browserTargets = browserTargets
  if (artifactDirectory) {
    mkdirSync(artifactDirectory, { recursive: true })
    const screenshot = await send('Page.captureScreenshot', {
      captureBeyondViewport: false,
      format: 'png',
    })
    writeFileSync(
      path.join(artifactDirectory, `${scenarioName}.png`),
      Buffer.from(screenshot.data, 'base64'),
    )
  }
  socket?.close()
  return value
}

inspect()
  .then((result) => {
    const output = compactOutput
      ? {
          bilibiliRichRegression: result.bilibiliRichRegression,
          browserStderr: result.browserStderr,
          browserTargets: result.browserTargets,
          consoleEvents: result.consoleEvents,
          executionContexts: result.executionContexts,
          extensionProbe: result.extensionProbe,
          douyinDomRegression: result.douyinDomRegression,
          douyinRichRegression: result.douyinRichRegression,
          nativeEmojiRegression: result.nativeEmojiRegression,
          sideChatRegression: result.sideChatRegression,
        }
      : result
    if (artifactDirectory) {
      mkdirSync(artifactDirectory, { recursive: true })
      writeFileSync(
        path.join(artifactDirectory, `${scenarioName}.json`),
        `${JSON.stringify(output, null, 2)}\n`,
        'utf8',
      )
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    if (
      result.douyinDomRegression &&
      result.douyinDomRegression.assertionFailures &&
      result.douyinDomRegression.assertionFailures.length
    ) {
      process.exitCode = 1
    }
    if (
      result.sideChatRegression &&
      result.sideChatRegression.assertionFailures &&
      result.sideChatRegression.assertionFailures.length
    ) {
      process.exitCode = 1
    }
    if (
      result.bilibiliRichRegression &&
      result.bilibiliRichRegression.assertionFailures &&
      result.bilibiliRichRegression.assertionFailures.length
    ) {
      process.exitCode = 1
    }
    if (
      result.douyinRichRegression &&
      result.douyinRichRegression.assertionFailures &&
      result.douyinRichRegression.assertionFailures.length
    ) {
      process.exitCode = 1
    }
  })
  .catch((error) => {
    const failure = {
      browserExitCode: browser.exitCode,
      browserSignal: browser.signalCode,
      browserStderr: browserStderr.slice(-8_000),
      scenario: scenarioName,
      startupError: String(error instanceof Error ? error.message : error).slice(0, 1_000),
    }
    if (artifactDirectory) {
      mkdirSync(artifactDirectory, { recursive: true })
      writeFileSync(
        path.join(artifactDirectory, `${scenarioName}-startup.json`),
        `${JSON.stringify(failure, null, 2)}\n`,
        'utf8',
      )
    }
    process.stderr.write(`${JSON.stringify(failure)}\n`)
    process.exitCode = 2
  })
  .finally(stopBrowser)
