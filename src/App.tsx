import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { loadTodos, saveTodos, type Todo } from './storage'

function createTodo(): Todo {
  return { id: crypto.randomUUID(), text: '', done: false }
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [loaded, setLoaded] = useState(false)

  // Map of Todo id -> input element, so we can move focus imperatively.
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map())
  // The id of the input that should receive focus after the next render,
  // and whether the caret should be placed at the end.
  const pendingFocus = useRef<{ id: string; caretEnd: boolean } | null>(null)

  // Initial load. Always guarantee at least one row to type into.
  useEffect(() => {
    let active = true
    loadTodos().then((stored) => {
      if (!active) return
      setTodos(stored.length > 0 ? stored : [createTodo()])
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [])

  // Debounced persistence (~400ms after the last change).
  useEffect(() => {
    if (!loaded) return
    const handle = window.setTimeout(() => {
      void saveTodos(todos)
    }, 400)
    return () => window.clearTimeout(handle)
  }, [todos, loaded])

  // Apply any pending focus request once the DOM reflects the new list.
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    const el = inputs.current.get(target.id)
    if (!el) return
    el.focus()
    if (target.caretEnd) {
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
  }, [todos])

  const registerInput = useCallback(
    (id: string) => (el: HTMLInputElement | null) => {
      if (el) inputs.current.set(id, el)
      else inputs.current.delete(id)
    },
    []
  )

  const updateText = useCallback((id: string, text: string) => {
    setTodos((prev) =>
      prev.map((todo) => (todo.id === id ? { ...todo, text } : todo))
    )
  }, [])

  const toggleDone = useCallback((id: string) => {
    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === id ? { ...todo, done: !todo.done } : todo
      )
    )
  }, [])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>, id: string) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        const next = createTodo()
        setTodos((prev) => {
          const index = prev.findIndex((todo) => todo.id === id)
          if (index === -1) return prev
          const copy = prev.slice()
          copy.splice(index + 1, 0, next)
          return copy
        })
        pendingFocus.current = { id: next.id, caretEnd: false }
        return
      }

      if (event.key === 'Backspace' && event.currentTarget.value === '') {
        event.preventDefault()
        setTodos((prev) => {
          if (prev.length <= 1) return prev
          const index = prev.findIndex((todo) => todo.id === id)
          if (index <= 0) return prev
          pendingFocus.current = { id: prev[index - 1].id, caretEnd: true }
          return prev.filter((todo) => todo.id !== id)
        })
      }
    },
    []
  )

  return (
    <main className="app">
      <ul className="list">
        {todos.map((todo) => (
          <li className="row" key={todo.id}>
            <button
              type="button"
              className={`checkbox${todo.done ? ' checked' : ''}`}
              aria-pressed={todo.done}
              aria-label={todo.done ? 'Mark as not done' : 'Mark as done'}
              onClick={() => toggleDone(todo.id)}
            >
              {todo.done ? '✓' : ''}
            </button>
            <input
              ref={registerInput(todo.id)}
              className={`text${todo.done ? ' done' : ''}`}
              type="text"
              value={todo.text}
              placeholder="New task"
              onChange={(event) => updateText(todo.id, event.target.value)}
              onKeyDown={(event) => handleKeyDown(event, todo.id)}
            />
          </li>
        ))}
      </ul>
    </main>
  )
}
