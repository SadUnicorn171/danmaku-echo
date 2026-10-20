'use strict';

// Two real extension documents share Chrome Storage and the background writer.
module.exports = async function statisticsMultiPage({ send, evaluate, sessionId, extensionId }) {
  await evaluate(`(async () => {
    const date = '2026-01-01';
    await chrome.storage.local.set({
      danmakuEchoSendStatisticsIndexV1: { schemaVersion: 1, days: [date] },
      ['danmakuEchoSendStatisticsDayV1:' + date]: { schemaVersion: 1, date,
        events: Array.from({ length: 61 }, (_, i) => ({ id: 'multi-page-event-' + i,
          platform: 'huya', roomId: 'fixture', sentAtSec: Date.parse(date) / 1000 + i, text: 'row:' + i + ':' })) },
    });
    document.querySelector('.send-statistics-heading button').click();
    return true;
  })()`);
  async function waitFor(expression, target = sessionId) {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if (await evaluate(`Boolean(${expression})`, target)) return true; }
      catch (error) {
        // The newly opened document can replace about:blank between CDP calls.
        if (!/Execution context was destroyed|Cannot find context/.test(String(error))) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return false;
  }
  const ready = await waitFor(`document.querySelector('.send-statistics-summary b')?.textContent === '61'`);
  await evaluate(`(() => { document.querySelectorAll('.send-statistics-pagination button')[1].click(); return true; })()`);
  const secondPage = await waitFor(`document.querySelectorAll('.send-statistics-text').length === 11`);
  const target = await send('Target.createTarget', { url: 'chrome-extension://' + extensionId + '/index.html' });
  try {
    const attached = await send('Target.attachToTarget', { flatten: true, targetId: target.targetId });
    const writerReady = await waitFor(`document.querySelector('.send-statistics-summary b')?.textContent === '61'`, attached.sessionId);
    if (!writerReady) return { passed: false, ready, secondPage, writerReady };
    await evaluate(`(() => {
      const input = document.querySelectorAll('.send-statistics-filters input[type="search"]')[1];
      input.value = 'row:0:';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.send-statistics-filters').requestSubmit();
      return true;
    })()`, attached.sessionId);
    const filterApplied = await waitFor(`document.querySelectorAll('.send-statistics-text').length === 1`, attached.sessionId);
    await evaluate(`(() => {
      window.confirm = () => true;
      document.querySelectorAll('.send-statistics-heading button')[2].click();
      return true;
    })()`, attached.sessionId);
    const writerCleared = await waitFor(`document.querySelector('.send-statistics-summary b')?.textContent === '60'`, attached.sessionId);
    const readerReloaded = await waitFor(`document.querySelector('.send-statistics-summary b')?.textContent === '60'
      && document.querySelectorAll('.send-statistics-text').length === 50
      && document.querySelector('.send-statistics-text')?.textContent === 'row:60:'
      && document.querySelector('.send-statistics-pagination button')?.disabled === true`);
    const notice = await evaluate(`document.body.textContent.includes('记录已变化，已重新加载') || document.body.textContent.includes('Records changed')`);
    await evaluate(`(async () => { await chrome.runtime.sendMessage({ type: 'danmaku-echo.send-statistics', action: 'clear' }); return true; })()`);
    return { passed: ready && secondPage && filterApplied && writerCleared && readerReloaded && notice,
      ready, secondPage, filterApplied, writerCleared, readerReloaded, notice };
  } finally { await send('Target.closeTarget', { targetId: target.targetId }); }
};
