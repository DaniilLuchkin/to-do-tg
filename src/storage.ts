export type Todo = { id: string; text: string; done: boolean; level: 0 | 1 }

const STORAGE_KEY = 'todos'

function getCloudStorage(): TelegramCloudStorage | undefined {
  return window.Telegram?.WebApp?.CloudStorage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseTodos(raw: string | null): Todo[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const result: Todo[] = []
    for (const item of parsed) {
      if (!isRecord(item)) continue
      if (typeof item.id !== 'string') continue
      if (typeof item.text !== 'string') continue
      if (typeof item.done !== 'boolean') continue
      // Migration: previously saved lists have no `level` — default to 0.
      const level: 0 | 1 = item.level === 1 ? 1 : 0
      result.push({ id: item.id, text: item.text, done: item.done, level })
    }
    return result
  } catch {
    return []
  }
}

export function loadTodos(): Promise<Todo[]> {
  const cloud = getCloudStorage()
  if (cloud) {
    return new Promise<Todo[]>((resolve) => {
      cloud.getItem(STORAGE_KEY, (error, value) => {
        if (error) {
          resolve([])
          return
        }
        resolve(parseTodos(value))
      })
    })
  }

  try {
    return Promise.resolve(parseTodos(localStorage.getItem(STORAGE_KEY)))
  } catch {
    return Promise.resolve([])
  }
}

export function saveTodos(todos: Todo[]): Promise<void> {
  const value = JSON.stringify(todos)
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
