// Small shared Telegram WebApp UI helpers. Every call is guarded with optional
// chaining so older clients / the browser fallback simply no-op.

// When Telegram's BackButton exists, rely on it (no duplicate in-app back).
export const HAS_BACK_BUTTON = !!window.Telegram?.WebApp?.BackButton

// Haptic ticks — only inside Telegram.
export function hapticLight(): void {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light')
}

export function hapticMedium(): void {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('medium')
}

// Suspend Telegram's vertical swipe-to-minimize during a drag (guarded).
export function beginDragLock(): void {
  window.Telegram?.WebApp?.disableVerticalSwipes?.()
  document.body.style.touchAction = 'none'
}

// Vertical swipes are globally locked (Wallet-style); a drag never re-enables
// them — restore the locked (disabled) state when the drag ends.
export function endDragLock(): void {
  document.body.style.touchAction = ''
  window.Telegram?.WebApp?.disableVerticalSwipes?.()
}
