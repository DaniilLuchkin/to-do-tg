import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles.css'

const webApp = window.Telegram?.WebApp
webApp?.ready()
webApp?.expand?.()

const theme = webApp?.themeParams
if (theme) {
  const root = document.documentElement
  const set = (name: string, value: string | undefined) => {
    if (value) root.style.setProperty(name, value)
  }
  set('--bg', theme.bg_color)
  set('--surface', theme.secondary_bg_color)
  set('--text', theme.text_color)
  set('--hint', theme.hint_color)
  set('--separator', theme.section_separator_color)
  set('--accent', theme.button_color)
  set('--accent-text', theme.button_text_color)
  set('--danger', theme.destructive_text_color)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
