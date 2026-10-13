import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export type Lang = 'en' | 'de' | 'fr'

type Ctx = { lang: Lang; setLang: (l: Lang) => void }

const LanguageContext = createContext<Ctx>({ lang: 'en', setLang: () => {} })

const STORAGE_KEY = 'kworld-lang'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'de' || stored === 'fr' ? stored : 'en'
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang)
    document.documentElement.lang = lang
  }, [lang])

  return (
    <LanguageContext.Provider value={{ lang, setLang: setLangState }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => useContext(LanguageContext)
