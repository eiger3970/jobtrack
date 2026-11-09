import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type Application, inRange, monthRange, swissDate, jobRoomEntry, jobRoomMissing } from '../lib/orp'
import { buildOrpPdf, type OrpProfile } from '../lib/orp_pdf'
import JobRoomHelper, { resetJobRoomSelection } from './job_room_helper'
import OrpAu from './orp_au'
import OrpShare, { SHARE_CREDIT } from './orp_share'
import BookmarkDrag from './bookmark_drag'
import brainSideIcon from '../assets/jobtrack_brain_side.svg'
import localSyncIcon from '../assets/localsync_icon.png'
import { TapCount } from './find_details'
import { sortedCountries, countryName } from '../lib/countries'
import { bookmarklet } from '../lib/jobroom_fill'
import { saveFile, stamp } from '../lib/save_file'
import { isApp } from '../lib/platform'
import { useProKey, buyPro } from '../lib/pro'
import { PRO_KEY, PRO_USD, PRO_SCOPE } from './job_track_pro'

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

export default function OrpPanel({ apps, t, onClose, onUpdate, initialCleanup = false }: { apps: Application[]; t: (k: string) => string; onClose: () => void; onUpdate: (id: number, patch: Partial<Application>) => void; initialCleanup?: boolean; onSync?: () => void }) {
  const [profile, setProfile] = useState<Saved>(loadProfile)
  const [cleanup, setCleanup] = useState(initialCleanup)
  const mobile = isApp() || (typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) || (typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 760px)').matches)

  const now = new Date()
  const [month, setMonth] = useState((import.meta.env.DEV && window.location.hash === '#preview=jobroom' && new URLSearchParams(window.location.search).get('view') === 'report' ? '2026-10' : '') || profile.registered?.slice(0, 7) || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [mode, setMode] = useState<'month' | 'before'>('month')
  const [periodChosen, setPeriodChosen] = useState(false)
  const [entryChosen, setEntryChosen] = useState(false)
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
  const [fillReady, setFillReady] = useState(false)
  const [entryMode, setEntryMode] = useState<'manual' | 'autofill'>('autofill')
  const [step, setStep] = useState<'ask' | 'setup' | 'work'>(() => initialCleanup || (typeof window !== 'undefined' && (new URLSearchParams(window.location.search).get('share') === '1' || (import.meta.env.DEV && new URLSearchParams(window.location.search).get('view') === 'report'))) ? 'work' : (import.meta.env.DEV && !mobile && window.location.search.includes('setup') ? 'setup' : 'ask'))
  const panelRef = useRef<HTMLDivElement>(null)
  const [chooserTop, setChooserTop] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (step !== 'ask') { setChooserTop(null); return }
    if (panelRef.current) setChooserTop(panelRef.current.getBoundingClientRect().top)
  }, [step])
  const bm = useRef<HTMLAnchorElement>(null)
  useEffect(() => { bm.current?.setAttribute('href', bookmarklet(window.location.origin)) }, [step])
  const [regText, setRegText] = useState(() => swissDate(profile.registered || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`))
  const fillNextRef = useRef<HTMLButtonElement>(null)
  const { pro: webPro } = useProKey(PRO_KEY, 'jobtrack-pro-')
  const hasPro = webPro || isApp()
  const pickRef = useRef<HTMLInputElement>(null)
  const registeredRef = useRef<HTMLButtonElement>(null)

  function update(p: Partial<Saved>) {
    const next = { ...profile, ...p }
    setProfile(next)
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }

  function openDatePicker() {
    setPeriodChosen(true)
    const picker = pickRef.current
    try { picker?.showPicker() } catch { picker?.focus({ preventScroll: true }) }
  }

  function openSelectedPeriod() {
    setFillReady(false)
    setEntryChosen(false)
    setStep('work')
  }
  function selectRegistration(registered: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(registered)) return
    const parsed = new Date(registered + 'T12:00:00Z')
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== registered) return
    setPeriodChosen(true)
    setMonth(registered.slice(0, 7))
    if (mode === 'before') update({ registered })
    setRegText(swissDate(registered))
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

  const rows = useMemo(() => cleanup ? apps : inRange(apps, from, to), [apps, cleanup, from, to])
  const allEntered = rows.length > 0 && rows.every(a => !!a.jobroomDone)
  useEffect(() => () => resetJobRoomSelection(), [])
  useEffect(() => {
    if (step !== 'work' || !allEntered || fillReady) return
    const frame = requestAnimationFrame(() => fillNextRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [step, allEntered, fillReady])

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

  // the same three rules as short chips; the full sentences sit behind the i
  const assureShort = useMemo(() => {
    if (mode !== 'before' || !profile.registered) return ''
    const lang = document.documentElement.lang || 'en'
    const mn = (d: Date) => d.toLocaleString(lang, { month: 'long' })
    const reg = new Date(profile.registered + 'T12:00:00')
    return t('jr.assureShort').replace(/\{folder\}/g, mn(new Date(reg.getFullYear(), reg.getMonth() - 1, 15))).replace(/\{reg\}/g, mn(reg))
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

  const enteredParts = regText.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  const enteredRegistration = enteredParts ? `${enteredParts[3]}-${enteredParts[2].padStart(2, '0')}-${enteredParts[1].padStart(2, '0')}` : ''
  const enteredDate = new Date(enteredRegistration + 'T12:00:00Z')
  const periodValid = mode === 'month' ? /^\d{4}-(0[1-9]|1[0-2])$/.test(month) : !!enteredRegistration && !Number.isNaN(enteredDate.getTime()) && enteredDate.toISOString().slice(0, 10) === enteredRegistration

  const fillNext = (glow: boolean) => (!mobile && country === 'CH' && !fillReady) ? <button ref={fillNextRef} type="button" className={(glow ? 'btn btn-glow jt-guidance-glow' : 'btn-secondary') + ' jt-fill-next'} onClick={() => { if (entryMode === 'autofill') { setDragged(false); setStep('setup') } else setFillReady(true) }}>{t('orp.nextStep')}</button> : null
  const fillChoice = <>
          {!mobile && country === 'CH' && <fieldset aria-labelledby="orp-entry-heading" className={'orp-entry-choice' + (!fillReady && !entryChosen ? ' jr-glow' : '')}>
            <div id="orp-entry-heading" className="orp-entry-heading">{t('entry.choose')}</div>
            {(['autofill', 'manual'] as const).map((value, n) => {
              const effort = value === 'autofill' ? 6 : 2
              const effortColor = effort <= 3 ? '#00ff41' : effort <= 6 ? '#ffb000' : '#e05a5a'
              const tint = [1, 3, 5].map(at => parseInt(effortColor.slice(at, at + 2), 16) / 255)
              return <label key={value}>
              <input type="radio" name="jobtrack-entry-mode" value={value} checked={entryMode === value} onClick={() => { setEntryChosen(true); setFillReady(false) }} onChange={() => setEntryMode(value)} />
              <span className="orp-entry-description"><strong>3.2.{n + 1} {t(`entry.${value}`)}</strong>
                <span className="orp-entry-counts"><span>{t('entry.useCount')} <TapCount n={value === 'autofill' ? 3 : 14} label={t('fd.tapsAria')} /></span><span title={t(value === 'autofill' ? 'entry.setupHint' : 'entry.noSetup')}>{t('entry.setupCount')} <TapCount n={value === 'autofill' ? 3 : 0} label={t('entry.setupAria')} /></span><span>{t('entry.effort')} <svg className="orp-effort-brain" width="43" height="34" viewBox="0 0 512 400" role="img" aria-label={t('entry.effortAria').replace('{n}', String(effort))}>
                  <defs>
                    <linearGradient id={`entry-brain-feather-${value}`} gradientUnits="userSpaceOnUse" x1={480 - 440 * effort / 10 - 24} x2={480 - 440 * effort / 10 + 24} y1="0" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0"/><stop offset="1" stopColor="#fff" stopOpacity="1"/></linearGradient>
                    <mask id={`entry-brain-fill-${value}`} maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="400"><rect width="512" height="290" fill={`url(#entry-brain-feather-${value})`}/></mask>
                    <filter id={`entry-brain-tint-${value}`} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={`${tint[0] * .35} 0 0 0 ${tint[0] * .65} ${tint[1] * .35} 0 0 0 ${tint[1] * .65} ${tint[2] * .35} 0 0 0 ${tint[2] * .65} 0 0 0 1 0`}/></filter>
                  </defs>
                  <image href={brainSideIcon} width="512" height="400"/>
                  <g mask={`url(#entry-brain-fill-${value})`}><image href={brainSideIcon} width="512" height="400" filter={`url(#entry-brain-tint-${value})`}/><g className="orp-neurons" fill="#fff" stroke="#fff" strokeWidth="3" aria-hidden="true"><path d="M465 130 430 90 400 130 365 80 330 140 290 100 250 150 210 110 170 150 120 110 70 160M430 90 410 55M400 130 420 190 460 215M330 140 350 200 310 240M250 150 270 210 230 245M170 150 150 210 100 230" fill="none" opacity=".3"/>{['M465 130 430 90 400 130 365 80 330 140 290 100 250 150 210 110 170 150 120 110 70 160','M430 90 410 55','M400 130 420 190 460 215','M330 140 350 200 310 240','M250 150 270 210 230 245','M170 150 150 210 100 230'].map((d,i) => <path key={d} className="orp-neuron-link" d={d} fill="none" style={{ animationDelay: `${i * .45}s` }}/>)}{[[465,130],[430,90],[400,130],[365,80],[330,140],[290,100],[250,150],[210,110],[170,150],[120,110],[70,160],[410,55],[420,190],[460,215],[350,200],[310,240],[270,210],[230,245],[150,210],[100,230]].map(([x,y],i) => <circle key={i} className="orp-neuron" cx={x} cy={y} r="5" style={{ animationDelay: `${i * .2}s` }}/>)}</g></g>
                  <text x="300" y="170" textAnchor="middle" fill="#03020a" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="104">{effort}/10</text>
                </svg></span></span>
                {value === 'autofill' && <small>{t('entry.autofillInfo')}{!hasPro && <> <button type="button" className="btn-secondary jr-bm-back" onClick={ev => { ev.preventDefault(); ev.stopPropagation(); buyPro({ scope: PRO_SCOPE, amount: PRO_USD, title: 'JobTrack Pro', subtitle: t('jr.proSub') }) }}>{t('jr.proBtn')}</button></>}</small>}
              </span>
            </label>})}
          </fieldset>}
  </>

  return (
    <div className="modal" style={step === 'ask' && chooserTop !== null ? { alignItems: 'flex-start', paddingTop: chooserTop, boxSizing: 'border-box' } : undefined} onClick={onClose}>
      <div ref={panelRef} className={'modal-content orp-panel' + (step === 'ask' ? ' orp-chooser' : '')} style={step === 'ask' && chooserTop !== null ? { maxHeight: `calc(100dvh - ${chooserTop}px - 16px)` } : undefined} onClick={e => e.stopPropagation()}>
        <h3>{(() => {
          // 2026-10-15 owner: second line for the country/system ("Switzerland: Job-Room")
          const [first, ...rest] = (country === 'CH' ? t('orp.title') : country === 'AU' ? t('orp.title.au') : t('orp.title.other').replace('{country}', countryName(country, lang0))).split(' - ')
          return <>{first}{rest.length > 0 && <><br />{rest.join(' - ')}</>}</>
        })()}</h3>
        <div className={'orp-body' + (step === 'work' ? ' orp-room' : '')}>
        {/* 2026-10-14 owner: "too confusing where to start" - three steps: the question, the
            one-time set-up, then only the squares and the card. Numbers go into Details. */}
        {step === 'ask' && (<>
          <p className="orp-stepno">{t('orp.step1of3')}</p>
          <label className="modal-label">{t('orp.country')}
            <select value={country} onChange={e => setCountry(e.target.value)}>
              {countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
            {country !== 'CH' && <input type="month" value={month} onFocus={() => setPeriodChosen(true)} onChange={e => setMonth(e.target.value)} />}
          </label>
          <p className="orp-q orp-label-info">{t('orp.which')}
            {country === 'CH' && <button type="button" className="info-btn info-btn-amber" aria-label={t('orp.info.title')} onClick={() => setInfo(v => !v)}>i</button>}
          </p>
          {country === 'CH' && info && <ul className="orp-before-tip orp-tip-list">{t('orp.beforeTip').split('|').map(x => <li key={x}>{x}</li>)}</ul>}
          {country === 'CH' && <div className={'orp-tabs' + (!periodChosen ? ' jr-glow' : '')}>
            <button className={mode === 'month' ? 'btn' : 'btn-secondary'} onClick={() => { setMode('month'); setPeriodChosen(true); setEntryChosen(false) }}>{t('orp.month')}</button>
            <div className="orp-before-row">
            <button className={mode === 'before' ? 'btn' : 'btn-secondary'} onClick={() => { setMode('before'); setPeriodChosen(true); setEntryChosen(false); if (!enteredRegistration) openDatePicker(); else setTimeout(() => registeredRef.current?.focus({ preventScroll: true }), 0) }}>{t('orp.before')}</button>
              <div className="orp-registration-date">
          {/* 2026-10-14 owner: Swiss date format DD.MM.YYYY (the browser's own picker showed MM.DD.YYYY) */}
          <div className="orp-date">
            <button ref={registeredRef} id="orp-registered-text" type="button" className="orp-date-value" aria-label={t('table.date')} onClick={openDatePicker}>{regText || 'DD.MM.YYYY'}</button>
            <input ref={pickRef} type="date" lang="de-CH" className="orp-date-native" value={enteredRegistration} tabIndex={-1} aria-hidden="true"
              onChange={e => selectRegistration(e.target.value)} />
            <button type="button" className="orp-date-btn" aria-label="Calendar" onClick={openDatePicker}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
            </button>
          </div>
          <div className={'orp-date-caption' + (mode === 'before' ? ' is-visible' : '')} aria-hidden={mode !== 'before'}><div>
          <label className="modal-label orp-label-info" htmlFor="orp-registered-text">{t('orp.registered')}</label>
          </div></div>
              </div>
            </div>
          </div>}





        </>)}

        {step === 'setup' && !mobile && (
          <div className="orp-setup-big">
            {/* 2026-10-15 owner: set-up window = title, one line, the picture, the button. After the drag it remembers and closes. */}
            <BookmarkDrag bm={bm} label="Job-Room fill" barLabel={t('share.barLabel')} title={t('share.s1')} how={t('bm.retry')} notHere={t('jr.bm.notHere')} onDragged={() => setDragged(true)} />
            {dragged
              ? <button type="button" className="btn btn-glow jt-guidance-glow orp-next" onClick={() => { try { localStorage.setItem(BM_DONE_KEY, '1') } catch { /* private mode */ } setFillReady(true); setStep('work') }}>{t('jr.bm.done2')}</button>
              : <button type="button" className="jr-bm-again" onClick={() => { try { localStorage.setItem(BM_DONE_KEY, '1') } catch { /* private mode */ } setFillReady(true); setStep('work') }}>{t('jr.bm.have')}</button>}
          </div>
        )}

        {step === 'work' && (<>
          {cleanup && <p className="orp-stepno">{t('cleanup.title')}</p>}
          <p className="orp-choice"><span className="orp-chip" title={mode === 'before' ? t('orp.before') : undefined}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6 H20 V20 H4 Z M4 10 H20 M8 3 V7 M16 3 V7" /></svg>{cleanup ? t('cleanup.all') : mode === 'before' ? `${t('orp.beforeShort')} ${swissDate(profile.registered)}` : jobRoomMonth}</span>
            {' '}<button type="button" className="jr-bm-again" onClick={() => { setCleanup(false); setStep('ask') }}>{t(cleanup ? 'cleanup.report' : 'orp.change')}</button>
</p>
          {country === 'CH' && !cleanup && rows.length > 0 && (() => {
            // squares like the ones in 3.1: green entered, amber ready to enter, red needs completing
            const todo = rows.filter(a => !a.jobroomDone), red = todo.filter(a => jobRoomMissing(jobRoomEntry(a)).length > 0).length, amber = todo.length - red, entered = rows.length - todo.length
            const label = t(todo.length ? 'orp.toEnter' : 'orp.allEntered').replace('{n}', String(todo.length || rows.length))
            // 2026-11-03 owner: "Go through the jobs below" sits to the right of the squares
            return <div className="orp-counts-row">
              <p className="orp-counts" role="img" aria-label={label} title={label}>
                {amber > 0 && <span className="orp-sq">{amber}</span>}
                {red > 0 && <span className="orp-sq need">{red}</span>}
                {entered > 0 && <span className="orp-sq done">{entered}</span>}
              </p>
              <p className="orp-hint">{t(mobile ? 'orp.workHintPhone' : 'orp.workHint')}</p>
            </div>
          })()}
          {country === 'CH' && !cleanup && <details className="orp-details">
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
          {!cleanup && assureText && <div className="jr-assure-chips">
            {assureShort.split('|').map((x, i) => <span key={x} className="orp-chip"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={['M4 6 H20 V20 H4 Z M4 10 H20 M8 3 V7 M16 3 V7', 'M12 3 L21 8 L12 13 L3 8 Z M3 12 L12 17 L21 12 M3 16 L12 21 L21 16', 'M12 3 A9 9 0 1 1 11.99 3 M12 7 V12 L15.5 14'][i]} /></svg>{x}</span>)}
            <details className="jr-assure-more"><summary aria-label={t('jr.assureInfo')}>i</summary>
              <ul className="orp-before-tip jr-assure">{assureText.split('|').map(x => <li key={x}>{x}</li>)}</ul>
            </details>
          </div>}
          </details>}
          {country !== 'CH' && !cleanup ? <OrpAu rows={rows} t={t} onUpdate={onUpdate} country={country} /> : <>
          {!cleanup && rows.length === 0 && <p className="orp-hint">{t(mobile ? 'orp.workHintPhone' : 'orp.workHint')}</p>}
          <JobRoomHelper fillChoice={fillChoice} fillNext={fillNext} fillReady={mobile || fillReady} key={cleanup ? 'cleanup' : `${mode}-${month}`} allApps={apps} rows={rows} monthLabel={jobRoomMonth} onUpdate={onUpdate} t={t} cleanupOnly={cleanup} mobile={mobile} manual={entryMode !== 'autofill' || !(() => { try { return localStorage.getItem(BM_DONE_KEY) === '1' } catch { return false } })()} onSetup={mobile || entryMode === 'manual' ? undefined : () => setStep('setup')} />
          {!cleanup && rows.length === 0 && <button type="button" className="btn-secondary" onClick={() => setCleanup(true)}>{t('cleanup.allButton')}</button>}
          </>}

          {!cleanup && !isApp() && (mobile ? <a className="orp-hint orp-share-note" style={{ display: 'block', textDecoration: 'none' }} href={`/contact?help=1&msg=${encodeURIComponent(`Job-entry form fields (${country}):\n`)}`} target="_blank" rel="noopener noreferrer">{t('share.phoneNote').replace('{credit}', SHARE_CREDIT)}</a> : <OrpShare country={country} mobile={mobile} t={t} />)}
          {!cleanup && !isApp() && mobile && <a className="orp-ad" href="https://apps.apple.com/us/app/localsync/id6815725499" target="_blank" rel="noopener noreferrer"><img src={localSyncIcon} alt="" width="40" height="40" /><span><b>LocalSync</b> {t('ad.localsync')}</span></a>}
          {!cleanup && !isApp() && mobile && <a className="orp-ad orp-ad-you" href="/contact?help=1&focus=contact&msg=I%20would%20like%20to%20advertise%20on%20JobTrack." target="_blank" rel="noopener noreferrer"><span><b>{t('ad.yoursH')}</b> {t('ad.yours')}</span></a>}   {/* 2026-11-04 owner: internal ad in the blank space under the 5% off note */}
        </>)}
        </div>
        {step !== 'setup' && <div className="modal-buttons"><button className={step === 'ask' ? 'btn jt-period-next' + (periodChosen && periodValid ? ' btn-glow' : '') : 'btn-secondary'} disabled={step === 'ask' && !periodValid} onClick={() => {
          if (step === 'ask') {
            if (!periodValid) return
            if (mode === 'before') selectRegistration(enteredRegistration)
            openSelectedPeriod()
          } else onClose()
        }}>{t(step === 'ask' ? 'orp.next' : 'close')}</button></div>}

      </div>
    </div>
  )
}
