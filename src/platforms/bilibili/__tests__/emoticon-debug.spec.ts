import { describe, expect, it, vi } from 'vitest'

import {
  bilibiliEmoticonAssetDebugSummary,
  createBilibiliEmoticonDebugAttempt,
} from '../emoticon-debug'

describe('Bilibili room Emoji debug output', () => {
  it('summarizes native identity without printing resource URLs', () => {
    const summary = bilibiliEmoticonAssetDebugSummary({
      keys: [
        'native-panel:room_3990387_104794',
        'https://i0.hdslb.com/bfs/emote/private-resource.png?token=secret',
      ],
      src: 'https://i0.hdslb.com/bfs/emote/private-resource.png?token=secret',
      token: '[点赞]',
    })

    expect(summary).toEqual({
      hasSource: true,
      identity: 'room_3990387_104794',
      keyCount: 2,
      keyKinds: ['native-panel', 'url'],
      token: '[点赞]',
    })
    expect(JSON.stringify(summary)).not.toContain('private-resource')
    expect(JSON.stringify(summary)).not.toContain('secret')
  })

  it('prints a correlated failure stage while removing authentication fields', () => {
    const logger = vi.fn<(message: string, details: Record<string, unknown>) => void>()
    const debug = createBilibiliEmoticonDebugAttempt(
      {
        assets: [{ keys: ['native-panel:room_3990387_104794'], token: '[点赞]' }],
        parts: [{ type: 'emoji' }],
        text: '[点赞]',
      },
      logger,
    )

    debug.fail('direct-send-failed', {
      code: -400,
      cookie: 'SESSDATA=secret',
      csrf: 'secret-csrf',
      error: new TypeError('Failed to fetch'),
    })

    expect(logger).toHaveBeenCalledOnce()
    const [message, details] = logger.mock.calls[0]
    expect(message).toContain('Bilibili room Emoji +1')
    expect(details).toMatchObject({
      attemptId: debug.attemptId,
      details: {
        code: -400,
        error: { message: 'Failed to fetch', name: 'TypeError' },
      },
      stage: 'direct-send-failed',
    })
    expect(JSON.stringify(details)).not.toContain('SESSDATA')
    expect(JSON.stringify(details)).not.toContain('secret-csrf')
  })
})
