import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from './context/language'
import JobTrack from './pages/job_track'
import './index.css'
import { mirrorToNative, restoreFromNative } from './lib/durable'

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
