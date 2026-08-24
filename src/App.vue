<template>
  <div class="app-shell">
    <SettingsSidebar
      :active-section="activeSection"
      :version="version"
      @navigate="scrollToSection"
    />

    <section class="main-area">
      <SettingsTopbar
        v-model:enabled="settings.enabled"
        :active-section-title="activeSectionTitle"
        :feedback-email="feedbackEmail"
        @copy-diagnostics="copyCurrentPageDiagnostics"
        @copy-feedback="copyFeedbackEmail"
        @save="save"
      />

      <main ref="contentCanvas" class="content-canvas">
        <div class="settings-container">
          <section id="general-settings" class="settings-section" aria-labelledby="features-title">
            <h2 id="features-title">{{ t('settingsInteractionFeatures') }}</h2>
            <div class="settings-card">
              <SettingSwitch
                id="feature-enabled"
                v-model="settings.enabled"
                :title="t('settingsQuickActions')"
                :description="t('settingsQuickActionsDescription')"
                :aria-label="t('ariaEnableExtension')"
                @change="save"
              />
              <SettingSwitch
                id="action-plus-one"
                v-model="settings.actions.plusOne"
                :disabled="isOnlyActionEnabled('plusOne')"
                :title="t('settingsShowPlusOne')"
                :description="t('settingsShowPlusOneDescription')"
                :aria-label="t('ariaShowPlusOne')"
                @change="saveActionSetting"
              />
              <SettingSwitch
                id="action-reply"
                v-model="settings.actions.reply"
                :disabled="isOnlyActionEnabled('reply')"
                :title="t('settingsShowReply')"
                :description="t('settingsShowReplyDescription')"
                :aria-label="t('ariaShowReply')"
                @change="saveActionSetting"
              />
              <SettingSwitch
                id="action-favorite"
                v-model="settings.actions.favorite"
                :disabled="isOnlyActionEnabled('favorite')"
                :title="t('settingsShowFavorite')"
                :description="t('settingsShowFavoriteDescription')"
                :aria-label="t('ariaShowFavorite')"
                @change="saveActionSetting"
              />
              <SettingSwitch
                id="action-copy"
                v-model="settings.actions.copy"
                :disabled="isOnlyActionEnabled('copy')"
                :title="t('settingsShowCopy')"
                :description="t('settingsShowCopyDescription')"
                :aria-label="t('ariaShowCopy')"
                @change="saveActionSetting"
              />
              <SettingSwitch
                id="altClick"
                v-model="settings.altClick"
                :title="t('settingsAltClick')"
                :description="t('settingsAltClickDescription')"
                @change="save"
              />
              <label class="repeat-reminder-number-setting" for="capsule-scale-percent">
                <span>
                  <strong>{{ t('settingsCapsuleScale') }}</strong>
                  <small>{{ t('settingsCapsuleScaleDescription') }}</small>
                </span>
                <span class="repeat-reminder-number-input">
                  <input
                    id="capsule-scale-percent"
                    v-model.number="settings.interfaceScale.capsulePercent"
                    type="number"
                    :min="MIN_CAPSULE_SCALE_PERCENT"
                    :max="MAX_CAPSULE_SCALE_PERCENT"
                    step="5"
                    @change="saveCapsuleScale"
                  >
                  <em>%</em>
                </span>
              </label>
            </div>
          </section>

          <section id="repeat-reminder-settings" class="settings-section" aria-labelledby="repeat-reminder-title">
            <div class="section-heading">
              <div>
                <h2 id="repeat-reminder-title">{{ t('settingsRepeatReminder') }}</h2>
                <p>{{ t('settingsRepeatReminderDescription') }}</p>
              </div>
              <span>{{ t('settingsRepeatReminderLocalBadge') }}</span>
            </div>
            <div class="settings-card">
              <SettingSwitch
                id="repeat-reminder-enabled"
                v-model="settings.repeatReminder.enabled"
                :title="t('settingsRepeatReminderEnabled')"
                :description="t('settingsRepeatReminderEnabledDescription')"
                :aria-label="t('settingsRepeatReminderEnabled')"
                @change="save"
              />
              <label class="repeat-reminder-number-setting" for="repeat-reminder-threshold">
                <span>
                  <strong>{{ t('settingsRepeatReminderThreshold') }}</strong>
                  <small>{{ t('settingsRepeatReminderThresholdDescription') }}</small>
                </span>
                <span class="repeat-reminder-number-input">
                  <input
                    id="repeat-reminder-threshold"
                    v-model.number="settings.repeatReminder.threshold"
                    type="number"
                    :min="MIN_REPEAT_REMINDER_THRESHOLD"
                    :max="MAX_REPEAT_REMINDER_THRESHOLD"
                    step="1"
                    @change="saveRepeatReminderThreshold"
                  >
                  <em>{{ t('settingsRepeatReminderThresholdUnit') }}</em>
                </span>
              </label>
              <label class="repeat-reminder-number-setting" for="repeat-reminder-prompt-duration">
                <span>
                  <strong>{{ t('settingsRepeatReminderPromptDuration') }}</strong>
                  <small>{{ t('settingsRepeatReminderPromptDurationDescription') }}</small>
                </span>
                <span class="repeat-reminder-number-input">
                  <input
                    id="repeat-reminder-prompt-duration"
                    v-model.number="settings.repeatReminder.promptDurationSeconds"
                    type="number"
                    :min="MIN_REPEAT_REMINDER_PROMPT_SECONDS"
                    :max="MAX_REPEAT_REMINDER_PROMPT_SECONDS"
                    step="1"
                    @change="saveRepeatReminderPromptDuration"
                  >
                  <em>{{ t('settingsRepeatReminderPromptDurationUnit') }}</em>
                </span>
              </label>
              <label class="repeat-reminder-number-setting" for="repeat-reminder-queue-limit">
                <span>
                  <strong>{{ t('settingsRepeatReminderQueueLimit') }}</strong>
                  <small>{{ t('settingsRepeatReminderQueueLimitDescription') }}</small>
                </span>
                <span class="repeat-reminder-number-input">
                  <input
                    id="repeat-reminder-queue-limit"
                    v-model.number="settings.repeatReminder.queueLimit"
                    type="number"
                    :min="MIN_REPEAT_REMINDER_QUEUE_LIMIT"
                    :max="MAX_REPEAT_REMINDER_QUEUE_LIMIT"
                    step="1"
                    @change="saveRepeatReminderQueueLimit"
                  >
                  <em>{{ t('settingsRepeatReminderQueueLimitUnit') }}</em>
                </span>
              </label>
              <label class="repeat-reminder-number-setting" for="repeat-reminder-prompt-scale">
                <span>
                  <strong>{{ t('settingsRepeatReminderPromptScale') }}</strong>
                  <small>{{ t('settingsRepeatReminderPromptScaleDescription') }}</small>
                </span>
                <span class="repeat-reminder-number-input">
                  <input
                    id="repeat-reminder-prompt-scale"
                    v-model.number="settings.repeatReminder.promptScalePercent"
                    type="number"
                    :min="MIN_REPEAT_REMINDER_PROMPT_SCALE_PERCENT"
                    :max="MAX_REPEAT_REMINDER_PROMPT_SCALE_PERCENT"
                    step="5"
                    @change="saveRepeatReminderPromptScale"
                  >
                  <em>%</em>
                </span>
              </label>
            </div>
          </section>

          <section id="platform-connections" class="settings-section" aria-labelledby="platforms-title">
            <h2 id="platforms-title">{{ t('settingsPlatformStatus') }}</h2>
            <div class="settings-card">
              <SettingSwitch
                v-for="platform in platforms"
                :id="`platform-${platform.id}`"
                :key="platform.id"
                v-model="settings.platforms[platform.id]"
                :title="platform.label"
                :description="t('settingsPlatformDescription')"
                :aria-label="t('settingsEnablePlatformAria', platform.label)"
                @change="save"
              />
            </div>
          </section>

          <section id="side-chat-capsule" class="settings-section" aria-labelledby="side-chat-capsule-title">
            <h2 id="side-chat-capsule-title">{{ t('settingsSideCapsuleTitle') }}</h2>
            <div class="settings-card">
              <SettingSwitch
                id="side-chat-capsule-bilibili"
                v-model="settings.sideChatCapsule.bilibili"
                :title="t('settingsSideCapsulePlatformTitle', t('platformBilibili'))"
                :description="t('settingsSideCapsulePlatformDescription', t('platformBilibili'))"
                :aria-label="t('settingsSideCapsulePlatformAria', t('platformBilibili'))"
                @change="save"
              />
              <SettingSwitch
                id="side-chat-capsule-huya"
                v-model="settings.sideChatCapsule.huya"
                :title="t('settingsSideCapsulePlatformTitle', t('platformHuya'))"
                :description="t('settingsSideCapsulePlatformDescription', t('platformHuya'))"
                :aria-label="t('settingsSideCapsulePlatformAria', t('platformHuya'))"
                @change="save"
              />
              <SettingSwitch
                id="side-chat-capsule-douyu"
                v-model="settings.sideChatCapsule.douyu"
                :title="t('settingsSideCapsulePlatformTitle', t('platformDouyu'))"
                :description="t('settingsSideCapsulePlatformDescription', t('platformDouyu'))"
                :aria-label="t('settingsSideCapsulePlatformAria', t('platformDouyu'))"
                @change="save"
              />
            </div>
          </section>

          <section id="native-danmaku-capsule" class="settings-section" aria-labelledby="native-capsule-title">
            <h2 id="native-capsule-title">{{ t('settingsDouyuNativeTitle') }}</h2>
            <div class="settings-card">
              <SettingSwitch
                id="native-danmaku-capsule-douyu"
                v-model="settings.nativeDanmakuCapsule.douyu"
                :title="t('settingsDouyuNativeToggle')"
                :description="t('settingsDouyuNativeDescription')"
                :aria-label="t('settingsDouyuNativeToggle')"
                @change="save"
              />
            </div>
          </section>

          <section id="platform-colors" class="settings-section color-settings-section" aria-labelledby="colors-title">
            <div class="color-section-heading">
              <div>
                <h2 id="colors-title">{{ t('settingsColors') }}</h2>
                <p>{{ t('settingsColorsDescription') }}</p>
              </div>
              <span id="color-count" class="color-count">{{ t('settingsCustomColorCount', String(customColorCount)) }}</span>
            </div>
            <div class="color-platform-list">
              <ColorPlatform
                v-for="platform in platforms"
                :key="platform.id"
                :platform="platform.id"
                :label="platform.label"
                :colors="settings.colors[platform.id]"
                :fields="colorFields"
                @invalid="setStatus(t('settingsInvalidColor'), 'error')"
                @reset="resetPlatformColors(platform.id)"
                @update-color="(key, value) => setColor(platform.id, key, value)"
              />
            </div>
          </section>

          <section id="favorites-guide" class="settings-section" aria-labelledby="favorites-title">
            <div class="section-heading">
              <div>
                <h2 id="favorites-title">{{ t('settingsFavorites') }}</h2>
                <p>{{ t('settingsFavoritesDescription') }}</p>
              </div>
              <span>{{ t('settingsLocalStorage') }}</span>
            </div>
            <div class="favorites-page-card">
              <div class="favorites-guide-intro">
                <div class="favorites-guide-statement">
                  <span class="favorites-guide-plus" aria-hidden="true">+1</span>
                  <h3>{{ t('settingsFavoritesStatementLine1') }}<br>{{ t('settingsFavoritesStatementLine2') }}</h3>
                  <p>{{ t('settingsFavoritesGuideDescription') }}</p>
                  <ul :aria-label="t('settingsFavoritesSupportedAria')">
                    <li>{{ t('settingsFavoritesPlainText') }}</li>
                    <li>Unicode Emoji</li>
                    <li>{{ t('settingsFavoritesRichText') }}</li>
                  </ul>
                </div>

                <div class="favorites-guide-preview" :aria-label="t('settingsFavoritesPreviewAria')">
                  <div class="favorites-preview-head">
                    <span>{{ t('favoritesCurrentRoom') }}</span>
                    <small>{{ t('favoritesRoomItemCount', '3') }}</small>
                  </div>
                  <div class="favorites-preview-tabs">
                    <span class="is-active">{{ t('favoritesCurrent') }} <small>3</small></span>
                    <span>{{ t('favoritesOtherRooms') }} <small>8</small></span>
                    <span>{{ t('favoritesAll') }} <small>11</small></span>
                  </div>
                  <div class="favorites-preview-sort">
                    <span>{{ t('favoritesOtherRooms') }}</span>
                    <small>{{ t('favoritesSortSendCountLabel') }}</small>
                  </div>
                  <div class="favorites-preview-group">
                    <span><strong>老张的游戏间</strong><small>3 条收藏 · 已发送 14 次</small></span>
                    <em>3</em>
                    <b aria-hidden="true" />
                  </div>
                  <div class="favorites-preview-group">
                    <span><strong>小鱼聊电影</strong><small>2 条收藏 · 已发送 7 次</small></span>
                    <em>2</em>
                    <b aria-hidden="true" />
                  </div>
                  <div class="favorites-preview-group">
                    <span><strong>大刘音乐台</strong><small>3 条收藏 · 已发送 9 次</small></span>
                    <em>3</em>
                    <b aria-hidden="true" />
                  </div>
                </div>
              </div>

              <ol class="favorites-guide-flow" :aria-label="t('settingsFavoritesFlowAria')">
                <li>
                  <span class="favorites-flow-index">1</span>
                  <span><strong>{{ t('settingsFavoritesStepSave') }}</strong><small>{{ t('settingsFavoritesStepSaveDescription') }}</small></span>
                </li>
                <li>
                  <span class="favorites-flow-index">2</span>
                  <span><strong>{{ t('settingsFavoritesStepList') }}</strong><small><kbd>Alt</kbd> + <kbd>Q</kbd>{{ t('settingsFavoritesStepListDescription') }}</small></span>
                </li>
                <li>
                  <span class="favorites-flow-index">3</span>
                  <span><strong>{{ t('settingsFavoritesStepWheel') }}</strong><small>{{ t('settingsFavoritesStepWheelDescription') }} <kbd>Q</kbd>。</small></span>
                </li>
              </ol>

              <div class="favorites-guide-note">
                <strong>{{ t('settingsLocal') }}</strong>
                <span>{{ t('settingsFavoritesPrivacyNote') }}</span>
              </div>

              <FavoritesDataTools @status="setStatus" />
            </div>
          </section>
        </div>
      </main>
    </section>
  </div>

  <p
    id="status"
    :class="['save-status', { 'is-visible': statusVisible }, statusKind && `is-${statusKind}`]"
    role="status"
    aria-live="polite"
  >
    {{ statusMessage }}
  </p>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ActionSettings, ColorSettingKey, PlatformId } from "./core/types";
import ColorPlatform from "./components/ColorPlatform.vue";
import FavoritesDataTools from "./components/FavoritesDataTools.vue";
import SettingSwitch from "./components/SettingSwitch.vue";
import SettingsSidebar from "./components/SettingsSidebar.vue";
import SettingsTopbar from "./components/SettingsTopbar.vue";
import { useSectionNavigation } from "./composables/useSectionNavigation";
import { useSettings } from "./composables/useSettings";
import { t } from "./core/i18n";
import { SETTINGS_SECTION_IDS } from "./core/settings-sections";
import {
  MAX_CAPSULE_SCALE_PERCENT,
  MAX_REPEAT_REMINDER_PROMPT_SECONDS,
  MAX_REPEAT_REMINDER_PROMPT_SCALE_PERCENT,
  MAX_REPEAT_REMINDER_QUEUE_LIMIT,
  MAX_REPEAT_REMINDER_THRESHOLD,
  MIN_CAPSULE_SCALE_PERCENT,
  MIN_REPEAT_REMINDER_PROMPT_SECONDS,
  MIN_REPEAT_REMINDER_PROMPT_SCALE_PERCENT,
  MIN_REPEAT_REMINDER_QUEUE_LIMIT,
  MIN_REPEAT_REMINDER_THRESHOLD,
  normalizeCapsuleScalePercent,
  normalizeRepeatReminderPromptSeconds,
  normalizeRepeatReminderPromptScalePercent,
  normalizeRepeatReminderQueueLimit,
  normalizeRepeatReminderThreshold
} from "./core/repeat-reminder-settings";

const feedbackEmail = "sadunicorn1113@gmail.com";
const platforms: ReadonlyArray<{ id: PlatformId; label: string }> = [
  { id: "bilibili", label: t("platformBilibili") },
  { id: "douyin", label: t("platformDouyin") },
  { id: "douyu", label: t("platformDouyu") },
  { id: "huya", label: t("platformHuya") }
];
const colorFields: ReadonlyArray<{
  defaultValue: string;
  key: ColorSettingKey;
  label: string;
}> = [
  { key: "actionStart", label: t("colorActionStart"), defaultValue: "#FD8101" },
  { key: "actionEnd", label: t("colorActionEnd"), defaultValue: "#FD8101" },
  { key: "actionText", label: t("colorActionText"), defaultValue: "#FFFFFF" },
  { key: "focusRing", label: t("colorFocusRing"), defaultValue: "#FD8101" },
  { key: "selection", label: t("colorSelection"), defaultValue: "#FD8101" },
  { key: "panelBackground", label: t("colorPanelBackground"), defaultValue: "#FD8101" },
  { key: "panelText", label: t("colorPanelText"), defaultValue: "#FFFFFF" },
  { key: "success", label: t("colorSuccess"), defaultValue: "#27AE60" },
  { key: "warning", label: t("colorWarning"), defaultValue: "#E6A000" },
  { key: "error", label: t("colorError"), defaultValue: "#FF4747" }
];
const {
  copyFeedbackEmail,
  save,
  settings,
  setStatus,
  statusKind,
  statusMessage,
  statusVisible,
  version
} = useSettings();
const { activeSection, contentCanvas, scrollToSection } = useSectionNavigation(SETTINGS_SECTION_IDS);

const customColorCount = computed(() => platforms.reduce((total, platform) => (
  total + Object.values(settings.colors[platform.id]).filter(Boolean).length
), 0));
const activeSectionTitle = computed(() => ({
  "favorites-guide": t("settingsFavorites"),
  "general-settings": t("settingsGeneral"),
  "native-danmaku-capsule": t("settingsNativeCapsule"),
  "platform-colors": t("settingsColors"),
  "platform-connections": t("settingsPlatforms"),
  "repeat-reminder-settings": t("settingsRepeatReminder"),
  "side-chat-capsule": t("settingsSideCapsule")
}[activeSection.value]));

function saveRepeatReminderThreshold(): void {
  settings.repeatReminder.threshold = normalizeRepeatReminderThreshold(settings.repeatReminder.threshold);
  save();
}

function saveRepeatReminderPromptDuration(): void {
  settings.repeatReminder.promptDurationSeconds = normalizeRepeatReminderPromptSeconds(
    settings.repeatReminder.promptDurationSeconds
  );
  save();
}

function saveRepeatReminderQueueLimit(): void {
  settings.repeatReminder.queueLimit = normalizeRepeatReminderQueueLimit(
    settings.repeatReminder.queueLimit
  );
  save();
}

function saveRepeatReminderPromptScale(): void {
  settings.repeatReminder.promptScalePercent = normalizeRepeatReminderPromptScalePercent(
    settings.repeatReminder.promptScalePercent
  );
  save();
}

function saveCapsuleScale(): void {
  settings.interfaceScale.capsulePercent = normalizeCapsuleScalePercent(
    settings.interfaceScale.capsulePercent
  );
  save();
}

function isOnlyActionEnabled(action: keyof ActionSettings): boolean {
  return settings.actions[action]
    && Object.values(settings.actions).filter(Boolean).length === 1;
}

function saveActionSetting(): void {
  if (!Object.values(settings.actions).some(Boolean)) settings.actions.plusOne = true;
  save();
}

function setColor(platform: PlatformId, key: ColorSettingKey, value: string): void {
  settings.colors[platform][key] = value;
  save();
}

function resetPlatformColors(platform: PlatformId): void {
  colorFields.forEach((field) => {
    settings.colors[platform][field.key] = "";
  });
  save();
}

async function writeClipboardText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.readOnly = true;
    input.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(input);
    try {
      input.select();
      return document.execCommand("copy");
    } finally {
      input.remove();
    }
  }
}

async function copyCurrentPageDiagnostics(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== "number") throw new Error("active-tab-unavailable");
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "danmaku-echo.diagnostics.snapshot"
    });
    if (!response?.ok || !response.snapshot) throw new Error("diagnostics-unavailable");
    const copied = await writeClipboardText(JSON.stringify(response.snapshot, null, 2));
    if (!copied) throw new Error("clipboard-rejected");
    setStatus(t("settingsDiagnosticsCopied"), "saved");
  } catch {
    setStatus(t("settingsDiagnosticsUnavailable"), "error");
  }
}
</script>

<style lang="scss">
:root {
  color-scheme: light;
  font-family: "Microsoft YaHei UI", "PingFang SC", "Segoe UI", sans-serif;
  --canvas: #f3f3f3;
  --surface: #f9f9f9;
  --surface-muted: #eeeeee;
  --border: #c4c7c7;
  --text: #1a1c1c;
  --text-secondary: #444748;
  --text-muted: #747878;
  --success: #27ae60;
  --danger: #ff4747;
  --shadow: 0 1px 1px rgb(0 0 0 / 5%);
}

* {
  box-sizing: border-box;
}

html {
  background: var(--canvas);
  min-height: 600px;
  min-width: 800px;
  scroll-behavior: smooth;
}

body {
  color: var(--text);
  margin: 0;
  min-height: 600px;
  min-width: 800px;
}

button,
input {
  font: inherit;
}

a {
  color: inherit;
  text-decoration: none;
}

.app-shell {
  background: var(--canvas);
  display: flex;
  height: 100vh;
  min-height: 600px;
  overflow: hidden;
  width: 100%;
}

.platform-status svg .filled {
  fill: currentColor;
  stroke: none;
}

.main-area {
  background: var(--canvas);
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.content-canvas {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 32px max(32px, calc((100% - 768px) / 2));
  position: relative;
  scrollbar-color: #c8caca transparent;
  scrollbar-width: thin;
  z-index: 1;
}

.settings-container {
  display: flex;
  flex-direction: column;
  gap: 32px;
  margin: 0 auto;
  max-width: 768px;
  width: 100%;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  scroll-margin-top: 24px;
}

.settings-section h2 {
  color: #000;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: .05em;
  line-height: 20px;
  margin: 0;
}

.settings-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.repeat-reminder-number-setting {
  align-items: center;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 24px;
  justify-content: space-between;
  min-height: 72px;
  padding: 12px 16px;
}

.repeat-reminder-number-setting > span:first-child {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.repeat-reminder-number-setting strong {
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.repeat-reminder-number-setting small {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 18px;
}

.repeat-reminder-number-input {
  align-items: center;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: 7px;
  display: flex;
  flex: 0 0 auto;
  overflow: hidden;
}

.repeat-reminder-number-input input {
  background: transparent;
  border: 0;
  color: var(--text);
  font: 500 12px/20px ui-monospace, Consolas, monospace;
  outline: 0;
  padding: 6px 4px 6px 10px;
  text-align: right;
  width: 62px;
}

.repeat-reminder-number-input em {
  color: var(--text-secondary);
  font-size: 11px;
  font-style: normal;
  padding-right: 10px;
}

.repeat-reminder-number-input:focus-within {
  border-color: #fd8101;
  outline: 2px solid rgb(253 129 1 / 40%);
  outline-offset: 1px;
}

.section-heading {
  align-items: center;
  display: flex;
  gap: 16px;
  justify-content: space-between;
}

.section-heading > div {
  min-width: 0;
}

.section-heading p {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 20px;
  margin: 4px 0 0;
}

.section-heading > span {
  background: rgb(253 129 1 / 10%);
  border: 1px solid rgb(253 129 1 / 26%);
  border-radius: 999px;
  color: #b65c00;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .07em;
  line-height: 16px;
  padding: 3px 8px;
  white-space: nowrap;
}

.favorites-page-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: var(--shadow);
  overflow: hidden;
  position: relative;
}

.favorites-page-card::before {
  background: #fd8101;
  content: "";
  height: 3px;
  left: 0;
  position: absolute;
  right: 0;
  top: 0;
  z-index: 1;
}

.favorites-guide-intro {
  display: grid;
  grid-template-columns: minmax(220px, .8fr) minmax(320px, 1.2fr);
  min-height: 300px;
}

.favorites-guide-statement {
  align-items: flex-start;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 36px 32px 32px;
}

.favorites-guide-plus {
  align-items: center;
  background: #fd8101;
  border-radius: 16px;
  color: #fff;
  display: flex;
  font: 700 17px/1 Bahnschrift, "Segoe UI", sans-serif;
  height: 36px;
  justify-content: center;
  margin-bottom: 24px;
  width: 46px;
}

.favorites-guide-statement h3 {
  color: #171717;
  font-size: 27px;
  font-weight: 600;
  letter-spacing: -.035em;
  line-height: 37px;
  margin: 0;
}

.favorites-guide-statement > p {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 20px;
  margin: 15px 0 0;
  max-width: 290px;
}

.favorites-guide-statement ul {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 15px;
  list-style: none;
  margin: auto 0 0;
  padding: 20px 0 0;
}

.favorites-guide-statement li {
  color: var(--text-muted);
  font-size: 9px;
  line-height: 16px;
  padding-left: 10px;
  position: relative;
}

.favorites-guide-statement li::before {
  background: #fd8101;
  border-radius: 999px;
  content: "";
  height: 4px;
  left: 0;
  position: absolute;
  top: 6px;
  width: 4px;
}

.favorites-guide-preview {
  align-self: stretch;
  background: #fffaf5;
  border-left: 1px solid rgb(253 129 1 / 22%);
  min-width: 0;
  padding: 35px 30px 26px;
}

.favorites-preview-head,
.favorites-preview-tabs,
.favorites-preview-sort,
.favorites-preview-group {
  align-items: center;
  display: flex;
}

.favorites-preview-head {
  justify-content: space-between;
  margin-bottom: 18px;
}

.favorites-preview-head > span {
  color: #202020;
  font-size: 11px;
  font-weight: 600;
}

.favorites-preview-head > small {
  color: #777;
  font-size: 8px;
}

.favorites-preview-tabs {
  border-bottom: 1px solid #d4d5d3;
  gap: 20px;
  margin-bottom: 0;
}

.favorites-preview-tabs > span {
  color: #888;
  font-size: 8px;
  line-height: 30px;
  padding: 0;
  position: relative;
  white-space: nowrap;
}

.favorites-preview-tabs > span.is-active {
  color: #202020;
}

.favorites-preview-tabs > span.is-active::after {
  background: #fd8101;
  bottom: -1px;
  content: "";
  height: 2px;
  left: 0;
  position: absolute;
  right: 0;
}

.favorites-preview-tabs small {
  color: inherit;
  font-size: 7px;
  margin-left: 3px;
}

.favorites-preview-sort {
  border-bottom: 1px solid #dedfdd;
  justify-content: space-between;
  min-height: 30px;
}

.favorites-preview-sort > span {
  color: #555;
  font-size: 8px;
  font-weight: 600;
}

.favorites-preview-sort > small {
  color: #777;
  font-size: 7px;
}

.favorites-preview-group {
  border-bottom: 1px solid #dedfdd;
  gap: 8px;
  min-height: 47px;
}

.favorites-preview-group > b {
  border-color: transparent transparent transparent #fd8101;
  border-style: solid;
  border-width: 4px 0 4px 6px;
  height: 0;
  transform-origin: 3px 4px;
  width: 0;
}

.favorites-preview-group > span {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.favorites-preview-group strong {
  color: #222;
  font-size: 9px;
  font-weight: 600;
}

.favorites-preview-group small {
  color: #888;
  font-size: 7px;
  margin-top: 1px;
}

.favorites-preview-group > em {
  align-items: center;
  border: 1px solid #d4d5d3;
  border-radius: 10px;
  color: #777;
  display: flex;
  font-size: 7px;
  font-style: normal;
  height: 19px;
  justify-content: center;
  width: 25px;
}

.favorites-guide-flow {
  display: grid;
  gap: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid #dfe0de;
}

.favorites-guide-flow li {
  align-items: center;
  display: flex;
  gap: 13px;
  min-height: 92px;
  padding: 18px 22px;
}

.favorites-guide-flow li + li {
  border-left: 1px solid #dfe0de;
}

.favorites-flow-index {
  align-items: center;
  border: 2px solid #fd8101;
  border-radius: 50%;
  color: #b65c00;
  display: flex;
  flex: 0 0 28px;
  font: 600 11px/1 Bahnschrift, "Segoe UI", sans-serif;
  height: 28px;
  justify-content: center;
  width: 28px;
}

.favorites-guide-flow li > span:last-child {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.favorites-guide-flow li strong {
  color: #222;
  font-size: 11px;
  font-weight: 600;
  line-height: 17px;
}

.favorites-guide-flow li small {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 17px;
  margin-top: 2px;
}

.favorites-guide-flow kbd {
  background: #f0f2f2;
  border: 1px solid #d2d7d7;
  border-radius: 4px;
  box-shadow: inset 0 -1px #c8cdcd;
  color: #303535;
  font-family: inherit;
  font-size: 9px;
  padding: 1px 4px;
}

.favorites-guide-note {
  align-items: center;
  background: #faf7f3;
  border-top: 1px solid #e4ded6;
  display: flex;
  gap: 10px;
  padding: 12px 20px;
}

.favorites-guide-note strong {
  color: #b65c00;
  font-size: 10px;
  font-weight: 600;
  line-height: 20px;
}

.favorites-guide-note > span {
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 18px;
}

.save-status {
  background: rgb(249 249 249 / 96%);
  border: 1px solid var(--border);
  border-radius: 4px;
  bottom: 18px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 8%);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 18px;
  margin: 0;
  opacity: 0;
  padding: 6px 10px;
  pointer-events: none;
  position: fixed;
  right: 20px;
  transform: translateY(8px);
  transition: opacity 140ms ease, transform 140ms ease;
  z-index: 5;
}

.save-status.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.save-status.is-saved {
  border-color: rgb(39 174 96 / 35%);
  color: #197d43;
}

.save-status.is-error {
  border-color: rgb(201 76 76 / 35%);
  color: var(--danger);
}

@media (max-width: 900px) {
  .content-canvas {
    padding-left: 24px;
    padding-right: 24px;
  }

  .setting-copy small {
    font-size: 13px;
  }

  .color-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .color-field:nth-child(odd) {
    border-right: 0;
  }

  .favorites-guide-intro {
    grid-template-columns: minmax(0, 1fr);
  }

  .favorites-guide-statement > p {
    max-width: 430px;
  }

  .favorites-guide-statement ul {
    margin-top: 0;
  }

  .favorites-guide-preview {
    border-left: 0;
    border-top: 1px solid #dedfdd;
  }

  .favorites-guide-flow {
    grid-template-columns: minmax(0, 1fr);
  }

  .favorites-guide-flow li {
    min-height: 0;
  }

  .favorites-guide-flow li + li {
    border-left: 0;
    border-top: 1px solid #dfe0de;
  }

  .favorites-data-tools {
    align-items: stretch;
    flex-direction: column;
  }

  .favorites-data-actions button {
    flex: 1;
    justify-content: center;
  }
}

@media (max-height: 700px) {
  .content-canvas {
    padding-bottom: 24px;
    padding-top: 24px;
  }

  .settings-container {
    gap: 24px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: .01ms !important;
  }
}
</style>
