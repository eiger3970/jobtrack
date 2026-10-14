import React, { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { type Application } from '../lib/orp'
import { isApp } from '../lib/platform'
import SyncFlow from '../components/sync_flow'
import { merge, baseOf, newRoom, newKey, linkFromHash, linkFromText, openLink, type Base, type MergeResult, type SyncLink } from '../lib/jobtrack_sync'

// 2026-10-14 owner: phone + desktop (also library computers) share one list.
// Computer: Sync -> QR. Phone: Camera -> scan -> the page opens and syncs.
// Owner: "include the image as per file transfer webpage, showing how the
// data is private, only the linking devices is seen".

type Lang = 'en' | 'de' | 'fr'
type Tx = (en: string, de: string, fr: string) => string
interface Quota { target: number; period: 'week' | 'fortnight' | 'month' }
interface Props {
  lang: Lang; apps: Application[]; quota: Quota | null
  setApps: (a: Application[]) => void; setQuota: (q: Quota) => void; onClose: () => void
}

// the list as it was right after this device's last sync (see merge rules)
const BASE = 'kworld_jobtrack_sync_base'
export function loadBase(): Base { try { return JSON.parse(localStorage.getItem(BASE) || '{}') } catch { return {} } }
function keepBase(apps: Application[]) { try { localStorage.setItem(BASE, JSON.stringify(baseOf(apps))) } catch { /* private mode */ } }
// the ORP form details (name, AVS...) travel too, so clearing a library computer loses nothing;
// a device that already has its own keeps them
const ORP_PROFILE = 'kworld_jobtrack_orp_profile'
function readKey(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } }
function adoptProfile(p: unknown) { if (typeof p === 'string' && p && !readKey(ORP_PROFILE)) try { localStorage.setItem(ORP_PROFILE, p) } catch { /* private mode */ } }

// 2026-10-14 owner: shown like a real passphrase - Capital + number on the first
// word (Scorn5-most-ozone-frisk). The number comes from the room, so both screens match.
const words = (room: string) => {
  const n = [...room].reduce((a, c) => a + c.charCodeAt(0), 0) % 10
  return room.split('0').map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) + n : w)).join('-')
}

function Points({ L }: { L: Tx }) {
  return (
    <ul className="jts-points">
      {/* 2026-10-14 owner: "Keep both, what does this mean ... Key, I don't understand" - plain words */}
      <li><b>{L('Changed on both devices?', 'Auf beiden Geräten geändert?', 'Modifié sur les deux appareils?')}</b> {L('Merged automatically into one entry. If the same detail differs, the other value is written into the notes - nothing is lost, no duplicates to hunt for.', 'Automatisch zu einem Eintrag zusammengeführt. Weicht dieselbe Angabe ab, steht der andere Wert in den Notizen - nichts geht verloren, keine Doppelten zu suchen.', "Fusionné automatiquement en une entrée. Si le même détail diffère, l'autre valeur est notée - rien n'est perdu, aucun doublon à chercher.")}</li>
      <li><b>{L('The key', 'Der Schlüssel', 'La clé')}</b> {L('(middle of the picture): one secret key, made on this computer and handed to your phone inside the QR code - never over the internet. Only these two can open the locked list.', '(Mitte des Bildes): ein geheimer Schlüssel, auf diesem Computer erstellt und im QR-Code ans Telefon übergeben - nie übers Internet. Nur diese zwei öffnen die verschlossene Liste.', "(au milieu de l'image): une clé secrète, créée sur cet ordinateur et remise au téléphone dans le code QR - jamais par internet. Seuls ces deux peuvent ouvrir la liste verrouillée.")}</li>
      <li><b>{L('Our server', 'Unser Server', 'Notre serveur')}</b> {L('passes on the locked list, sees only that 2 devices linked, keeps nothing.', 'reicht die verschlossene Liste weiter, sieht nur 2 verbundene Geräte, speichert nichts.', 'transmet la liste verrouillée, voit seulement 2 appareils liés, ne garde rien.')}</li>
    </ul>
  )
}

function Done({ r, L }: { r: MergeResult; L: Tx }) {
  return (
    <div className="jts-done">
      <p className="jts-done-title">{L('Synced - both devices now have the same list', 'Synchronisiert - beide Geräte haben jetzt dieselbe Liste', 'Synchronisé - les deux appareils ont maintenant la même liste')} ({r.apps.length})</p>
      <ul>
        <li>{L('From the phone', 'Vom Telefon', 'Du téléphone')}: {r.fromPhone}</li>
        <li>{L('From the computer', 'Vom Computer', "De l'ordinateur")}: {r.fromComputer}</li>
        {(r.joined ?? 0) > 0 && <li>{L('Duplicates joined (same job, date and company)', 'Doppelte zusammengelegt (gleiche Stelle, Datum, Firma)', 'Doublons réunis (même poste, date, entreprise)')}: {r.joined}</li>}
        {(r.merged ?? 0) > 0 && <li>{L('Merged automatically (different details changed)', 'Automatisch zusammengeführt (verschiedene Angaben geändert)', 'Fusionné automatiquement (détails différents modifiés)')}: {r.merged}</li>}
        {r.both > 0 && <li>{L('Kept both (changed on both)', 'Beide behalten (auf beiden geändert)', 'Gardé les deux (modifié des deux côtés)')}: {r.both}</li>}
        {r.removed > 0 && <li>{L('Deleted (deleted on one device)', 'Gelöscht (auf einem Gerät gelöscht)', 'Supprimé (supprimé sur un appareil)')}: {r.removed}</li>}
      </ul>
    </div>
  )
}
// 2026-10-14 owner: the phone app (and a phone browser opened by hand) scans
// the computer's QR itself - the iPhone Camera would open Safari, not the app.
function Scanner({ L, onLink }: { L: Tx; onLink: (l: { room: string; key: string }) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let stream: MediaStream | null = null, stop = false
    let jsQR: typeof import('jsqr').default | null = null
    import('jsqr').then(m => { jsQR = m.default }).catch(() => {})
    const BD = (window as any).BarcodeDetector
    const detector = BD ? new BD({ formats: ['qr_code'] }) : null
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const found = (text: string) => { const l = linkFromText(text); if (l) { stop = true; onLink(l) } return !!l }
    const tick = async () => {
      if (stop) return
      const v = video.current
      if (v && v.readyState >= 2) {
        if (detector) { try { const r = await detector.detect(v); if (r[0] && found(r[0].rawValue)) return } catch { /* jsQR below */ } }
        if (jsQR && ctx && v.videoWidth) {
          canvas.width = v.videoWidth; canvas.height = v.videoHeight
          ctx.drawImage(v, 0, 0)
          const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
          if (code && found(code.data)) return
        }
      }
      setTimeout(tick, 200)
    }
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(s => {
      if (stop) { s.getTracks().forEach(t => t.stop()); return }
      stream = s
      if (video.current) { video.current.srcObject = s; void video.current.play() }
      tick()
    }).catch(() => setErr(true)) ?? setErr(true)
    return () => { stop = true; stream?.getTracks().forEach(t => t.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return err
    ? <p className="jts-lost">{L('No camera. Settings -> JobTrack (or Safari) -> Camera -> Allow, then try again.', 'Keine Kamera. Einstellungen -> JobTrack (oder Safari) -> Kamera -> Erlauben, dann nochmals.', 'Pas de caméra. Réglages -> JobTrack (ou Safari) -> Appareil photo -> Autoriser, puis réessayez.')}</p>
    : <video ref={video} className="jts-cam" playsInline muted />
}

type State = 'start' | 'scan' | 'waiting' | 'syncing' | 'done' | 'lost' | 'cleared'
const onPhone = () => isApp() || /iPhone|iPod|Android/i.test(navigator.userAgent)

// 2026-10-14 owner: library computer -> sync to the phone, then clear it.
// JobTrack only by default; the CV page's data isn't synced, so it's a separate tick.
export function clearComputer(withCv: boolean) {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('kworld_jobtrack') || (withCv && k.startsWith('cvgen-'))) localStorage.removeItem(k)
    sessionStorage.clear()
  } catch { /* private mode - nothing stored anyway */ }
}

// 2026-10-14 owner: the Clear button "could wipe hours of work" - amber, with a
// warning, and a confirm step that says what is safe where. Also offered on the
// main screen after a sync (job_track_backup.tsx), where it can't be missed.
export const SYNCED_KEY = 'kworld_jobtrack_synced'
export function lastSync(): { at: number; n: number } | null {
  try { return JSON.parse(sessionStorage.getItem(SYNCED_KEY) || 'null') } catch { return null }
}
const WARN = <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" /></svg>

export function ClearBox({ L, n, at, onClear, extra }: { L: Tx; n: number; at: number; onClear: () => void; extra?: React.ReactNode }) {
  const [ask, setAsk] = useState(false)
  const time = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return ask ? (
    <div className="jts-confirm">
      <p className="jts-confirm-title">{WARN}{L('Delete JobTrack from this computer?', 'JobTrack von diesem Computer löschen?', 'Effacer JobTrack de cet ordinateur?')}</p>
      <p>{L(`Your ${n} entries are safe on your phone (synced ${time}). Only this computer's copy is deleted.`, `Ihre ${n} Einträge sind sicher auf Ihrem Telefon (synchronisiert ${time}). Nur die Kopie auf diesem Computer wird gelöscht.`, `Vos ${n} entrées sont en sécurité sur votre téléphone (synchro ${time}). Seule la copie de cet ordinateur est effacée.`)}</p>
      {extra}
      <div className="jts-confirm-btns">
        <button className="btn-secondary" onClick={() => setAsk(false)}>{L('Keep it', 'Behalten', 'Garder')}</button>
        <button className="jts-clear-amber" onClick={onClear}>{WARN}{L('Yes, clear this computer', 'Ja, Computer leeren', 'Oui, vider cet ordinateur')}</button>
      </div>
    </div>
  ) : (
    <button className="jts-clear-amber" onClick={() => setAsk(true)}>{WARN}{L('Clear JobTrack from this computer', 'JobTrack von diesem Computer löschen', 'Effacer JobTrack de cet ordinateur')}</button>
  )
}

export default function JobTrackSync({ lang, apps, quota, setApps, setQuota, onClose }: Props) {
  const L: Tx = (en, de, fr) => (lang === 'de' ? de : lang === 'fr' ? fr : en)
  // the phone arrives with #sync=...&e=... from the QR, or scans it (app)
  const [hashLink] = useState(linkFromHash)
  const phone = hashLink !== null || onPhone()
  const [link, setLink] = useState<{ room: string; key: string } | null>(() => hashLink ?? (phone ? null : { room: newRoom(), key: newKey() }))
  const [state, setState] = useState<State>(hashLink ? 'waiting' : 'start')
  const [qr, setQr] = useState('')
  const [result, setResult] = useState<MergeResult | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [withCv, setWithCv] = useState(false)
  const hasCv = (() => { try { return localStorage.getItem('cvgen-data') !== null } catch { return false } })()
  // fresh values inside the socket callbacks
  const appsRef = useRef(apps); appsRef.current = apps
  const quotaRef = useRef(quota); quotaRef.current = quota

  // the QR always points at the website, also when shown in the app
  const url = link ? `https://kworld.space/jobtrack#sync=${link.room}&e=${link.key}` : ''
  useEffect(() => {
    if (!phone && url) QRCode.toDataURL(url, { margin: 1, width: 300, color: { dark: '#03020a', light: '#ffffff' } }).then(setQr)
  }, [url, phone])

  useEffect(() => {
    if (!link) return
    let l: SyncLink | null = null, sent = false, gone = false
    const role = phone ? 'phone' : 'computer'
    // phone: no answer within 25 s -> say so, offer to try again
    const timer = phone ? setTimeout(() => { if (!gone) setState(s => (s === 'done' ? s : 'lost')) }, 25000) : undefined
    openLink(link.room, link.key, role, {
      open: () => {},
      lost: () => setState(s => (s === 'done' || s === 'cleared' ? s : 'lost')),
      peers: n => {
        if (phone && n >= 2 && !sent && l) {
          sent = true
          setState('syncing')
          void l.send('list', { apps: appsRef.current, base: loadBase(), quota: quotaRef.current, profile: readKey(ORP_PROFILE) })
        }
      },
      msg: (kind, body) => {
        if (!phone && kind === 'list') {
          setState('syncing')
          const r = merge(appsRef.current, loadBase(), body.apps ?? [], body.base ?? {})
          setApps(r.apps); keepBase(r.apps)
          if (!quotaRef.current && body.quota) setQuota(body.quota)
          adoptProfile(body.profile)
          void l?.send('result', { r, quota: quotaRef.current ?? body.quota ?? null, profile: readKey(ORP_PROFILE) })
          setResult(r); setState('done')
          try { sessionStorage.setItem(SYNCED_KEY, JSON.stringify({ at: Date.now(), n: r.apps.length })) } catch { /* private mode */ }
        }
        if (phone && kind === 'result') {
          const r: MergeResult = body.r
          setApps(r.apps); keepBase(r.apps)
          if (!quotaRef.current && body.quota) setQuota(body.quota)
          adoptProfile(body.profile)
          setResult(r); setState('done')
          if (hashLink) history.replaceState(null, '', window.location.pathname)
        }
      },
    }).then(x => {
      if (gone) { x.close(); return }
      l = x
    }).catch(() => setState('lost'))
    return () => { gone = true; clearTimeout(timer); l?.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, attempt])

  function close() {
    if (hashLink) history.replaceState(null, '', window.location.pathname)
    onClose()
  }
  function clearHere() {
    setApps([])
    // after React writes the empty list, remove every JobTrack key
    setTimeout(() => { clearComputer(withCv); setState('cleared') }, 0)
  }
  function again() {
    setState(phone && !hashLink ? 'scan' : phone ? 'waiting' : 'start')
    if (phone && !hashLink) setLink(null)
    setAttempt(a => a + 1)
  }

  const title = phone ? L('Sync with the computer', 'Mit dem Computer synchronisieren', "Synchroniser avec l'ordinateur") : L('Sync with your phone', 'Mit dem Telefon synchronisieren', 'Synchroniser avec votre téléphone')
  let body
  if (state === 'cleared') body = (
    <div className="jts-done">
      <p className="jts-done-title">{L('This computer is clear', 'Dieser Computer ist leer', 'Cet ordinateur est vidé')}</p>
      <p>{L('Your list is on your phone. Last step: close this browser window.', 'Ihre Liste ist auf Ihrem Telefon. Letzter Schritt: dieses Browserfenster schliessen.', 'Votre liste est sur votre téléphone. Dernière étape: fermez cette fenêtre du navigateur.')}</p>
    </div>
  )
  else if (state === 'done' && result) body = (<>
    <Done r={result} L={L} />
    {!phone && <div className="jts-shared">
      <p className="jts-step">{L('Shared or library computer? Clear it now:', 'Fremder oder Bibliotheks-Computer? Jetzt leeren:', 'Ordinateur partagé ou de bibliothèque? Videz-le maintenant:')}</p>
      <ClearBox L={L} n={result.apps.length} at={Date.now()} onClear={clearHere}
        extra={hasCv && <label className="jts-check"><input type="checkbox" checked={withCv} onChange={e => setWithCv(e.target.checked)} />{L('Also my CV from the CV page (not synced - download it first)', 'Auch meinen Lebenslauf von der CV-Seite (nicht synchronisiert - zuerst herunterladen)', 'Aussi mon CV de la page CV (non synchronisé - téléchargez-le avant)')}</label>} />
    </div>}
  </>)
  else if (state === 'lost') body = (
    <div className="jts-lost">
      <p>{L('No link to the other device.', 'Keine Verbindung zum anderen Gerät.', "Pas de lien avec l'autre appareil.")}</p>
      <ol>
        <li>{L('Computer -> kworld.space/jobtrack -> Sync phone + computer: is the QR still open?', 'Computer -> kworld.space/jobtrack -> Sync Telefon + Computer: ist der QR noch offen?', 'Ordinateur -> kworld.space/jobtrack -> Sync téléphone + ordinateur: le QR est-il encore ouvert?')}</li>
        <li>{L('Both devices online (Wi-Fi or mobile data)?', 'Beide Geräte online (WLAN oder mobile Daten)?', 'Les deux appareils en ligne (Wi-Fi ou données mobiles)?')}</li>
      </ol>
      <button className="btn btn-glow" onClick={again}>{L('Try again', 'Nochmals versuchen', 'Réessayer')}</button>
    </div>
  )
  else if (phone && !link) body = state === 'scan'
    ? <><p className="jts-step">{L("Point at the computer's QR code", 'Auf den QR-Code des Computers richten', "Visez le code QR de l'ordinateur")}</p><Scanner L={L} onLink={l => { setLink(l); setState('waiting') }} /></>
    : <>
      <p className="jts-step">{L('Computer -> kworld.space/jobtrack -> Sync phone + computer -> a QR code', 'Computer -> kworld.space/jobtrack -> Sync Telefon + Computer -> ein QR-Code', 'Ordinateur -> kworld.space/jobtrack -> Sync téléphone + ordinateur -> un code QR')}</p>
      <button className="btn btn-glow" onClick={() => setState('scan')}>{L('Scan the QR code', 'QR-Code scannen', 'Scanner le code QR')}</button>
    </>
  else if (phone) body = <p className="jts-wait"><span className="jts-spin" />{state === 'syncing' ? L('Syncing...', 'Synchronisiere...', 'Synchronisation...') : L('Linking to the computer...', 'Verbinde mit dem Computer...', "Connexion à l'ordinateur...")}</p>
  else body = (<>
    {/* 2026-10-14 owner: a clear hint - sync first, then clear the shared computer */}
    <ol className="jts-steps">
      {/* 2026-10-14 owner: the LocalSync guide's picture - phone scanning the QR - left of the step */}
      <li className="jts-step-pic"><svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true">
        <rect x="2" y="4" width="18" height="32" rx="3.5" fill="none" stroke="#00ff41" strokeWidth="2.4" />
        <circle cx="11" cy="31.5" r="1.4" fill="#00ff41" />
        {[5, 10, 15].map(r => <path key={r} d={`M${25 + r * 0.4} ${20 - r} A${r * 1.15} ${r * 1.15} 0 0 1 ${25 + r * 0.4} ${20 + r}`} stroke="#00ff41" strokeWidth="2" fill="none" />)}
        <rect x="44" y="8" width="18" height="18" rx="2" fill="#f0eeff" />
        {[[46, 10], [55, 10], [46, 19]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="5" height="5" fill="none" stroke="#03020a" strokeWidth="1.4" />)}
        <rect x="55" y="19" width="2.4" height="2.4" fill="#03020a" /><rect x="58" y="22" width="2.4" height="2.4" fill="#03020a" />
      </svg><span><b className="jts-num">1.</b> {L('Phone -> Camera -> point at this QR -> tap the link', 'Telefon -> Kamera -> auf diesen QR richten -> Link tippen', 'Téléphone -> Appareil photo -> visez ce QR -> touchez le lien')}<br /><span className="jts-or">{L('or JobTrack app -> Sync phone + computer -> Scan the QR code', 'oder JobTrack-App -> Sync Telefon + Computer -> QR-Code scannen', 'ou app JobTrack -> Sync téléphone + ordinateur -> Scanner le code QR')}</span></span></li>
      <li><b className="jts-num">2.</b> {L('Shared or library computer: after the sync, tap the amber button below the QR code', 'Fremder oder Bibliotheks-Computer: nach dem Sync den orangen Knopf unter dem QR-Code tippen', 'Ordinateur partagé ou de bibliothèque: après la synchro, touchez le bouton orange sous le code QR')}</li>
    </ol>
    {qr ? <img className="jts-qr" src={qr} alt={L('QR code to sync', 'QR-Code zum Synchronisieren', 'Code QR pour synchroniser')} /> : <div className="jts-qr" />}
    {state === 'syncing' && <p className="jts-wait"><span className="jts-spin" />{L('Syncing...', 'Synchronisiere...', 'Synchronisation...')}</p>}
    {/* 2026-10-14 owner: "where is this infernal one tap" - always in sight, unlocks after the sync */}
    <button className="jts-clear-amber jts-clear-wait" disabled>{L('Clear JobTrack from this computer - after the sync', 'JobTrack von diesem Computer löschen - nach dem Sync', 'Effacer JobTrack de cet ordinateur - après la synchro')}</button>
  </>)

  return (
    <div className="modal" onClick={close}>
      <div className="modal-content jts-panel" onClick={e => e.stopPropagation()}>
        <h2 className="jts-title">{title}</h2>
        {body}
        {link && state !== 'done' && state !== 'lost' && state !== 'cleared' && <p className="jts-match">{L('Same words on both screens = your devices are linked, secure and encrypted', 'Gleiche Wörter auf beiden Bildschirmen = Ihre Geräte sind verbunden, sicher und verschlüsselt', 'Mêmes mots sur les deux écrans = vos appareils sont liés, sécurisés et chiffrés')}:<code className="jts-words">{words(link.room)}</code></p>}
        {state !== 'cleared' && <>
          {/* 2026-10-14 owner: same picture as /transfer - shared component, relay variant */}
          <SyncFlow variant="relay" className="trx-flow jts-flow"
            label={L('The lock key lives only on your phone and computer. Our server passes the list on, locked, and sees only that two devices linked.', 'Der Schlüssel liegt nur auf Telefon und Computer. Unser Server reicht die Liste verschlossen weiter und sieht nur, dass zwei Geräte verbunden sind.', "La clé n'existe que sur votre téléphone et votre ordinateur. Notre serveur transmet la liste verrouillée et voit seulement que deux appareils sont liés.")}
            lockTip={L('The secret key - tap to learn about passphrases', 'Der geheime Schlüssel - tippen, mehr über Passphrasen', 'La clé secrète - touchez pour en savoir plus')}
            onLock={() => window.open('/passphrase#why', '_blank', 'noopener')} />
          <Points L={L} />
        </>}
        <div className="modal-buttons"><button className="btn-secondary" onClick={close}>{L('Close', 'Schliessen', 'Fermer')}</button></div>
      </div>
    </div>
  )
}
