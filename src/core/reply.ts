const DIRECT_SENDER_KEYS = [
  'authorName',
  'author_name',
  'displayIdStr',
  'display_id_str',
  'nickname',
  'nickName',
  'nick_name',
  'nick',
  'senderName',
  'sender_name',
  'userName',
  'userNickname',
  'user_nickname',
  'username',
  'user_name',
  'displayName',
  'display_name',
  'screenName',
  'screen_name',
  'uname',
  'displayId',
  'display_id',
] as const

const DIRECT_SENDER_ID_KEYS = [
  'authorId',
  'author_id',
  'senderId',
  'sender_id',
  'shortId',
  'short_id',
  'uniqueId',
  'unique_id',
  'userId',
  'user_id',
] as const

const CONTAINED_SENDER_ID_KEYS = [
  ...DIRECT_SENDER_ID_KEYS,
  'idStr',
  'id_str',
  'secUid',
  'sec_uid',
  'uid',
] as const

const SENDER_CONTAINER_KEYS = [
  'account',
  'author',
  'fromUser',
  'from_user',
  'member',
  'owner',
  'profile',
  'sender',
  'user',
  'userData',
  'user_data',
  'userInfo',
  'user_info',
  'visitor',
] as const

const SENDER_WRAPPER_KEYS = [
  'data',
  'args',
  'bizData',
  'biz_data',
  'body',
  'businessData',
  'business_data',
  'comment',
  'common',
  'context',
  'danmaku',
  'danmakuData',
  'danmaku_data',
  'detail',
  'entity',
  'event',
  'ext',
  'extra',
  'extension',
  'item',
  'meta',
  'message',
  'messageData',
  'message_data',
  'options',
  'params',
  'payload',
  'rawData',
  'raw_data',
  'record',
  'roomMessage',
  'room_message',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeSenderName(value: unknown): string {
  const normalized = String(value == null ? '' : value)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^@+\s*/, '')
    .replace(/[：:]\s*$/, '')
    .trim()
  if (
    !normalized ||
    /^(?:https?|ftp):\/\//i.test(normalized) ||
    /^(?:(?:点击)?(?:查看|打开)(?:用户|个人)?(?:信息|资料|主页)|(?:用户|个人)(?:信息|资料|主页))$/u.test(
      normalized,
    )
  ) {
    return ''
  }
  const characters = Array.from(normalized)
  if (characters.length > 64) {
    return ''
  }
  return characters.join('')
}

export function replyMention(sender: unknown): string {
  const name = normalizeSenderName(sender)
  return name ? `@${name} ` : ''
}

// Inserts the sender mention at the caret position inside the current draft,
// replacing any selected text, e.g. "1232312 32|34" + reply becomes
// "1232312 32@sadunicorn34". Without a caret position it appends at the end,
// and an empty draft becomes a leading "@name " for quick typing. Re-replying
// to a sender whose mention is already present is a no-op.
export function replyDraftValue(
  currentValue: unknown,
  sender: unknown,
  selectionStart?: number,
  selectionEnd?: number,
): string {
  const name = normalizeSenderName(sender)
  if (!name) {
    return String(currentValue == null ? '' : currentValue)
  }
  const current = String(currentValue == null ? '' : currentValue)
  if (!current) {
    return `@${name} `
  }
  const mention = `@${name}`
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`@${escapedName}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(current)) {
    return current
  }
  const length = current.length
  const start = Number.isFinite(selectionStart)
    ? Math.max(0, Math.min(Number(selectionStart), length))
    : length
  const end = Number.isFinite(selectionEnd)
    ? Math.max(start, Math.min(Number(selectionEnd), length))
    : start
  return `${current.slice(0, start)}${mention}${current.slice(end)}`
}

export function extractSenderFromRecord(value: unknown): string {
  if (typeof value === 'string') {
    return normalizeSenderName(value)
  }
  if (!isRecord(value) && !Array.isArray(value)) {
    return ''
  }

  const visited = new WeakSet<object>()
  let visitedCount = 0
  const scalarSender = (candidate: unknown) => {
    if (typeof candidate === 'string') return normalizeSenderName(candidate)
    if (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0) {
      return normalizeSenderName(String(candidate))
    }
    if (typeof candidate === 'bigint' && candidate >= 0n) {
      return normalizeSenderName(String(candidate))
    }
    return ''
  }

  const inspect = (candidate: unknown, depth: number, senderContainer: boolean): string => {
    if (typeof candidate === 'string') {
      return senderContainer ? normalizeSenderName(candidate) : ''
    }
    if (
      (!isRecord(candidate) && !Array.isArray(candidate)) ||
      depth > 8 ||
      visitedCount >= 160 ||
      visited.has(candidate)
    ) {
      return ''
    }
    visited.add(candidate)
    visitedCount += 1

    if (Array.isArray(candidate)) {
      for (const item of candidate.slice(0, 24)) {
        const sender = inspect(item, depth + 1, senderContainer)
        if (sender) return sender
      }
      return ''
    }

    for (const key of DIRECT_SENDER_KEYS) {
      const sender = scalarSender(candidate[key])
      if (sender) return sender
    }
    for (const key of senderContainer ? CONTAINED_SENDER_ID_KEYS : DIRECT_SENDER_ID_KEYS) {
      const sender = scalarSender(candidate[key])
      if (sender) return sender
    }
    if (senderContainer) {
      const sender = scalarSender(candidate.name)
      if (sender) return sender
    }

    // User-like containers are inspected before generic payload wrappers so a
    // renderer's own `name`/`title` metadata cannot be mistaken for a sender.
    for (const key of SENDER_CONTAINER_KEYS) {
      const sender = inspect(candidate[key], depth + 1, true)
      if (sender) return sender
    }
    for (const key of SENDER_WRAPPER_KEYS) {
      const sender = inspect(candidate[key], depth + 1, senderContainer)
      if (sender) return sender
    }

    return ''
  }

  return inspect(value, 0, false)
}
