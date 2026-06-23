export type Todo = { id: string; text: string; done: boolean }

const STORAGE_KEY = 'todos'

function getCloudStorage(): TelegramCloudStorage | undefined {
  return window.Telegram?.WebApp?.CloudStorage
}

function parseTodos(raw: string | null): Todo[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is Todo =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Todo).id === 'string' &&
        typeof (item as Todo).text === 'string' &&
        typeof (item as Todo).done === 'boolean'
    )
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
