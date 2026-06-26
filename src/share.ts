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

// Your Mini App's public deep-link base, e.g. 'https://t.me/YourBot/notes'.
// Leave empty to share everything as plain text. Set this (and redeploy) to
// enable link-sharing of small notes.
export const SHARE_LINK_BASE = ''

// ---- base64url (no padding) — native btoa/atob, no dependencies -----------
function bytesToBase64url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToBytes(value: string): Uint8Array {
  const pad = (4 - (value.length % 4)) % 4
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Encode a note's rows into a base64url deep-link payload.
export function encodeNote(rows: Row[]): string {
  return bytesToBase64url(new TextEncoder().encode(serialize(rows)))
}

// Decode a shared `startapp` payload back into rows, or null if unusable.
export function decodeSharedParam(param: string): Row[] | null {
  try {
    const json = new TextDecoder().decode(base64urlToBytes(param))
    const rows = deserialize(json)
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

function openTelegramShare(url: string): void {
  const wa = window.Telegram?.WebApp
  if (wa?.openTelegramLink) wa.openTelegramLink(url)
  else window.open(url, '_blank')
}

// Share a note: a deep link when it's small enough (and configured), else the
// note's plain text. Both open Telegram's share sheet to pick a chat.
export function shareNote(rows: Row[]): void {
  const link = buildShareDeepLink(rows)
  const url = link
    ? `https://t.me/share/url?url=${encodeURIComponent(link)}` +
      `&text=${encodeURIComponent(titleOf(rows) || 'To-Do note')}`
    : `https://t.me/share/url?url=${encodeURIComponent(rowsToText(rows))}`
  openTelegramShare(url)
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
