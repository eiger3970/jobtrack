import { Fragment, useState, useEffect, useRef, type ReactNode } from 'react'
import { countAdClick, useAdView } from '../lib/ad_count'
import { useLanguage } from '../context/language'
import jobTrackI18n from './job_track_i18n.json'
import './job_track.css'
import JobTrackPro from './job_track_pro'
import { type Application, type OrpMethod, ORP_DEFAULTS, jobRoomEntry, jobRoomMissing } from '../lib/orp'
import OrpPanel from './orp_panel'
import JobSaveBookmark from './job_save_bookmark'
import { TapCount, KeyCount } from './find_details'
import JobTrackSync, { clearComputer } from './job_track_sync'
import { FILL_KEY } from '../lib/jobroom_fill'
import BackupBar, { notBackedUp } from './job_track_backup'
import { linkFromHash, merge, dedupe } from '../lib/jobtrack_sync'
import { parseAd } from '../lib/ad_parse'
import { planReminders } from '../lib/reminders'
import { saveFile, stamp } from '../lib/save_file'
import { isApp } from '../lib/platform'
import { createUXRecorder, UX_OPT_OUT_STORAGE, type UXReport } from '../lib/jobtrack_ux'
declare const __BUILD_DATE__: string
import jobTrackIcon from '../assets/jobtrack_icon.svg'
import { GiftIcon, ShieldLink } from '../components/security_shield'

// same lookup pattern as home.tsx's getString - English fallback, then the raw key, never a blank string.
function getString(key: string, lang: 'en' | 'de' | 'fr'): string {
  const entry = (jobTrackI18n as any).strings[key]
  if (!entry) return key
  return entry[lang] ?? entry.en ?? key
}

// Same idea, but for a pool of variants (encouragement text shouldn't repeat
// the same 3 phrases forever). `seed` picks deterministically so the message
// doesn't flicker on every re-render, but does change as progress changes.
function getStringVariant(key: string, lang: 'en' | 'de' | 'fr', seed: number): string {
  const entry = (jobTrackI18n as any).strings[key]
  if (!entry) return key
  const pool: string[] = entry[lang] ?? entry.en ?? [key]
  return pool[((seed % pool.length) + pool.length) % pool.length]
}

type App = Application

// 2026-10-13 owner friction: statuses go stale - still "applied" 4 weeks on
// usually means a silent no. Flagged so it gets checked before the ORP form.
const STALE_DAYS = 28
function isStale(a: App): boolean {
  if (a.status !== 'applied' && a.status !== 'screening') return false
  return (Date.now() - new Date(a.date + 'T12:00:00').getTime()) / 86400000 > STALE_DAYS
}

const STATUSES = ['applied','screening','interview','technical','offer','accepted','rejected']
// order shown in the status menus, top to bottom (STATUSES keeps the progress order the logic relies on)
const STATUS_MENU = ['accepted','offer','technical','interview','screening','applied','rejected']
const JOBROOM_PREVIEW = import.meta.env.DEV && typeof window !== 'undefined' && window.location.hash === '#preview=jobroom'
const LIST_PREVIEW = JOBROOM_PREVIEW && new URLSearchParams(window.location.search).get('preview') === 'list'
const STORAGE = JOBROOM_PREVIEW ? 'kworld_jobtrack_preview' : 'kworld_jobtrack'

function loadApps(): App[] {
  // DEV preview of the Job-Room helper
  if (JOBROOM_PREVIEW) return [
    { id: 11, company: 'Téléverbier S.A.', role: 'Cuisinier (H/F)', date: '2026-10-03', status: 'applied', cv: '', cover: '', nextDate: '', notes: '', method: 'electronic', rate: 100, postal: '1936', city: 'Verbier', email: 'jobs@example.ch' },
    { id: 12, company: 'First Track SA', role: 'Opérateur de Production de Skis', date: '2026-10-05', status: 'rejected', cv: '', cover: '', nextDate: '', notes: '', method: 'electronic', rate: 100 },
    { id: 13, company: 'Bergbahnen Rinerhorn AG', role: 'Ski Lift Operator', date: '2026-10-13', status: 'applied', cv: '', cover: '', nextDate: '', notes: '', address: '7277 Davos Glaris (GR)', jobroomDone: '2026-10-14' },
  ] as App[]
  // DEV preview of the not-backed-up bar
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.location.hash === '#preview=backup') return [{ id: 1, company: 'Bergbahnen Rinerhorn AG', role: 'Ski lift operator', date: '2026-09-12', status: 'applied', cv: '', cover: '', nextDate: '', notes: 'Staff housing offered\nStart By agreement Permanent' }, { id: 2, company: 'Example Semiconductor GmbH', role: 'Shift Equipment Maintenance Engineer - Etching 80 - 100% (f/m/d) - R0129808', date: '2026-10-14', status: 'applied', cv: '', cover: '', nextDate: '', notes: '' }]
  try { return JSON.parse(localStorage.getItem(STORAGE) || '[]') } catch { return [] }
}

// Match each search word against the company and role; accents are optional.
function searchApplications(apps: App[], query: string): App[] {
  const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return apps
  return apps.filter(a => {
    const text = normalize(`${a.company} ${a.role}`)
    return words.every(word => text.includes(word))
  })
}

interface Quota { target: number; period: 'week' | 'fortnight' | 'month' }
const QUOTA_STORAGE = 'kworld_jobtrack_quota'
// 2026-09-23: real feedback, live - "needs a reminder to export data
// before closing." Records only ever live in this browser's storage, so
// clearing browser data or switching device loses them. The snapshot is
// what the last exported backup contained - anything different is unsaved.
const BACKUP_SNAPSHOT_STORAGE = 'kworld_jobtrack_backup_snapshot'
const BACKUP_AT_STORAGE = 'kworld_jobtrack_backup_at'

// 2026-10-14: icons-only view, remembered per device
const MIN_STORAGE = 'kworld_jobtrack_minimal'
const MIN_LABEL = { en: { min: 'Minimise', full: 'Full view' }, de: { min: 'Minimieren', full: 'Volle Ansicht' }, fr: { min: 'Réduire', full: 'Vue complète' } }

function readStored(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function loadQuota(): Quota | null {
  try { return JSON.parse(localStorage.getItem(QUOTA_STORAGE) || 'null') } catch { return null }
}

// Monday-start week, calendar month - counts by application date (a.date),
// not by when the entry was created, so backfilled entries count correctly.
// Fortnight is a rolling 14-day window (not calendar-aligned) since agencies
// like Centrelink use an individual reporting cycle we have no way to know -
// a rolling window is the closest honest approximation without that date.
function periodStart(period: 'week' | 'fortnight' | 'month'): Date {
  const now = new Date()
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  if (period === 'fortnight') return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13)
  const day = now.getDay()
  const diffToMonday = day === 0 ? 6 : day - 1
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday)
  return monday
}

function countInPeriod(apps: App[], period: 'week' | 'fortnight' | 'month'): number {
  const start = periodStart(period)
  const startStr = start.toISOString().slice(0, 10)
  return apps.filter(a => a.date >= startStr).length
}

// Same icon for a status everywhere it appears (badge + filter button) -
// native <select> options can't render SVG at all, so the dropdown stays
// text-only regardless.
function StatusIcon({ status }: { status: string }) {
  const paths: Record<string, ReactNode> = {
    applied: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
    screening: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />,
    interview: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
    technical: <><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>,
    offer: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    accepted: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
    rejected: <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[status]}</svg>
}

type HeaderColumn = 'company' | 'role' | 'date' | 'status' | 'cv' | 'cover' | 'next' | 'actions' | 'add' | 'list' | 'edit' | 'notes'
function HeaderIcon({ col, filled = false }: { col: HeaderColumn; filled?: boolean }) {
  const paths: Record<string, ReactNode> = {
    add: <><path d="M4 6h9M4 12h5M4 18h5M17 10v12M11 16h12" /></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
    edit: <><path d="m16 3 5 5M3 21l5-1L21 7a2.1 2.1 0 0 0-5-3L3 17v4Z" /></>,
    company: <><rect x="4" y="3" width="16" height="18" rx="1" /><rect x="10" y="14" width="4" height="7" /></>,
    role: <><rect x="2" y="4" width="20" height="16" rx="2" /><circle cx="8" cy="10" r="2" /><path d="M4.5 17v-1a3.5 3.5 0 0 1 7 0v1M15 9h4M15 13h4M15 17h2" /></>,
    date: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
    status: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></>,
    cv: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    cover: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
    notes: <path d={filled ? "M14 2H4v20h16V8zM14 2v6h6M8 12h8M8 16h6" : "M14 2H4v20h16V8zM14 2v6h6M12 11v7M8.5 14.5h7"} />,
    next: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
    actions: <g fill="currentColor" stroke="none"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /><path transform="translate(24 0)" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></g>,
  }
  if (!paths[col]) return null
  return <svg viewBox={col === 'actions' ? '0 0 48 24' : '0 0 24 24'} style={col === 'actions' ? { width: 28 } : undefined} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[col]}</svg>
}

// Phone labels reuse the desktop category icons and translated names.
function CellLabel({ col, children }: { col: HeaderColumn; children: ReactNode }) {
  return <span className="jt-cell-label"><HeaderIcon col={col} />{children}</span>
}

// Compact presence indicators; filenames stay in editing and export reports.
function DocumentIndicator({ value, yes, no }: { value: string; yes: string; no: string }) {
  const included = Boolean(value?.trim())
  return <span className={'jt-document-status ' + (included ? 'jt-document-included' : 'jt-document-missing')} role="img" aria-label={included ? yes : no}><span aria-hidden="true">{included ? '✓' : '✗'}</span></span>
}

function updateApplicationNote(apps: App[], id: number, notes: string): App[] {
  return apps.map(a => a.id === id ? { ...a, notes } : a)
}

// Tap-to-reveal, not hover/title - a native title attribute never shows on
// phone at all, so anything that needs explaining on mobile has to use this.
function InfoTip({ text, label, icon }: { text: ReactNode; label: string; icon: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])
  return (
    <span className="info-tip-wrap" ref={ref}>
      <button type="button" className="info-btn" aria-label={label} onClick={() => setOpen(v => !v)}>i</button>
      {open && (
        <div className="info-popover info-tip-popover">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
          <span>{text}</span>
        </div>
      )}
    </span>
  )
}

// Lowercase, accents stripped, punctuation to spaces, legal-form words
// (AG, GmbH, SA, Ltd...) dropped - so "Jungfraubahnen Management AG" and
// "jungfraubahnen management" compare equal.
const LEGAL_FORMS = new Set(['ag', 'gmbh', 'sa', 'sarl', 'sàrl', 'ltd', 'llc', 'inc', 'plc', 'pty', 'bv', 'nv', 'co', 'kg', 'se', 'spa', 'srl'])
const COMPANY_STOPWORDS = new Set(['management', 'group', 'holding', 'holdings', 'services', 'solutions', 'international', 'company', 'schweiz', 'suisse', 'svizzera', 'switzerland', 'the'])
function normalizeName(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && !LEGAL_FORMS.has(w)).join(' ')
}

// Sender domains from any email address in the pasted text, reduced to
// the distinctive part (gerhard.moser@jungfrau.ch -> "jungfrau"). Job
// platforms and personal mail providers say nothing about the employer,
// so they're skipped.
const GENERIC_MAIL_DOMAINS = new Set(['www', 'gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'yahoo', 'icloud', 'me', 'proton', 'protonmail', 'gmx', 'bluewin', 'web', 'workday', 'myworkday', 'myworkdayjobs', 'greenhouse', 'lever', 'smartrecruiters', 'successfactors', 'jobs', 'recruiting', 'recruitee', 'personio', 'workable', 'bamboohr', 'jobup', 'jobscout24', 'linkedin', 'indeed', 'noreply', 'no-reply', 'mail', 'email', 'hr'])
function senderDomains(text: string): string[] {
  const found: string[] = []
  // Email addresses AND web addresses - signatures usually carry the
  // company site (www.sicpa.com) even when the copied body has no sender.
  for (const m of text.matchAll(/(?:[a-z0-9._%+-]+@|https?:\/\/|\bwww\.)([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const parts = m[1].toLowerCase().split('.')
    // Rightmost label that isn't a TLD or a generic word: mail.jungfrau.ch -> jungfrau
    const core = parts.slice(0, -1).reverse().find(p => p.length >= 3 && !GENERIC_MAIL_DOMAINS.has(p))
    if (core && !found.includes(core)) found.push(core)
  }
  return found
}

export default function JobTrack() {
  const adCv = useRef<HTMLAnchorElement>(null)
  const adCl = useRef<HTMLAnchorElement>(null)
  useAdView(adCv, 'jobtrack:cv', !isApp())
  useAdView(adCl, 'jobtrack:cl', !isApp())
  // phone: lock page zoom on this page only (iOS Firefox restores a zoomed view after refresh); restored on leave
  useEffect(() => {
    const m = document.querySelector('meta[name="viewport"]'); if (!m) return
    const old = m.getAttribute('content') || ''
    m.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0')
    return () => { m.setAttribute('content', old) }
  }, [])
  const { lang } = useLanguage()
  const t = (key: string) => getString(key, lang)
  const STATUS_PLAIN: Record<string, string> = {
    applied: t('status.plain.applied'), screening: t('status.plain.screening'), interview: t('status.plain.interview'),
    technical: t('status.plain.technical'), offer: t('status.plain.offer'), accepted: t('status.plain.accepted'), rejected: t('status.plain.rejected'),
  }
  const [apps, setApps] = useState<App[]>(loadApps)
  // 2026-11-03 owner: the Job-Room button name follows the country - the person's own pick wins, else the IP lookup, else a neutral name
  const [btnCountry, setBtnCountry] = useState('')
  useEffect(() => {
    try { if (localStorage.getItem('kworld_jobtrack_country')) return } catch { /* private mode */ }
    fetch('/api/country').then(r => r.json()).then((d: { country?: string }) => { if (d.country && /^[A-Z]{2}$/.test(d.country)) setBtnCountry(d.country) }).catch(() => { /* offline: neutral name */ })
  }, [])
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<App | null>(null)
  const [noteTargetId, setNoteTargetId] = useState<number | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const noteDialogRef = useRef<HTMLDialogElement>(null)
  const [actionsTargetId, setActionsTargetId] = useState<number | null>(null)
  const actionsDialogRef = useRef<HTMLDialogElement>(null)
  const actionsApp = apps.find(a => a.id === actionsTargetId)
  // compulsory Job-Room details this job still lacks (small warning icon in its row opens the edit form)
  const gapNames: Record<string, [string, string, string]> = { date: ['date', 'Datum', 'date'], business: ['company', 'Firma', 'entreprise'], postal: ['postcode', 'PLZ', 'code postal'], city: ['town', 'Ort', 'localité'], jobTitle: ['job title', 'Stelle', 'poste'], email: ['email or job link', 'E-Mail oder Link', 'e-mail ou lien'] }
  const gapText = (a: Application) => {
    if (a.jobroomDone) return ''
    const miss = jobRoomMissing(jobRoomEntry(a)); if (!miss.length) return ''
    const i = lang === 'de' ? 1 : lang === 'fr' ? 2 : 0
    return [['Job-Room needs: ', 'Job-Room braucht: ', 'Job-Room exige : '][i] + miss.map(k => gapNames[k][i]).join(', ')][0]
  }
  useEffect(() => { if (actionsTargetId !== null) actionsDialogRef.current?.showModal() }, [actionsTargetId])
  const reportDialogRef = useRef<HTMLDialogElement>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (deleteTargetId !== null) deleteDialogRef.current?.showModal() }, [deleteTargetId])

  useEffect(() => {
    if (noteTargetId === null) return
    const dialog = noteDialogRef.current
    if (!dialog) return
    // iOS 26 can mispaint the caret in fixed containers after a long page scroll.
    // The iOS CSS uses document positioning, anchored before autofocus runs.
    dialog.style.setProperty('--jt-note-scroll-top', `${window.scrollY}px`)
    dialog.showModal()
  }, [noteTargetId])

  const [form, setForm] = useState<Omit<App, 'id'>>({ company:'', role:'', date: new Date().toISOString().slice(0,10), status:'applied', cv:'', cover:'', nextDate:'', notes:'' })
  const [orpOpen, setOrpOpen] = useState(false)
  const [adText, setAdText] = useState('')
  const [adFilled, setAdFilled] = useState(false)
  const [fillMode, setFillMode] = useState<'bookmark' | 'paste' | 'type'>(() => { try { const m = localStorage.getItem('kworld_jobtrack_fillmode'); const phone = window.matchMedia('(max-width: 760px)').matches; if (phone) return m === 'type' ? 'type' : 'paste'; return m === 'paste' || m === 'type' ? m : 'bookmark' } catch { return 'bookmark' } })   // 2026-11-04 owner: desktop starts on Bookmark fill, phone on Paste fill (the bookmark is desktop only)   // 2026-11-03 owner: pills at the top pick the way to add a job
  const fillPills = (active: 'bookmark' | 'paste' | 'type' | 'multiple') => {
    const pick = (m: 'bookmark' | 'paste' | 'type' | 'multiple') => { if (m === 'multiple') { setModal(false); setBulkModal(true) } else { setFillMode(m); try { localStorage.setItem('kworld_jobtrack_fillmode', m) } catch { /* private mode */ } setBulkModal(false); setModal(true) } }
    const pill = (m: 'bookmark' | 'paste' | 'type' | 'multiple', taps: number, keys: number) => <button key={m} type="button" role="tab" aria-selected={active === m} className={'fill-pill' + (active === m ? ' on' : '')} onClick={() => pick(m)}><TapCount n={taps} maxCount={8} big label={t('fd.tapsAria')} />{keys > 0 && <KeyCount n={keys} label={t('fd.keysAria')} />}{t('fill.' + m)}</button>
    return <div className="fill-pills" role="tablist" aria-label={t('modal.addTitle')}>{pill('bookmark', 1, 0)}{pill('paste', 7, 0)}{pill('type', 8, phoneDevice ? 80 : 60)}{pill('multiple', 5, phoneDevice ? 120 : 90)}</div>
  }
  // how many duplicates the last Import backup file joined (shown on the button)
  const [importJoined, setImportJoined] = useState(0)
  // 2026-10-25 owner: the page finds and joins doubled jobs itself, and says so - with Undo. Undo is remembered,
  // so the next visit does not join them again.
  const KEEP_DUPS = 'kworld_jobtrack_keep_dups'
  const [autoJoin, setAutoJoin] = useState<{ n: number; before: App[] } | null>(null)
  useEffect(() => {
    try { if (localStorage.getItem(KEEP_DUPS)) return } catch { /* private mode */ }
    const r = dedupe(apps as unknown as Application[])
    if (r.joined > 0) { setAutoJoin({ n: r.joined, before: apps }); setApps(r.apps as unknown as App[]) }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const noAddress = apps.filter(r => { const x = jobRoomEntry(r as unknown as Application); return !(r as unknown as Application & { jobroomDone?: boolean }).jobroomDone && (!x.postal || !x.city || (!x.street && !r.addrUnknown)) }).length
  // ?share=1 (from the share-form bookmark) opens the unemployment panel straight on the share card
  const [orpPanel, setOrpPanel] = useState(() => (JOBROOM_PREVIEW && !LIST_PREVIEW) || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('share') === '1'))
  // 2026-11-03: DEV preview opens in the complete-details view; add ?view=report to open the normal report view (same as the live site)
  const [orpCleanup, setOrpCleanup] = useState(JOBROOM_PREVIEW && new URLSearchParams(window.location.search).get('view') !== 'report')
  function orpButtonLabel() {
    let c = ''
    try { c = (localStorage.getItem('kworld_jobtrack_country') || '').toUpperCase() } catch { /* private mode */ }
    c = c || btnCountry
    return t(c === 'CH' ? 'orp.button.ch' : c === 'AU' ? 'orp.button.au' : c ? 'orp.button.other' : 'orp.button')
  }
  function openOrp(cleanup = false) { setOrpCleanup(cleanup); setOrpPanel(true) }
  const settingsDialogRef = useRef<HTMLDialogElement>(null)
  const [minimal, setMinimal] = useState(() => readStored(MIN_STORAGE) !== '0' || (import.meta.env.DEV && typeof window !== 'undefined' && window.location.search.includes('min')))
  useEffect(() => { try { localStorage.setItem(MIN_STORAGE, minimal ? '1' : '0') } catch { /* private mode */ } }, [minimal])
  // 2026-10-14: phone + computer sync - the phone arrives from the QR with #sync=
  // prerender has no navigator - counts as a computer there
  const phoneDevice = isApp() || (typeof navigator !== 'undefined' && /iPhone|iPod|Android/i.test(navigator.userAgent))
  const [syncOpen, setSyncOpen] = useState(() => linkFromHash() !== null || (import.meta.env.DEV && /^#preview=sync(phone|lost|scan|done)?$/.test(window.location.hash)))
  // 2026-11-10 owner: first launch of the installed app = welcome popup, "tap here to import or sync existing data" (QR sync only)
  const WELCOME_STORAGE = 'kworld_jobtrack_welcome_seen'
  const welcomeRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const force = import.meta.env.DEV && window.location.search.includes('welcome')
    if (force || (isApp() && apps.length === 0 && readStored(WELCOME_STORAGE) !== '1')) welcomeRef.current?.showModal()
  }, [])
  const closeWelcome = (sync: boolean) => { try { localStorage.setItem(WELCOME_STORAGE, '1') } catch { /* blocked */ } welcomeRef.current?.close(); if (sync) setSyncOpen(true) }
  const [showStorageInfo, setShowStorageInfo] = useState(false)
  const infoRef = useRef<HTMLDivElement>(null)
  const [showEmailInfo, setShowEmailInfo] = useState(false)
  const emailInfoRef = useRef<HTMLDivElement>(null)
  const [showImportInfo, setShowImportInfo] = useState(false)
  const importInfoRef = useRef<HTMLDivElement>(null)
  const [quota, setQuota] = useState<Quota | null>(loadQuota)
  const [editingQuota, setEditingQuota] = useState(false)
  const [quotaDraft, setQuotaDraft] = useState<Quota>({ target: 8, period: 'month' })
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const bulkPreview = bulkText.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const sepIndex = line.indexOf(' - ')
    return { company: sepIndex === -1 ? line : line.slice(0, sepIndex).trim(), role: sepIndex === -1 ? '' : line.slice(sepIndex + 3).trim() }
  })
  // 2026-09-12: real feedback, live - a confirmation email arrives a few
  // minutes after applying and the only way to reflect that here was to
  // hunt down the right row and click through the status dropdown. This
  // stays 100% local (no inbox access, ever) - paste the email text in,
  // it fuzzy-matches the company name against existing rows and offers
  // one tap to apply a status change.
  const [emailModal, setEmailModal] = useState(false)
  const [emailUpdatedId, setEmailUpdatedId] = useState<number | null>(null)
  const listStartRef = useRef<HTMLDivElement>(null)
  const findBarRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [navOffset, setNavOffset] = useState(0)
  const [showListTop, setShowListTop] = useState(false)
  const [finishJobId, setFinishJobId] = useState<number | null>(null)
  const [finishOpen, setFinishOpen] = useState(false)
  const [finishTarget, setFinishTarget] = useState<HTMLDivElement | null>(null)
  const finishL = (en: string, de: string, fr: string) => lang === 'de' ? de : lang === 'fr' ? fr : en
  function offerFinish(id: number) { setFinishJobId(id); setFinishOpen(false) }
  function scrollToTrackerElement(target: Element) {
    const navbar = document.querySelector('.navbar')
    const headerBottom = navbar ? Math.max(0, navbar.getBoundingClientRect().bottom) : 0
    window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - headerBottom - (target.closest('.applications-table') && window.matchMedia('(max-width: 760px)').matches ? findBarRef.current?.offsetHeight || 0 : 0)), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  function finishSession() {
    setFinishOpen(v => !v)
  }
  useEffect(() => {
    if (!finishOpen || !finishTarget || finishJobId === null) return
    const row = document.getElementById(`jobtrack-application-${finishJobId}`)
    if (row) scrollToTrackerElement(row)
  }, [finishOpen, finishTarget, finishJobId])
  useEffect(() => {
    if (emailModal || emailUpdatedId === null) return
    const row = document.getElementById(`jobtrack-application-${emailUpdatedId}`)
    if (!row) return
    scrollToTrackerElement(row)
    setEmailUpdatedId(null)
  }, [emailModal, emailUpdatedId])
  const [emailText, setEmailText] = useState('')
  const [emailSender, setEmailSender] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailAmbiguous, setEmailAmbiguous] = useState(false)
  const [emailCandidates, setEmailCandidates] = useState<App[]>([])
  const [emailCompany, setEmailCompany] = useState('')
  const [emailRole, setEmailRole] = useState('')
  const [emailCv, setEmailCv] = useState('')
  const [emailCover, setEmailCover] = useState('')
  const [emailMatch, setEmailMatch] = useState<App | null>(null)
  const [emailStatus, setEmailStatus] = useState('screening')
  const [copiedList, setCopiedList] = useState(false)
  const [backupImported, setBackupImported] = useState(false)
  const backupInputRef = useRef<HTMLInputElement>(null)

  function bulkAdd() {
    const today = new Date().toISOString().slice(0, 10)
    const newApps: App[] = bulkPreview.map(({ company, role }, i) => {
      return { id: Date.now() + i, company, role, date: today, status: 'applied', cv: '', cover: '', nextDate: '', notes: '' }
    })
    setApps(prev => [...prev, ...newApps])
    setBulkText('')
    setBulkModal(false)
  }

  useEffect(() => { localStorage.setItem(STORAGE, JSON.stringify(apps)) }, [apps])
  // 2026-11-03 owner: the JobTrack fill bookmark saved a job in another tab -> show it here: refresh the list, close Add Application, scroll to the top, flash the row
  useEffect(() => {
    const JUST = 'kworld_jobtrack_justsaved'
    const read = () => { try { return localStorage.getItem(JUST) || '' } catch { return '' } }
    let seen = read()
    let pending = ''
    const flash = () => {
      if (!pending || document.visibilityState !== 'visible') return
      const id = pending; pending = ''
      window.scrollTo({ top: 0, behavior: 'smooth' })
      window.setTimeout(() => {
        const el = document.getElementById('jobtrack-application-' + id)
        if (!el) return
        if (el.getBoundingClientRect().top + window.scrollY > window.innerHeight * 0.85) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('jt-just-saved'); window.setTimeout(() => el.classList.remove('jt-just-saved'), 5000)
      }, 450)
    }
    const take = () => {
      const v = read()
      if (!v || v === seen) return
      seen = v
      const [id, at] = v.split(':')
      if (Date.now() - Number(at) > 60000) return
      setApps(loadApps()); setModal(false); setBulkModal(false)
      pending = id
      window.setTimeout(flash, 150)
    }
    const onStorage = (e: StorageEvent) => { if (e.key === JUST) take() }
    const onVisible = () => { take(); flash() }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.removeEventListener('storage', onStorage); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  // 2026-10-14: opened by the JobTrack fill bookmark on Job-Room - hand over the card, close
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('fill') || !window.opener) return
    try {
      const d = localStorage.getItem(FILL_KEY)
      if (d) window.opener.postMessage(JSON.parse(d), 'https://www.job-room.ch')
    } catch { /* nothing to hand over */ }
    setTimeout(() => window.close(), 300)
  }, [])
  // 2026-10-13: ORP reminders (1st, 4th, short weeks) re-planned with the real counts
  useEffect(() => { void planReminders(apps).catch(() => {}) }, [apps])

  const [backupSnapshot, setBackupSnapshot] = useState<string | null>(() => readStored(BACKUP_SNAPSHOT_STORAGE))
  const [, setBackupAt] = useState<string | null>(() => readStored(BACKUP_AT_STORAGE))
  const unbackedUp = apps.length > 0 && JSON.stringify({ apps, quota }) !== backupSnapshot

  // Browsers only allow their own generic "Leave site?" wording here, and
  // iOS Safari ignores it entirely - the on-page banner below is the
  // reminder that works everywhere; this is the extra net on desktop.
  useEffect(() => {
    if (!unbackedUp) return
    // 2026-10-13 owner: "Save + write the cover letter" showed the browser's
    // "Leave page?" - scary, and nothing is lost there (saved first). Our own
    // move to the letter page skips the warning.
    function warn(e: BeforeUnloadEvent) { if ((window as unknown as { kworldLeaving?: boolean }).kworldLeaving) return; e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unbackedUp])

  useEffect(() => {
    if (quota) localStorage.setItem(QUOTA_STORAGE, JSON.stringify(quota))
    else localStorage.removeItem(QUOTA_STORAGE)
  }, [quota])

  function openQuotaEditor() {
    setQuotaDraft(quota || { target: 8, period: 'month' })
    setEditingQuota(true)
  }
  function saveQuota() {
    if (quotaDraft.target > 0) setQuota(quotaDraft)
    setEditingQuota(false)
  }
  function removeQuota() {
    setQuota(null)
    setEditingQuota(false)
  }

  // mousedown (not click) - closing on the same event that opens it is a
  // classic bug, since click fires after mousedown on the same interaction.
  // Same pattern as navbar.tsx's LangSwitcher.
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) setShowStorageInfo(false)
      if (emailInfoRef.current && !emailInfoRef.current.contains(e.target as Node)) setShowEmailInfo(false)
      if (importInfoRef.current && !importInfoRef.current.contains(e.target as Node)) setShowImportInfo(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // 2026-10-14 owner: columns left to right Date, Company, Role, Cover, Status, CV.
  // 2026-09-25: user - "can the Company column be sorted by a-z to find?"
  // Company and Date headers sort the list; tap again to reverse.
  const [sortBy, setSortBy] = useState<{ col: 'date' | 'company'; asc: boolean }>({ col: 'date', asc: false })
  const [searchText, setSearchText] = useState('')
  const statusApps = filter === 'all' ? apps : apps.filter(a => a.status === filter)
  const filtered = searchApplications(statusApps, searchText).slice().sort((a, b) => {
    const d = sortBy.col === 'company' ? a.company.localeCompare(b.company, undefined, { sensitivity: 'base' }) : a.date.localeCompare(b.date) || a.id - b.id
    return sortBy.asc ? d : -d
  })
  useEffect(() => {
    if (!apps.length) { setShowListTop(false); return }
    const navbar = document.querySelector('.navbar')
    function updateNavigation() {
      const offset = navbar ? Math.max(0, navbar.getBoundingClientRect().bottom) : 0
      setNavOffset(offset)
      const anchor = listStartRef.current
      const phoneLayout = window.matchMedia('(max-width: 760px)').matches
      // A hidden phone search must not leave desktop rows filtered after resizing.
      if (!phoneLayout) setSearchText('')
      setShowListTop(Boolean(phoneLayout && anchor && anchor.getBoundingClientRect().top < offset - 400))
    }
    updateNavigation()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateNavigation) : null
    if (navbar) observer?.observe(navbar)
    window.addEventListener('scroll', updateNavigation, { passive: true })
    window.addEventListener('resize', updateNavigation)
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', updateNavigation)
      window.removeEventListener('resize', updateNavigation)
    }
  }, [apps.length])
  function sortOn(col: 'date' | 'company') {
    uxRecorder.mark('sort_change')
    setSortBy(s => s.col === col ? { col, asc: !s.asc } : { col, asc: col === 'company' })
  }
  // 2026-10-14 owner: make it clear which column drives the sort - the active one is
  // highlighted with a solid arrow; the other sortable one shows a faint up/down hint.
  // 2026-10-14 owner: no hint arrows on the inactive column - tapping the heading sorts
  const sortMark = (col: 'date' | 'company') => sortBy.col !== col ? null : (
    <svg className={'jt-sort-ic' + (sortBy.col === col ? ' on' : '')} viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d={sortBy.col !== col ? 'M12 5l4 5H8zm0 14l-4-5h8z' : sortBy.asc ? 'M12 6l6 8H6z' : 'M12 18l-6-8h12z'} />
    </svg>
  )
  const sortCls = (col: 'date' | 'company') => 'jt-sortable' + (sortBy.col === col ? ' jt-sorted' : '')
  // 2026-10-14 owner: white = counts for this period's quota, amber = older; a thick line where the old ones start
  const cutoff = (() => { const d = quota ? periodStart(quota.period) : new Date(new Date().getFullYear(), new Date().getMonth(), 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
  const isOld = (a: App) => a.date < cutoff
  // 2026-10-15 owner: the thick line follows the quota colour (same rule as the quota card)
  const lineColor = (() => { if (!quota) return '#ffb000'; const pct = Math.min(100, (countInPeriod(apps, quota.period) / quota.target) * 100); return pct >= 50 ? '#00ff41' : pct >= 15 ? '#f59e0b' : '#ef4444' })()
  const [reward, setReward] = useState(false)
  const [testimonialText, setTestimonialText] = useState('')
  const [testimonialName, setTestimonialName] = useState('')
  const [testimonialEmail, setTestimonialEmail] = useState('')
  const [testimonialPermission, setTestimonialPermission] = useState(false)
  const [uxRecorder] = useState(() => createUXRecorder(readStored(UX_OPT_OUT_STORAGE) !== '1'))
  const [uxRecording, setUXRecording] = useState(() => readStored(UX_OPT_OUT_STORAGE) !== '1')
  const [includeUX, setIncludeUX] = useState(false)
  const [reviewedUX, setReviewedUX] = useState<UXReport | null>(null)
  const [uxDeliveryNotice, setUXDeliveryNotice] = useState('')
  const [showDiagInfo, setShowDiagInfo] = useState(false)
  const diag = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('diag')
  function setLocalUXRecording(enabled: boolean) {
    setUXRecording(enabled)
    try { localStorage.setItem(UX_OPT_OUT_STORAGE, enabled ? '0' : '1') } catch { /* page-only preference */ }
    setReviewedUX(null)
    if (enabled) uxRecorder.start()
    else { uxRecorder.stop(); setIncludeUX(false) }
  }

  function reviewUXReport() {
    const columnOrder = Array.from(document.querySelectorAll('.applications-table thead th[data-ux-column]')).map(th => th.getAttribute('data-ux-column') || '')
    setReviewedUX(uxRecorder.snapshot({
      build_date: typeof __BUILD_DATE__ === 'undefined' ? 'development' : __BUILD_DATE__,
      layout: window.matchMedia('(max-width: 760px)').matches ? 'phone' : 'desktop',
      column_order: columnOrder,
      sort: sortBy.col === 'company' ? (sortBy.asc ? 'az' : 'za') : (sortBy.asc ? 'oldest' : 'newest'),
    }))
  }

  const [testimonialStatus, setTestimonialStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [testimonialError, setTestimonialError] = useState('')
  async function submitTestimonial() {
    if (!testimonialText.trim() || !testimonialEmail.trim() || testimonialStatus === 'sending') return
    if (includeUX && !reviewedUX) { setTestimonialError(t('ux.reviewRequired')); return }
    setTestimonialStatus('sending')
    setTestimonialError('')
    setUXDeliveryNotice('')
    try {
      const response = await fetch('https://submit-access-proxy.kinhswch-cloudflare.workers.dev/submit-testimonial', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: testimonialText.trim(), name: testimonialName.trim(), email: testimonialEmail.trim(), permission: testimonialPermission, source: 'jobtrack', ...(includeUX && reviewedUX ? { ux_consent: true, ux_report: reviewedUX } : {}) }),
      })
      const result = await response.json()
      if (!response.ok || result.status !== 'ok' || result.reward_status !== 'pending_review') throw new Error(finishL('Could not submit your credit request. Please try again later.', 'Ihre Guthabenanfrage konnte nicht gesendet werden. Bitte versuchen Sie es später erneut.', 'Impossible d’envoyer votre demande de crédit. Réessayez plus tard.'))
      if (includeUX && result.ux_report_received !== true) setUXDeliveryNotice(t('ux.unconfirmed'))
      setTestimonialStatus('sent')
      uxRecorder.clear(); setIncludeUX(false); setReviewedUX(null)
    } catch {
      setTestimonialStatus('error')
      setTestimonialError(finishL('Could not submit your credit request. Your text is still here. Please try again later.', 'Ihre Guthabenanfrage konnte nicht gesendet werden. Ihr Text bleibt erhalten. Bitte versuchen Sie es später erneut.', 'Impossible d’envoyer votre demande de crédit. Votre texte est conservé. Réessayez plus tard.'))
    }
  }
  const firstOldId = sortBy.col === 'date' && !sortBy.asc ? filtered.find(isOld)?.id : undefined
  const statusCounts = STATUS_MENU.map(st => [st, apps.filter(a => a.status === st).length] as const).filter(([, n]) => n > 0)

  function openAdd() { uxRecorder.mark('application_add'); setEditing(null); setOrpOpen(false); setAdText(''); setAdFilled(false); setForm({ company:'',role:'',date:new Date().toISOString().slice(0,10),status:'applied',cv:'',cover:'',nextDate:'',notes:'', ...ORP_DEFAULTS }); setModal(true) }
  function openNote(a: App) { uxRecorder.mark('note_open'); setNoteDraft(a.notes || ''); setNoteTargetId(a.id) }
  function saveNote() {
    if (noteTargetId === null) return
    uxRecorder.mark('note_save')
    setApps(prev => updateApplicationNote(prev, noteTargetId, noteDraft))
    offerFinish(noteTargetId)
    noteDialogRef.current?.close()
  }
  function openEdit(a: App) {
    uxRecorder.mark('application_edit')
    const { id: _id, ...rest } = a
    // 2026-10-14: an older entry's one-line address/contact, split into Job-Room's fields
    const e = jobRoomEntry(a)
    const split = { street: a.street || e.street, streetNo: a.streetNo || e.streetNo, postal: a.postal || e.postal, city: a.city || e.city,
      contactPerson: a.contactPerson || e.contactPerson, email: a.email || e.email, phone: a.phone || e.phone }
    setEditing(a); setOrpOpen(false); setForm({ ...ORP_DEFAULTS, ...rest, ...split }); setModal(true)
  }
  // 2026-10-15 owner: automated - paste the ad and the fields fill themselves, then flag what is still missing while the ad is fresh
  function applyAd(text: string) {
    const ad = parseAd(text)
    setForm(f => ({ ...f, role: ad.role || f.role, company: ad.company || f.company, address: ad.address || f.address,
      contact: ad.contact || f.contact, rate: ad.rate ?? f.rate, notes: [f.notes, ad.notes].filter(Boolean).join(' · '),
      street: ad.street || f.street, streetNo: ad.streetNo || f.streetNo, postal: ad.postal || f.postal, city: ad.city || f.city,
      contactPerson: ad.contactPerson || f.contactPerson, email: ad.email || f.email, phone: ad.phone || f.phone, link: ad.link || f.link,
      adText: text.slice(0, 20000) }))
    setOrpOpen(true); setAdFilled(true)
  }
  function save() {
    if (!form.company || !form.role) return
    const id = editing ? editing.id : Date.now()
    if (editing) { setApps(apps.map(a => a.id === editing.id ? { ...form, id: a.id } : a)) }
    else { setApps([...apps, { ...form, id }]) }
    offerFinish(id)
    setModal(false)
  }
  function del(id: number) { setDeleteTargetId(id) }
  function confirmDelete() {
    if (deleteTargetId !== null) setApps(prev => prev.filter(a => a.id !== deleteTargetId))
    deleteDialogRef.current?.close()
  }

  // 2026-09-23: real feedback, live - "Update from email needs to pull
  // data from email, rather than me re-typing all the fields... e.g.
  // Jungfraubahnen Management AG emailed confirmation from
  // gerhard.moser@jungfrau.ch." Was an exact match on one regex-guessed
  // company name, so it almost never matched. Now scores every existing
  // application against the whole pasted text: the full company name,
  // each distinctive word of it, the sender's email domain
  // (jungfrau.ch -> "jungfrau" -> Jungfraubahnen), and the role title.
  // Company evidence identifies candidates; distinctive role words resolve them.
  // A date or array order is never evidence that an email concerns a particular job.
  function findEmailCandidates(text: string): App[] {
    const hay = normalizeName(text)
    const domains = senderDomains(text)
    let candidates: App[] = []
    let bestScore = 0
    for (const a of apps) {
      const name = normalizeName(a.company)
      if (!name) continue
      let score = 0
      if (hay.includes(name)) score += 3
      const words = name.split(' ').filter(w => w.length >= 4 && !COMPANY_STOPWORDS.has(w))
      for (const w of words) if (hay.includes(w)) score += 1
      for (const d of domains) if (words.some(w => w.startsWith(d) || d.startsWith(w))) score += 2
      if (score > bestScore) { candidates = [a]; bestScore = score }
      else if (score > 0 && score === bestScore) candidates.push(a)
    }
    if (candidates.length < 2) return candidates
    const filler = new Set(['saison', 'hiver', 'winter', 'season', 'summer', 'saisonniere', 'poste', 'operator'])
    const tokens = candidates.map(a => [...new Set(normalizeName(a.role).split(' ').filter(w => w.length >= 4 && !filler.has(w) && !/^\d+$/.test(w)))])
    const hayWords = new Set(hay.split(' '))
    const scores = candidates.map((a, i) => {
      const role = normalizeName(a.role)
      const exact = role.length >= 4 && hay.includes(role) ? 2 : 0
      return exact + tokens[i].filter(w => hayWords.has(w) && tokens.some((other, j) => j !== i && !other.includes(w))).length
    })
    const withRoleEvidence = candidates.filter((_, i) => scores[i] > 0)
    return withRoleEvidence.length > 0 ? withRoleEvidence : candidates
  }
  function findEmailMatch(text: string): App | null {
    const candidates = findEmailCandidates(text)
    return candidates.length === 1 ? candidates[0] : null
  }
  // Real ATS confirmation emails (Workday, Greenhouse, etc.) are
  // templated enough that a couple of regexes catch the common phrasing
  // ("your interest in X and", "position of Y to join/at") - always
  // just a starting guess the user can edit, never assumed correct.
  function guessFromEmail(text: string): { company: string; role: string } {
    // 2026-09-25: BOBST rejection - "your interest in the IoT Technology
    // Director position and ... joining BOBST" was read as company = the
    // role. Company from "joining X" first; "interest in X and" only when X
    // isn't a job title.
    const interestIn = text.match(/interest in ([^,.\n]+?) and\b/i)
    const interestCompany = interestIn && !/\b(?:position|role|job|vacancy|post|stelle)\b/i.test(interestIn[1]) ? interestIn : null
    const companyMatch = text.match(/\bjoining ([A-Z][\w&.\- ]{1,40}?)[.,!\n]/) || interestCompany || text.match(/applying to ([^,.\n]+?)[.,\n]/i) || text.match(/at ([^,.\n]+?) for the position/i)
      // A signature line ending in a legal form: "SICPA SA", "Jungfraubahnen Management AG"
      // Signature line "### TéléCharmey SA": markdown #/* prefix allowed,
      // accented letters too (2026-09-25).
      || text.match(/^[\s#*_>-]*(\p{Lu}[\p{L}\d&.'\- ]{1,60}?\s(?:AG|SA|GmbH|Sàrl|SARL|Ltd|Inc|LLC|S\.A\.))[\s*_#]*$/mu)
      || text.match(/interest in joining ([^,.\n]+)/i)
    const roleMatch = text.match(/pour le poste d(?:e |')([^,.\n]+)/i) || text.match(/für die (?:Stelle|Position) als ([^,.\n]+)/i) || text.match(/interest in the ([^,.\n]+?) (?:position|role|job|vacancy)\b/i) || text.match(/position of (.+?) to join/i) || text.match(/position of ([^,.\n]+)/i) || text.match(/for the role of ([^,.\n]+)/i)
      || text.match(/for the ([^,.\n]+?) (?:career opportunity|position|role|job|vacancy)\b/i)
    return {
      company: companyMatch ? companyMatch[1].trim() : '',
      role: roleMatch ? roleMatch[1].trim() : '',
    }
  }
  // Recognised outcomes preselect a suggestion in the status dropdown.
  function looksLikeRejection(text: string): boolean {
    return /regret to inform|not (?:be )?(?:process|proceed|progress|move forward)\w* (?:with )?your application|unfortunately[^.]{0,80}(?:not|other candidates)|decided to (?:pursue|move forward with) other|leider (?:müssen wir |muss ich |müssen wir dir |muss ich dir )?(?:ihnen |dir )?(?:mitteilen|absagen)|leider (?:muss|müssen) (?:ich|wir) (?:ihnen |dir )?mitteilen|andere\S* (?:bewerber|kandidat)\S*[^.]{0,40}entschieden|absage|nous (?:avons le regret|regrettons)|au regret de vous informer|pas (?:pu )?(?:retenir|donner suite)|n.a (?:malheureusement )?pas été retenue?|pas été retenue?|ne (?:pas )?pouvons pas donner suite|(?:alle |die )?(?:posten|stellen?|positionen?) (?:bereits |inzwischen )?(?:besetzt|besetzen|besetzten)|anderweitig besetzt|(?:bereits|inzwischen) besetzt|für (?:eine andere person|einen anderen kandidaten|eine andere kandidatin) entschieden|nicht (?:weiter )?berücksichtigen|poste (?:a (?:déjà )?été|est (?:déjà )?) pourvu|(?:position|role|vacancy) has (?:already )?been filled/i.test(text)
  }
  // 2026-09-25: real bug, live - user pasted an invitation ("würde ich dir
  // gerne vorschlagen, dass wir uns ... zu einem kurzen Gespräch via
  // Microsoft Teams treffen ... kennenlernen") and nothing changed: only
  // rejections were recognised. Now: formal interview wording -> Interview;
  // a short / get-to-know call -> Screening ("why not screening?" - user).
  // Never moves a status backwards; a rejection always wins.
  function looksLikeFormalInterview(text: string): boolean {
    return /\binterview|vorstellungsgespr|bewerbungsgespr|zweite(?:s|n)? gespr|entretien|assessment/i.test(text)
  }
  function looksLikeScreening(text: string): boolean {
    return /kurz(?:es|en|er)? (?:gespräch|telefonat|austausch|call)|kennenlern|get to know|short call|brief (?:call|chat)|phone screen|screening|telefonat|microsoft teams|zoom|video call|would like to (?:meet|speak|talk)|(?:schedule|arrange) a (?:call|meeting|chat)|gespräch|treffen|premier échange|échange (?:téléphonique|visio)|vous rencontrer/i.test(text)
  }
  function looksLikeOffer(text: string): boolean {
    // An open position plus a personal interest/availability check is also
    // an offer suggestion, even without the formal word "Angebot".
    const explicit = /\bjob offer\b|we (?:would like to|are pleased to|are delighted to) offer you|\b(?:stellenangebot|arbeitsangebot|vertragsangebot)\b|wir (?:möchten|wollen) (?:ihnen|dir) (?:die|eine) stelle anbieten|offre d[’']embauche|nous (?:souhaitons|avons le plaisir de) vous proposer (?:le|un) poste/i.test(text)
    const openPosition = /\bfreie[nrms]? stelle\b|\boffene[nrms]? stelle\b/i.test(text)
    const interest = /(?:noch|weiterhin) interesse|interesse an der (?:freien|offenen) stelle/i.test(text)
    const availability = /ab wann (?:wären|sind|könnten|können) sie|wann (?:könnten|können) sie (?:anfangen|beginnen|starten)/i.test(text)
    return explicit || (openPosition && interest && availability)
  }
  function statusFromEmail(text: string, current: string | null): string {
    if (looksLikeRejection(text)) return current === 'accepted' ? current : 'rejected'
    const found = looksLikeOffer(text) ? 'offer' : looksLikeFormalInterview(text) ? 'interview' : looksLikeScreening(text) ? 'screening' : null
    if (!found) return current || 'applied'
    // 2026-09-25: user back-filled older emails ("we're reviewing your CV")
    // after a rejection, and the old email overwrote it. A final status is
    // never changed by a pasted email - only by hand from the status menu.
    if (current === 'rejected' || current === 'accepted') return current
    if (current && STATUSES.indexOf(current) > STATUSES.indexOf(found)) return current
    return found
  }
  // "We got it, we're reviewing it" replies (TéléCharmey, 2026-09-25):
  // the status stays as it is; a dated note records that they replied.
  function looksLikeAcknowledgement(text: string): boolean {
    return /entre de bonnes mains|nous (?:allons|avons bien) (?:reçu|l.étudier|étudier)|bien reçu|accusé de réception|avons reçu (?:ta|votre) candidature|received your application|we have received|confirm (?:the )?receipt|currently reviewing|will review your application|eingang (?:ihrer|deiner) bewerbung|(?:ihre|deine) bewerbung (?:ist )?(?:bei uns )?eingegangen|haben (?:ihre|deine) (?:bewerbung|unterlagen) erhalten|werden (?:ihre|deine) (?:bewerbung|unterlagen) (?:sorgfältig )?prüfen/i.test(text)
  }
  function openEmailUpdate() {
    setEmailText('')
    setEmailSender('')
    setEmailSubject('')
    setEmailAmbiguous(false)
    setEmailCandidates([])
    setEmailMatch(null)
    setEmailCompany('')
    setEmailRole('')
    setEmailCv('')
    setEmailCover('')
    setEmailModal(true)
  }
  // Receipt acknowledgements keep the existing status. Recognised recruiter
  // steps suggest a status for review before the person saves the update.
  // Body and sender are pasted separately - copying an email only grabs
  // the body; the sender's address is a second copy from the header.
  function checkEmailMatch(body: string, sender: string, subject = emailSubject) {
    setEmailText(body)
    setEmailSender(sender)
    setEmailSubject(subject)
    const text = subject + '\n' + sender + '\n' + body
    const candidates = findEmailCandidates(text)
    const match = candidates.length === 1 ? candidates[0] : null
    setEmailCandidates(candidates)
    setEmailAmbiguous(candidates.length > 1)
    if (match) {
      // Fill every field from the application already on file - nothing
      // to retype.
      setEmailCompany(match.company)
      setEmailRole(match.role || guessFromEmail(text).role)
      setEmailCv(match.cv)
      setEmailCover(match.cover)
    } else {
      const guess = guessFromEmail(text)
      const domain = senderDomains(text)[0]
      setEmailCompany(guess.company || (domain ? domain.charAt(0).toUpperCase() + domain.slice(1) : ''))
      setEmailRole(guess.role)
      setEmailCv('')
      setEmailCover('')
    }
    setEmailMatch(match)
    setEmailStatus(statusFromEmail(text, match ? match.status : null))
  }
  function recheckCompany(company: string) {
    setEmailCompany(company)
    // An application already matched or picked stays the one being
    // updated - typing here corrects its name (user: corrections were lost).
    if (emailMatch) return
    const text = company + '\n' + emailSubject + '\n' + emailSender + '\n' + emailText
    const candidates = findEmailCandidates(text)
    const match = findEmailMatch(text)
    setEmailCandidates(candidates)
    setEmailAmbiguous(candidates.length > 1)
    setEmailMatch(match)
    if (match) { setEmailRole(match.role); setEmailCv(match.cv); setEmailCover(match.cover) }
    setEmailStatus(statusFromEmail(text, match ? match.status : null))
  }
  function pickEmailApplication(picked: App) {
    setEmailMatch(picked)
    setEmailCompany(picked.company)
    setEmailRole(picked.role)
    setEmailCv(picked.cv)
    setEmailCover(picked.cover)
    setEmailStatus(statusFromEmail(emailSubject + '\n' + emailSender + '\n' + emailText, picked.status))
  }
  function applyEmailUpdate() {
    if (emailAmbiguous && !emailMatch) return
    const today = new Date().toISOString().slice(0, 10)
    const text = emailSubject + '\n' + emailSender + '\n' + emailText
    const finalStatus = emailMatch && (emailMatch.status === 'rejected' || emailMatch.status === 'accepted')
    const ackNote = looksLikeAcknowledgement(text) && !looksLikeRejection(text) && !finalStatus ? `Received - reviewing (${today})` : ''
    const withNote = (notes: string) => !ackNote || notes.includes(ackNote) ? notes : (notes ? `${notes}\n${ackNote}` : ackNote)
    if (emailMatch) {
      const company = emailCompany.trim() || emailMatch.company
      const role = emailRole.trim() || emailMatch.role
      setApps(prev => prev.map(a => a.id === emailMatch.id ? { ...a, status: emailStatus, company, role, cv: emailCv.trim() || a.cv, cover: emailCover.trim() || a.cover, notes: withNote(a.notes) } : a))
      setFilter('all')
      setEmailUpdatedId(emailMatch.id)
      offerFinish(emailMatch.id)
    } else if (emailCompany.trim()) {
      const id = Date.now()
      setApps(prev => [...prev, { id, company: emailCompany.trim(), role: emailRole.trim(), date: today, status: emailStatus, cv: emailCv.trim(), cover: emailCover.trim(), nextDate: '', notes: withNote('') }])
      setFilter('all')
      setEmailUpdatedId(id)
      offerFinish(id)
    } else {
      return
    }
    setEmailModal(false)
  }
  // Changing status is the single most common edit on this whole page -
  // it shouldn't need the full modal (pencil -> dropdown -> Save).
  function updateStatus(id: number, status: string) {
    uxRecorder.mark('status_change')
    if (status === 'accepted') setReward(true)
    setApps(prev => prev.map(a => a.id === id ? { ...a, status } : a))
    offerFinish(id)
  }

  const counts: Record<string, number> = {}
  apps.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1 })

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function exportPDF() {
    uxRecorder.mark('report_export')
    const rows = apps.map(a => `
      <tr>
        <td>${escapeHtml(a.company)}</td>
        <td>${escapeHtml(a.role)}</td>
        <td>${escapeHtml(a.date)}</td>
        <td>${escapeHtml(STATUS_PLAIN[a.status] || a.status)}</td>
        <td>${escapeHtml(a.cover || '-')}</td>
        <td>${escapeHtml(a.cv || '-')}</td>
        <td>${escapeHtml(a.nextDate || '-')}</td>
        <td>${escapeHtml(a.notes || '-')}</td>
      </tr>`).join('')
    const countLabel = apps.length === 1 ? t('pdf.application') : t('pdf.applications')
    const statsHtml = Object.entries(counts)
      .map(([s, n]) => `<span class="stat-pill"><strong>${n}</strong> ${escapeHtml(STATUS_PLAIN[s] || s)}</span>`)
      .join('')
    // YYYYMMDDhhmm_description - sorts chronologically by filename, matches
    // the same pattern used by the CV and cover-letter generators.
    const d = new Date()
    const ts = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`
    const filename = `${ts}_job_applications`
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(filename)}</title>
      <style>
        body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 2rem; color: #111; }
        h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
        p.meta { color: #555; font-size: 0.8rem; margin-bottom: 1rem; }
        .stats-row { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
        .stat-pill { background: #f0f0f0; border-radius: 20px; padding: 4px 12px; font-size: 0.78rem; }
        .stat-pill strong { color: #111; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 0.8rem; vertical-align: top; overflow-wrap: anywhere; }
        th { background: #f0f0f0; }
        @media print { .stats-row { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style></head><body>
      <h1>${escapeHtml(t('pdf.title'))}</h1>
      <p class="meta">${escapeHtml(t('pdf.exported'))} ${new Date().toLocaleDateString()} &middot; ${apps.length} ${escapeHtml(countLabel)}</p>
      <div class="stats-row">
        <span class="stat-pill"><strong>${apps.length}</strong> ${escapeHtml(t('stat.total'))}</span>
        ${statsHtml}
      </div>
      <table>
        <thead><tr><th>${escapeHtml(t('table.company'))}</th><th>${escapeHtml(t('table.role'))}</th><th>${escapeHtml(t('table.date'))}</th><th>${escapeHtml(t('table.status'))}</th><th>${escapeHtml(t('table.cover'))}</th><th>${escapeHtml(t('table.cv'))}</th><th>${escapeHtml(t('table.next'))}</th><th>${escapeHtml(t('table.notes'))}</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8">${escapeHtml(t('table.empty'))}</td></tr>`}</tbody>
      </table>
      </body></html>`
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    win.print()
  }

  function copyAsList() {
    uxRecorder.mark('copy_email')
    const lines = apps.map(a => {
      let line = `- ${a.date} — ${a.company} — ${a.role} (${STATUS_PLAIN[a.status] || a.status})`
      if (a.cover?.trim()) line += ` — ${t('table.cover')}: ${a.cover}`
      if (a.cv?.trim()) line += ` — ${t('table.cv')}: ${a.cv}`
      if (a.nextDate) line += ` — ${t('copyList.next')}: ${a.nextDate}`
      if (a.notes?.trim()) line += ` — ${t('table.notes')}: ${a.notes}`
      return line
    })
    navigator.clipboard?.writeText(lines.join('\n')).then(() => {
      setCopiedList(true)
      setTimeout(() => setCopiedList(false), 2000)
    })
  }

  function exportBackup() {
    uxRecorder.mark('backup_export')
    const backup = { apps, quota }
    const d = new Date()
    // app: iOS share sheet (Files, Mail, AirDrop); browser: download
    const device = window.matchMedia('(max-width: 760px)').matches ? 'phone' : 'computer'   // 2026-11-05 owner: phone and computer exports must be told apart in Downloads
    void saveFile(`${stamp(d)}_jobtrack_backup_${device}.json`, JSON.stringify(backup, null, 2), 'application/json')
    const snapshot = JSON.stringify(backup)
    const at = d.toISOString()
    try {
      localStorage.setItem(BACKUP_SNAPSHOT_STORAGE, snapshot)
      localStorage.setItem(BACKUP_AT_STORAGE, at)
    } catch { /* storage full/blocked - banner just keeps showing */ }
    setBackupSnapshot(snapshot)
    setBackupAt(at)
  }

  function importBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string)
        const importedApps: App[] = Array.isArray(parsed.apps) ? parsed.apps : Array.isArray(parsed) ? parsed : []
        if (importedApps.length === 0) throw new Error('no apps')
        // Fresh ids on import - a backup made on another device could
        // collide with ids already used here.
        // 2026-10-14 owner: same merge as Sync - opening the same backup twice no
        // longer doubles the list; an entry that differs is kept twice (never lose data)
        setApps(prev => { const r = merge(prev, {}, importedApps, {}); setImportJoined(r.joined); return r.apps })
        if (!quota && parsed.quota) setQuota(parsed.quota)
        setBackupImported(true)
        setTimeout(() => setBackupImported(false), 2500)
      } catch {
        alert(t('backup.importError'))
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className={'jobtrack-page' + (minimal ? ' jt-min' : '')}>

      <dialog ref={actionsDialogRef} className="jt-notes-dialog" aria-labelledby="jobtrack-actions-heading" onClose={() => setActionsTargetId(null)}>
        <h2 id="jobtrack-actions-heading">{t('table.actions')}</h2>
        {actionsApp && <div className="jt-report-actions">
          <button type="button" className="btn-secondary export-btn" onClick={() => { actionsDialogRef.current?.close(); openNote(actionsApp) }}><HeaderIcon col="notes" filled={!!actionsApp.notes?.trim()} />{t(actionsApp.notes?.trim() ? 'note.edit' : 'note.add')}</button>
          <button type="button" className="btn-secondary export-btn" onClick={() => { actionsDialogRef.current?.close(); openEdit(actionsApp) }}><HeaderIcon col="edit" />{t('action.edit')}</button>
          <button type="button" className="btn-secondary export-btn jt-menu-delete" onClick={() => { actionsDialogRef.current?.close(); del(actionsApp.id) }}>{t('action.delete')}</button>
        </div>}
        <div className="jt-notes-buttons"><button type="button" onClick={() => actionsDialogRef.current?.close()}>{t('close')}</button></div>
      </dialog>
      <dialog ref={reportDialogRef} className="jt-notes-dialog" aria-labelledby="jobtrack-report-heading">
        <h2 id="jobtrack-report-heading">{t('report.choose')}</h2>
        <div className="jt-report-actions">
          <button type="button" className="btn-secondary export-btn" disabled={apps.length === 0} onClick={() => { reportDialogRef.current?.close(); if (isApp()) openOrp(); else exportPDF() }}><HeaderIcon col="list" />{t('report.pdf')}</button>
          <button type="button" className="btn-secondary export-btn" onClick={copyAsList} disabled={apps.length === 0} title={t('copyList')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /><path d="M5 6h6M5 9.5h4" /><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M12 13h7M12 16h7M12 19h4" /></svg>
              <span>{copiedList ? t('copyList.done') : t('copyList')}</span>
            </button>
        </div>
        <div className="jt-notes-buttons"><button type="button" onClick={() => reportDialogRef.current?.close()}>{t('close')}</button></div>
      </dialog>
      <dialog ref={deleteDialogRef} className="jt-notes-dialog" aria-labelledby="jobtrack-delete-heading" onClose={() => setDeleteTargetId(null)}>
        <form onSubmit={e => { e.preventDefault(); confirmDelete() }}>
          <h2 id="jobtrack-delete-heading">{t('confirm.delete')}</h2>
          <p><strong>{apps.find(a => a.id === deleteTargetId)?.company}</strong><br />{apps.find(a => a.id === deleteTargetId)?.role}</p>
          <p style={{ whiteSpace: 'pre-line' }}>{t('delete.warning')}</p>
          <div className="jt-notes-buttons"><button type="button" autoFocus onClick={() => deleteDialogRef.current?.close()}>{t('cancel')}</button><button type="submit" className="jt-delete-confirm">{t('action.delete')}</button></div>
        </form>
      </dialog>
      <dialog ref={noteDialogRef} className="jt-notes-dialog jt-note-editor" aria-labelledby="jobtrack-note-heading" onClose={() => setNoteTargetId(null)}>
        <form onSubmit={e => { e.preventDefault(); saveNote() }}>
          <h2 id="jobtrack-note-heading">{t('table.notes')}</h2>
          <p>{apps.find(a => a.id === noteTargetId)?.company}</p>
          <div className="jt-note-input"><textarea aria-label={t('table.notes')} placeholder={t('note.hint')} value={noteDraft} onChange={e => setNoteDraft(e.target.value)} autoFocus />{noteDraft && <button type="button" className="jt-note-clear" aria-label={t('note.clear')} onClick={() => { setNoteDraft(''); noteDialogRef.current?.querySelector('textarea')?.focus() }}>×</button>}</div>
          <div className="jt-notes-buttons"><button type="button" onClick={() => noteDialogRef.current?.close()}>{t('cancel')}</button><button type="submit" className="jt-note-save">{t('save')}</button></div>
        </form>
      </dialog>

      {reward && (
        <div className="jt-reward" role="button" tabIndex={0} aria-label="Close job celebration" onClick={() => setReward(false)} onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setReward(false) } }} ref={node => node?.focus()}>
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 60 }).map((_, i) => <span key={i} className="confetti-piece" style={{ left: `${(i * 37 + 3) % 100}%`, animationDelay: `${-(i % 17) * .43}s`, animationDuration: `${5 + (i % 7) * .6}s`, background: ['#00ff41', '#f1c40f', '#3b82f6', '#ff4fa3'][i % 4] }} />)}
          </div>
          <div className="jt-reward-title">ACCEPTED!</div>
          <div className="jt-reward-sub">You got the job.</div>
        </div>
      )}
      <div className="container">
        {/* 2026-09-15: real feedback, live - "update emoji to svg
            image. JobTrack header is darkened for some strange
            reason." The header's gradient-text-fill CSS trick
            (background-clip: text + transparent text-fill-color) only
            works on real text - a color emoji inside it doesn't
            respect text-fill-color and rendered as a dark/broken
            glyph instead of the actual emoji colors. A real <svg> icon
            outside the clipped text isn't affected by that at all. */}
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* 2026-10-14 owner: the app icon (clipboard + check + confetti) everywhere */}
          <img src={jobTrackIcon} alt="" style={{ width: '2.4rem', height: '2.4rem', borderRadius: '22%', flexShrink: 0 }} />
          <span>{t('title')}</span>
          {/* 2026-10-14 owner: "lots of controls... a minimal version with only images" -
              icons only; mouse over a row (or tap this again on a phone) for the full view */}
          <span className="jt-header-controls">
          <button type="button" className="jt-min-toggle" aria-pressed={minimal} onClick={() => { uxRecorder.mark('view_toggle'); setMinimal(m => !m) }} aria-label={minimal ? MIN_LABEL[lang].full : MIN_LABEL[lang].min} title={minimal ? MIN_LABEL[lang].full : MIN_LABEL[lang].min}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={minimal ? 'M3 5v14h18V5H3zm16 6H5V7h14v4zM5 17v-4h14v4H5z' : 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z'} /></svg>
            <span>{minimal ? MIN_LABEL[lang].full : MIN_LABEL[lang].min}</span>
          </button>
          <button type="button" className="jt-settings-toggle" aria-label={t('settings.title')} title={t('settings.title')} onClick={() => settingsDialogRef.current?.showModal()}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="#0f0d1a"/><circle cx="15" cy="17" r="3" fill="#0f0d1a"/></svg></button></span>
        </h1>
        {/* 2026-11-09 owner: website or app, one fold, three lines with icons (website only; the app itself needs no pitch) */}
        {!isApp() && <details className="jt-where">
          <summary>{t('where.title')}</summary>
          <ul>
            <li><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z" /></svg><span>{t('where.web')}</span></li>
            <li><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg><span>{t('where.backup')}</span></li>
            <li><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z" /></svg><span>{t('where.app')}</span></li>
          </ul>
        </details>}
        <div className="stats">
          {quota && !editingQuota && (() => {
            const count = countInPeriod(apps, quota.period)
            const pct = Math.min(100, (count / quota.target) * 100)
            const met = count >= quota.target
            // Green-dominant on purpose - a quota tracker for a stressful job
            // hunt shouldn't greet you with red every time you open it.
            const color = lineColor
            const zone = pct >= 75 ? 'quota.pool.almost' : pct >= 30 ? 'quota.pool.progress' : 'quota.pool.start'
            const milestone = pct === 0 ? null : getStringVariant(zone, lang, count)

            if (met) {
              return (
                <div className="stat-card quota-card quota-celebrate">
                  <button className="quota-edit-btn" onClick={openQuotaEditor} title={t('quota.edit')} aria-label={t('quota.edit')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
                  </button>
                  <div className="confetti" aria-hidden="true">
                    {Array.from({ length: 12 }).map((_, i) => <span key={i} className="confetti-piece" />)}
                  </div>
                  <svg className="quota-relax-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                  <div className="stat-number" style={{ color }}>{count} / {quota.target}</div>
                  <p className="quota-celebrate-title">{getStringVariant('quota.pool.celebrateTitle', lang, count)}</p>
                  <p className="quota-celebrate-body">{getStringVariant('quota.pool.celebrateBody', lang, count)}</p>
                </div>
              )
            }
            return (
              <div className="stat-card quota-card" style={{ borderColor: color }}>
                <button className="quota-edit-btn" onClick={openQuotaEditor} title={t('quota.edit')} aria-label={t('quota.edit')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>
                </button>
                <div className="stat-number" style={{ color }}>{count} / {quota.target}</div>
                <div className="stat-label">{quota.period === 'month' ? t('quota.thisMonth') : quota.period === 'fortnight' ? t('quota.thisFortnight') : t('quota.thisWeek')}</div>
                <div className="quota-bar"><div className="quota-bar-fill" style={{ width: `${pct}%`, background: color }} /></div>
                {milestone && <div className="quota-milestone" style={{ color }}>{milestone}</div>}
              </div>
            )
          })()}
          {!quota && !editingQuota && (
            <button className="stat-card quota-set-btn" onClick={openQuotaEditor}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
              <div className="stat-label">{t('quota.setPrompt')}</div>
              <div className="quota-set-hint">{t('quota.setHint')}</div>
            </button>
          )}
          {editingQuota && (
            <div className="stat-card quota-card quota-editing">
              <input type="number" min={1} value={quotaDraft.target} onChange={e => setQuotaDraft(q => ({ ...q, target: Number(e.target.value) }))} className="quota-input" />
              <span className="quota-input-label">{t('quota.count')}</span>
              <select value={quotaDraft.period} onChange={e => setQuotaDraft(q => ({ ...q, period: e.target.value as 'week' | 'fortnight' | 'month' }))} className="quota-select">
                <option value="week">{t('quota.period.week')}</option>
                <option value="fortnight">{t('quota.period.fortnight')}</option>
                <option value="month">{t('quota.period.month')}</option>
              </select>
              <div className="quota-edit-actions">
                <button className="btn-small" onClick={saveQuota}>{t('quota.save')}</button>
                <button className="btn-small-ghost" onClick={() => setEditingQuota(false)}>{t('quota.cancel')}</button>
                {quota && <button className="btn-small-ghost" onClick={removeQuota}>{t('quota.remove')}</button>}
              </div>
            </div>
          )}
          <div className="stat-card"><div className="stat-number">{apps.length}</div><div className="stat-label">{t('stat.total')}</div></div>
          {Object.entries(counts).map(([s, n]) => <div key={s} className="stat-card"><div className="stat-number">{n}</div><div className="stat-label">{STATUS_PLAIN[s] || s}</div></div>)}
        </div>
        <dialog ref={settingsDialogRef} className="jt-notes-dialog jt-settings-dialog" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close() }}>
          <h2>{t('settings.title')}</h2>
          <section className="jt-settings-backups"><h3>{t('settings.backupFiles')}</h3><div className="howto-step howto-step-info" ref={infoRef}>
            <button type="button" className="howto-go" onClick={exportBackup} disabled={apps.length === 0}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              <span>{t('backup.export')}</span>
            </button>
            <button type="button" className="info-btn" aria-label={t('backup.export')} onClick={() => setShowStorageInfo(v => !v)}>i</button>
            {showStorageInfo && (
              <div className="info-popover">
                <button type="button" className="info-popover-close" onClick={() => setShowStorageInfo(false)} aria-label={t('close')}>✕</button>
                <p className="info-popover-title">{t('info.title')}</p>
                <ul className="info-popover-list">
                  <li>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                    <span>{t('info.point1')}</span>
                  </li>
                  <li>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /><line x1="3" y1="3" x2="21" y2="21" /></svg>
                    <span>{t('info.point2')}</span>
                  </li>
                  <li>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="3" rx="1" /><rect x="3" y="4" width="12" height="3" rx="1" /><rect x="3" y="18" width="7" height="3" rx="1" /></svg>
                    <span>{t('info.point3')}</span>
                  </li>
                  <li className="info-popover-item-block">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
                    <div>
                      <p className="info-popover-item-title">{t('info.point4.title')}</p>
                      <p className="info-popover-item-sub">{t('info.point4.instruction.lead')} <strong>{t('backup.export').replace(/^\d+\.\s*/, '')}</strong>{t('info.point4.instruction.trail')}</p>
                      <ul className="info-popover-sublist">
                        <li>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="12" x2="2" y2="12" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /><line x1="6" y1="16" x2="6.01" y2="16" /><line x1="10" y1="16" x2="10.01" y2="16" /></svg>
                          <span>{t('info.point4.computer')}</span>
                        </li>
                        <li>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="9" width="10" height="12" rx="1" /><rect x="10" y="2" width="4" height="7" /><line x1="10" y1="5" x2="14" y2="5" /></svg>
                          <span>{t('info.point4.usb')}</span>
                        </li>
                        <li>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                          <span>{t('info.point4.cloud')}</span>
                        </li>
                      </ul>
                    </div>
                  </li>
                </ul>
              </div>
            )}
          </div><input type="file" accept="application/json" ref={backupInputRef} style={{ display: 'none' }} onChange={importBackup} /><div className="howto-step howto-step-info import-btn-wrap" ref={importInfoRef}>
            <button type="button" className="howto-go" onClick={() => backupInputRef.current?.click()} title={t('backup.hint')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></svg>
              <span>{backupImported ? (importJoined ? `${t('backup.imported')} - ${importJoined} ${t('backup.joined')}` : t('backup.imported')) : t('backup.import')}</span>
            </button>
            <button type="button" className="info-btn" aria-label={t('backup.importInfo.title')} onClick={() => setShowImportInfo(v => !v)}>i</button>
            {showImportInfo && (
              <div className="info-popover import-info-popover">
                <button type="button" className="info-popover-close" onClick={() => setShowImportInfo(false)} aria-label={t('close')}>✕</button>
                <p className="info-popover-title">{t('backup.importInfo.title')}</p>
                <ul className="info-popover-list">
                  <li>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><polyline points="9 15 11 17 15 13" /></svg>
                    <span>{t('backup.importInfo.point1')}</span>
                  </li>
                  <li>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
                    <span>{t('backup.importInfo.point2')}</span>
                  </li>
                  <li>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
                    <span>{t('backup.importInfo.point3')}</span>
                  </li>
                </ul>
              </div>
            )}
          </div></section>
          {diag && <><div className="jt-ux-local"><label><input type="checkbox" checked={uxRecording} onChange={e => setLocalUXRecording(e.target.checked)} />{t('ux.local')}</label></div>
          <div className="jt-ux-local"><label><input type="checkbox" checked={includeUX} disabled={!uxRecording} onChange={e => { setIncludeUX(e.target.checked); setReviewedUX(null) }} />{t('ux.include')}</label></div>
          <p>{t('settings.ux')}</p></>}
          {!diag && <><div className="jt-ux-local"><label><input type="checkbox" checked={uxRecording} onChange={e => setLocalUXRecording(e.target.checked)} />{t('diag.on')}</label><button type="button" className="info-btn" aria-label={t('ux.local')} aria-expanded={showDiagInfo} onClick={() => setShowDiagInfo(v => !v)}>i</button></div>
          {showDiagInfo && <p className="jt-ux-info">{t('ux.localInfo')}</p>}</>}
          <div className="jt-notes-buttons"><button type="button" onClick={() => settingsDialogRef.current?.close()}>{t('close')}</button></div>
        </dialog>

        {/* 2026-10-13 owner: "top header has 1. - 4., they could be the actual link
            buttons" - the steps ARE the buttons now; their copies below are gone. */}
        <div className="howto-strip">
          <div className="howto-step">
            <button type="button" className={'howto-go' + (apps.length === 0 ? ' howto-go-main' : '')} onClick={openAdd}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
              <span>{t('howto.add')}</span>
            </button>
          </div>
          <div className="howto-arrow">→</div>
          <div className="howto-step howto-step-info" ref={emailInfoRef}>
            <button type="button" className="howto-go" onClick={openEmailUpdate}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
              <span>{t('howto.track')}</span>
            </button>
            {/* 2026-09-23: real feedback, live - "does copy from need copying
                too, then where to paste?" Copying an email grabs the body
                only; the sender's address is a separate, optional copy. */}
            <button type="button" className="info-btn" aria-label={t('emailinfo.title')} onClick={() => setShowEmailInfo(v => !v)}>i</button>
            {showEmailInfo && (
              <div className="info-popover">
                <button type="button" className="info-popover-close" onClick={() => setShowEmailInfo(false)} aria-label={t('close')}>✕</button>
                <p className="info-popover-title">{t('emailinfo.title')}</p>
                <ol className="info-popover-list info-popover-steps">
                  {['emailinfo.s1', 'emailinfo.s2', 'emailinfo.s3', 'emailinfo.s4'].map((k, n) => (
                    <li key={k}><span className="info-popover-step-num">{n + 1}.</span><span>{t(k).split('{icon}').map((part, j) => j === 0 ? part : <span key={j}><svg className="info-inline-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h16v16H4z" /><path d="M22 6l-10 7L2 6" /></svg>{part}</span>)}</span></li>
                  ))}
                </ol>
              </div>
            )}
          </div>


          <div className="howto-arrow">→</div>
          <div className="howto-step"><button type="button" className="howto-go" onClick={() => setSyncOpen(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="11" y="2" width="11" height="8" rx="1" stroke="#4da3ff" /><path d="M16.5 10v3m-3 0h6" stroke="#4da3ff" /><rect x="2" y="12" width="6" height="10" rx="1.5" stroke="#00ff41" /><path d="M10 16l2-2m-1-3 2-2" stroke="#00ff41" strokeDasharray="1 3" /></svg><span>{t('howto.private')}</span></button></div>
          {/* 2026-10-14 owner: Import next to Save backup - save and open are a pair */}


        <div className="toolbar jt-secondary-actions">
          <div className="toolbar-primary">
            {/* 2026-10-13 owner: ORP proofs (716.007 PDF + Job-Room) in one tap */}
            <button className="btn-secondary export-btn orp-btn" title={orpButtonLabel()} onClick={() => openOrp()}>
              {/* 2026-10-14 owner: the ORP building - ground + 5 floors, ORP on the 3rd floor (4th level up), those windows lit */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><rect x="4.5" y="1" width="15" height="21.5" rx="1" /><path d="M10.5 22.5v-3h3v3" />{[2.6, 5.7, 8.8, 11.9, 15].map(y => [6.8, 11, 15.2].map(x => <rect key={`${x}${y}`} x={x} y={y} width="2.1" height="1.7" rx="0.3" fill={y === 8.8 ? '#ffb000' : 'currentColor'} stroke="none" opacity={y === 8.8 ? 1 : 0.5} />))}{[6.8, 15.2].map(x => <rect key={`g${x}`} x={x} y="18.6" width="2.1" height="1.7" rx="0.3" fill="currentColor" stroke="none" opacity="0.5" />)}</svg>
              <span className="export-btn-label">{orpButtonLabel()}</span>
            </button>
            <button type="button" className="btn-secondary export-btn" title={t('report.choose')} onClick={() => reportDialogRef.current?.showModal()}>
              <HeaderIcon col="list" /><span className="export-btn-label">{t('report.choose')}</span>
            </button>

            {/* 2026-10-14 owner: Copy as list joins the left group */}

          </div>

        </div>
        </div>

        {/* Keep reminder hooks active; show the choices below Finished only. */}
        <BackupBar inline target={finishTarget} lang={lang} apps={apps} snapshot={backupSnapshot} onSync={() => setSyncOpen(true)} onExport={exportBackup} onClear={() => { setApps([]); setTimeout(() => clearComputer(false), 0) }} />

        {apps.length > 0 && <details id="jobtrack-feedback" className="jt-testimonial">
          <summary><GiftIcon className="jt-testimonial-gift" />{finishL('How did JobTrack help? Share your experience and receive $5 software credit.', 'Wie hat JobTrack geholfen? Teilen Sie Ihre Erfahrung und erhalten Sie 5 $ Software-Guthaben.', 'Comment JobTrack vous a-t-il aidé? Partagez votre expérience et recevez 5 $ de crédit logiciel.')}</summary>
          {testimonialStatus === 'sent' ? <><p role="status">{finishL('Thank you. Your feedback and $5 credit request are awaiting review. Credit will be emailed after review.', 'Vielen Dank. Ihr Feedback und Ihre Anfrage für 5 $ Guthaben werden geprüft. Das Guthaben erhalten Sie danach per E-Mail.', 'Merci. Votre avis et votre demande de crédit de 5 $ sont en attente de vérification. Le crédit sera envoyé par e-mail après vérification.')}</p>{uxDeliveryNotice && <p role="alert">{uxDeliveryNotice}</p>}</> : <form onSubmit={e => { e.preventDefault(); void submitTestimonial() }}>
            <label>{finishL('Your experience', 'Ihre Erfahrung', 'Votre expérience')}<textarea rows={3} maxLength={2000} required placeholder={finishL('What helped? What could improve?', 'Was hat geholfen? Was könnte besser sein?', 'Qu’est-ce qui vous a aidé? Que peut-on améliorer?')} value={testimonialText} onChange={e => setTestimonialText(e.target.value)} /></label>
            <label>{finishL('Public name or pseudonym (optional)', 'Öffentlicher Name oder Pseudonym (optional)', 'Nom public ou pseudonyme (facultatif)')}<input maxLength={120} autoComplete="off" value={testimonialName} onChange={e => setTestimonialName(e.target.value)} /></label>
            <label>{finishL('Email for your credit (kept private)', 'E-Mail für Ihr Guthaben (bleibt privat)', 'E-mail pour votre crédit (reste privé)')}<input type="email" maxLength={254} required autoComplete="email" value={testimonialEmail} onChange={e => setTestimonialEmail(e.target.value)} /></label>
            <label className="jt-testimonial-consent"><input type="checkbox" checked={includeUX} disabled={testimonialStatus === 'sending' || !uxRecording} onChange={e => { setIncludeUX(e.target.checked); setReviewedUX(null) }} />{t('ux.include')}</label>
            {includeUX && <div className="jt-ux-review">
              <p>{t('ux.recording')}</p>
              <p>{t('ux.excludes')}</p>
              <div className="jt-ux-buttons"><button type="button" onClick={reviewUXReport}>{t('ux.review')}</button><button type="button" onClick={() => { uxRecorder.clear(); setReviewedUX(null) }}>{t('ux.clear')}</button></div>
              {reviewedUX && <><p>{t('ux.snapshot')}</p><pre tabIndex={0}>{JSON.stringify(reviewedUX, null, 2)}</pre></>}
              {!reviewedUX && <p>{t('ux.reviewRequired')}</p>}
            </div>}
            <label className="jt-testimonial-consent"><input type="checkbox" checked={testimonialPermission} onChange={e => setTestimonialPermission(e.target.checked)} />{finishL('I allow kworld to publish my feedback and public name on its website and in promotional materials, with disclosure of the $5 incentive. My email stays private.', 'kworld darf mein Feedback und meinen öffentlichen Namen auf der Website und in Werbematerialien veröffentlichen, mit Hinweis auf das Guthaben von 5 $. Meine E-Mail bleibt privat.', 'J’autorise kworld à publier mon avis et mon nom public sur son site et dans ses supports promotionnels, en mentionnant le crédit de 5 $. Mon e-mail reste privé.')}</label>
            <p>{finishL('Honest feedback, including criticism, qualifies for review. UX reports and publishing permission are optional and do not affect credit eligibility. No application records are attached. Publishing permission never covers your UX report or email.', 'Ehrliches Feedback, auch Kritik, wird geprüft. UX-Berichte und die Veröffentlichungserlaubnis sind freiwillig und beeinflussen den Guthabenanspruch nicht. Es werden keine Bewerbungsdaten angehängt. UX-Bericht und E-Mail dürfen nicht veröffentlicht werden.', 'Les avis honnêtes, y compris les critiques, sont examinés. Le rapport UX et l’autorisation de publication sont facultatifs et ne changent pas l’éligibilité au crédit. Aucune candidature n’est jointe. Le rapport UX et l’e-mail ne sont jamais autorisés à être publiés.')}</p>
            <button type="submit" className="btn" disabled={!testimonialText.trim() || !testimonialEmail.trim() || testimonialStatus === 'sending' || (includeUX && !reviewedUX)}>{testimonialStatus === 'sending' ? finishL('Sending…', 'Wird gesendet…', 'Envoi…') : finishL('Send feedback', 'Feedback senden', 'Envoyer mon avis')}</button>
            {testimonialStatus === 'error' && <p role="alert">{testimonialError}</p>}
          </form>}
        </details>}
        {apps.length > 0 && <div className="jt-verbose"><JobTrackPro apps={apps} lang={lang} /></div>}

        {autoJoin && <p className="jt-note">{autoJoin.n} {t('dup.auto')} <button type="button" className="jt-note-btn" onClick={() => { setApps(autoJoin.before); try { localStorage.setItem(KEEP_DUPS, '1') } catch { /* private mode */ } setAutoJoin(null) }}>{t('dup.undo')}</button></p>}
        {noAddress > 0 && <button type="button" className="jt-address-cleanup" aria-label={`${noAddress} ${t('gap.count')} ${t('gap.open')}`} title={`${noAddress} ${t('gap.count')} ${t('gap.open')}`} onClick={() => openOrp(true)}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span>{noAddress}</span><span className="jt-address-label">{t('gap.open')}</span></button>}

        <div className="filter-bar">
          <button className={`filter-btn${filter === 'all' ? ' active' : ''}`} onClick={() => { uxRecorder.mark('filter_change'); setFilter('all') }}>{t('filter.all')}</button>
          {STATUSES.map(s => (
            <span key={s} className="filter-btn-wrap">
              <button className={`filter-btn${filter === s ? ' active' : ''}`} onClick={() => { uxRecorder.mark('filter_change'); setFilter(s) }}>
                <StatusIcon status={s} /><span className="jt-lbl">{STATUS_PLAIN[s]}</span>
              </button>
              {s === 'technical' && (
                <InfoTip
                  text={t('status.technical.hint')}
                  label={t('status.technical.hint')}
                  icon={<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>}
                />
              )}
            </span>
          ))}
        </div>

        {/* Sits between the filters and the table - right where the
            records it is warning about are. */}

        {apps.length > 0 && <>
          <div ref={listStartRef} className="jt-list-anchor" />
          <div ref={findBarRef} className="jt-find-bar" role="search" aria-label={t('find.label')} style={{ top: navOffset }}>
            <div className="jt-find-input">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></svg>
              <input ref={searchInputRef} onFocus={() => uxRecorder.mark('search_focus')} type="search" value={searchText} onChange={e => setSearchText(e.target.value)} placeholder={t('find.label')} aria-label={t('find.label')} autoComplete="off" />
              {searchText && <button type="button" className="jt-find-clear" aria-label={t('find.clear')} onClick={() => { setSearchText(''); searchInputRef.current?.focus() }}>✕</button>}
            </div>
            <div className="jt-find-options">
              <output aria-live="polite">{t('find.count').replace('{found}', String(filtered.length)).replace('{total}', String(statusApps.length))}</output>
              <select aria-label={t('find.sort')} value={sortBy.col === 'company' ? (sortBy.asc ? 'az' : 'za') : (sortBy.asc ? 'oldest' : 'newest')} onChange={e => { uxRecorder.mark('sort_change'); setSortBy({ col: e.target.value === 'az' || e.target.value === 'za' ? 'company' : 'date', asc: e.target.value === 'az' || e.target.value === 'oldest' }) }}>
                <option value="newest">{t('find.newest')}</option>
                <option value="oldest">{t('find.oldest')}</option>
                <option value="az">{t('find.az')}</option>
                {sortBy.col === 'company' && !sortBy.asc && <option value="za">{t('find.za')}</option>}
              </select>
            </div>
          </div>
          {showListTop && <button type="button" className="jt-list-top" aria-label={t('find.topLabel')} onClick={() => { uxRecorder.mark('top'); if (listStartRef.current) scrollToTrackerElement(listStartRef.current) }}><span aria-hidden="true">↑</span> {t('find.top')}</button>}
        </>}

        <div className="jt-table-wrap">
          <table className="applications-table" style={{ ['--jt-line' as string]: lineColor, ['--jt-period-date' as string]: quota ? lineColor : '#00ff41' }}>
            {/* One shared record: desktop table and company-first phone card. */}
            <thead><tr>
              <th data-ux-column="date" className={sortCls('date')} aria-sort={sortBy.col === 'date' ? (sortBy.asc ? 'ascending' : 'descending') : 'none'} onClick={() => sortOn('date')} title="Sort by date"><HeaderIcon col="date" />{t('table.date')}{sortMark('date')}<InfoTip label={t('stale.legend')} icon={<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>} text={
                <span className="jt-datekey">
                  <span><b className="jt-dk-white">2026-10-14</b> = {t('dk.white')}</span>
                  <span><i className="jt-dk-line" style={{ background: lineColor }} /> = {t('dk.line')}</span>
                  <span><b className="jt-dk-amber">2026-09-19</b> <span className="jt-dk-amber">= {t('dk.amber')}</span></span>
                </span>} /></th>
              <th data-ux-column="status"><HeaderIcon col="status" />{t('table.status')}{statusCounts.length > 0 && <span className="jt-status-counts">{statusCounts.map(([st, n]) => <span key={st} className={`jt-sc jt-sc-${st}`}>{n} {STATUS_PLAIN[st]}</span>)}</span>}</th>
              <th data-ux-column="cover" title={t('table.cover')}><HeaderIcon col="cover" />{t('document.coverShort')}</th>
              <th data-ux-column="cv" title={t('table.cv')}><HeaderIcon col="cv" />{t('document.cvShort')}</th>
              <th data-ux-column="company" className={sortCls('company')} aria-sort={sortBy.col === 'company' ? (sortBy.asc ? 'ascending' : 'descending') : 'none'} onClick={() => sortOn('company')} title="Sort A-Z"><HeaderIcon col="company" />{t('table.company')}{sortMark('company')}</th>
              <th data-ux-column="role"><HeaderIcon col="role" />{t('table.role')}</th>
              <th data-ux-column="actions"><HeaderIcon col="actions" />{t('table.actions')}</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#a0a0b0', padding: '2rem' }}>{t(searchText.trim() ? 'find.empty' : 'table.empty')}</td></tr>}
              {filtered.map(a => (
                <Fragment key={a.id}>
                <tr id={`jobtrack-application-${a.id}`} key={a.id} className={a.id === firstOldId ? 'jt-first-old' : undefined}>
                  <td data-label={t('table.date')} className={['jt-cell-date', isOld(a) ? 'jt-old-date' : 'jt-current-date', sortBy.col === 'date' ? 'jt-sorted-cell' : ''].filter(Boolean).join(' ')} title={isStale(a) ? t('stale.hint') : undefined}>
                    <CellLabel col="date">{t('table.date')}</CellLabel>
                    <span>{a.date}</span>
                    {a.nextDate && <span className="jt-next-date"><HeaderIcon col="next" /><span>{t('table.next')}: {a.nextDate}</span></span>}
                  </td>
                  <td data-label={t('table.status')} className="jt-cell-status">
                    <CellLabel col="status">{t('table.status')}</CellLabel>
                    <label className={`status-badge status-select-wrap status-${a.status}`}>
                      <StatusIcon status={a.status} />
                      {STATUS_PLAIN[a.status] || a.status}
                      <select value={a.status} onChange={e => updateStatus(a.id, e.target.value)} className="status-select" aria-label={t('table.status')}>
                        {STATUS_MENU.map(s => <option key={s} value={s}>{STATUS_PLAIN[s]}</option>)}
                      </select>
                    </label>
                  </td>
                  <td colSpan={2} className="jt-cell-documents">
                    <div className="jt-documents">
                      <div className="jt-document"><CellLabel col="cover">{t('document.coverShort')}</CellLabel><DocumentIndicator value={a.cover} yes={t('document.included')} no={t('document.missing')} /></div>
                      <div className="jt-document"><CellLabel col="cv">{t('document.cvShort')}</CellLabel><DocumentIndicator value={a.cv} yes={t('document.included')} no={t('document.missing')} /></div>
                      {a.notes?.trim() && <div className="jt-application-note">
                        <button type="button" className="jt-note-edit" aria-label={t('note.edit')} onClick={() => openNote(a)}><span className="jt-note-text">{a.notes}</span></button>
                      </div>}
                    </div>
                  </td>
                  <td data-label={t('table.company')} className={'jt-cell-company' + (sortBy.col === 'company' ? ' jt-sorted-cell' : '')} title={a.company}><CellLabel col="company">{t('table.company')}</CellLabel><span className="jt-one">{a.company}</span></td>
                  <td data-label={t('table.role')} className="jt-cell-role" title={a.role}><CellLabel col="role">{t('table.role')}</CellLabel><span className="jt-one">{a.role}</span></td>
                  <td data-label={t('table.actions')} className="jt-actions">
                    <CellLabel col="actions">{t('table.actions')}</CellLabel>
                    <div className="jt-row-actions">
                    {finishJobId === a.id && <button type="button" className="jt-finish-float" aria-expanded={finishOpen} aria-controls="jobtrack-finish-panel" onClick={finishSession}>{finishL('Finished?', 'Fertig?', 'Terminé?')}</button>}
                    {gapText(a) && <button type="button" className="action-btn jt-gap-action" title={gapText(a)} aria-label={gapText(a)} onClick={() => openEdit(a)}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2 1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z" /></svg></button>}
                    <button type="button" className="action-btn jt-desktop-action" title={t(a.notes?.trim() ? 'note.edit' : 'note.add')} aria-label={t(a.notes?.trim() ? 'note.edit' : 'note.add')} onClick={() => openNote(a)}><HeaderIcon col="notes" filled={!!a.notes?.trim()} /></button>
                    <button className="action-btn jt-desktop-action" title={t('action.edit')} aria-label={t('action.edit')} onClick={() => openEdit(a)}><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg></button>
                    <button className="action-btn jt-desktop-action jt-delete-action" title={t('action.delete')} aria-label={t('action.delete')} onClick={() => del(a.id)}><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg></button>
                    <button type="button" className="action-btn jt-phone-actions" aria-haspopup="dialog" onClick={() => setActionsTargetId(a.id)}>{gapText(a) && <svg className="jt-gap-mini" viewBox="0 0 24 24" width="14" height="14" aria-label={gapText(a)}><path fill="currentColor" d="M12 2 1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z" /></svg>}<span>{t('table.actions')}</span></button>
                    </div>
                  </td>
                </tr>
                {finishJobId === a.id && finishOpen && <tr className="jt-finish-row"><td colSpan={7}>
                  <div id="jobtrack-finish-panel" className="jt-finish-expand"><div>
                    <div ref={setFinishTarget} />
                  </div></div>
                </td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <p className="jt-sponsor-privacy">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <span>{t('privacy.sponsors').split(/(?<=\.) /).map((x: string, i: number) => <Fragment key={i}>{i > 0 && <br />}{x}</Fragment>)}</span>
        </p>

        <div className="backup-panel jt-verbose">
          <div className="backup-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            <span><strong>{t('backup.privacy')}</strong> · {t('backup.privacyNote')}</span>
          </div>
          <div className="backup-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
            <span><strong>{t('backup.free')}</strong> · {t('backup.freeNote')}</span>
          </div>
        </div>

        {/* 2026-11-09 owner: website promo cards stay out of the app */}
        {!isApp() && <div className="jt-tool-strip">
            <a href="/cv-gen/" className="jt-tool-card" ref={adCv} onClick={() => countAdClick('jobtrack:cv')}>
              <span className="jt-tool-label">{t('ad.label')}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              <p className="jt-tool-title">{t('ad.cv.title')}</p>
              <p className="jt-tool-desc">{t('ad.cv.desc')}</p>
              <span className="jt-tool-cta">{t('ad.cv.cta')}</span>
            </a>
            <a href="/cl-gen" className="jt-tool-card" ref={adCl} onClick={() => countAdClick('jobtrack:cl')}>
              <span className="jt-tool-label">{t('ad.label')}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
              <p className="jt-tool-title">{t('ad.cl.title')}</p>
              <p className="jt-tool-desc">{t('ad.cl.desc')}</p>
              <span className="jt-tool-cta">{t('ad.cl.cta')}</span>
            </a>
          </div>}
      </div>

      {orpPanel && <OrpPanel apps={apps} onSync={() => setSyncOpen(true)} initialCleanup={orpCleanup} t={t} onClose={() => setOrpPanel(false)} onUpdate={(id, patch) => setApps(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x))} />}
      <dialog ref={welcomeRef} className="jt-notes-dialog jt-welcome" onCancel={() => closeWelcome(false)}>
        <h2 className="jt-welcome-head"><img src={jobTrackIcon} alt="" />Welcome to JobTrack</h2>
        <div className="jt-welcome-tiles">
          <button type="button" className="jt-tile jt-tile-main" onClick={() => closeWelcome(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="11" y="2" width="11" height="8" rx="1" stroke="#4da3ff" /><rect x="2" y="12" width="6" height="10" rx="1.5" stroke="#00ff41" /><path d="M10 16l2-2m-1-3 2-2" /></svg><span>Import or sync</span></button>
          <button type="button" className="jt-tile" onClick={() => { closeWelcome(false); backupInputRef.current?.click() }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></svg><span>Import backup file</span></button>
          <button type="button" className="jt-tile" onClick={() => closeWelcome(false)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg><span>Start a new list</span></button>
        </div>
      </dialog>
      {syncOpen && <JobTrackSync lang={lang} apps={apps} quota={quota} setApps={setApps} setQuota={setQuota} onClose={() => setSyncOpen(false)} />}

      {modal && (
        <div className={'modal' + (editing ? '' : ' fill-top')} onClick={() => setModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{editing ? t('modal.editTitle') : t('modal.addTitle')}</h3>
            {!editing && fillPills(fillMode)}
            {/* 2026-11-03 owner: four pills at the top pick the way to add; only that way is shown */}
            {!editing && fillMode === 'bookmark' && <JobSaveBookmark t={t} bare onClose={() => setModal(false)} />}
            {/* 2026-10-13 owner: "trouble entering data" - paste the ad, the fields fill themselves */}
            {!editing && fillMode === 'paste' && (
              <div className="ad-paste">
                {/* 2026-10-13 owner: "that critical user step is needed, Ctrl+A and Ctrl+C" */}
                <p className="ad-step">{t(/iPhone|iPad|Android/i.test(navigator.userAgent) ? 'ad.step.phone' : 'ad.step.computer')}</p>
                <textarea rows={3} placeholder={t('ad.paste')} value={adText} onChange={e => { setAdText(e.target.value); setAdFilled(false); if (e.target.value.trim().length > 40) applyAd(e.target.value) }} />
                <button type="button" className="btn" disabled={!adText.trim()} onClick={() => applyAd(adText)}>{t('ad.fill')}</button>
                {adFilled && <p className="ad-done">{t('ad.check')}</p>}
                {/* 2026-10-13 owner: "all of it needs more automation" - save the entry,
                    then kworld's cover-letter writer opens with this ad and writes the
                    letter; it records the letter on this same entry (no duplicate). */}
                {adFilled && !isApp() && (
                  <button type="button" className="btn btn-glow" disabled={!form.company || !form.role} onClick={() => {
                    const id = Date.now()
                    const next = [...apps, { ...form, id }]
                    try {
                      localStorage.setItem(STORAGE, JSON.stringify(next))
                      sessionStorage.setItem('kworld_jobtrack_handoff', JSON.stringify({ id, ad: adText, company: form.company, role: form.role, contact: form.contactPerson || form.contact || '', address: [[form.street, form.streetNo].filter(Boolean).join(' '), [form.postal, form.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || form.address || '', email: form.email ?? '' }))
                    } catch { /* storage blocked - the letter page still opens empty */ }
                    ;(window as unknown as { kworldLeaving?: boolean }).kworldLeaving = true
                    window.location.href = '/cl-gen'
                  }}>{t('ad.letter')}</button>
                )}
              </div>
            )}
            {(editing || fillMode === 'type' || (fillMode === 'paste' && adFilled)) && (<>
            {(adFilled || editing) && (() => {
              const need = ([['company', form.company, 'field.company'], ['role', form.role, 'field.role'], ['postal', form.postal, 'orp.postal'], ['city', form.city, 'orp.city']] as const).filter(([, v]) => !(v ?? '').toString().trim()).map(([, , k]) => t(k))
              const nice = ([['street', form.street, 'orp.street'], ['email', form.email, 'orp.email'], ['phone', form.phone, 'orp.phone']] as const).filter(([, v]) => !(v ?? '').toString().trim()).map(([, , k]) => t(k))
              if (!need.length && !nice.length) return <p className="ad-done">{t('ad.allSet')}</p>
              return <ul className="orp-before-tip jr-assure">
                {need.length > 0 && <li><b>{t('ad.need')}</b> {need.join(', ')}</li>}
                {nice.length > 0 && <li>{t('ad.nice')} {nice.join(', ')}</li>}
              </ul>
            })()}
            <input type="text" placeholder={t('field.company')} value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} required />
            <input type="text" placeholder={t('field.role')} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} required />
            <label className="modal-label">{t('field.dateApplied')}</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUS_MENU.map(s => <option key={s} value={s} title={s === 'technical' ? t('status.technical.hint') : undefined}>{STATUS_PLAIN[s]}</option>)}
            </select>
            <input type="text" placeholder={t('field.cv')} value={form.cv} onChange={e => setForm(f => ({ ...f, cv: e.target.value }))} />
            <input type="text" placeholder={t('field.cover')} value={form.cover} onChange={e => setForm(f => ({ ...f, cover: e.target.value }))} />
            <label className="modal-label">{t('field.nextDate')}</label>
            <input type="date" value={form.nextDate} onChange={e => setForm(f => ({ ...f, nextDate: e.target.value }))} />
            {/* 2026-09-25: user couldn't find Notes - an unlabelled box at the bottom. */}
            <label className="modal-label">{t('field.notes').replace(/\.+$/, '')}</label>
            <textarea rows={2} placeholder={t('field.notes')} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            {/* 2026-10-13 owner: the ORP form 716.007 fields - folded, defaults already set */}
            <button type="button" className="orp-fold" onClick={() => setOrpOpen(o => !o)} aria-expanded={orpOpen}>
              {orpOpen ? '▾' : '▸'} {t('orp.details')}
            </button>
            {orpOpen && (
              <div className="orp-fields">
                {/* 2026-10-14 owner: Job-Room's own fields - the more filled in, the less push back */}
                <div className="orp-row2">
                  <input type="text" placeholder={t('orp.street')} value={form.street ?? ''} onChange={e => setForm(f => ({ ...f, street: e.target.value }))} />
                  <input type="text" className="orp-short" placeholder={t('orp.no')} value={form.streetNo ?? ''} onChange={e => setForm(f => ({ ...f, streetNo: e.target.value }))} />
                </div>
                <div className="orp-row2">
                  <input type="text" className="orp-short" inputMode="numeric" placeholder={t('orp.postal')} value={form.postal ?? ''} onChange={e => setForm(f => ({ ...f, postal: e.target.value }))} />
                  <input type="text" placeholder={t('orp.city')} value={form.city ?? ''} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                </div>
                <input type="text" placeholder={t('orp.contactPerson')} value={form.contactPerson ?? ''} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} />
                <input type="email" placeholder={t('orp.email')} value={form.email ?? ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                <input type="tel" placeholder={t('orp.phone')} value={form.phone ?? ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                <input type="url" placeholder={t('orp.link')} value={form.link ?? ''} onChange={e => setForm(f => ({ ...f, link: e.target.value }))} />
                <label className="modal-label">{t('orp.method')}</label>
                <select value={form.method ?? 'electronic'} onChange={e => setForm(f => ({ ...f, method: e.target.value as OrpMethod }))}>
                  <option value="electronic">{t('orp.method.electronic')}</option>
                  <option value="letter">{t('orp.method.letter')}</option>
                  <option value="visit">{t('orp.method.visit')}</option>
                  <option value="phone">{t('orp.method.phone')}</option>
                </select>
                <label className="modal-label">{t('orp.rate')}</label>
                <input type="number" min={10} max={100} step={10} value={form.rate ?? 100} onChange={e => setForm(f => ({ ...f, rate: Number(e.target.value) || 100 }))} />
                <label className="orp-check"><input type="checkbox" checked={!!form.assigned} onChange={e => setForm(f => ({ ...f, assigned: e.target.checked }))} /> {t('orp.assigned')}</label>
                {form.status === 'rejected' && <input type="text" placeholder={t('orp.motif')} value={form.motif ?? ''} onChange={e => setForm(f => ({ ...f, motif: e.target.value }))} />}
              </div>
            )}
            </>)}
            {(editing || fillMode !== 'bookmark') && <div className="modal-buttons">
              <button className="btn-secondary" onClick={() => setModal(false)}>{t('cancel')}</button>
              {(editing || fillMode === 'type' || (fillMode === 'paste' && adFilled)) && <button className="btn" onClick={save}>{t('save')}</button>}
            </div>}

          </div>
        </div>
      )}

      {bulkModal && (
        <div className="modal fill-top" onClick={() => setBulkModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="bulk-heading"><HeaderIcon col="add" />{t('bulk.title')}</h3>
            {fillPills('multiple')}
            <ul className="bulk-points bulk-instructions">
              <li><HeaderIcon col="list" /><span>{t('bulk.instructions')}<br /><strong>{t('bulk.format')}</strong></span></li>
            </ul>
            <textarea rows={8} placeholder={t('bulk.placeholder')} value={bulkText} onChange={e => setBulkText(e.target.value)} className="bulk-textarea" />
            {bulkPreview.length > 0 && <section className="bulk-preview" aria-label={t('bulk.preview')}>
              <h4>{t('bulk.preview')} ({bulkPreview.length})</h4>
              <div className="bulk-preview-scroll"><table>
                <thead><tr><th scope="col">{t('table.company')}</th><th scope="col">{t('table.role')}</th></tr></thead>
                <tbody>{bulkPreview.map((entry, i) => <tr key={i}><td>{entry.company || '-'}</td><td>{entry.role || <span className="bulk-preview-missing">{t('bulk.missingRole')}</span>}</td></tr>)}</tbody>
              </table></div>
            </section>}
            <ul className="bulk-points bulk-date-note">
              <li><HeaderIcon col="date" /><span>{t('bulk.dateNote')}</span></li>
              <li><HeaderIcon col="edit" /><span>{t('bulk.dateEdit')}</span></li>
            </ul>
            <div className="modal-buttons">
              <button className="btn-secondary" onClick={() => setBulkModal(false)}>{t('cancel')}</button>
              <button className="btn" onClick={bulkAdd} disabled={bulkPreview.length === 0}>{t('bulk.addCount')} ({bulkPreview.length})</button>
            </div>
          </div>
        </div>
      )}

      {emailModal && (
        <div className="modal email-modal" onClick={() => setEmailModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{t('email.button')}</h3>
            <p className="bulk-instructions"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: '.35rem' }}><path d="M6 8V4a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-4M6 5l8.5 5L23 5" /><rect x="1" y="8" width="17" height="13" rx="1" /><path d="m1 10 8.5 5 8.5-5" /></svg>Matched against your existing applications.<br />Nothing is sent anywhere, it all happens in your browser.<ShieldLink topic="privacy" point="jobtrack-email" iconOnly /></p>
            {emailMatch && <div className="email-results" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', position: 'sticky', top: '-1.5rem', zIndex: 1, background: '#0f0d1a', padding: '.75rem 0' }}>
              <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', color: 'var(--nebula-teal, #00ff41)' }}><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="m7 12 3 3 7-7" /></svg>Matched</span>
              <button className="btn email-update-action" onClick={applyEmailUpdate} disabled={!emailCompany.trim()}>Update status</button>
            </div>}
            <label className="modal-label">Email body text</label>
            <textarea rows={8} placeholder="Paste the email text here…" value={emailText} onChange={e => checkEmailMatch(e.target.value, emailSender)} className="bulk-textarea" />
            {emailAmbiguous && !emailMatch && <div className="email-results">
              <p role="alert">Which position is this reply about? Tap the matching job:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                {emailCandidates.map(a => <button type="button" className="btn-secondary" key={a.id} onClick={() => pickEmailApplication(a)}>{a.company} - {a.role || 'Position not recorded'} ({a.date})</button>)}
              </div>
            </div>}
            {((emailText.trim() && !emailMatch) || emailSender.trim() || emailSubject.trim()) && <div className="email-results">
              <p>Unsure?</p>
              <input type="text" aria-label="Email subject" placeholder="Paste the email subject here" value={emailSubject} onChange={e => checkEmailMatch(emailText, emailSender, e.target.value)} />
              {((emailSubject.trim() && !emailMatch) || emailSender.trim()) && <>
                {!emailMatch && <p role="status">Still unsure? Paste email from.</p>}
                <label className="modal-label">Sender's email address (optional)</label>
                <input type="text" inputMode="email" placeholder="e.g. job@charmey.ch" value={emailSender} onChange={e => checkEmailMatch(emailText, e.target.value)} />
              </>}
            </div>}
            {(emailText.trim() || emailSender.trim() || emailSubject.trim()) && (
              <div className="email-results" style={{ marginTop: '.75rem' }}>
                <label className="modal-label">Company {!emailMatch && !emailAmbiguous && emailCompany && <span style={{ fontWeight: 400 }}>(not in your list yet - check the spelling matches, or this'll be added as new)</span>}</label>
                <input type="text" placeholder="Company name" value={emailCompany} onChange={e => recheckCompany(e.target.value)} />
                {!emailCompany.trim() && <p style={{ fontSize: '.75rem', color: 'var(--text-dim, #a0a0b0)' }}>Couldn't guess the company from this email - type it in above.</p>}
                {/* 2026-09-25: real gap, live - a BOBST rejection wasn't matched
                    and the only buttons were Cancel / Add as new. Now any
                    existing application can be picked by hand, which turns
                    the button into Update status. */}
                {apps.length > 0 && (!emailAmbiguous || emailMatch) && (
                  <>
                    <label className="modal-label">{emailMatch ? 'Wrong one? Pick the application' : 'Or pick the existing application'}</label>
                    <select value={emailMatch ? String(emailMatch.id) : ''} onChange={e => {
                      const picked = apps.find(a => String(a.id) === e.target.value) || null
                      if (picked) pickEmailApplication(picked)
                      else setEmailMatch(null)
                    }}>
                      <option value="">{emailAmbiguous ? 'Choose the application' : emailMatch ? '-' : 'Not in my list - add as new'}</option>
                      {[...apps].sort((a, b) => a.company.localeCompare(b.company)).map(a => (
                        <option key={a.id} value={String(a.id)}>{a.company}{a.role ? ` - ${a.role}` : ''} ({a.date})</option>
                      ))}
                    </select>
                  </>
                )}
                {emailCompany.trim() ? (
                  <>
                    <label className="modal-label">Role</label>
                    <input type="text" placeholder="Role" value={emailRole} onChange={e => setEmailRole(e.target.value)} />
                    <input type="text" placeholder={t('field.cv')} value={emailCv} onChange={e => setEmailCv(e.target.value)} />
                    <input type="text" placeholder={t('field.cover')} value={emailCover} onChange={e => setEmailCover(e.target.value)} />
                  </>
                ) : null}
                <label className="modal-label">Status</label>
                <select value={emailStatus} onChange={e => setEmailStatus(e.target.value)}>
                  {STATUS_MENU.map(s => <option key={s} value={s}>{STATUS_PLAIN[s]}</option>)}
                </select>
              </div>
            )}
            <div className="modal-buttons">
              {(!emailMatch && emailText.trim() && emailCandidates.length === 0 && emailCompany.trim()) && <button className="btn" onClick={applyEmailUpdate}>Add as new application</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
