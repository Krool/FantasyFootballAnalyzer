// Guarded haptic feedback for draft-day moments (on the clock, pick logged).
// iOS Safari has no Vibration API at all, so this is a progressive
// enhancement: it silently no-ops everywhere it isn't supported instead of
// throwing, and it stays quiet in a background tab or under reduced motion.
export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  if (
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return;
  }
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw for an unsupported pattern shape; swallow it.
  }
}
