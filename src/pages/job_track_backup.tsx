import { useEffect, useState } from 'react'
import { type Application } from '../lib/orp'
import { baseOf, key } from '../lib/jobtrack_sync'
import { loadBase } from './job_track_sync'

// 2026-10-14 owner: "2 entries not backed up" + the choices, each with how
// easy it is. Owner's ranking: this browser is easiest but fails on public
// computers; a cloud account needs a login + passphrase set up (hard when life is disorganised);
// a USB stick is often not at hand - so the phone (scan a QR) is the easiest
// that really works. Plus a reminder after a few idle minutes.
// Computers only - the phone keeps its own export banner.

type Tx = (en: string, de: string, fr: string) => string
const KEPT = 'kworld_jobtrack_kept_here' // "keep on this computer" until the next change
const IDLE_MS = 3 * 60 * 1000

function readBase(k: string): Record<number, string> { try { return JSON.parse(localStorage.getItem(k) || '{}') } catch { return {} } }
function snapshotBase(snapshot: string | null): Record<number, string> {
  try { return baseOf(JSON.parse(snapshot || '{}').apps ?? []) } catch { return {} }
}

// entries matching none of: last sync, last exported file, "keep here"
export function notBackedUp(apps: Application[], snapshot: string | null): number {
  const bases = [loadBase(), snapshotBase(snapshot), readBase(KEPT)]
  return apps.filter(a => { const k = key(a); return !bases.some(b => b[a.id] === k) }).length
}

function Ease({ n, L }: { n: 1 | 2 | 3; L: Tx }) {
  const label = n === 3 ? L('Easy', 'Einfach', 'Facile') : n === 2 ? L('Medium', 'Mittel', 'Moyen') : L('Hard', 'Schwer', 'Difficile')
  return (
    <span className="jtb-ease" aria-label={label}>
      <svg viewBox="0 0 22 12" width="22" height="12" aria-hidden="true">{[0, 1, 2].map(i => <rect key={i} x={i * 8} y={8 - i * 4} width="6" height={4 + i * 4} rx="1" fill={i < n ? '#00ff41' : '#2a2a3a'} />)}</svg>
      {label}
    </span>
  )
}

// 2026-10-14 owner order: phone first in all cases; a cloud drive only ranks
// well once the cloud account + passphrase are already set up (digital life
// in order); this browser last - not with you on the go, lost on public computers.
function Choices({ L, onSync, onExport, onKeep }: { L: Tx; onSync: () => void; onExport: () => void; onKeep: () => void }) {
  return (
    <ul className="jtb-choices">
      <li className="jtb-best">
        <button className="btn btn-glow" onClick={onSync}>{L('Phone - scan a QR', 'Telefon - QR scannen', 'Téléphone - scanner un QR')}</button>
        <Ease n={3} L={L} /><span className="jtb-why">{L('Recommended - with you on the go, works on any computer, no login', 'Empfohlen - unterwegs dabei, geht an jedem Computer, ohne Login', 'Recommandé - avec vous partout, marche sur tout ordinateur, sans connexion')}</span>
      </li>
      <li>
        <button className="btn-secondary" onClick={onExport}>{L('Cloud drive - save a file', 'Cloud-Speicher - Datei speichern', 'Cloud - enregistrer un fichier')}</button>
        <Ease n={2} L={L} /><span className="jtb-why">{L('Only if your cloud account and passphrase are already set up - then upload the file. Not yet?', 'Nur wenn Cloud-Konto und Passphrase schon eingerichtet sind - dann die Datei hochladen. Noch nicht?', 'Seulement si votre compte cloud et votre phrase de passe sont déjà prêts - puis téléversez le fichier. Pas encore?')}{' '}
          <a href="/security/personal#digital-life" target="_blank" rel="noopener">{L('Digital life in order', 'Digitaler Alltag im Griff', 'Vie numérique en ordre')}</a>{' + '}
          <a href="/passphrase" target="_blank" rel="noopener">{L('Passphrase', 'Passphrase', 'Phrase de passe')}</a>
        </span>
      </li>
      <li>
        <button className="btn-secondary" onClick={onExport}>{L('USB stick - save a file', 'USB-Stick - Datei speichern', 'Clé USB - enregistrer un fichier')}</button>
        <Ease n={1} L={L} /><span className="jtb-why">{L('Needs a USB stick with you', 'Braucht einen USB-Stick dabei', 'Il faut une clé USB sur vous')}</span>
      </li>
      <li>
        <button className="btn-secondary" onClick={onKeep}>{L('Keep in this browser', 'In diesem Browser behalten', 'Garder dans ce navigateur')}</button>
        <Ease n={3} L={L} /><span className="jtb-why">{L('Not with you on the go, lost on public or library computers', 'Unterwegs nicht dabei, verloren an öffentlichen oder Bibliotheks-Computern', 'Pas avec vous en déplacement, perdu sur un ordinateur public ou de bibliothèque')}</span>
      </li>
    </ul>
  )
}

export default function BackupBar({ lang, apps, snapshot, onSync, onExport }: { lang: 'en' | 'de' | 'fr'; apps: Application[]; snapshot: string | null; onSync: () => void; onExport: () => void }) {
  const L: Tx = (en, de, fr) => (lang === 'de' ? de : lang === 'fr' ? fr : en)
  const [, bump] = useState(0)
  const n = notBackedUp(apps, snapshot)
  const [idle, setIdle] = useState(false)

  // idle reminder: no tap, key or scroll for 3 minutes while something is not backed up
  useEffect(() => {
    if (n === 0) { setIdle(false); return }
    let t = setTimeout(() => setIdle(true), IDLE_MS)
    const reset = () => { clearTimeout(t); t = setTimeout(() => setIdle(true), IDLE_MS) }
    const ev = ['pointerdown', 'keydown', 'scroll', 'mousemove'] as const
    ev.forEach(e => window.addEventListener(e, reset, { passive: true }))
    return () => { clearTimeout(t); ev.forEach(e => window.removeEventListener(e, reset)) }
  }, [n])

  // the tab title shows it too, when another tab is in front
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '')
    document.title = n > 0 ? `(${n}) ${base}` : base
    return () => { document.title = document.title.replace(/^\(\d+\) /, '') }
  }, [n])

  if (n === 0) return null
  const keep = () => { try { localStorage.setItem(KEPT, JSON.stringify(baseOf(apps))) } catch { /* private mode */ } setIdle(false); bump(x => x + 1) }
  const sync = () => { setIdle(false); onSync() }
  const exp = () => { setIdle(false); onExport() }
  const head = n === 1 ? L('1 entry not backed up', '1 Eintrag nicht gesichert', '1 entrée non sauvegardée') : L(`${n} entries not backed up`, `${n} Einträge nicht gesichert`, `${n} entrées non sauvegardées`)
  return (<>
    <div className="backup-reminder jtb-bar" role="status">
      <p className="jtb-head">{head}</p>
      <Choices L={L} onSync={sync} onExport={exp} onKeep={keep} />
    </div>
    {idle && (
      <div className="modal" onClick={() => setIdle(false)}>
        <div className="modal-content jts-panel" onClick={e => e.stopPropagation()}>
          <h2 className="jts-title">{L('Still here?', 'Noch da?', 'Toujours là?')} {head}</h2>
          <Choices L={L} onSync={sync} onExport={exp} onKeep={keep} />
          <div className="modal-buttons"><button className="btn-secondary" onClick={() => setIdle(false)}>{L('Later', 'Später', 'Plus tard')}</button></div>
        </div>
      </div>
    )}
  </>)
}
