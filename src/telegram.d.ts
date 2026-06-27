// Minimal type declarations for the Telegram WebApp surface this app uses.
// Intentionally partial — only what we touch is declared.

interface TelegramThemeParams {
  bg_color?: string
  secondary_bg_color?: string
  text_color?: string
  hint_color?: string
  section_separator_color?: string
  button_color?: string
  button_text_color?: string
  destructive_text_color?: string
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
  removeItem(
    key: string,
    callback?: (error: string | null, removed: boolean) => void
  ): void
  getKeys(callback: (error: string | null, keys: string[]) => void): void
}

interface TelegramHapticFeedback {
  impactOccurred(style: string): void
}

interface TelegramBackButton {
  show?(): void
  hide?(): void
  onClick?(callback: () => void): void
  offClick?(callback: () => void): void
}

interface TelegramInitDataUnsafe {
  start_param?: string
}

interface TelegramWebApp {
  ready(): void
  expand?(): void
  initData: string
  initDataUnsafe?: TelegramInitDataUnsafe
  colorScheme: 'light' | 'dark'
  themeParams: TelegramThemeParams
  openTelegramLink?(url: string): void
  CloudStorage?: TelegramCloudStorage
  HapticFeedback?: TelegramHapticFeedback
  BackButton?: TelegramBackButton
  // Newer Bot API versions — guard every call with `?.` so old clients no-op.
  isVerticalSwipesEnabled?: boolean
  disableVerticalSwipes?(): void
  enableVerticalSwipes?(): void
  addToHomeScreen?(): void
  openInvoice?(url: string, callback?: (status: string) => void): void
}

interface Window {
  Telegram?: {
    WebApp?: TelegramWebApp
  }
}
