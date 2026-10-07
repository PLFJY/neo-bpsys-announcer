import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { FluentProvider, webDarkTheme, webLightTheme, Button, Menu, MenuItemRadio, MenuList, MenuPopover, MenuTrigger } from '@fluentui/react-components'
import { Desktop20Regular, WeatherMoon20Regular, WeatherSunny20Regular } from '@fluentui/react-icons'

export type ThemeMode = 'system' | 'light' | 'dark'
const themeNames = { system: '跟随系统', light: '浅色模式', dark: '深色模式' }
const ThemeContext = createContext<{ mode: ThemeMode; setMode: (mode: ThemeMode) => void }>({ mode: 'system', setMode: () => {} })
const storedMode = (): ThemeMode => {
  try {
    const mode = localStorage.getItem('neo-bpsys-theme')
    return mode === 'light' || mode === 'dark' ? mode : 'system'
  } catch { return 'system' }
}

export function ThemeRoot({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(storedMode)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const dark = mode === 'dark' || (mode === 'system' && systemDark)
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(query.matches)
    query.addEventListener('change', update)
    update()
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    try { localStorage.setItem('neo-bpsys-theme', mode) } catch { /* Storage can be disabled. */ }
  }, [dark, mode])
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === 'neo-bpsys-theme') setMode(storedMode()) }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  return <ThemeContext.Provider value={{ mode, setMode }}><FluentProvider theme={dark ? webDarkTheme : webLightTheme} className="theme-root">{children}</FluentProvider></ThemeContext.Provider>
}

export function ThemePicker() {
  const { mode, setMode } = useContext(ThemeContext)
  const icon = mode === 'system' ? <Desktop20Regular /> : mode === 'dark' ? <WeatherMoon20Regular /> : <WeatherSunny20Regular />
  return <Menu checkedValues={{ theme: [mode] }} onCheckedValueChange={(_, data) => {
    const selected = data.checkedItems[0]
    if (selected === 'light' || selected === 'dark' || selected === 'system') setMode(selected)
  }}>
    <MenuTrigger disableButtonEnhancement><Button type="button" appearance="subtle" icon={icon} aria-label={`外观：${themeNames[mode]}`} className="theme-picker">{themeNames[mode]}</Button></MenuTrigger>
    <MenuPopover><MenuList aria-label="外观设置">
      <MenuItemRadio name="theme" value="light" icon={<WeatherSunny20Regular />}>浅色模式</MenuItemRadio>
      <MenuItemRadio name="theme" value="dark" icon={<WeatherMoon20Regular />}>深色模式</MenuItemRadio>
      <MenuItemRadio name="theme" value="system" icon={<Desktop20Regular />}>跟随系统</MenuItemRadio>
    </MenuList></MenuPopover>
  </Menu>
}
