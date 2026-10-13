import { useMemo, useState } from 'react'
import { type Application, METHOD_FR, inRange, monthRange, orpResult, swissDate } from '../lib/orp'
import { buildOrpPdf, type OrpProfile } from '../lib/orp_pdf'
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

export default function OrpPanel({ apps, t, onClose }: { apps: Application[]; t: (k: string) => string; onClose: () => void }) {
  const [profile, setProfile] = useState<Saved>(loadProfile)
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [mode, setMode] = useState<'month' | 'before'>('month')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')

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

  async function copy(key: string, value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(key); setTimeout(() => setCopied(''), 1500) } catch { /* no clipboard */ }
  }

  const Field = ({ id, name, value }: { id: string; name: string; value: string }) => (
    <div className="orp-row">
      <span className="orp-row-name">{name}</span>
      <span className="orp-row-value">{value || '-'}</span>
      {value && <button className="orp-copy" onClick={() => copy(id, value)}>{copied === id ? t('orp.copied') : t('orp.copy')}</button>}
    </div>
  )

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content orp-panel" onClick={e => e.stopPropagation()}>
        <h3>{t('orp.title')}</h3>
        <label className="modal-label">{t('orp.registered')}</label>
        <input type="date" value={profile.registered} onChange={e => update({ registered: e.target.value })} />

        <div className="orp-tabs">
          <button className={mode === 'month' ? 'btn' : 'btn-secondary'} onClick={() => setMode('month')}>{t('orp.month')}</button>
          <button className={mode === 'before' ? 'btn' : 'btn-secondary'} disabled={!profile.registered} onClick={() => setMode('before')}>{t('orp.before')}</button>
        </div>
        {mode === 'month' && <input type="month" value={month} onChange={e => setMonth(e.target.value)} />}

        <p className="orp-count"><b>{rows.length}</b> {t('orp.searches')} · {swissDate(from)} - {swissDate(to)}</p>
        {shortWeeks.length > 0 && (
          <p className="orp-warn">{t('orp.shortWeeks')} {shortWeeks.map(([wk, n]) => `${swissDate(wk)} (${n})`).join(', ')}</p>
        )}

        {/* 2026-10-13 owner: "digital online is best" - Job-Room cards come
            first; the paper-form PDF is only for an office that asks for it */}
        <p className="orp-hint">{t('orp.jobroomHint')}</p>
        {rows.length > 0 && (
          <div className="orp-cards">
            {rows.map((a, i) => (
              <div key={a.id} className="orp-card">
                <p className="orp-card-head">{i + 1}. {swissDate(a.date)} - {a.company}</p>
                <Field id={`${a.id}d`} name="Date" value={swissDate(a.date)} />
                <Field id={`${a.id}c`} name="Entreprise" value={a.company} />
                <Field id={`${a.id}a`} name="Adresse" value={a.address ?? ''} />
                <Field id={`${a.id}p`} name="Contact" value={a.contact ?? ''} />
                <Field id={`${a.id}r`} name="Poste" value={a.role} />
                <Field id={`${a.id}m`} name="Offre" value={METHOD_FR[a.method ?? 'electronic']} />
                <Field id={`${a.id}t`} name="Taux" value={(a.rate ?? 100) >= 100 ? 'plein temps' : `${a.rate}%`} />
                <Field id={`${a.id}s`} name="Résultat" value={orpResult(a.status)} />
              </div>
            ))}
          </div>
        )}
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
