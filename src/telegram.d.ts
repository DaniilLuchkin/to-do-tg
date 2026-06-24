// Minimal type declarations for the Telegram WebApp surface this app uses.
// Intentionally partial — only what we touch is declared.

interface TelegramThemeParams {
  bg_color?: string
  text_color?: string
  hint_color?: string
}

interface TelegramCloudStorage {
  getItem(
    key: string,
    callback: (error: string | null, value: string | null) => void
  ): void
  setItem(
    key: string,
    value: string,
    callback?: (error: string | null, success: boolean) => void
  ): void
}

interface TelegramHapticFeedback {
  impactOccurred(style: string): void
}

interface TelegramWebApp {
  ready(): void
  expand?(): void
  initData: string
  colorScheme: 'light' | 'dark'
  themeParams: TelegramThemeParams
  CloudStorage?: TelegramCloudStorage
  HapticFeedback?: TelegramHapticFeedback
  // Newer Bot API versions — guard every call with `?.` so old clients no-op.
  isVerticalSwipesEnabled?: boolean
  disableVerticalSwipes?(): void
  enableVerticalSwipes?(): void
}

interface Window {
  Telegram?: {
    WebApp?: TelegramWebApp
  }
}
