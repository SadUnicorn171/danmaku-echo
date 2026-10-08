import { applySettingsPatch, diffSettings, saveSettingsPatch, type SettingsPatch } from '../core/settings-persistence';
import { onMounted, onUnmounted, reactive, ref, toRaw, watchEffect } from "vue";
import { mergeSettings } from "../core/shared";
import type { ExtensionSettings } from "../core/types";
import { normalizeSettingsLanguage, settingsLanguage, t, type SettingsLanguage } from "./settings-language";

type StatusKind = "error" | "saved" | "";

export function useSettings() {
  const settings = reactive<ExtensionSettings>(mergeSettings());
  let baseline = mergeSettings();
  let pendingSaves = 0;
  let saveVersion = 0;
  const submitted = new Map<string, { change: SettingsPatch; version: number; failed: boolean }>();
  const statusMessage = ref(t("settingsAutoSave"));
  const statusKind = ref<StatusKind>("");
  const statusVisible = ref(false);
  const version = ref("1.1.4");
  const storage = globalThis.chrome?.storage?.sync ?? null;
  const languageSaving = ref(false);
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  watchEffect(() => {
    document.documentElement.lang = settingsLanguage.value;
    document.title = t("extensionActionTitle");
  });

  function replaceSettings(value: unknown, failed: SettingsPatch[] = []): void {
    const preference = value && typeof value === "object" && "settingsLanguage" in value
      ? value.settingsLanguage : undefined;
    settingsLanguage.value = normalizeSettingsLanguage(preference);
    const edits = [...failed, ...diffSettings(baseline, plainSettings())];
    baseline = mergeSettings(value);
    const next = mergeSettings(applySettingsPatch(value, edits));
    settings.enabled = next.enabled;
    settings.interfaceScale = next.interfaceScale;
    settings.altClick = next.altClick;
    settings.actions = next.actions;
    settings.nativeDanmakuCapsule = next.nativeDanmakuCapsule;
    settings.douyinNativeSettings = next.douyinNativeSettings;
    settings.platforms = next.platforms;
    settings.repeatReminder = next.repeatReminder;
    settings.sideChatCapsule = next.sideChatCapsule;
    settings.colors = next.colors;
  }

  function setStatus(message: string, kind: StatusKind = ""): void {
    if (statusTimer !== undefined) {
      clearTimeout(statusTimer);
    }
    statusMessage.value = message;
    statusKind.value = kind;
    statusVisible.value = true;
    statusTimer = setTimeout(() => {
      statusVisible.value = false;
    }, 1800);
  }

  function plainSettings(): ExtensionSettings {
    return mergeSettings(toRaw(settings));
  }

  function save(): void {
    const payload = plainSettings();
    if (!storage) {
      setStatus(t("settingsPreviewSaved"), "saved");
      return;
    }
    const changes = diffSettings(baseline, payload);
    if (!changes.length) return;
    const version = ++saveVersion;
    // Compare subsequent clicks with the latest submitted intent, not an old server echo.
    baseline = mergeSettings(applySettingsPatch(baseline, changes));
    changes.forEach(change => submitted.set(change.path.join('.'), { change, version, failed: false }));
    pendingSaves++;
    void saveSettingsPatch(changes).then(() => {
      setStatus(t("settingsSaved"), "saved");
    }, () => {
      for (const entry of submitted.values()) if (entry.version === version) entry.failed = true;
      setStatus(t("settingsSaveFailed"), "error");
    }).finally(() => {
      pendingSaves--;
      refreshSettings();
    });
  }

  function refreshSettings(): void {
    if (!storage || pendingSaves) return;
    const version = saveVersion;
    storage.get(null, (saved) => {
      if (pendingSaves || version !== saveVersion) return;
      const failed = [...submitted.values()].filter(entry => entry.failed).map(entry => entry.change);
      submitted.clear();
      replaceSettings(saved, failed);
    });
  }

  function changeLanguage(language: SettingsLanguage): void {
    if (languageSaving.value || language === settingsLanguage.value) return;
    const previous = settingsLanguage.value;
    settingsLanguage.value = language;
    statusVisible.value = false;
    if (!storage) return;
    languageSaving.value = true;
    void saveSettingsPatch([{ path: ['settingsLanguage'], value: language }]).catch(() => {
      settingsLanguage.value = previous;
      setStatus(t("settingsSaveFailed"), "error");
    }).finally(() => { languageSaving.value = false; });
  }

  async function copyFeedbackEmail(email: string): Promise<void> {
    let copied = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        try {
          await navigator.clipboard.writeText(email);
          copied = true;
        } catch {
          // Use the selection fallback below when extension clipboard access is unavailable.
        }
      }
      if (!copied) {
        const input = document.createElement("textarea");
        input.value = email;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        try {
          input.select();
          copied = document.execCommand("copy");
        } finally {
          input.remove();
        }
      }
      if (!copied) {
        throw new Error("copy command rejected");
      }
      setStatus(t("settingsFeedbackCopied", email), "saved");
    } catch {
      setStatus(t("settingsFeedbackCopyFailed", email), "error");
    }
  }

  const storageChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
    _changes,
    areaName
  ) => {
    if (areaName === "sync" && storage) {
      refreshSettings();
    }
  };

  onMounted(() => {
    version.value = globalThis.chrome?.runtime?.getManifest?.().version || version.value;
    if (storage) {
      refreshSettings();
      globalThis.chrome?.storage?.onChanged?.addListener(storageChanged);
    }
  });

  onUnmounted(() => {
    if (statusTimer !== undefined) {
      clearTimeout(statusTimer);
    }
    globalThis.chrome?.storage?.onChanged?.removeListener(storageChanged);
  });

  return {
    changeLanguage,
    language: settingsLanguage,
    languageSaving,
    copyFeedbackEmail,
    save,
    settings,
    setStatus,
    statusKind,
    statusMessage,
    statusVisible,
    version
  };
}
