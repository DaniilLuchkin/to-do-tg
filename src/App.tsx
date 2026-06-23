import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { loadTodos, saveTodos, type Todo } from './storage'

// Telegram CloudStorage allows at most 4096 characters per value. We store the
// whole list as one JSON string under the key "todos", so the binding limit is
// the serialized length of the array.
const MAX_VALUE_LENGTH = 4096

// Horizontal travel (px) a swipe must exceed to commit an indent/outdent.
const SWIPE_COMMIT_PX = 48

function serialized(todos: Todo[]): number {
  return JSON.stringify(todos).length
}

function createTodo(level: 0 | 1 = 0): Todo {
  return { id: crypto.randomUUID(), text: '', done: false, level }
}

// Reset a textarea to a single line then grow it to fit its content.
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// Light haptic tick on a committed indent/outdent — only inside Telegram.
function hapticLight(): void {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light')
}

// Active swipe gesture state for a single pointer.
type Gesture = {
  pointerId: number
  rowId: string
  startX: number
  startY: number
  // 'pending' until the first decisive move locks the axis.
  mode: 'pending' | 'horizontal' | 'vertical'
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [loaded, setLoaded] = useState(false)
  const [limitReached, setLimitReached] = useState(false)

  // Always-current mirror of `todos`, so event handlers can read the latest
  // committed state synchronously when computing candidate next states.
  const todosRef = useRef<Todo[]>(todos)
  todosRef.current = todos

  // Map of Todo id -> textarea element, so we can move focus imperatively.
  const inputs = useRef<Map<string, HTMLTextAreaElement>>(new Map())
  // The id of the textarea that should receive focus after the next render,
  // and whether the caret should be placed at the end.
  const pendingFocus = useRef<{ id: string; caretEnd: boolean } | null>(null)

  // Map of Todo id -> row wrapper element, used for swipe transforms and
  // pointer capture.
  const rows = useRef<Map<string, HTMLLIElement>>(new Map())
  // The in-flight swipe gesture, if any.
  const gesture = useRef<Gesture | null>(null)

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

  // Debounced persistence (~400ms after the last change). The over-limit guard
  // lives at edit time, so this write can never exceed MAX_VALUE_LENGTH.
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

  // Keep every textarea sized to its content after any state change.
  useEffect(() => {
    inputs.current.forEach((el) => autoGrow(el))
  }, [todos, limitReached])

  const registerInput = useCallback(
    (id: string) => (el: HTMLTextAreaElement | null) => {
      if (el) {
        inputs.current.set(id, el)
        autoGrow(el)
      } else {
        inputs.current.delete(id)
      }
    },
    []
  )

  // Editing a row's text. Growing past the limit is rejected: the textarea is
  // reverted in place and the notice is shown. Anything else is applied.
  const handleChange = useCallback(
    (id: string, event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value
      const base = todosRef.current
      const candidate = base.map((todo) =>
        todo.id === id ? { ...todo, text: value } : todo
      )
      if (serialized(candidate) > MAX_VALUE_LENGTH) {
        const current = base.find((todo) => todo.id === id)
        event.target.value = current ? current.text : ''
        autoGrow(event.target)
        setLimitReached(true)
        return
      }
      setLimitReached(false)
      setTodos(candidate)
      autoGrow(event.target)
    },
    []
  )

  // Toggling done never needs gating — it must always be allowed so the user
  // can keep managing the list even at the cap.
  const toggleDone = useCallback((id: string) => {
    setLimitReached(false)
    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === id ? { ...todo, done: !todo.done } : todo
      )
    )
  }, [])

  // Indent/outdent change only `level`, which never grows the serialized JSON
  // past the cap, so they are always allowed (even when limitReached).
  const indentRow = useCallback((id: string) => {
    const base = todosRef.current
    const row = base.find((todo) => todo.id === id)
    if (!row || row.level === 1) return
    setLimitReached(false)
    setTodos(base.map((todo) => (todo.id === id ? { ...todo, level: 1 } : todo)))
    hapticLight()
  }, [])

  const outdentRow = useCallback((id: string) => {
    const base = todosRef.current
    const row = base.find((todo) => todo.id === id)
    if (!row || row.level === 0) return
    setLimitReached(false)
    setTodos(base.map((todo) => (todo.id === id ? { ...todo, level: 0 } : todo)))
    hapticLight()
  }, [])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>, id: string) => {
      const base = todosRef.current
      const index = base.findIndex((todo) => todo.id === id)
      if (index === -1) return

      // Enter (without Shift) inserts a new empty row after this one. The new
      // row inherits the current row's indent level. Shift+Enter falls through
      // to the textarea's default newline (gated via handleChange).
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        const next = createTodo(base[index].level)
        const candidate = base.slice()
        candidate.splice(index + 1, 0, next)
        if (serialized(candidate) > MAX_VALUE_LENGTH) {
          setLimitReached(true)
          return
        }
        setLimitReached(false)
        setTodos(candidate)
        pendingFocus.current = { id: next.id, caretEnd: false }
        return
      }

      // Tab indents the row one level (0 -> 1). Shift+Tab outdents (1 -> 0).
      if (event.key === 'Tab') {
        event.preventDefault()
        if (event.shiftKey) outdentRow(id)
        else indentRow(id)
        return
      }

      // Backspace on an empty row deletes it and moves focus to the previous
      // row. The last remaining row is never deleted.
      if (event.key === 'Backspace' && event.currentTarget.value === '') {
        event.preventDefault()
        if (base.length <= 1) return
        if (index <= 0) return
        pendingFocus.current = { id: base[index - 1].id, caretEnd: true }
        setLimitReached(false)
        setTodos(base.filter((todo) => todo.id !== id))
      }
    },
    [indentRow, outdentRow]
  )

  // Reset a row's swipe transform, animating back to rest.
  const resetRowTransform = useCallback((rowId: string) => {
    const el = rows.current.get(rowId)
    if (!el) return
    el.style.transition = 'transform 120ms ease'
    el.style.transform = 'translateX(0)'
  }, [])

  const registerRow = useCallback(
    (id: string) => (el: HTMLLIElement | null) => {
      if (el) rows.current.set(id, el)
      else rows.current.delete(id)
    },
    []
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>, id: string) => {
      // Let the checkbox handle its own taps; never start a swipe there.
      if (event.target instanceof Element && event.target.closest('.checkbox')) {
        return
      }
      gesture.current = {
        pointerId: event.pointerId,
        rowId: id,
        startX: event.clientX,
        startY: event.clientY,
        mode: 'pending',
      }
    },
    []
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const g = gesture.current
      if (!g || g.pointerId !== event.pointerId) return
      const dx = event.clientX - g.startX
      const dy = event.clientY - g.startY

      // Decide the gesture axis once.
      if (g.mode === 'pending') {
        if (Math.abs(dy) > Math.abs(dx)) {
          // Vertical: hand off to native scrolling and stop tracking.
          g.mode = 'vertical'
          return
        }
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
          g.mode = 'horizontal'
          const el = rows.current.get(g.rowId)
          if (el) {
            el.style.transition = ''
            try {
              el.setPointerCapture(event.pointerId)
            } catch {
              // Capture can fail if the pointer already ended; ignore.
            }
          }
        } else {
          return
        }
      }

      if (g.mode === 'horizontal') {
        // Stop caret placement / text selection while dragging horizontally.
        event.preventDefault()
        const el = rows.current.get(g.rowId)
        if (el) {
          const damped = Math.max(-56, Math.min(56, dx * 0.4))
          el.style.transform = `translateX(${damped}px)`
        }
      }
    },
    []
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const g = gesture.current
      if (!g || g.pointerId !== event.pointerId) return
      gesture.current = null

      const el = rows.current.get(g.rowId)
      if (el) {
        try {
          el.releasePointerCapture(event.pointerId)
        } catch {
          // Already released; ignore.
        }
      }
      resetRowTransform(g.rowId)

      if (g.mode === 'horizontal') {
        const dx = event.clientX - g.startX
        if (dx > SWIPE_COMMIT_PX) indentRow(g.rowId)
        else if (dx < -SWIPE_COMMIT_PX) outdentRow(g.rowId)
      }
    },
    [indentRow, outdentRow, resetRowTransform]
  )

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLLIElement>) => {
      const g = gesture.current
      if (!g || g.pointerId !== event.pointerId) return
      gesture.current = null

      const el = rows.current.get(g.rowId)
      if (el) {
        try {
          el.releasePointerCapture(event.pointerId)
        } catch {
          // Already released; ignore.
        }
      }
      resetRowTransform(g.rowId)
    },
    [resetRowTransform]
  )

  return (
    <main className="app">
      <ul className="list">
        {todos.map((todo) => (
          <li
            className={`row${todo.level === 1 ? ' sub' : ''}`}
            key={todo.id}
            ref={registerRow(todo.id)}
            onPointerDown={(event) => handlePointerDown(event, todo.id)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          >
            <button
              type="button"
              className={`checkbox${todo.done ? ' checked' : ''}`}
              aria-pressed={todo.done}
              aria-label={todo.done ? 'Mark as not done' : 'Mark as done'}
              onClick={() => toggleDone(todo.id)}
            >
              {todo.done ? '✓' : ''}
            </button>
            <textarea
              ref={registerInput(todo.id)}
              className={`text${todo.done ? ' done' : ''}`}
              rows={1}
              value={todo.text}
              placeholder="New task"
              onChange={(event) => handleChange(todo.id, event)}
              onKeyDown={(event) => handleKeyDown(event, todo.id)}
            />
          </li>
        ))}
      </ul>
      {limitReached && (
        <p className="notice">
          Storage limit reached — delete or shorten a task to continue.
        </p>
      )}
    </main>
  )
}
