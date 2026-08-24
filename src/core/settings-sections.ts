export const SETTINGS_SECTION_IDS = [
  'general-settings',
  'repeat-reminder-settings',
  'platform-connections',
  'side-chat-capsule',
  'native-danmaku-capsule',
  'platform-colors',
  'favorites-guide',
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]
