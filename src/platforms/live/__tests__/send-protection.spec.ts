import { describe, expect, it, vi } from 'vitest'
import {
  classifyPlatformSendFeedback,
  classifyPlatformSendResponse,
  createPlatformFeedbackProbe,
  createSendProtection,
  formatPlatformSendFeedback,
} from '../send-protection'

describe('send protection', () => {
  it('classifies duplicate and rate-limit feedback while preserving platform text', () => {
    expect(classifyPlatformSendFeedback('请勿重复发送相同内容')).toMatchObject({
      kind: 'duplicate',
      message: '请勿重复发送相同内容',
      cooldownMs: 8_000,
    })
    expect(classifyPlatformSendFeedback('操作频繁，请 6 秒后再试')).toMatchObject({
      kind: 'rate-limit',
      cooldownMs: 6_000,
    })
    expect(classifyPlatformSendFeedback('弹幕发送过于频繁，请稍后再试')).toMatchObject({
      kind: 'rate-limit',
      cooldownMs: 15_000,
    })
    expect(classifyPlatformSendFeedback('您的手速太快啦，请休息一下吧')).toMatchObject({
      kind: 'rate-limit',
      cooldownMs: 15_000,
    })
    expect(classifyPlatformSendFeedback('发送失败：当前账号已被禁言')).toMatchObject({
      kind: 'rejected',
      cooldownMs: 0,
    })
    expect(classifyPlatformSendFeedback('主播今天发送了礼物')).toBeNull()
  })

  it('observes the native Douyu and Huya feedback containers beside their chat editors', async () => {
    const douyuProbe = createPlatformFeedbackProbe(document)
    const douyuTips = document.createElement('div')
    douyuTips.className = 'danmuTips-1ee820'
    douyuTips.innerHTML = '<label class="tipsMsg-9d58b1">弹幕发送过于频繁，请稍后再试</label>'
    document.body.append(douyuTips)
    await expect(douyuProbe.wait(10)).resolves.toMatchObject({ kind: 'rate-limit' })

    document.body.replaceChildren()
    const huyaProbe = createPlatformFeedbackProbe(document)
    const huyaChatFooter = document.createElement('div')
    huyaChatFooter.className = 'chat-room__ft__chat'
    huyaChatFooter.innerHTML = [
      '<div class="chatNotice" id="pubNoticMe">',
      '<p>发言太快，请 3 秒后再试</p><a class="closeBtn">×</a>',
      '</div>',
    ].join('')
    document.body.append(huyaChatFooter)
    await expect(huyaProbe.wait(10)).resolves.toMatchObject({
      kind: 'rate-limit',
      cooldownMs: 3_000,
    })
    document.body.replaceChildren()
  })

  it('classifies and formats sanitized native response metadata', () => {
    const feedback = classifyPlatformSendResponse({
      code: 10031,
      endpoint: 'https://api.live.bilibili.com/msg/send?w_rid=secret&csrf=secret',
      httpStatus: 200,
      message: '弹幕发送过于频繁，请 6 秒后再试',
      method: 'post',
      transport: 'fetch',
    })

    expect(feedback).toMatchObject({
      code: 10031,
      cooldownMs: 6_000,
      endpoint: 'api.live.bilibili.com/msg/send',
      httpStatus: 200,
      kind: 'rate-limit',
      method: 'POST',
      source: 'network',
    })
    expect(formatPlatformSendFeedback(feedback!)).toBe(
      '弹幕发送过于频繁，请 6 秒后再试（POST api.live.bilibili.com/msg/send · HTTP 200 · code 10031）',
    )
    expect(JSON.stringify(feedback)).not.toContain('secret')
    expect(classifyPlatformSendResponse({ code: 0, httpStatus: 200 })).toBeNull()
  })

  it('treats HTTP 429 as a global platform cooldown without requiring a message', () => {
    expect(classifyPlatformSendResponse({
      endpoint: '/room/chat?token=secret',
      httpStatus: 429,
      method: 'POST',
      transport: 'xhr',
    })).toMatchObject({
      cooldownMs: 15_000,
      endpoint: '/room/chat',
      kind: 'rate-limit',
      message: '平台拒绝了本次发送',
    })
  })

  it('blocks accidental double actions and repeated successful content', () => {
    let time = 10_000
    const guard = createSendProtection({
      now: () => time,
      sameMessageCooldownMs: 1_200,
      successCooldownMs: 0,
    })
    expect(guard.begin('你好').allowed).toBe(true)
    guard.finish('你好', true)
    time += 900
    expect(guard.begin('你好')).toMatchObject({ allowed: false, reason: 'duplicate' })
    time += 301
    expect(guard.begin('另一条').allowed).toBe(true)
    guard.finish('另一条', false)
    time += 900
    expect(guard.begin('你好').allowed).toBe(true)
  })

  it('keeps the default same-message guard active beyond the accidental-click window', () => {
    let time = 30_000
    const guard = createSendProtection({ now: () => time, successCooldownMs: 0 })
    expect(guard.begin('重复内容').allowed).toBe(true)
    guard.finish('重复内容', true)
    time += 1_500
    expect(guard.begin('重复内容')).toMatchObject({
      allowed: false,
      reason: 'duplicate',
      remainingMs: 1_500,
    })
  })

  it('applies platform rate limits globally and duplicate limits per message', () => {
    let time = 20_000
    const guard = createSendProtection({ now: () => time, accidentalIntervalMs: 0 })
    expect(guard.begin('A').allowed).toBe(true)
    guard.applyPlatformFeedback({ kind: 'rate-limit', message: '发送频繁', cooldownMs: 5_000 }, 'A')
    expect(guard.remainingMs('B')).toBe(5_000)
    time += 5_001
    expect(guard.begin('A').allowed).toBe(true)
    guard.applyPlatformFeedback({ kind: 'duplicate', message: '请勿重复发送', cooldownMs: 4_000 }, 'A')
    expect(guard.remainingMs('A')).toBe(4_000)
    expect(guard.remainingMs('B')).toBe(0)
  })

  it('observes newly mounted native alert feedback but ignores plugin and chat messages', async () => {
    vi.useFakeTimers()
    const probe = createPlatformFeedbackProbe(document)
    const chat = document.createElement('div')
    chat.className = 'chat-message-list'
    chat.textContent = '请勿重复发送相同内容'
    document.body.append(chat)
    const owned = document.createElement('div')
    owned.dataset.bcpOneOwned = 'true'
    owned.setAttribute('role', 'alert')
    owned.textContent = '操作频繁，请稍后再试'
    document.body.append(owned)
    const platformToast = document.createElement('div')
    platformToast.className = 'live-toast warning'
    platformToast.textContent = '发送太快，请 3 秒后再试'
    document.body.append(platformToast)
    await vi.runAllTimersAsync()
    await expect(probe.wait()).resolves.toMatchObject({
      kind: 'rate-limit',
      cooldownMs: 3_000,
      message: '发送太快，请 3 秒后再试',
    })
    document.body.replaceChildren()
    vi.useRealTimers()
  })
})
