import { useEffect, useMemo, useRef, useState } from 'react'
import { type Application, inRange, monthRange, swissDate } from '../lib/orp'
import { buildOrpPdf, type OrpProfile } from '../lib/orp_pdf'
import JobRoomHelper from './job_room_helper'
import OrpAu from './orp_au'
import OrpShare from './orp_share'
import BookmarkPic from './bookmark_pic'
import { sortedCountries, countryName } from '../lib/countries'
import { bookmarklet } from '../lib/jobroom_fill'
import { saveFile, stamp } from '../lib/save_file'
import { isApp } from '../lib/platform'

// 2026-10-13 owner: ORP paperwork in one place - the filled 716.007 PDF for
// any month or "avant chômage", and a Job-Room view with a Copy button per
// field, in Job-Room's order, so nothing is re-typed.

const PROFILE_KEY = 'kworld_jobtrack_orp_profile'
const BM_DONE_KEY = 'kworld_jobtrack_fill_bm_done'  // the green fill button has been dragged to the bar
interface Saved extends OrpProfile { registered: string }

function loadProfile(): Saved {
  try { return { name: '', avs: '', registered: '', ...JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') } }
  catch { return { name: '', avs: '', registered: '' } }
}

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Monday of the week an ISO date falls in
function weekKey(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return iso(d)
}

export default function OrpPanel({ apps, t, onClose, onUpdate }: { apps: Application[]; t: (k: string) => string; onClose: () => void; onUpdate: (id: number, patch: Partial<Application>) => void }) {
  const [profile, setProfile] = useState<Saved>(loadProfile)
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [mode, setMode] = useState<'month' | 'before'>('month')
  // 2026-10-15 owner: user picks the country (never detected from IP)
  const [country, setCountryState] = useState<string>(() => { try { const v = (localStorage.getItem('kworld_jobtrack_country') || 'CH').toUpperCase(); return v } catch { return 'CH' } })
  const setCountry = (c: string) => { setCountryState(c); if (c !== 'CH') setMode('month'); try { localStorage.setItem('kworld_jobtrack_country', c) } catch { /* private mode */ } }
  const lang0 = document.documentElement.lang || 'en'
  // 2026-10-15 owner: auto-pick the country from the IP (first-party /api/country); the user can change it, and that choice wins
  const [detected, setDetected] = useState('')
  useEffect(() => {
    let chosen = ''
    try { chosen = localStorage.getItem('kworld_jobtrack_country') || '' } catch { /* private mode */ }
    if (chosen) return
    fetch('/api/country').then(r => r.json()).then((d: { country?: string }) => {
      if (d.country && /^[A-Z]{2}$/.test(d.country)) { setDetected(d.country); setCountryState(d.country) }
    }).catch(() => { /* offline or local dev: stays Switzerland */ })
  }, [])
  const countries = useMemo(() => {
    const list = sortedCountries(lang0)
    for (const c of [detected, country]) if (c && !list.some(([k]) => k === c)) list.push([c, countryName(c, lang0)])
    return list.sort((a, b) => a[1].localeCompare(b[1], lang0))
  }, [lang0, detected, country])
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState(false)
  const [dragged, setDragged] = useState(false)
  const [step, setStep] = useState<'ask' | 'setup' | 'work'>(() => (import.meta.env.DEV && window.location.search.includes('setup') ? 'setup' : 'ask'))
  const bm = useRef<HTMLAnchorElement>(null)
  useEffect(() => { bm.current?.setAttribute('href', bookmarklet(window.location.origin)) }, [step])
  const [regText, setRegText] = useState(() => (loadProfile().registered ? swissDate(loadProfile().registered) : ''))
  const pickRef = useRef<HTMLInputElement>(null)

  function update(p: Partial<Saved>) {
    const next = { ...profile, ...p }
    setProfile(next)
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  // "avant chômage" = the 3 months before the ORP registration date
  const [from, to, label] = useMemo((): [string, string, string] => {
    if (mode === 'before' && profile.registered) {
      const reg = new Date(profile.registered + 'T12:00:00')
      const start = new Date(reg); start.setMonth(start.getMonth() - 3)
      const end = new Date(reg); end.setDate(end.getDate() - 1)
      return [iso(start), iso(end), 'AVANT CHÔMAGE']
    }
    const [y, m] = month.split('-').map(Number)
    const [a, b] = monthRange(y, m)
    return [a, b, `${MONTHS_FR[m - 1]} ${y}`]
  }, [mode, month, profile.registered])

  const rows = useMemo(() => inRange(apps, from, to), [apps, from, to])
  // ORP Lausanne sheet (2026-10-14): searches before unemployment go into the
  // Job-Room folder of the last month before registration
  const jobRoomMonth = useMemo(() => {
    if (mode === 'before' && profile.registered) {
      const d = new Date(profile.registered + 'T12:00:00'); d.setDate(1); d.setMonth(d.getMonth() - 1)
      return d.toLocaleString(document.documentElement.lang || 'en', { month: 'long', year: 'numeric' })
    }
    const [y, m] = month.split('-').map(Number)
    return new Date(y, m - 1, 15).toLocaleString(document.documentElement.lang || 'en', { month: 'long', year: 'numeric' })
  }, [mode, profile.registered, month])

  // 2026-10-15 owner: the reassurance text follows the registration date (not fixed to September/October)
  const assureText = useMemo(() => {
    if (mode !== 'before' || !profile.registered) return ''
    const lang = document.documentElement.lang || 'en'
    const mn = (d: Date) => d.toLocaleString(lang, { month: 'long' })
    const reg = new Date(profile.registered + 'T12:00:00')
    const folder = new Date(reg.getFullYear(), reg.getMonth() - 1, 15)
    const earlier: string[] = []
    for (let k = 2; k >= 0; k--) earlier.push(mn(new Date(reg.getFullYear(), reg.getMonth() - 1 - k, 15)))
    return t('jr.assure').replace(/\{folder\}/g, mn(folder)).replace(/\{reg\}/g, mn(reg)).replace(/\{earlier\}/g, earlier.join(', '))
  }, [mode, profile.registered, t])

  // weeks in the period with fewer than 2 searches (ORP minimum)
  const shortWeeks = useMemo(() => {
    const counts = new Map<string, number>()
    for (let d = new Date(weekKey(from) + 'T12:00:00'); iso(d) <= to; d.setDate(d.getDate() + 7)) counts.set(iso(d), 0)
    for (const a of rows) counts.set(weekKey(a.date), (counts.get(weekKey(a.date)) ?? 0) + 1)
    return [...counts.entries()].filter(([wk, n]) => n < 2 && wk <= iso(now))
  }, [rows, from, to])

  async function makePdf() {
    if (!profile.name || !profile.avs) return
    setBusy(true)
    try {
      const pdf = await buildOrpPdf(rows, profile, label)
      const slug = mode === 'before' ? 'avant_chomage' : month.replace('-', '_')
      await saveFile(`${stamp()}_preuves_recherches_${slug}.pdf`, pdf, 'application/pdf')
    } finally { setBusy(false) }
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content orp-panel" onClick={e => e.stopPropagation()}>
        <h3>{(() => {
          // 2026-10-15 owner: second line for the country/system ("Switzerland: Job-Room")
          const [first, ...rest] = (country === 'CH' ? t('orp.title') : country === 'AU' ? t('orp.title.au') : t('orp.title.other').replace('{country}', countryName(country, lang0))).split(' - ')
          return <>{first}{rest.length > 0 && <><br />{rest.join(' - ')}</>}</>
        })()}</h3>
        <div className="orp-body">
        {/* 2026-10-14 owner: "too confusing where to start" - three steps: the question, the
            one-time set-up, then only the squares and the card. Numbers go into Details. */}
        {step === 'ask' && (<>
          <p className="orp-stepno">{t('orp.step1of3')}</p>
          <label className="modal-label">{t('orp.country')}
            <select value={country} onChange={e => setCountry(e.target.value)}>
              {countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </label>
          <p className="orp-q orp-label-info">{t('orp.which')}
            {country === 'CH' && <button type="button" className="info-btn info-btn-amber" aria-label={t('orp.info.title')} onClick={() => setInfo(v => !v)}>i</button>}
          </p>
          {country === 'CH' && info && <ul className="orp-before-tip orp-tip-list">{t('orp.beforeTip').split('|').map(x => <li key={x}>{x}</li>)}</ul>}
          {country === 'CH' && <div className="orp-tabs">
            <button className={mode === 'month' ? 'btn' : 'btn-secondary'} onClick={() => setMode('month')}>{t('orp.month')}</button>
            <button className={mode === 'before' ? 'btn' : 'btn-secondary'} onClick={() => setMode('before')}>{t('orp.before')}</button>
          </div>}
        {mode === 'month' && <input type="month" value={month} onChange={e => setMonth(e.target.value)} />}
        {mode === 'before' && (<>
          <label className="modal-label orp-label-info">{t('orp.registered')}</label>
          {/* 2026-10-14 owner: Swiss date format DD.MM.YYYY (the browser's own picker showed MM.DD.YYYY) */}
          <div className="orp-date">
            <input type="text" inputMode="numeric" placeholder="DD.MM.YYYY" value={regText}
              onChange={e => { const v = e.target.value.replace(/[^0-9.]/g, ''); setRegText(v); const m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); if (m) update({ registered: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }) }} />
            <input ref={pickRef} type="date" lang="de-CH" className="orp-date-native" value={profile.registered} tabIndex={-1} aria-hidden="true"
              onChange={e => { update({ registered: e.target.value }); setRegText(swissDate(e.target.value)) }} />
            <button type="button" className="orp-date-btn" aria-label="Calendar" onClick={() => { try { pickRef.current?.showPicker() } catch { pickRef.current?.focus() } }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
            </button>
          </div>
        </>)}

          <button className="btn btn-glow orp-next" disabled={mode === 'before' && !profile.registered}
            onClick={() => setStep(country !== 'CH' ? 'work' : (() => { try { return localStorage.getItem(BM_DONE_KEY) ? 'work' : 'setup' } catch { return 'setup' } })())}>{t('orp.next')}</button>
          {!isApp() && <OrpShare country={country} t={t} />}
        </>)}

        {step === 'setup' && (
          <div className="orp-setup-big">
            {/* 2026-10-15 owner: set-up window = title, one line, the picture, the button. After the drag it remembers and closes. */}
            <p className="orp-setup-h">{t('share.s1')}</p>
            <BookmarkPic barLabel={t('share.barLabel')} button="JobTrack fill" />
            <a ref={bm} className={'jr-bm-link orp-setup-btn' + (dragged ? '' : ' orp-glow')} onDragEnd={() => { try { localStorage.setItem(BM_DONE_KEY, '1') } catch { /* private mode */ } setDragged(true) }} onClick={ev => { ev.preventDefault(); alert(t('jr.bm.notHere')) }}>JobTrack fill</a>
            {dragged
              ? <button type="button" className="btn btn-glow orp-next" onClick={() => setStep('work')}>{t('jr.bm.done2')}</button>
              : <button type="button" className="jr-bm-again" onClick={() => { try { localStorage.setItem(BM_DONE_KEY, '1') } catch { /* private mode */ } setStep('work') }}>{t('jr.bm.have')}</button>}
          </div>
        )}

        {step === 'work' && (<>
          <p className="orp-stepno">{t('orp.step3of3')}</p>
          <p className="orp-choice">{mode === 'before' ? `${t('orp.before')} - ${swissDate(profile.registered)}` : jobRoomMonth}
            {' '}<button type="button" className="jr-bm-again" onClick={() => setStep('ask')}>{t('orp.change')}</button>
</p>
          {country !== 'CH' ? <OrpAu rows={rows} t={t} onUpdate={onUpdate} country={country} /> : <>
          {assureText && <div className="jr-assure-row">
            <svg viewBox="0 0 24 24" className="jr-assure-ico" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18M8 14h3" /></svg>
            <ul className="orp-before-tip jr-assure">{assureText.split('|').map(x => <li key={x}>{x}</li>)}</ul>
          </div>}
          <JobRoomHelper allApps={apps} rows={rows} monthLabel={jobRoomMonth} onUpdate={onUpdate} t={t} onSetup={() => setStep('setup')} />
          </>}
          {country === 'CH' && <details className="orp-details">
            <summary>{t('orp.details2')}</summary>
            <p className="orp-count"><b>{rows.filter(a => a.jobroomDone).length}</b> / {rows.length} {t('jr.entered')} · {swissDate(from)} - {swissDate(to)}</p>
        {shortWeeks.length > 0 && (mode === 'month' || profile.registered) && (
          <details className="orp-weeks">
            <summary>{t('orp.weeksShort').replace('{n}', String(shortWeeks.length))}</summary>
            <p>{t('orp.shortWeeks')}</p>
            <ul>{shortWeeks.map(([wk, n]) => <li key={wk}>{t('orp.weekOf')} {swissDate(wk)}: {n} {n === 1 ? t('orp.search1') : t('orp.searchN')}</li>)}</ul>
          </details>
        )}

        <details className="orp-paper">
          <summary>{t('orp.paper')}</summary>
          <p className="orp-hint">{t('orp.needProfile')}</p>
          <input type="text" placeholder={t('orp.name')} value={profile.name} onChange={e => update({ name: e.target.value })} />
          <input type="text" placeholder={t('orp.avs')} value={profile.avs} onChange={e => update({ avs: e.target.value })} />
          <button className="btn-secondary" disabled={busy || !profile.name || !profile.avs || rows.length === 0} onClick={makePdf}>{busy ? '…' : t('orp.pdf')}</button>
        </details>
          </details>}
        </>)}
        </div>
        {step !== 'setup' && <div className="modal-buttons"><button className="btn-secondary" onClick={onClose}>{t('close')}</button></div>}
      </div>
    </div>
  )
}
