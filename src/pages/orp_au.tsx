import { useState } from 'react'
import { type Application, jobRoomEntry } from '../lib/orp'

// 2026-10-15 owner: Australia - Workforce Australia (Centrelink). Same saved job data, shown as a
// copy-per-field record. No bookmark fill: that site's fields are not confirmed, so nothing is auto-submitted.

const auDate = (iso: string, c: string) => { try { return new Date(iso + 'T12:00:00').toLocaleDateString('en-' + c) } catch { return iso } }
const HOW: Record<string, string> = { electronic: 'Online', letter: 'Mail', visit: 'In person', phone: 'Phone' }

export default function OrpAu({ rows, t, onUpdate, country }: { country: string; rows: Application[]; t: (k: string) => string; onUpdate: (id: number, patch: Partial<Application>) => void }) {
  const [copied, setCopied] = useState('')
  const copy = (key: string, text: string) => { try { navigator.clipboard.writeText(text) } catch { /* blocked */ } setCopied(key); window.setTimeout(() => setCopied(''), 1500) }
  return (
    <div className="orp-au">
      <p className="orp-before-tip">{t(country === 'AU' ? 'au.note' : 'au.note.other')}</p>
      {rows.map((a, n) => {
        const e = jobRoomEntry(a)
        const fields: [string, string][] = [
          ['Date', auDate(a.date, country)], ['Employer', e.business], ['Job title', e.jobTitle], ['How applied', HOW[a.method ?? 'electronic']],
          ['Address', [[e.street, e.streetNo].filter(Boolean).join(' '), [e.postal, e.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
          ['Contact', [e.contactPerson, e.email, e.phone].filter(Boolean).join(', ')], ['Link', e.link],
        ]
        const shown = fields.filter(([, v]) => v)
        return (
          <div className="jr-card" key={a.id}>
            <p className="jr-head">{n + 1}. {a.company}{a.jobroomDone && <span className="jr-done-tag">{t('au.reported')}</span>}</p>
            {shown.map(([k, v]) => (
              <p key={k} className="orp-au-row"><b>{k}:</b> {v} <button type="button" className="jr-copy" onClick={() => copy(a.id + k, v)}>{copied === a.id + k ? '\u2713' : 'Copy'}</button></p>
            ))}
            <button type="button" className="btn-secondary" onClick={() => copy(a.id + 'all', shown.map(([k, v]) => `${k}: ${v}`).join('\n'))}>{copied === a.id + 'all' ? '\u2713' : t('au.copyAll')}</button>
            {' '}<button type="button" className="btn-secondary" onClick={() => onUpdate(a.id, { jobroomDone: a.jobroomDone ? '' : new Date().toISOString().slice(0, 10) })}>{t('au.markReported')}</button>
          </div>
        )
      })}
    </div>
  )
}
