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
// Hard cap on the number of notes.
export const MAX_NOTES = 50
// Current on-disk schema version (stored inside the index payload as `v`).
export const SCHEMA_VERSION = 2
// User-facing app version (shown in About).
export const APP_VERSION = '1.0'
// Cached index titles are clipped so the index stays within budget at 50 notes.
const TITLE_MAX = 40

const INDEX_KEY = 'idx'
const OLD_KEY = 'todos'
// CloudStorage keys allow only [A-Za-z0-9_-]; prefixes use '_' (not ':').
const NOTE_PREFIX = 'n_'
const BAK_PREFIX = 'bak_'
const BAK_INDEX_KEY = `${BAK_PREFIX}${INDEX_KEY}`
const noteKey = (id: string): string => `${NOTE_PREFIX}${id}`

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
  return (rows[0]?.text ?? '').slice(0, TITLE_MAX)
}

// ---- Index (notes list) ---------------------------------------------------
export type NoteMeta = { id: string; title: string; mtime?: number }
type StoredNote = { i: string; t: string; m?: number }

function toStoredNote(n: NoteMeta): StoredNote {
  const out: StoredNote = { i: n.id, t: n.title.slice(0, TITLE_MAX) }
  if (n.mtime !== undefined) out.m = n.mtime
  return out
}

// Versioned index payload: { v: <schema>, n: [ {i,t,m?}, ... ] }.
export function serializeIndex(notes: NoteMeta[]): string {
  return JSON.stringify({ v: SCHEMA_VERSION, n: notes.map(toStoredNote) })
}

function parseNotesArray(arr: unknown[]): NoteMeta[] {
  const notes: NoteMeta[] = []
  for (const item of arr) {
    if (!isRecord(item)) continue
    if (typeof item.i !== 'string') continue
    const title = typeof item.t === 'string' ? item.t.slice(0, TITLE_MAX) : ''
    const mtime = typeof item.m === 'number' ? item.m : undefined
    notes.push({ id: item.i, title, mtime })
  }
  return notes
}

// Backup files store NoteMeta directly (id/title/mtime), not the short keys.
function parseBackupNotes(arr: unknown[]): NoteMeta[] {
  const notes: NoteMeta[] = []
  for (const item of arr) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string') continue
    const title =
      typeof item.title === 'string' ? item.title.slice(0, TITLE_MAX) : ''
    const mtime = typeof item.mtime === 'number' ? item.mtime : undefined
    notes.push({ id: item.id, title, mtime })
  }
  return notes
}

type IndexParse =
  | { status: 'ok'; notes: NoteMeta[]; legacy: boolean }
  | { status: 'corrupt' }
  | { status: 'future' }

// Recognize the legacy bare-array index (v1) and the current versioned object.
function parseIndexPayload(raw: string): IndexParse {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { status: 'corrupt' }
  }
  if (Array.isArray(data)) {
    return { status: 'ok', notes: parseNotesArray(data), legacy: true }
  }
  if (isRecord(data) && typeof data.v === 'number' && Array.isArray(data.n)) {
    if (data.v > SCHEMA_VERSION) return { status: 'future' }
    return {
      status: 'ok',
      notes: parseNotesArray(data.n),
      legacy: data.v < SCHEMA_VERSION,
    }
  }
  return { status: 'corrupt' }
}

// ---- Low-level KV: Promise-wrapped CloudStorage or localStorage fallback ---
function getCloud(): TelegramCloudStorage | undefined {
  return window.Telegram?.WebApp?.CloudStorage
}

export function kvGet(key: string): Promise<string | null> {
  const cloud = getCloud()
  if (cloud) {
    return new Promise((resolve) => {
      try {
        // Telegram's CloudStorage returns "" (not null) for a missing key —
        // normalize empty/error to null so callers see "no value", never an
        // empty string that would fail to parse.
        cloud.getItem(key, (error, value) =>
          resolve(error || !value ? null : value)
        )
      } catch {
        resolve(null)
      }
    })
  }
  try {
    return Promise.resolve(localStorage.getItem(key) || null)
  } catch {
    return Promise.resolve(null)
  }
}

export function kvSet(key: string, value: string): Promise<void> {
  const cloud = getCloud()
  if (cloud) {
    return new Promise((resolve) => {
      try {
        cloud.setItem(key, value, () => resolve())
      } catch {
        resolve()
      }
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
      try {
        cloud.removeItem(key, () => resolve())
      } catch {
        resolve()
      }
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
      try {
        cloud.getKeys((error, keys) => resolve(error ? [] : keys))
      } catch {
        resolve([])
      }
    })
  }
  try {
    return Promise.resolve(Object.keys(localStorage))
  } catch {
    return Promise.resolve([])
  }
}

// ---- Note operations ------------------------------------------------------
// Never-empty-overwrite guard: refuse to persist an empty index unless the
// caller explicitly allows it (an actual user delete of the last note).
export function saveIndex(notes: NoteMeta[], allowEmpty = false): Promise<void> {
  if (notes.length === 0 && !allowEmpty) return Promise.resolve()
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

// Copy the current index + every note key into bak_* keys (most recent only).
async function backupAll(): Promise<void> {
  const idx = await kvGet(INDEX_KEY)
  if (idx !== null) await kvSet(BAK_INDEX_KEY, idx)
  const keys = await kvKeys()
  for (const k of keys) {
    if (!k.startsWith(NOTE_PREFIX)) continue
    const v = await kvGet(k)
    if (v !== null) await kvSet(`${BAK_PREFIX}${k}`, v)
  }
}

// Reconcile after loading: drop index entries with missing content and delete
// orphan content keys — but PRESERVE rather than wipe on suspicious states.
async function finishReconcile(
  notes: NoteMeta[]
): Promise<{ notes: NoteMeta[]; error: null }> {
  const keys = await kvKeys()
  // getKeys failed/empty but we have notes → don't reconcile (preserve).
  if (keys.length === 0) return { notes, error: null }

  const contentIds = new Set(
    keys
      .filter((k) => k.startsWith(NOTE_PREFIX))
      .map((k) => k.slice(NOTE_PREFIX.length))
  )
  const referenced = new Set(notes.map((n) => n.id))
  const kept = notes.filter((n) => contentIds.has(n.id))

  // Never empty a previously non-empty index via reconciliation (e.g. a
  // transient read failure) — preserve the original entries instead.
  if (kept.length === 0 && notes.length > 0) return { notes, error: null }

  for (const cid of contentIds) {
    if (!referenced.has(cid)) await kvRemove(noteKey(cid))
  }
  if (kept.length !== notes.length) {
    await kvSet(INDEX_KEY, serializeIndex(kept))
  }
  return { notes: kept, error: null }
}

export type InitResult = {
  notes: NoteMeta[]
  error: 'corrupt' | 'future' | null
}

// Startup: migrate (old single list + schema bumps), reconcile, return index.
// On unrecognized/corrupt/future data, PRESERVE the raw value and report an
// error instead of overwriting it.
export async function initNotes(): Promise<InitResult> {
  const idxRaw = await kvGet(INDEX_KEY)

  // Treat a missing OR empty index as "no index yet" (fresh install / not
  // synced), never as corrupt — CloudStorage yields "" for absent keys.
  if (!idxRaw || idxRaw.trim() === '') {
    // Legacy migration: old single "todos" list → first note.
    const old = await kvGet(OLD_KEY)
    if (old !== null) {
      const rows = deserialize(old)
      const id = newId()
      await kvSet(noteKey(id), serialize(rows))
      const notes: NoteMeta[] = [
        { id, title: titleOf(rows), mtime: Date.now() },
      ]
      await kvSet(INDEX_KEY, serializeIndex(notes))
      await kvRemove(OLD_KEY)
      return finishReconcile(notes)
    }
    return { notes: [], error: null } // fresh install
  }

  const parsed = parseIndexPayload(idxRaw)
  if (parsed.status === 'corrupt') return { notes: [], error: 'corrupt' }
  if (parsed.status === 'future') return { notes: [], error: 'future' }

  // Schema migration (e.g. legacy bare-array → versioned): back up first.
  if (parsed.legacy) {
    await backupAll()
    await kvSet(INDEX_KEY, serializeIndex(parsed.notes))
  }

  return finishReconcile(parsed.notes)
}

// ---- Whole-app backup file (local export / import) ------------------------
type BackupFile = {
  app: 'todo-notes'
  v: number
  idx: NoteMeta[]
  notes: Record<string, string>
}

export async function exportAllNotes(): Promise<string> {
  const idxRaw = await kvGet(INDEX_KEY)
  const notes =
    idxRaw && parseIndexPayload(idxRaw).status === 'ok'
      ? (parseIndexPayload(idxRaw) as { notes: NoteMeta[] }).notes
      : []
  const contents: Record<string, string> = {}
  for (const n of notes) {
    const c = await kvGet(noteKey(n.id))
    if (c !== null) contents[n.id] = c
  }
  const file: BackupFile = {
    app: 'todo-notes',
    v: SCHEMA_VERSION,
    idx: notes,
    notes: contents,
  }
  return JSON.stringify(file)
}

// Result of a whole-app import: the new index, or why it was refused.
export type ImportOutcome =
  | { ok: true; notes: NoteMeta[] }
  | { ok: false; reason: 'invalid' | 'limit' }

// Restore every note from a backup file (replaces everything). Auto-backs up
// the current data first. Refuses an invalid file or one over the note cap.
export async function importAllNotes(json: string): Promise<ImportOutcome> {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (!isRecord(data) || !Array.isArray(data.idx) || !isRecord(data.notes)) {
    return { ok: false, reason: 'invalid' }
  }
  const notes = parseBackupNotes(data.idx)
  const contents = data.notes
  if (notes.length === 0) return { ok: false, reason: 'invalid' }
  if (notes.length > MAX_NOTES) return { ok: false, reason: 'limit' }

  await backupAll()

  // Remove existing note content not present in the import.
  const importIds = new Set(notes.map((n) => n.id))
  const keys = await kvKeys()
  for (const k of keys) {
    if (!k.startsWith(NOTE_PREFIX)) continue
    if (!importIds.has(k.slice(NOTE_PREFIX.length))) await kvRemove(k)
  }

  // Write imported content, then the index last.
  for (const n of notes) {
    const c = contents[n.id]
    if (typeof c === 'string') await kvSet(noteKey(n.id), c)
  }
  await kvSet(INDEX_KEY, serializeIndex(notes))
  return { ok: true, notes }
}
