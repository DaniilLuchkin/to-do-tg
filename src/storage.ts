export type Row = {
  id: string
  text: string
  checkbox: boolean
  done: boolean
  level: 0 | 1
}

// Per-value byte cap imposed by Telegram CloudStorage. Applies to each note's
// content value AND to the index value (`idx`).
export const MAX_VALUE_BYTES = 4096

const INDEX_KEY = 'idx'
const OLD_KEY = 'todos'
const noteKey = (id: string): string => `n:${id}`

// Short, collision-resistant ids (~7 chars, charset [0-9a-z] — safe in keys).
let idCounter = 0
export function newId(): string {
  const time = Date.now().toString(36).slice(-5)
  const seq = (idCounter++ % 1296).toString(36).padStart(2, '0')
  return time + seq
}

export function bytesOf(value: string): number {
  return new TextEncoder().encode(value).length
}

// ---- Per-note content serialization (short keys, omit defaults) -----------
//   i = id (always)  t = text (omit "")  c = 1 checkbox  d = 1 done  l = 1 level1
type StoredRow = { i: string; t?: string; c?: 1; d?: 1; l?: 1 }

export function serialize(rows: Row[]): string {
  const compact: StoredRow[] = rows.map((row) => {
    const out: StoredRow = { i: row.id }
    if (row.text !== '') out.t = row.text
    if (row.checkbox) out.c = 1
    if (row.done) out.d = 1
    if (row.level === 1) out.l = 1
    return out
  })
  return JSON.stringify(compact)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function deserialize(raw: string | null): Row[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const rows: Row[] = []
    for (const item of parsed) {
      if (!isRecord(item)) continue
      if (typeof item.i !== 'string') continue
      const text = typeof item.t === 'string' ? item.t : ''
      const checkbox = item.c === 1
      const done = checkbox && item.d === 1
      const level: 0 | 1 = item.l === 1 ? 1 : 0
      rows.push({ id: item.i, text, checkbox, done, level })
    }
    return rows
  } catch {
    return []
  }
}

// Plain-text export, one line per row (round-trippable format).
export function rowsToText(rows: Row[]): string {
  return rows
    .map((row) => {
      const indent = row.level === 1 ? '  ' : ''
      if (row.checkbox) {
        return `${indent}- [${row.done ? 'x' : ' '}] ${row.text}`
      }
      return `${indent}${row.text}`
    })
    .join('\n')
}

// A note's display title is the text of its first row, clipped for the index.
export function titleOf(rows: Row[]): string {
  return (rows[0]?.text ?? '').slice(0, 80)
}

// ---- Index (notes list) ---------------------------------------------------
export type NoteMeta = { id: string; title: string; mtime?: number }
type StoredNote = { i: string; t: string; m?: number }

export function serializeIndex(notes: NoteMeta[]): string {
  const arr: StoredNote[] = notes.map((n) => {
    const out: StoredNote = { i: n.id, t: n.title }
    if (n.mtime !== undefined) out.m = n.mtime
    return out
  })
  return JSON.stringify(arr)
}

function parseIndex(raw: string | null): NoteMeta[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const notes: NoteMeta[] = []
    for (const item of parsed) {
      if (!isRecord(item)) continue
      if (typeof item.i !== 'string') continue
      const title = typeof item.t === 'string' ? item.t : ''
      const mtime = typeof item.m === 'number' ? item.m : undefined
      notes.push({ id: item.i, title, mtime })
    }
    return notes
  } catch {
    return []
  }
}

// ---- Low-level KV: Promise-wrapped CloudStorage or localStorage fallback ---
function getCloud(): TelegramCloudStorage | undefined {
  return window.Telegram?.WebApp?.CloudStorage
}

export function kvGet(key: string): Promise<string | null> {
  const cloud = getCloud()
  if (cloud) {
    return new Promise((resolve) => {
      cloud.getItem(key, (error, value) => resolve(error ? null : value))
    })
  }
  try {
    return Promise.resolve(localStorage.getItem(key))
  } catch {
    return Promise.resolve(null)
  }
}

export function kvSet(key: string, value: string): Promise<void> {
  const cloud = getCloud()
  if (cloud) {
    return new Promise((resolve) => {
      cloud.setItem(key, value, () => resolve())
    })
  }
  try {
    localStorage.setItem(key, value)
  } catch {
    // best effort
  }
  return Promise.resolve()
}

export function kvRemove(key: string): Promise<void> {
  const cloud = getCloud()
  if (cloud) {
    return new Promise((resolve) => {
      cloud.removeItem(key, () => resolve())
    })
  }
  try {
    localStorage.removeItem(key)
  } catch {
    // best effort
  }
  return Promise.resolve()
}

export function kvKeys(): Promise<string[]> {
  const cloud = getCloud()
  if (cloud) {
    return new Promise((resolve) => {
      cloud.getKeys((error, keys) => resolve(error ? [] : keys))
    })
  }
  try {
    return Promise.resolve(Object.keys(localStorage))
  } catch {
    return Promise.resolve([])
  }
}

// ---- Note operations ------------------------------------------------------
export function saveIndex(notes: NoteMeta[]): Promise<void> {
  return kvSet(INDEX_KEY, serializeIndex(notes))
}

export async function loadNote(id: string): Promise<Row[]> {
  return deserialize(await kvGet(noteKey(id)))
}

export function saveNoteContent(id: string, rows: Row[]): Promise<void> {
  return kvSet(noteKey(id), serialize(rows))
}

export function removeNoteContent(id: string): Promise<void> {
  return kvRemove(noteKey(id))
}

// Startup: migrate the old single list, reconcile orphans, return the index.
export async function initNotes(): Promise<NoteMeta[]> {
  let idxRaw = await kvGet(INDEX_KEY)

  // Migration: no index yet but the old single list exists → make it note #1.
  if (idxRaw === null) {
    const old = await kvGet(OLD_KEY)
    if (old !== null) {
      const rows = deserialize(old)
      const id = newId()
      await kvSet(noteKey(id), serialize(rows))
      const notes: NoteMeta[] = [
        { id, title: titleOf(rows), mtime: Date.now() },
      ]
      await saveIndex(notes)
      await kvRemove(OLD_KEY)
      idxRaw = serializeIndex(notes)
    }
  }

  const notes = parseIndex(idxRaw)

  // Reconciliation: drop index entries with missing content; delete orphan
  // content keys not referenced by the index.
  const keys = await kvKeys()
  const contentIds = new Set(
    keys.filter((k) => k.startsWith('n:')).map((k) => k.slice(2))
  )
  const referenced = new Set(notes.map((n) => n.id))

  const kept = notes.filter((n) => contentIds.has(n.id))
  const changed = kept.length !== notes.length

  for (const cid of contentIds) {
    if (!referenced.has(cid)) await kvRemove(noteKey(cid))
  }

  if (changed) await saveIndex(kept)
  return kept
}
