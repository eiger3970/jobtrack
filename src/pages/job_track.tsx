import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useLanguage } from '../context/language'
import jobTrackI18n from './job_track_i18n.json'
import './job_track.css'
import JobTrackPro from './job_track_pro'
import { type Application, type OrpMethod, ORP_DEFAULTS } from '../lib/orp'
import OrpPanel from './orp_panel'
import JobTrackSync from './job_track_sync'
import BackupBar from './job_track_backup'
import { linkFromHash, merge } from '../lib/jobtrack_sync'
import { parseAd } from '../lib/ad_parse'
import { planReminders } from '../lib/reminders'
import { saveFile, stamp } from '../lib/save_file'
import { isApp } from '../lib/platform'
import jobTrackIcon from '../assets/jobtrack_icon.svg'

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
const STORAGE = 'kworld_jobtrack'

function loadApps(): App[] {
  // DEV preview of the not-backed-up bar
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.location.hash === '#preview=backup') return [{ id: 1, company: 'Bergbahnen Rinerhorn AG', role: 'Ski lift operator', date: '2026-09-12', status: 'applied', cv: '', cover: '', nextDate: '', notes: 'Staff housing offered\nStart By agreement Permanent' }, { id: 2, company: 'Example Semiconductor GmbH', role: 'Shift Equipment Maintenance Engineer - Etching 80 - 100% (f/m/d) - R0129808', date: '2026-10-14', status: 'applied', cv: '', cover: '', nextDate: '', notes: '' }]
  try { return JSON.parse(localStorage.getItem(STORAGE) || '[]') } catch { return [] }
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
const MIN_LABEL = { en: { min: 'Minimal', full: 'Full view' }, de: { min: 'Minimal', full: 'Volle Ansicht' }, fr: { min: 'Minimal', full: 'Vue complète' } }

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

function HeaderIcon({ col }: { col: 'company' | 'role' | 'date' | 'status' | 'cv' | 'cover' | 'next' | 'actions' }) {
  const paths: Record<string, ReactNode> = {
    company: <><rect x="4" y="3" width="16" height="18" rx="1" /><rect x="10" y="14" width="4" height="7" /></>,
    role: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>,
    date: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
    status: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></>,
    cv: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    cover: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
    next: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
    actions: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[col]}</svg>
}

// Tap-to-reveal, not hover/title - a native title attribute never shows on
// phone at all, so anything that needs explaining on mobile has to use this.
function InfoTip({ text, label, icon }: { text: string; label: string; icon: ReactNode }) {
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
  const { lang } = useLanguage()
  const t = (key: string) => getString(key, lang)
  const STATUS_PLAIN: Record<string, string> = {
    applied: t('status.plain.applied'), screening: t('status.plain.screening'), interview: t('status.plain.interview'),
    technical: t('status.plain.technical'), offer: t('status.plain.offer'), accepted: t('status.plain.accepted'), rejected: t('status.plain.rejected'),
  }
  const [apps, setApps] = useState<App[]>(loadApps)
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<App | null>(null)
  const [form, setForm] = useState<Omit<App, 'id'>>({ company:'', role:'', date: new Date().toISOString().slice(0,10), status:'applied', cv:'', cover:'', nextDate:'', notes:'' })
  const [orpOpen, setOrpOpen] = useState(false)
  const [adText, setAdText] = useState('')
  const [adFilled, setAdFilled] = useState(false)
  const [orpPanel, setOrpPanel] = useState(false)
  const [minimal, setMinimal] = useState(() => readStored(MIN_STORAGE) === '1' || (import.meta.env.DEV && typeof window !== 'undefined' && window.location.search.includes('min')))
  useEffect(() => { try { localStorage.setItem(MIN_STORAGE, minimal ? '1' : '0') } catch { /* private mode */ } }, [minimal])
  // 2026-10-14: phone + computer sync - the phone arrives from the QR with #sync=
  // prerender has no navigator - counts as a computer there
  const phoneDevice = isApp() || (typeof navigator !== 'undefined' && /iPhone|iPod|Android/i.test(navigator.userAgent))
  const [syncOpen, setSyncOpen] = useState(() => linkFromHash() !== null || (import.meta.env.DEV && window.location.hash === '#preview=sync'))
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
  // 2026-09-12: real feedback, live - a confirmation email arrives a few
  // minutes after applying and the only way to reflect that here was to
  // hunt down the right row and click through the status dropdown. This
  // stays 100% local (no inbox access, ever) - paste the email text in,
  // it fuzzy-matches the company name against existing rows and offers
  // one tap to apply a status change.
  const [emailModal, setEmailModal] = useState(false)
  const [emailText, setEmailText] = useState('')
  const [emailSender, setEmailSender] = useState('')
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
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    const newApps: App[] = lines.map((line, i) => {
      const sepIndex = line.indexOf(' - ')
      const company = sepIndex === -1 ? line : line.slice(0, sepIndex).trim()
      const role = sepIndex === -1 ? '' : line.slice(sepIndex + 3).trim()
      return { id: Date.now() + i, company, role, date: today, status: 'applied', cv: '', cover: '', nextDate: '', notes: '' }
    })
    setApps(prev => [...prev, ...newApps])
    setBulkText('')
    setBulkModal(false)
  }

  useEffect(() => { localStorage.setItem(STORAGE, JSON.stringify(apps)) }, [apps])
  // 2026-10-13: ORP reminders (1st, 4th, short weeks) re-planned with the real counts
  useEffect(() => { void planReminders(apps).catch(() => {}) }, [apps])

  const [backupSnapshot, setBackupSnapshot] = useState<string | null>(() => readStored(BACKUP_SNAPSHOT_STORAGE))
  const [backupAt, setBackupAt] = useState<string | null>(() => readStored(BACKUP_AT_STORAGE))
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

  // 2026-09-25: user - "can the Company column be sorted by a-z to find?"
  // Company and Date headers sort the list; tap again to reverse.
  const [sortBy, setSortBy] = useState<{ col: 'date' | 'company'; asc: boolean }>({ col: 'date', asc: false })
  const filtered = (filter === 'all' ? apps : apps.filter(a => a.status === filter)).slice().sort((a, b) => {
    const d = sortBy.col === 'company' ? a.company.localeCompare(b.company, undefined, { sensitivity: 'base' }) : a.date.localeCompare(b.date) || a.id - b.id
    return sortBy.asc ? d : -d
  })
  function sortOn(col: 'date' | 'company') {
    setSortBy(s => s.col === col ? { col, asc: !s.asc } : { col, asc: col === 'company' })
  }
  const sortMark = (col: 'date' | 'company') => sortBy.col === col ? (sortBy.asc ? ' ▲' : ' ▼') : ''

  function openAdd() { setEditing(null); setOrpOpen(false); setAdText(''); setAdFilled(false); setForm({ company:'',role:'',date:new Date().toISOString().slice(0,10),status:'applied',cv:'',cover:'',nextDate:'',notes:'', ...ORP_DEFAULTS }); setModal(true) }
  function openEdit(a: App) { const { id: _id, ...rest } = a; setEditing(a); setOrpOpen(false); setForm({ ...ORP_DEFAULTS, ...rest }); setModal(true) }
  function save() {
    if (!form.company || !form.role) return
    if (editing) { setApps(apps.map(a => a.id === editing.id ? { ...form, id: a.id } : a)) }
    else { setApps([...apps, { ...form, id: Date.now() }]) }
    setModal(false)
  }
  function del(id: number) { if (confirm(t('confirm.delete'))) setApps(apps.filter(a => a.id !== id)) }

  // 2026-09-23: real feedback, live - "Update from email needs to pull
  // data from email, rather than me re-typing all the fields... e.g.
  // Jungfraubahnen Management AG emailed confirmation from
  // gerhard.moser@jungfrau.ch." Was an exact match on one regex-guessed
  // company name, so it almost never matched. Now scores every existing
  // application against the whole pasted text: the full company name,
  // each distinctive word of it, the sender's email domain
  // (jungfrau.ch -> "jungfrau" -> Jungfraubahnen), and the role title.
  // Highest score wins; ties go to the most recently applied.
  function findEmailMatch(text: string): App | null {
    const hay = normalizeName(text)
    const domains = senderDomains(text)
    let best: App | null = null
    let bestScore = 0
    for (const a of apps) {
      const name = normalizeName(a.company)
      if (!name) continue
      let score = 0
      if (hay.includes(name)) score += 3
      const words = name.split(' ').filter(w => w.length >= 4 && !COMPANY_STOPWORDS.has(w))
      for (const w of words) if (hay.includes(w)) score += 1
      for (const d of domains) if (words.some(w => w.startsWith(d) || d.startsWith(w))) score += 2
      const role = normalizeName(a.role)
      if (role.length >= 4 && hay.includes(role)) score += 2
      if (score > bestScore || (score === bestScore && score > 0 && best && a.date > best.date)) { best = a; bestScore = score }
    }
    return bestScore > 0 ? best : null
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
  // A rejection is the one outcome the wording states outright - pre-pick
  // it (still just a suggestion in the dropdown). Anything else keeps the
  // status on file, see checkEmailMatch.
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
  function statusFromEmail(text: string, current: string | null): string {
    if (looksLikeRejection(text)) return current === 'accepted' ? current : 'rejected'
    const found = looksLikeFormalInterview(text) ? 'interview' : looksLikeScreening(text) ? 'screening' : null
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
    setEmailMatch(null)
    setEmailCompany('')
    setEmailRole('')
    setEmailCv('')
    setEmailCover('')
    setEmailModal(true)
  }
  // Never guess a status jump from the email text alone - an ATS's own
  // auto-acknowledgement of receipt ("thank you for applying") is not
  // the same as an actual recruiter step. Matched apps keep whatever
  // status they already had; a brand-new entry starts at "applied" -
  // the person tells us if something has genuinely progressed.
  // Body and sender are pasted separately - copying an email only grabs
  // the body; the sender's address is a second copy from the header.
  function checkEmailMatch(body: string, sender: string) {
    setEmailText(body)
    setEmailSender(sender)
    const text = sender + '\n' + body
    if (!body.trim() && !sender.trim()) { setEmailMatch(null); return }
    const match = findEmailMatch(text)
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
    }
    setEmailMatch(match)
    setEmailStatus(statusFromEmail(text, match ? match.status : null))
  }
  function recheckCompany(company: string) {
    setEmailCompany(company)
    // An application already matched or picked stays the one being
    // updated - typing here corrects its name (user: corrections were lost).
    if (emailMatch) return
    const match = findEmailMatch(company)
    setEmailMatch(match)
    setEmailStatus(match ? match.status : 'applied')
  }
  function applyEmailUpdate() {
    const today = new Date().toISOString().slice(0, 10)
    const text = emailSender + '\n' + emailText
    const finalStatus = emailMatch && (emailMatch.status === 'rejected' || emailMatch.status === 'accepted')
    const ackNote = looksLikeAcknowledgement(text) && !looksLikeRejection(text) && !finalStatus ? `Received - reviewing (${today})` : ''
    const withNote = (notes: string) => !ackNote || notes.includes(ackNote) ? notes : (notes ? `${notes}\n${ackNote}` : ackNote)
    if (emailMatch) {
      const company = emailCompany.trim() || emailMatch.company
      const role = emailRole.trim() || emailMatch.role
      setApps(prev => prev.map(a => a.id === emailMatch.id ? { ...a, status: emailStatus, company, role, cv: emailCv.trim() || a.cv, cover: emailCover.trim() || a.cover, notes: withNote(a.notes) } : a))
    } else if (emailCompany.trim()) {
      setApps(prev => [...prev, { id: Date.now(), company: emailCompany.trim(), role: emailRole.trim(), date: today, status: emailStatus, cv: emailCv.trim(), cover: emailCover.trim(), nextDate: '', notes: withNote('') }])
    } else {
      return
    }
    setEmailModal(false)
  }
  // Changing status is the single most common edit on this whole page -
  // it shouldn't need the full modal (pencil -> dropdown -> Save).
  function updateStatus(id: number, status: string) { setApps(prev => prev.map(a => a.id === id ? { ...a, status } : a)) }

  const counts: Record<string, number> = {}
  apps.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1 })

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function exportPDF() {
    const rows = apps.map(a => `
      <tr>
        <td>${escapeHtml(a.company)}</td>
        <td>${escapeHtml(a.role)}</td>
        <td>${escapeHtml(a.date)}</td>
        <td>${escapeHtml(STATUS_PLAIN[a.status] || a.status)}</td>
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
        th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 0.8rem; vertical-align: top; }
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
        <thead><tr><th>${escapeHtml(t('table.company'))}</th><th>${escapeHtml(t('table.role'))}</th><th>${escapeHtml(t('table.date'))}</th><th>${escapeHtml(t('table.status'))}</th><th>${escapeHtml(t('table.next'))}</th><th>${escapeHtml(t('table.notes'))}</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">${escapeHtml(t('table.empty'))}</td></tr>`}</tbody>
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
    const lines = apps.map(a => {
      let line = `- ${a.date} — ${a.company} — ${a.role} (${STATUS_PLAIN[a.status] || a.status})`
      if (a.nextDate) line += ` — ${t('copyList.next')}: ${a.nextDate}`
      return line
    })
    navigator.clipboard?.writeText(lines.join('\n')).then(() => {
      setCopiedList(true)
      setTimeout(() => setCopiedList(false), 2000)
    })
  }

  function exportBackup() {
    const backup = { apps, quota }
    const d = new Date()
    // app: iOS share sheet (Files, Mail, AirDrop); browser: download
    void saveFile(`${stamp(d)}_jobtrack_backup.json`, JSON.stringify(backup, null, 2), 'application/json')
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
        setApps(prev => merge(prev, {}, importedApps, {}).apps)
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
          <button type="button" className="jt-min-toggle" aria-pressed={minimal} onClick={() => setMinimal(m => !m)} title={minimal ? MIN_LABEL[lang].full : MIN_LABEL[lang].min}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d={minimal ? 'M3 5v14h18V5H3zm16 6H5V7h14v4zM5 17v-4h14v4H5z' : 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z'} /></svg>
            <span>{minimal ? MIN_LABEL[lang].full : MIN_LABEL[lang].min}</span>
          </button>
        </h1>

        {/* 2026-10-13 owner: "top header has 1. - 4., they could be the actual link
            buttons" - the steps ARE the buttons now; their copies below are gone. */}
        <div className="howto-strip">
          <div className="howto-step">
            <button type="button" className="howto-go howto-go-main" onClick={openAdd}>
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
          <div className="howto-step">
            <button type="button" className="howto-go" onClick={isApp() ? () => setOrpPanel(true) : exportPDF}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="19" x2="12" y2="11" /><polyline points="9 14 12 11 15 14" /></svg>
              <span>{t('howto.export')}</span>
            </button>
          </div>
          <div className="howto-arrow">→</div>
          <div className="howto-step howto-step-info" ref={infoRef}>
            <button type="button" className="howto-go" onClick={exportBackup} disabled={apps.length === 0}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              <span>{t('howto.private')}</span>
            </button>
            <button type="button" className="info-btn" aria-label={t('howto.private')} onClick={() => setShowStorageInfo(v => !v)}>i</button>
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
                      <p className="info-popover-item-sub">{t('info.point4.instruction.lead')} <strong>{t('howto.private').replace(/^\d+\.\s*/, '')}</strong>{t('info.point4.instruction.trail')}</p>
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
          </div>
          {/* 2026-10-14 owner: Import next to Save backup - save and open are a pair */}
          <input type="file" accept="application/json" ref={backupInputRef} style={{ display: 'none' }} onChange={importBackup} />
          <div className="howto-step howto-step-info import-btn-wrap" ref={importInfoRef}>
            <button type="button" className="howto-go" onClick={() => backupInputRef.current?.click()} title={t('backup.hint')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              <span className="export-btn-label">{backupImported ? t('backup.imported') : t('backup.import')}</span>
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
          </div>
        </div>

        {/* 2026-10-14 owner: computers get the choices bar (phone recommended), visible without scrolling */}
        {!phoneDevice && <BackupBar lang={lang} apps={apps} snapshot={backupSnapshot} onSync={() => setSyncOpen(true)} onExport={exportBackup} />}
        <div className="stats">
          {quota && !editingQuota && (() => {
            const count = countInPeriod(apps, quota.period)
            const pct = Math.min(100, (count / quota.target) * 100)
            const met = count >= quota.target
            // Green-dominant on purpose - a quota tracker for a stressful job
            // hunt shouldn't greet you with red every time you open it.
            const color = met ? '#00ff41' : pct >= 50 ? '#00ff41' : pct >= 15 ? '#f59e0b' : '#ef4444'
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
        {apps.length > 0 && <div className="jt-verbose"><JobTrackPro apps={apps} lang={lang} /></div>}

        <div className="toolbar">
          <div className="toolbar-primary">
            {/* 2026-10-13 owner: ORP proofs (716.007 PDF + Job-Room) in one tap */}
            <button className="btn-secondary export-btn orp-btn" onClick={() => setOrpPanel(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M9 15l2 2 4-4" /></svg>
              <span className="export-btn-label">{t('orp.button')}</span>
            </button>
            <button className="btn-secondary export-btn" onClick={() => setBulkModal(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
              <span className="export-btn-label">{t('bulkAdd')}</span>
            </button>
          </div>
          <div className="toolbar-tools">
            <button className="btn-secondary export-btn" onClick={() => setSyncOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="14" height="10" rx="1" /><path d="M6 18h6M9 14v4" /><rect x="17" y="8" width="5" height="12" rx="1" /></svg>
              <span className="export-btn-label">{lang === 'de' ? 'Sync Telefon + Computer' : lang === 'fr' ? 'Sync téléphone + ordinateur' : 'Sync phone + computer'}</span>
            </button>
            <button className="btn-secondary export-btn" onClick={copyAsList} disabled={apps.length === 0} title={t('copyList')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              <span className="export-btn-label">{copiedList ? t('copyList.done') : t('copyList')}</span>
            </button>
          </div>
        </div>

        <div className="filter-bar">
          <button className={`filter-btn${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>{t('filter.all')}</button>
          {STATUSES.map(s => (
            <span key={s} className="filter-btn-wrap">
              <button className={`filter-btn${filter === s ? ' active' : ''}`} onClick={() => setFilter(s)}>
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
        {unbackedUp && phoneDevice && (
          <div className="backup-reminder" role="status">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" /></svg>
            <span>
              {t('backup.reminder')}{' '}
              {backupAt
                ? t('backup.reminder.last').replace('{days}', String(Math.floor((Date.now() - new Date(backupAt).getTime()) / 86400000)))
                : t('backup.reminder.never')}
            </span>
            <button className="btn btn-glow backup-reminder-btn" onClick={exportBackup}>{t('backup.export')}</button>
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table className="applications-table">
            <thead><tr>
              <th className="jt-sortable" onClick={() => sortOn('company')} title="Sort A-Z"><HeaderIcon col="company" />{t('table.company')}{sortMark('company')}</th>
              <th><HeaderIcon col="role" />{t('table.role')}</th>
              <th className="jt-sortable" onClick={() => sortOn('date')} title="Sort by date"><HeaderIcon col="date" />{t('table.date')}{sortMark('date')}</th>
              <th><HeaderIcon col="status" />{t('table.status')}</th>
              <th><HeaderIcon col="cv" />{t('table.cv')}</th>
              <th><HeaderIcon col="cover" />{t('table.cover')}</th>
              <th><HeaderIcon col="next" />{t('table.next')}<InfoTip text={t('table.next.hint')} label={t('table.next.hint')} icon={<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>} /></th>
              <th><HeaderIcon col="actions" />{t('table.actions')}<InfoTip text={t('table.actions.hint')} label={t('table.actions.hint')} icon={<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></>} /></th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: '#a0a0b0', padding: '2rem' }}>{t('table.empty')}</td></tr>}
              {filtered.map(a => (
                <tr key={a.id}>
                  {/* 2026-10-14 owner: Minimal = one line per cell (full text on hover), notes hidden */}
                  <td className="jt-cell-company" title={a.company}><span className="jt-one">{a.company}</span>{a.notes && <span className="jt-note">{a.notes.split('\n').filter(Boolean).pop()}</span>}</td>
                  <td className="jt-cell-role" title={a.role}><span className="jt-one">{a.role}</span></td>
                  <td className={isStale(a) ? 'jt-stale-date' : undefined} title={isStale(a) ? t('stale.hint') : undefined}>{a.date}{isStale(a) && <span className="jt-stale" title={t('stale.hint')}>{t('stale')}</span>}</td>
                  <td>
                    <label className={`status-badge status-select-wrap status-${a.status}`}>
                      <StatusIcon status={a.status} />
                      {STATUS_PLAIN[a.status] || a.status}
                      <select value={a.status} onChange={e => updateStatus(a.id, e.target.value)} className="status-select" aria-label={t('table.status')}>
                        {STATUSES.map(s => <option key={s} value={s}>{STATUS_PLAIN[s]}</option>)}
                      </select>
                    </label>
                  </td>
                  <td style={{ fontSize: '0.75rem', color: '#a0a0b0' }}>{a.cv || '-'}</td>
                  <td style={{ fontSize: '0.75rem', color: '#a0a0b0' }}>{a.cover || '-'}</td>
                  <td style={{ fontSize: '0.75rem', color: '#a0a0b0' }}>{a.nextDate || '-'}</td>
                  <td>
                    <button className="action-btn" title={t('action.edit')} aria-label={t('action.edit')} onClick={() => openEdit(a)}><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg></button>
                    <button className="action-btn" title={t('action.delete')} aria-label={t('action.delete')} onClick={() => del(a.id)}><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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

        <div className="ad-strip jt-verbose">
          <a href="/cv-gen/" className="ad-card">
            <span className="ad-label">{t('ad.label')}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            <p className="ad-title">{t('ad.cv.title')}</p>
            <p className="ad-desc">{t('ad.cv.desc')}</p>
            <span className="ad-cta">{t('ad.cv.cta')}</span>
          </a>
          <a href="/cl-gen" className="ad-card">
            <span className="ad-label">{t('ad.label')}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
            <p className="ad-title">{t('ad.cl.title')}</p>
            <p className="ad-desc">{t('ad.cl.desc')}</p>
            <span className="ad-cta">{t('ad.cl.cta')}</span>
          </a>
        </div>
      </div>

      {orpPanel && <OrpPanel apps={apps} t={t} onClose={() => setOrpPanel(false)} />}
      {syncOpen && <JobTrackSync lang={lang} apps={apps} quota={quota} setApps={setApps} setQuota={setQuota} onClose={() => setSyncOpen(false)} />}

      {modal && (
        <div className="modal" onClick={() => setModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{editing ? t('modal.editTitle') : t('modal.addTitle')}</h3>
            {/* 2026-10-13 owner: "trouble entering data" - paste the ad, the fields fill themselves */}
            {!editing && (
              <div className="ad-paste">
                {/* 2026-10-13 owner: "that critical user step is needed, Ctrl+A and Ctrl+C" */}
                <p className="ad-step">{t(/iPhone|iPad|Android/i.test(navigator.userAgent) ? 'ad.step.phone' : 'ad.step.computer')}</p>
                <textarea rows={3} placeholder={t('ad.paste')} value={adText} onChange={e => { setAdText(e.target.value); setAdFilled(false) }} />
                <button type="button" className="btn" disabled={!adText.trim()} onClick={() => {
                  const ad = parseAd(adText)
                  setForm(f => ({ ...f, role: ad.role || f.role, company: ad.company || f.company, address: ad.address || f.address,
                    contact: ad.contact || f.contact, rate: ad.rate ?? f.rate, notes: [f.notes, ad.notes].filter(Boolean).join(' · ') }))
                  setOrpOpen(true); setAdFilled(true)
                }}>{t('ad.fill')}</button>
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
                      sessionStorage.setItem('kworld_jobtrack_handoff', JSON.stringify({ id, ad: adText, company: form.company, role: form.role, contact: form.contact ?? '', address: form.address ?? '' }))
                    } catch { /* storage blocked - the letter page still opens empty */ }
                    ;(window as unknown as { kworldLeaving?: boolean }).kworldLeaving = true
                    window.location.href = '/cl-gen'
                  }}>{t('ad.letter')}</button>
                )}
              </div>
            )}
            <input type="text" placeholder={t('field.company')} value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} required />
            <input type="text" placeholder={t('field.role')} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} required />
            <label className="modal-label">{t('field.dateApplied')}</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUSES.map(s => <option key={s} value={s} title={s === 'technical' ? t('status.technical.hint') : undefined}>{STATUS_PLAIN[s]}</option>)}
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
                <input type="text" placeholder={t('orp.address')} value={form.address ?? ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
                <input type="text" placeholder={t('orp.contact')} value={form.contact ?? ''} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))} />
                <label className="modal-label">{t('orp.method')}</label>
                <select value={form.method ?? 'electronic'} onChange={e => setForm(f => ({ ...f, method: e.target.value as OrpMethod }))}>
                  <option value="electronic">{t('orp.method.electronic')}</option>
                  <option value="visit">{t('orp.method.visit')}</option>
                  <option value="phone">{t('orp.method.phone')}</option>
                </select>
                <label className="modal-label">{t('orp.rate')}</label>
                <input type="number" min={10} max={100} step={10} value={form.rate ?? 100} onChange={e => setForm(f => ({ ...f, rate: Number(e.target.value) || 100 }))} />
                <label className="orp-check"><input type="checkbox" checked={!!form.assigned} onChange={e => setForm(f => ({ ...f, assigned: e.target.checked }))} /> {t('orp.assigned')}</label>
                {form.status === 'rejected' && <input type="text" placeholder={t('orp.motif')} value={form.motif ?? ''} onChange={e => setForm(f => ({ ...f, motif: e.target.value }))} />}
              </div>
            )}
            <div className="modal-buttons">
              <button className="btn-secondary" onClick={() => setModal(false)}>{t('cancel')}</button>
              <button className="btn" onClick={save}>{t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {bulkModal && (
        <div className="modal" onClick={() => setBulkModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{t('bulk.title')}</h3>
            <p className="bulk-instructions">{t('bulk.instructions')}</p>
            <textarea rows={8} placeholder={t('bulk.placeholder')} value={bulkText} onChange={e => setBulkText(e.target.value)} className="bulk-textarea" />
            <p className="bulk-date-note">{t('bulk.dateNote')}</p>
            <div className="modal-buttons">
              <button className="btn-secondary" onClick={() => setBulkModal(false)}>{t('cancel')}</button>
              <button className="btn" onClick={bulkAdd} disabled={!bulkText.trim()}>{t('bulk.addCount')} ({bulkText.split('\n').filter(l => l.trim()).length})</button>
            </div>
          </div>
        </div>
      )}

      {emailModal && (
        <div className="modal" onClick={() => setEmailModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>{t('email.button')}</h3>
            <p className="bulk-instructions">Matched against your existing applications by company name, sender and role. Nothing is sent anywhere, it all happens in your browser.</p>
            <label className="modal-label">1. Email text</label>
            <textarea rows={8} placeholder="Paste the email text here…" value={emailText} onChange={e => checkEmailMatch(e.target.value, emailSender)} className="bulk-textarea" />
            <label className="modal-label">2. Sender's email address <span style={{ fontWeight: 400 }}>(optional - improves matching)</span></label>
            <input type="text" inputMode="email" placeholder="e.g. gerhard.moser@jungfrau.ch" value={emailSender} onChange={e => checkEmailMatch(emailText, e.target.value)} />
            <p style={{ fontSize: '.75rem', color: 'var(--text-dim, #a0a0b0)', marginTop: '-.25rem' }}>Copying an email only grabs the text - tap or click the sender's name at the top of the email to copy their address.</p>
            {(emailText.trim() || emailSender.trim()) && (
              <div style={{ marginTop: '.75rem' }}>
                <label className="modal-label">Company {!emailMatch && emailCompany && <span style={{ fontWeight: 400 }}>(not in your list yet - check the spelling matches, or this'll be added as new)</span>}</label>
                <input type="text" placeholder="Company name" value={emailCompany} onChange={e => recheckCompany(e.target.value)} />
                {!emailCompany.trim() && <p style={{ fontSize: '.75rem', color: 'var(--text-dim, #a0a0b0)' }}>Couldn't guess the company from this email - type it in above.</p>}
                {emailMatch ? (
                  <p style={{ fontSize: '.85rem', color: 'var(--nebula-teal, #00ff41)' }}>Matched existing application: {emailMatch.company}{emailMatch.role ? ` - ${emailMatch.role}` : ''} (applied {emailMatch.date})</p>
                ) : null}
                {/* 2026-09-25: real gap, live - a BOBST rejection wasn't matched
                    and the only buttons were Cancel / Add as new. Now any
                    existing application can be picked by hand, which turns
                    the button into Update status. */}
                {apps.length > 0 && (
                  <>
                    <label className="modal-label">{emailMatch ? 'Wrong one? Pick the application' : 'Or pick the existing application'}</label>
                    <select value={emailMatch ? String(emailMatch.id) : ''} onChange={e => {
                      const picked = apps.find(a => String(a.id) === e.target.value) || null
                      setEmailMatch(picked)
                      if (picked) { setEmailCompany(picked.company); setEmailStatus(statusFromEmail(emailSender + '\n' + emailText, picked.status)) }
                    }}>
                      <option value="">{emailMatch ? '-' : 'Not in my list - add as new'}</option>
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
                  {STATUSES.map(s => <option key={s} value={s}>{STATUS_PLAIN[s]}</option>)}
                </select>
              </div>
            )}
            <div className="modal-buttons">
              <button className="btn-secondary" onClick={() => setEmailModal(false)}>{t('cancel')}</button>
              <button className="btn" onClick={applyEmailUpdate} disabled={!emailCompany.trim()}>{emailMatch ? 'Update status' : 'Add as new application'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
