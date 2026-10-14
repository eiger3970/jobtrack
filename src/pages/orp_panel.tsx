import { useEffect, useMemo, useRef, useState } from 'react'
import { type Application, inRange, monthRange, swissDate } from '../lib/orp'
import { buildOrpPdf, type OrpProfile } from '../lib/orp_pdf'
import JobRoomHelper from './job_room_helper'
import { bookmarklet } from '../lib/jobroom_fill'
import { saveFile, stamp } from '../lib/save_file'

// 2026-10-13 owner: ORP paperwork in one place - the filled 716.007 PDF for
// any month or "avant chômage", and a Job-Room view with a Copy button per
// field, in Job-Room's order, so nothing is re-typed.

const PROFILE_KEY = 'kworld_jobtrack_orp_profile'
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
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState(false)
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
        <h3>{t('orp.title')}</h3>
        {/* 2026-10-14 owner: "too confusing where to start" - three steps: the question, the
            one-time set-up, then only the squares and the card. Numbers go into Details. */}
        {step === 'ask' && (<>
          <p className="orp-stepno">{t('orp.step1of3')}</p>
          <p className="orp-q">{t('orp.which')}</p>
          <div className="orp-tabs">
            <button className={mode === 'month' ? 'btn' : 'btn-secondary'} onClick={() => setMode('month')}>{t('orp.month')}</button>
            <button className={mode === 'before' ? 'btn' : 'btn-secondary'} onClick={() => setMode('before')}>{t('orp.before')}</button>
          </div>
        {mode === 'month' && <input type="month" value={month} onChange={e => setMonth(e.target.value)} />}
        {mode === 'before' && (<>
          <label className="modal-label orp-label-info">{t('orp.registered')}
            <button type="button" className="info-btn info-btn-amber" aria-label={t('orp.info.title')} onClick={() => setInfo(v => !v)}>i</button>
          </label>
          {info && <p className="orp-before-tip">{t('orp.beforeTip')}</p>}
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
            onClick={() => setStep('setup')}>{t('orp.next')}</button>
        </>)}

        {step === 'setup' && (
          <div className="orp-setup-big">
            <p className="orp-stepno">{t('orp.step2of3')}</p>
            <p className="orp-setup-h">{t('jr.bm.big')}</p>
            {/* picture: the green button dragged up into the browser's bookmarks bar */}
            <svg viewBox="0 0 320 120" className="orp-setup-pic" aria-hidden="true">
              <rect x="6" y="6" width="308" height="108" rx="8" fill="#0f0d1c" stroke="#2a2a3a" />
              <rect x="6" y="6" width="308" height="22" rx="8" fill="#1a1a2a" />
              <text x="16" y="21" fontSize="10" fill="#8a86a8">{t('jr.bm.bar')}</text>
              <rect x="150" y="10" width="78" height="14" rx="4" fill="none" stroke="#00ff41" strokeDasharray="3 2" />
              <text x="189" y="21" fontSize="9" textAnchor="middle" fill="#00ff41">JobTrack fill</text>
              <rect x="40" y="76" width="96" height="26" rx="6" fill="#00ff41" />
              <text x="88" y="93" fontSize="11" textAnchor="middle" fill="#03020a" fontWeight="700">JobTrack fill</text>
              <path d="M112 74 C 140 40, 160 38, 182 30" fill="none" stroke="#f0eeff" strokeWidth="2" strokeDasharray="5 4" />
              <path d="M176 26 L184 29 L178 35" fill="none" stroke="#f0eeff" strokeWidth="2" />
              <path d="M120 88 l0 14 l4 -4 l3 6 l3 -1 l-3 -6 l5 0 z" fill="#f0eeff" stroke="#03020a" strokeWidth="0.8" />
            </svg>
            <p className="orp-setup-how">{t('jr.bm.how')}</p>
            <a ref={bm} className="jr-bm-link orp-setup-btn" onClick={ev => { ev.preventDefault(); alert(t('jr.bm.notHere')) }} title={t('jr.bm.drag')}>JobTrack fill</a>
            <button type="button" className="btn btn-glow orp-next" onClick={() => setStep('work')}>{t('jr.bm.done2')}</button>
          </div>
        )}

        {step === 'work' && (<>
          <p className="orp-stepno">{t('orp.step3of3')}</p>
          <p className="orp-choice">{mode === 'before' ? `${t('orp.before')} - ${swissDate(profile.registered)}` : jobRoomMonth}
            {' '}<button type="button" className="jr-bm-again" onClick={() => setStep('ask')}>{t('orp.change')}</button>
            {' · '}<button type="button" className="jr-bm-again" onClick={() => setStep('setup')}>{t('jr.bm.title')}</button></p>
          <JobRoomHelper rows={rows} monthLabel={jobRoomMonth} onUpdate={onUpdate} t={t} onSetup={() => setStep('setup')} />
          <details className="orp-details">
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
          </details>
        </>)}
        <div className="modal-buttons"><button className="btn-secondary" onClick={onClose}>{t('close')}</button></div>
      </div>
    </div>
  )
}
