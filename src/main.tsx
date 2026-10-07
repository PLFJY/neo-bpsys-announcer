import React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeRoot } from './theme'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ThemeRoot><App /></ThemeRoot></React.StrictMode>,
)
