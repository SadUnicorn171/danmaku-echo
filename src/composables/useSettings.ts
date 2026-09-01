import { onMounted, onUnmounted, reactive, ref, toRaw } from "vue";
import { mergeSettings } from "../core/shared";
import type { ExtensionSettings } from "../core/types";
import { t } from "../core/i18n";

type StatusKind = "error" | "saved" | "";

export function useSettings() {
  const settings = reactive<ExtensionSettings>(mergeSettings());
  const statusMessage = ref(t("settingsAutoSave"));
  const statusKind = ref<StatusKind>("");
  const statusVisible = ref(false);
  const version = ref("1.1.4");
  const storage = globalThis.chrome?.storage?.sync ?? null;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  function replaceSettings(value: unknown): void {
    const next = mergeSettings(value);
    settings.enabled = next.enabled;
    settings.interfaceScale = next.interfaceScale;
    settings.altClick = next.altClick;
    settings.actions = next.actions;
    settings.nativeDanmakuCapsule = next.nativeDanmakuCapsule;
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
      setStatus("预览设置已更新", "saved");
      return;
    }
    storage.set(payload, () => {
      if (chrome.runtime.lastError) {
        setStatus(t("settingsSaveFailed"), "error");
      } else {
        setStatus(t("settingsSaved"), "saved");
      }
    });
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
      setStatus(`反馈邮箱已复制：${email}`, "saved");
    } catch {
      setStatus(`复制失败，请手动复制：${email}`, "error");
    }
  }

  const storageChanged: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
    _changes,
    areaName
  ) => {
    if (areaName === "sync" && storage) {
      storage.get(null, (saved) => replaceSettings(saved));
    }
  };

  onMounted(() => {
    version.value = globalThis.chrome?.runtime?.getManifest?.().version || version.value;
    if (storage) {
      storage.get(null, (saved) => replaceSettings(saved));
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
