'use strict';

const { writeFileSync } = require('node:fs');
const path = require('node:path');

// Open the browser action itself: navigating a tab to index.html cannot catch
// a popup whose content-based sizing collapses around viewport-relative CSS.
module.exports = async function settingsPopup({ send, evaluate, pageTargetId, extensionId, artifactDirectory, scenarioName }) {
  const { windowId, bounds } = await send('Browser.getWindowForTarget', { targetId: pageTargetId });
  const attempts = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const compact = attempt === 1;
    await send('Browser.setWindowBounds', { windowId, bounds: { width: compact ? 700 : 1280, height: compact ? 600 : 900 } });
    const beforeOpen = await send('Target.getTargets');
    const existingTargets = new Set(beforeOpen.targetInfos.map(target => target.targetId));
    await evaluate(`(async () => { await chrome.action.openPopup(); return true; })()`);
    try {
      const layout = await evaluate(`(async () => {
        let popup;
        for (let attempt = 0; attempt < 100; attempt++) {
          popup = chrome.extension.getViews({ type: 'popup' })[0];
          if (popup?.document.querySelector('.settings-section')) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!popup?.document.querySelector('.settings-section')) return { ready: false };
        await new Promise(resolve => popup.requestAnimationFrame(() => popup.requestAnimationFrame(resolve)));
        const doc = popup.document;
        const shell = doc.querySelector('.app-shell').getBoundingClientRect();
        const topbar = doc.querySelector('.topbar').getBoundingClientRect();
        const content = doc.querySelector('.content-canvas');
        const box = content.getBoundingClientRect();
        content.scrollTop = content.scrollHeight;
        const scrollable = content.scrollTop > 0
          && Math.abs(content.scrollHeight - content.scrollTop - content.clientHeight) <= 1;
        content.scrollTop = 0;
        return { ready: true, width: popup.innerWidth, height: popup.innerHeight,
          shellHeight: shell.height, contentHeight: box.height, scrollable,
          noOuterScrollbars: doc.documentElement.clientWidth === popup.innerWidth
            && doc.documentElement.clientHeight === popup.innerHeight,
          pageFits: shell.left >= 0 && shell.right <= popup.innerWidth + 1
            && content.scrollWidth <= content.clientWidth + 1,
          shellFits: shell.top >= 0 && shell.bottom <= popup.innerHeight + 1,
          topbarFits: topbar.top >= 0 && topbar.bottom <= popup.innerHeight && topbar.right <= popup.innerWidth + 1,
          heading: doc.querySelector('.topbar h1')?.textContent,
          tabUnaffected: !document.documentElement.hasAttribute('data-extension-popup') };
      })()`);
      attempts.push({ ...layout, compact });
      const { targetInfos } = await send('Target.getTargets');
      const target = targetInfos.find(target => !existingTargets.has(target.targetId)
        && target.url === `chrome-extension://${extensionId}/index.html`);
      if (target) {
        const { sessionId } = await send('Target.attachToTarget', { flatten: true, targetId: target.targetId });
        try {
          const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
          writeFileSync(path.join(artifactDirectory, `${scenarioName}-popup-${attempt + 1}.png`), Buffer.from(screenshot.data, 'base64'));
        } finally { await send('Target.detachFromTarget', { sessionId }); }
      }
    } finally {
      await evaluate(`(() => { chrome.extension.getViews({ type: 'popup' }).forEach(popup => popup.close()); return true; })()`);
    }
  }
  await send('Browser.setWindowBounds', { windowId, bounds: { width: bounds.width, height: bounds.height } });
  return { attempts, passed: attempts.every(layout => layout.ready
    && layout.width >= (layout.compact ? 320 : 700)
    && layout.height >= 400 && layout.contentHeight >= (layout.compact ? 180 : 350) && layout.scrollable
    && layout.noOuterScrollbars && layout.pageFits && layout.shellFits && layout.topbarFits && layout.tabUnaffected) };
};
