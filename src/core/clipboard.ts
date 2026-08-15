export async function copyTextToClipboard(value: unknown): Promise<boolean> {
  const text = String(value == null ? "" : value);
  if (!text) return false;

  try {
    if (typeof navigator.clipboard?.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Some live pages block the async Clipboard API. The trusted click still
    // permits the selection-based fallback below without a new permission.
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.readOnly = true;
  input.setAttribute("aria-hidden", "true");
  input.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
  document.body.append(input);
  try {
    input.focus({ preventScroll: true });
    input.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    input.remove();
  }
}
