import { afterEach, describe, expect, it } from 'vitest'
import {
  formatLiveAudienceMetric,
  parseLiveAudienceValue,
  readLiveAudienceMetric,
} from '../live-audience'

afterEach(() => {
  document.body.replaceChildren()
})

describe('live audience recognition', () => {
  it('normalizes exact counts and Chinese magnitude units', () => {
    expect(parseLiveAudienceValue('房间观众(4,529)')).toBe(4_529)
    expect(parseLiveAudienceValue('16.7万')).toBe(167_000)
    expect(parseLiveAudienceValue('1,246.9万')).toBe(12_469_000)
    expect(parseLiveAudienceValue('2.1亿+')).toBe(210_000_000)
    expect(parseLiveAudienceValue('1w+')).toBe(10_000)
    expect(parseLiveAudienceValue('2万+')).toBe(20_000)
    expect(parseLiveAudienceValue('10W+')).toBe(100_000)
    expect(parseLiveAudienceValue('2.5k')).toBe(2_500)
    expect(parseLiveAudienceValue('暂未开播')).toBeNull()
  })

  it('reads the stable Douyin online-audience field', () => {
    document.body.innerHTML = '<div data-e2e="live-room-audience">4,974</div>'
    expect(readLiveAudienceMetric('douyin')).toEqual({
      kind: 'viewers',
      label: '在线观众',
      platform: 'douyin',
      rawText: '4,974',
      sampledAt: expect.any(Number),
      source: 'dom',
      value: 4_974,
    })
  })

  it('reads Bilibili room viewers without confusing the popularity label', () => {
    document.body.innerHTML = `
      <div>网游人气100</div>
      <div class="tab-list">
        <div class="tab-item active">房间观众(4529)</div>
        <div class="tab-item">大航海(19)</div>
      </div>
    `
    expect(readLiveAudienceMetric('bilibili')).toMatchObject({
      kind: 'viewers',
      rawText: '4529',
      value: 4_529,
    })
  })

  it('reads Bilibili compact ten-thousand-plus viewer text', () => {
    document.body.innerHTML = `
      <div class="tabs"><div class="tab-list dp-flex">
        <div class="item tab-item active">房间观众(1万+)</div>
        <div class="item tab-item">大航海(752)</div>
      </div></div>
    `
    expect(readLiveAudienceMetric('bilibili')).toMatchObject({
      kind: 'viewers',
      rawText: '1万+',
      value: 10_000,
    })
  })

  it('reads the Douyu guest count and ignores its heat signal', () => {
    document.body.innerHTML = `
      <div class="subTitleContainer__-vzhr">
        <h3>主播名称</h3>
        <span class="label__3Yn47"><i><svg></svg></i>1373953</span>
      </div>
      <div class="NobleRankTab__3Yn47">贵宾(5355)</div>
    `
    expect(readLiveAudienceMetric('douyu')).toEqual({
      kind: 'guests',
      label: '贵宾数',
      platform: 'douyu',
      rawText: '5355',
      sampledAt: expect.any(Number),
      source: 'dom',
      value: 5_355,
    })
  })

  it('does not fall back to the Douyu heat value when no guest count is present', () => {
    document.body.innerHTML = '<span class="label__3Yn47"><svg></svg>1393094</span>'
    expect(readLiveAudienceMetric('douyu')).toBeNull()
  })

  it('reads the Huya guest tab and preserves its compact display', () => {
    document.body.innerHTML = `
      <span class="host-spectator host-info-item" title="热度值">
        <i></i><span id="live-count" title="热度值">16.7万</span>
      </span>
      <li class="room-weeklyRankList-nav-item J_rankTabVip">贵宾(2.6千+)</li>
    `
    const metric = readLiveAudienceMetric('huya')
    expect(metric).toMatchObject({
      kind: 'guests',
      rawText: '2.6千+',
      value: 2_600,
    })
    expect(formatLiveAudienceMetric(metric)).toBe('2.6千+ 位')
  })

  it('keeps compact mobile-style viewer counts visible above ten thousand', () => {
    expect(formatLiveAudienceMetric({
      kind: 'viewers',
      label: '实时观众',
      platform: 'douyin',
      rawText: '10w+',
      value: 100_000,
    })).toBe('10w+ 人')
  })

  it('formats an exact guest count as people in the guest seat', () => {
    expect(formatLiveAudienceMetric({
      kind: 'guests',
      label: '贵宾数',
      platform: 'douyu',
      rawText: '5355',
      value: 5_355,
    })).toBe('5,355 位')
  })
})
