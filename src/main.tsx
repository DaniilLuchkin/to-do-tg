import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles.css'

const webApp = window.Telegram?.WebApp
webApp?.ready()
webApp?.expand()

const theme = webApp?.themeParams
if (theme) {
  const root = document.documentElement
  if (theme.bg_color) root.style.setProperty('--bg', theme.bg_color)
  if (theme.text_color) root.style.setProperty('--text', theme.text_color)
  if (theme.hint_color) root.style.setProperty('--hint', theme.hint_color)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
