import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { isApp } from '../lib/platform'

export type Lang = 'en' | 'de' | 'fr'

type Ctx = { lang: Lang; setLang: (l: Lang) => void }

const LanguageContext = createContext<Ctx>({ lang: 'en', setLang: () => {} })

const STORAGE_KEY = 'kworld-lang'
const CHOSEN_KEY = 'kworld-lang-chosen'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    // 2026-11-15 owner: the app follows the phone's language until the person picks one in Settings
    if (isApp() && localStorage.getItem(CHOSEN_KEY) !== '1') {
      const phone = (navigator.language || '').slice(0, 2).toLowerCase()
      return phone === 'de' || phone === 'fr' ? phone : 'en'
    }
    return stored === 'de' || stored === 'fr' ? stored : 'en'
  })
  const setLang = (l: Lang) => { try { localStorage.setItem(CHOSEN_KEY, '1') } catch { /* private mode */ } setLangState(l) }

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => useContext(LanguageContext)
