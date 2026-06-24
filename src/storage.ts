export type Row = {
  id: string
  text: string
  checkbox: boolean
  done: boolean
  level: 0 | 1
}

const STORAGE_KEY = 'todos'

// Compact on-disk shape: short keys, defaults omitted to save characters.
//   i = id (always)        t = text (omit when "")
//   c = 1 when checkbox    d = 1 when done       l = 1 when level === 1
type StoredRow = { i: string; t?: string; c?: 1; d?: 1; l?: 1 }

// Convert in-memory rows to the tight JSON string that actually gets stored.
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

// Parse the stored string back into full rows, restoring omitted defaults.
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
      // `done` only applies to checkbox rows.
      const done = checkbox && item.d === 1
      const level: 0 | 1 = item.l === 1 ? 1 : 0
      rows.push({ id: item.i, text, checkbox, done, level })
    }
    return rows
  } catch {
    return []
  }
}

function getCloudStorage(): TelegramCloudStorage | undefined {
  return window.Telegram?.WebApp?.CloudStorage
}

// Plain-text export: one line per row, round-trippable with textToRows.
//   plain level 0:  "<text>"          plain level 1:  "  <text>"
//   checkbox:       "- [ ] <text>"    checked:        "- [x] <text>"
//   (level 1 prefixes the whole thing with two spaces; empty row -> empty line)
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

export function loadRows(): Promise<Row[]> {
  const cloud = getCloudStorage()
  if (cloud) {
    return new Promise<Row[]>((resolve) => {
      cloud.getItem(STORAGE_KEY, (error, value) => {
        if (error) {
          resolve([])
          return
        }
        resolve(deserialize(value))
      })
    })
  }

  try {
    return Promise.resolve(deserialize(localStorage.getItem(STORAGE_KEY)))
  } catch {
    return Promise.resolve([])
  }
}

export function saveRows(rows: Row[]): Promise<void> {
  const value = serialize(rows)
  const cloud = getCloudStorage()
  if (cloud) {
    return new Promise<void>((resolve) => {
      cloud.setItem(STORAGE_KEY, value, () => {
        resolve()
      })
    })
  }

  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Ignore write failures (e.g. private mode / quota) — persistence is best effort.
  }
  return Promise.resolve()
}
