import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from './context/language'
import JobTrack from './pages/job_track'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <JobTrack />
    </LanguageProvider>
  </StrictMode>,
)
