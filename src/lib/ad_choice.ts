// 2026-10-19 owner: ads for visitors who do not choose privacy. 'private' = no Google ad script, our own
// promo cards still show; 'ads' = Google ads as before; none yet = ads on, banner asks once.
import { useEffect, useState } from 'react'

const KEY = 'kworld_no_ads'
const EVENT = 'kworld-ad-choice'
export type AdChoice = '' | 'private' | 'ads'

export function readAdChoice(): AdChoice {
  try { const v = localStorage.getItem(KEY); return v === '1' ? 'private' : v === '0' ? 'ads' : '' } catch { return '' }
}
export function setAdChoice(c: 'private' | 'ads') {
  try { localStorage.setItem(KEY, c === 'private' ? '1' : '0') } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVENT))
  // Google's script may already be running in this page: a fresh load drops it
  if (c === 'private') window.location.reload()
}
export function useAdChoice(): AdChoice {
  const [c, setC] = useState<AdChoice>(readAdChoice)
  useEffect(() => { const f = () => setC(readAdChoice()); window.addEventListener(EVENT, f); return () => window.removeEventListener(EVENT, f) }, [])
  return c
}

// 2026-10-19: EU / EEA / UK visitors must opt in before any Google ad code loads. Country comes from our own
// edge (/api/country, nothing stored). Until it is known, and until they tap "Allow ads", only our own cards show.
const CONSENT_COUNTRIES = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO','GB'])
let countryOnce: Promise<string> | null = null
function visitorCountry(): Promise<string> {
  countryOnce ??= fetch('/api/country').then(r => r.json()).then(d => String(d.country || '')).catch(() => '')
  return countryOnce
}
export function useAdsAllowed(): boolean {
  const choice = useAdChoice()
  const [country, setCountry] = useState<string | null>(null)
  useEffect(() => { if (choice === '') visitorCountry().then(setCountry) }, [choice])
  if (choice === 'ads') return true
  if (choice === 'private') return false
  return !!country && !CONSENT_COUNTRIES.has(country)
}
