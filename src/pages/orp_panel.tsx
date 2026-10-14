import { useMemo, useRef, useState } from 'react'
import { type Application, inRange, monthRange, swissDate } from '../lib/orp'
import { buildOrpPdf, type OrpProfile } from '../lib/orp_pdf'
import JobRoomHelper from './job_room_helper'
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
      return `${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`
    }
    return label
  }, [mode, profile.registered, label])

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
        {/* 2026-10-14 owner: "way too much text for timid job searchers - minimal on welcome,
            the rest appears when needed". One question first, then only what that answer needs. */}
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

        {(mode === 'month' || profile.registered) && <p className="orp-count"><b>{rows.length}</b> {t('orp.searches')} · {swissDate(from)} - {swissDate(to)}</p>}
        {shortWeeks.length > 0 && (mode === 'month' || profile.registered) && (
          <details className="orp-weeks">
            <summary>{t('orp.weeksShort').replace('{n}', String(shortWeeks.length))}</summary>
            <p>{t('orp.shortWeeks')}</p>
            <ul>{shortWeeks.map(([wk, n]) => <li key={wk}>{t('orp.weekOf')} {swissDate(wk)}: {n} {n === 1 ? t('orp.search1') : t('orp.searchN')}</li>)}</ul>
          </details>
        )}

        {/* 2026-10-14 owner: one card at a time, exactly like Job-Room's ENTER form */}
        {(mode === 'month' || profile.registered) && <JobRoomHelper rows={rows} monthLabel={jobRoomMonth} onUpdate={onUpdate} t={t} />}
        <details className="orp-paper">
          <summary>{t('orp.paper')}</summary>
          <p className="orp-hint">{t('orp.needProfile')}</p>
          <input type="text" placeholder={t('orp.name')} value={profile.name} onChange={e => update({ name: e.target.value })} />
          <input type="text" placeholder={t('orp.avs')} value={profile.avs} onChange={e => update({ avs: e.target.value })} />
          <button className="btn-secondary" disabled={busy || !profile.name || !profile.avs || rows.length === 0} onClick={makePdf}>{busy ? '…' : t('orp.pdf')}</button>
        </details>
        <div className="modal-buttons"><button className="btn-secondary" onClick={onClose}>{t('close')}</button></div>
      </div>
    </div>
  )
}
