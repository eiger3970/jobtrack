import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from './context/language'
import JobTrack from './pages/job_track'
import './index.css'
import { mirrorToNative, restoreFromNative } from './lib/durable'

// 2026-11-09: the website pages call relative paths (/api/fill-ok, /api/country, ...); inside the app those must go to kworld.space
const nativeFetch = window.fetch.bind(window)
window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
  typeof input === 'string' && /^\/(api|owner)\//.test(input) ? nativeFetch('https://kworld.space' + input, init) : nativeFetch(input, init)

// native copy first, so the tracker reads restored data on its first render
restoreFromNative().catch(() => {}).finally(() => {
  mirrorToNative()
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <JobTrack />
    </LanguageProvider>
  </StrictMode>,
  )
})
