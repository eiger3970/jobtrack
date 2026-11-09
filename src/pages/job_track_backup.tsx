import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import PassphraseIcon from '../components/passphrase_icon'
import { TapCount } from './find_details'
import { ShieldLink } from '../components/security_shield'
import { type Application } from '../lib/orp'
import { baseOf, key } from '../lib/jobtrack_sync'
import { loadBase, lastSync, ClearBox } from './job_track_sync'

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

// Estimated clicks from this chooser, with devices/accounts already ready.
// Browser: automatic storage, no clicks and no second copy.
// Phone: Sync, open Camera, tap QR link; transfer itself is automatic.
// Cloud: export, open cloud, Upload, Files, select backup, Open.
// USB: export, open Downloads, select backup, Cut, open USB, Paste, Eject.
const BACKUP_TAPS = { browser: 0, phone: 3, cloud: 6, usb: 7 } as const
function BackupClicks({ kind, L }: { kind: keyof typeof BACKUP_TAPS; L: Tx }) {
  return <TapCount n={BACKUP_TAPS[kind]} maxCount={7} label={kind === 'browser' ? L('{n} clicks; saved automatically in this browser', '{n} Klicks; automatisch in diesem Browser gespeichert', '{n} clics ; enregistré automatiquement dans ce navigateur') : L('About {n} clicks; setup and extra prompts excluded', 'Etwa {n} Klicks; Einrichtung und zusätzliche Abfragen nicht enthalten', 'Environ {n} clics ; configuration et demandes supplémentaires exclues')} />
}

function ChoiceIcon({ kind }: { kind: 'devices' | 'phoneOff' | 'cloud' | 'cloudOff' | 'key' | 'usb' }) {
  if (kind === 'key') return <PassphraseIcon className="jtb-detail-icon" size={.85} />
  const shapes = {
    devices: <><g stroke="#4da3ff"><rect x="12" y="2" width="10" height="7" rx="1" /><path d="M10 12h14M17 9v3" /></g><g stroke="#00ff41"><rect x="2" y="10" width="6" height="12" rx="1.5" /><path d="M4 19h2" /></g></>,
    phoneOff: <><path d="M8 3h9a2 2 0 0 1 2 2v10M19 19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5M10 17h4M2 2l20 20" /></>,
    cloud: <><path d="M7 18a5 5 0 0 1-1-10 6 6 0 0 1 11-1 5.5 5.5 0 0 1 1 11M12 21V11m-4 4 4-4 4 4" /></>,
    cloudOff: <><path d="M5 8a5 5 0 0 0 2 10h10M10 4a6 6 0 0 1 7 3 5.5 5.5 0 0 1 4 9M2 2l20 20" /></>,
    usb: <><path d="M8 3h8v6H8zM7 9h10v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9ZM11 5v2m2-2v2" /></>,
  }
  return <svg className="jtb-detail-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[kind]}</svg>
}

function Choices({ L, onSync, onExport }: { L: Tx; onSync: () => void; onExport: () => void }) {
  return (
    <ul className="jtb-choices">
      <li>
        <strong className="jtb-browser-label">{L('Browser auto stored', 'Automatisch im Browser gespeichert', 'Enregistré automatiquement dans le navigateur')}</strong>
        <BackupClicks kind="browser" L={L} /><span className="jtb-why"><ChoiceIcon kind="phoneOff" />{L('Not on your phone.', 'Nicht auf Ihrem Telefon.', 'Pas sur votre téléphone.')} <b className="jtb-warn"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" /></svg>{L('Lost on shared or public computers.', 'Auf fremden oder öffentlichen Computern verloren.', 'Perdu sur un ordinateur partagé ou public.')}</b></span>
      </li>
      <li className="jtb-best">
        <button className="btn btn-glow" onClick={onSync}>{L('Phone - scan a QR', 'Telefon - QR scannen', 'Téléphone - scanner un QR')}</button>
        <BackupClicks kind="phone" L={L} /><span className="jtb-why"><ChoiceIcon kind="devices" />{L('Latest list saved on your phone and this computer. No separate backup file needed. No login.', 'Aktuelle Liste auf Ihrem Telefon und diesem Computer gespeichert. Keine separate Sicherungsdatei nötig. Ohne Login.', 'Liste à jour enregistrée sur votre téléphone et cet ordinateur. Aucun fichier de sauvegarde séparé nécessaire. Sans connexion.')}</span>
      </li>
      <li>
        <button className="btn-secondary" onClick={onExport}>{L('Cloud drive - save a file', 'Cloud-Speicher - Datei speichern', 'Cloud - enregistrer un fichier')}</button>
        <BackupClicks kind="cloud" L={L} /><span className="jtb-why"><ChoiceIcon kind="cloud" />{L('Cloud account and passphrase ready - then upload the file.', 'Cloud-Konto und Passphrase bereit - dann die Datei hochladen.', 'Compte cloud et phrase de passe prêts - puis téléversez le fichier.')}{' '}<ChoiceIcon kind="cloudOff" />{L('No cloud?', 'Keine Cloud?', 'Pas de cloud?')}{' '}
          <a href="/security/personal#digital-life" target="_blank" rel="noopener">{L('Digital life in order', 'Digitaler Alltag im Griff', 'Vie numérique en ordre')}</a>{' + '}
          <a href="/passphrase" target="_blank" rel="noopener"><ChoiceIcon kind="key" />{L('Passphrase', 'Passphrase', 'Phrase de passe')}</a>
        </span>
      </li>
      <li>
        <button className="btn-secondary" onClick={onExport}>{L('USB stick - save a file', 'USB-Stick - Datei speichern', 'Clé USB - enregistrer un fichier')}</button>
        <BackupClicks kind="usb" L={L} /><span className="jtb-why"><ChoiceIcon kind="usb" />{L('Needs a USB stick with you, locked with a passphrase', 'Braucht einen USB-Stick dabei, mit Passphrase verschlossen', 'Il faut une clé USB sur vous, verrouillée par une phrase de passe')}{' - '}
          {/* 2026-10-14 owner: link to the USB-locking product once it's built (idea: memory project_secure_usb_idea); the passphrase page until then */}
          <a href="/passphrase" target="_blank" rel="noopener"><ChoiceIcon kind="key" />{L('Passphrase', 'Passphrase', 'Phrase de passe')}</a></span>
      </li>
    </ul>
  )
}

export default function BackupBar({ lang, apps, snapshot, onSync, onExport, onClear, inline = false, target }: { lang: 'en' | 'de' | 'fr'; apps: Application[]; snapshot: string | null; onSync: () => void; onExport: () => void; onClear: () => void; inline?: boolean; target?: HTMLElement | null }) {
  const L: Tx = (en, de, fr) => (lang === 'de' ? de : lang === 'fr' ? fr : en)
  const place = (bar: ReactNode) => inline ? (target ? createPortal(bar, target) : null) : bar
  const n = notBackedUp(apps, snapshot)
  const [idle, setIdle] = useState(() => import.meta.env.DEV && typeof window !== 'undefined' && window.location.search.includes('idle'))

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

  // 2026-10-14 owner: "Leave site?" only while something isn't backed up. The
  // browser shows its own text (no custom words allowed), so the bar lights
  // up at the same moment - Cancel lands right on the choices.
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (n === 0) return
    const warn = (e: BeforeUnloadEvent) => {
      // Save + write the cover letter: the entry is saved first, no warning (owner 2026-10-13)
      if ((window as unknown as { kworldLeaving?: boolean }).kworldLeaving) return
      e.preventDefault(); e.returnValue = ''; setFlash(true); window.scrollTo({ top: 0 }) }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [n])

  // 2026-10-14 owner: after a sync, the Clear button where it can't be missed
  const synced = lastSync()
  const [cleared, setCleared] = useState(false)
  if (cleared) return place(
    <div className="backup-reminder jtb-bar jtb-synced"><p className="jtb-head">{L('This computer is clear - last step: close this browser window.', 'Dieser Computer ist leer - letzter Schritt: Browserfenster schliessen.', 'Cet ordinateur est vidé - dernière étape: fermez la fenêtre du navigateur.')}</p></div>
  )
  if (n === 0 && synced && apps.length > 0) return place(
    <div className="backup-reminder jtb-bar jtb-synced">
      <p className="jtb-head">{L(`Synced to your phone at ${new Date(synced.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Shared or library computer?`, `Um ${new Date(synced.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} mit dem Telefon synchronisiert. Fremder oder Bibliotheks-Computer?`, `Synchronisé avec votre téléphone à ${new Date(synced.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Ordinateur partagé ou de bibliothèque?`)}</p>
      <ClearBox L={L} n={synced.n} at={synced.at} onClear={() => { onClear(); setCleared(true) }} />
    </div>
  )
  if (n === 0) return null
  const sync = () => { setIdle(false); onSync() }
  const exp = () => { setIdle(false); onExport() }
  const head = n === 1 ? L('1 entry needing back up', '1 Eintrag muss gesichert werden', '1 entrée à sauvegarder') : L(`${n} entries needing back up`, `${n} Einträge müssen gesichert werden`, `${n} entrées à sauvegarder`)
  return (<>
    {place(<div className={'backup-reminder jtb-bar' + (flash ? ' jtb-flash' : '')} role="status" onAnimationEnd={() => setFlash(false)}>
      <p className="jtb-head">{head}<ShieldLink topic="backups" point="backup-rule" iconOnly /></p>
      <Choices L={L} onSync={sync} onExport={exp} />
    </div>)}
    {idle && (
      <div className="modal" onClick={() => setIdle(false)}>
        <div className="modal-content jts-panel" onClick={e => e.stopPropagation()}>
          <h2 className="jts-title">{L('Still here?', 'Noch da?', 'Toujours là?')} {head}</h2>
          <Choices L={L} onSync={sync} onExport={exp} />
          <div className="modal-buttons"><button className="btn-secondary" onClick={() => setIdle(false)}>{L('Later', 'Später', 'Plus tard')}</button></div>
        </div>
      </div>
    )}
  </>)
}
