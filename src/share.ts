import {
  serialize,
  deserialize,
  rowsToText,
  titleOf,
  type Row,
} from './storage'

// Telegram caps the Mini App deep-link `startapp` payload at 512 characters,
// charset [A-Za-z0-9_-] (base64url). A note whose encoded payload fits is
// shared as a deep link the recipient can open and save; anything larger is
// shared as plain text instead.
export const MAX_START_PARAM = 512

// Your Mini App's public deep-link base. `?startapp=<payload>` opens the bot's
// main Mini App. Leave empty to share everything as plain text.
export const SHARE_LINK_BASE = 'https://t.me/todolistwebapp_bot'

// ---- Symmetric base64url + UTF-8 (native btoa/atob, no dependencies) -------
// Used by BOTH the share-encode and receive-decode paths so they round-trip,
// including non-Latin text (e.g. Cyrillic) via TextEncoder/TextDecoder.
function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): string {
  let t = s.replace(/-/g, '+').replace(/_/g, '/')
  while (t.length % 4) t += '=' // restore padding
  const bin = atob(t)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// A valid startapp payload is base64url only — reject anything else up front.
const SHARE_PARAM_RE = /^[A-Za-z0-9_-]+$/

// Encode a note's rows into a base64url deep-link payload.
export function encodeNote(rows: Row[]): string {
  return b64urlEncode(serialize(rows))
}

// Parse an incoming `startapp` payload into rows. Returns null for anything
// unusable (bad charset, decode failure, or not a valid note) — never throws.
export function parseSharedNote(param: string): Row[] | null {
  if (!SHARE_PARAM_RE.test(param)) return null
  try {
    const rows = deserialize(b64urlDecode(param))
    return rows.length > 0 ? rows : null
  } catch {
    return null
  }
}

// Build the deep link for a note, or null when it won't fit / isn't configured.
export function buildShareDeepLink(rows: Row[]): string | null {
  if (!SHARE_LINK_BASE) return null
  const param = encodeNote(rows)
  if (param.length > MAX_START_PARAM) return null
  return `${SHARE_LINK_BASE}?startapp=${param}`
}

const APP_NAME = 'To-Do Notes'

function openTelegramShare(url: string): void {
  const wa = window.Telegram?.WebApp
  if (wa?.openTelegramLink) wa.openTelegramLink(url)
  else window.open(url, '_blank')
}

// The bot's @username, derived from the link base — Telegram auto-links it as
// a tappable mention in a shared message. Empty when unconfigured.
function botHandle(base: string): string {
  try {
    const seg = new URL(base).pathname.split('/').filter(Boolean)[0]
    return seg ? `@${seg}` : ''
  } catch {
    return ''
  }
}

// Share a note: a deep link when it's small enough (and configured), else the
// note's plain text. Both open Telegram's share sheet to pick a chat. Plain
// text carries a "Made with To-Do Notes (@bot)" footer — the tappable @handle
// lets recipients open the app (the deep-link case already includes the link).
export function shareNote(rows: Row[]): void {
  const link = buildShareDeepLink(rows)
  if (link) {
    const text = titleOf(rows) || APP_NAME
    openTelegramShare(
      `https://t.me/share/url?url=${encodeURIComponent(link)}` +
        `&text=${encodeURIComponent(text)}`
    )
    return
  }
  const handle = botHandle(SHARE_LINK_BASE)
  const footer = handle ? `Made with ${APP_NAME} (${handle})` : `Made with ${APP_NAME}`
  const body = `${rowsToText(rows)}\n\n${footer}`
  openTelegramShare(`https://t.me/share/url?url=${encodeURIComponent(body)}`)
}

// Read the shared payload from Telegram's start_param, falling back to the
// `startapp` query param so it also works in the browser preview.
export function readStartParam(): string | null {
  const fromTelegram = window.Telegram?.WebApp?.initDataUnsafe?.start_param
  if (fromTelegram) return fromTelegram
  try {
    return new URLSearchParams(window.location.search).get('startapp')
  } catch {
    return null
  }
}
