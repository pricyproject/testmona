/**
 * Copy text to the clipboard, falling back to a hidden textarea + `execCommand`
 * when the async Clipboard API is unavailable — `navigator.clipboard` is undefined
 * on any non-secure origin (plain http on a LAN host, some webviews), which
 * otherwise throws a TypeError and reports a spurious "copy failed".
 *
 * Returns true when the text reached the clipboard.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or a non-user-gesture context — try the fallback below.
    }
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}
