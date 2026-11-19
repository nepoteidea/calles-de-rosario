// Browser capability helpers. Every call is guarded: iOS Safari has no
// Fullscreen API on iPhone and no orientation lock outside an installed PWA.

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
}

export function enterFullscreen() {
  if (!isTouchDevice()) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    const req = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.();
    Promise.resolve(req)
      .then(() =>
        (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.(
          'landscape',
        ),
      )
      .catch(() => {});
  } catch {
    // not supported
  }
}

export function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not supported
  }
}
