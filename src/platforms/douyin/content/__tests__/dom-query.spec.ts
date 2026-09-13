import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  CHAT_MESSAGE_SELECTORS,
  CHAT_ROOT_SELECTORS,
  DOM_DANMAKU_SELECTORS,
  INPUT_SELECTORS,
  MESSAGE_TEXT_SELECTORS,
  SEND_BUTTON_SELECTORS,
  USER_NAME_SELECTORS,
  VIDEO_ROOT_SELECTORS,
} from '../dom-config'
import { closestAny, isDouyinOwnedNode, matchesAny, queryAll } from '../dom-query'

function loadFixture(): void {
  document.body.innerHTML = readFileSync(
    resolve(process.cwd(), 'tests', 'fixtures', 'live-dom', 'douyin.html'),
    'utf8',
  )
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe('Douyin isolated-world DOM contracts', () => {
  it('keeps selector tables and query implementations out of the runtime entry', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src', 'platforms', 'douyin', 'content', 'content-app.ts'),
      'utf8',
    )

    expect(source).toContain("from './dom-config'")
    expect(source).toContain("from './dom-query'")
    expect(source).not.toMatch(/const\s+[A-Z][A-Z0-9_]+_SELECTORS?\s*=/u)
    expect(source).not.toMatch(/function\s+(?:queryAll|matchesAny|closestAny)\s*\(/u)
  })

  it('finds the video, chat, message, content, sender and composer fixture nodes', () => {
    loadFixture()

    const videoRoot = queryAll(VIDEO_ROOT_SELECTORS)[0]
    const overlayMessage = queryAll(DOM_DANMAKU_SELECTORS, videoRoot)[0]
    const chatRoot = queryAll(CHAT_ROOT_SELECTORS)[0]
    const chatMessage = queryAll(CHAT_MESSAGE_SELECTORS, chatRoot)[0]

    expect(videoRoot).toBeInstanceOf(Element)
    expect(overlayMessage?.getAttribute('data-message-id')).toBe('douyin-native-overlay-1')
    expect(chatRoot).toBeInstanceOf(Element)
    expect(chatMessage?.getAttribute('data-message-id')).toBe('douyin-chat-1')
    expect(queryAll(MESSAGE_TEXT_SELECTORS, chatMessage)).toHaveLength(1)
    expect(queryAll(USER_NAME_SELECTORS, chatMessage)).toHaveLength(1)
    expect(queryAll(INPUT_SELECTORS)).toHaveLength(1)
    expect(queryAll(SEND_BUTTON_SELECTORS)).toHaveLength(1)
  })

  it('deduplicates matches, ignores invalid selectors and identifies owned nodes', () => {
    loadFixture()
    const chatMessage = document.querySelector('[data-message-id="douyin-chat-1"]')
    const content = document.querySelector('[data-e2e="chat-message-text"]')
    const ownedTrack = document.querySelector('[data-bcp-douyin-owned="true"]')

    expect(queryAll(['[', '[data-e2e="chat-message"]', 'article'])).toContain(chatMessage)
    expect(queryAll(['[data-e2e="chat-message"]', 'article']).filter((item) => item === chatMessage))
      .toHaveLength(1)
    expect(matchesAny(chatMessage, CHAT_MESSAGE_SELECTORS)).toBe(true)
    expect(closestAny(content, CHAT_MESSAGE_SELECTORS)).toBe(chatMessage)
    expect(isDouyinOwnedNode(ownedTrack)).toBe(true)
    expect(queryAll(DOM_DANMAKU_SELECTORS)).not.toContain(ownedTrack)
    expect(queryAll(CHAT_MESSAGE_SELECTORS)).not.toContain(ownedTrack)
  })
})
