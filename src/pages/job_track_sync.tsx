import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { type Application } from '../lib/orp'
import { isApp } from '../lib/platform'
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
function loadBase(): Base { try { return JSON.parse(localStorage.getItem(BASE) || '{}') } catch { return {} } }
function keepBase(apps: Application[]) { try { localStorage.setItem(BASE, JSON.stringify(baseOf(apps))) } catch { /* private mode */ } }
// the ORP form details (name, AVS...) travel too, so clearing a library computer loses nothing;
// a device that already has its own keeps them
const ORP_PROFILE = 'kworld_jobtrack_orp_profile'
function readKey(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } }
function adoptProfile(p: unknown) { if (typeof p === 'string' && p && !readKey(ORP_PROFILE)) try { localStorage.setItem(ORP_PROFILE, p) } catch { /* private mode */ } }

const words = (room: string) => room.split('0').map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join('-')
const PHONE_D = 'M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z'
const PC_D = 'M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z'

// Same look as /transfer's picture: phone and computer, the locked list passing
// through our server, which sees only a locked box and two linked devices.
function SyncPicture({ L }: { L: Tx }) {
  return (
    <svg className="jts-flow" viewBox="0 0 300 140" role="img" aria-label={L('Your list is locked on one device and unlocked only on the other. Our server passes the locked box and sees only that two devices linked.', 'Ihre Liste wird auf einem Gerät verschlossen und nur auf dem anderen geöffnet. Unser Server reicht die verschlossene Box weiter und sieht nur, dass zwei Geräte verbunden sind.', "Votre liste est verrouillée sur un appareil et ouverte seulement sur l'autre. Notre serveur transmet la boîte verrouillée et voit seulement que deux appareils sont liés.")}>
      <rect x="96" y="4" width="108" height="46" rx="6" fill="#0f0d1c" stroke="#8a86a8" strokeWidth="1.6" />
      <text x="150" y="20" textAnchor="middle" fontSize="9" fill="#8a86a8">{L('Our server sees', 'Unser Server sieht', 'Notre serveur voit')}</text>
      <rect x="128" y="27" width="14" height="12" rx="2" fill="#00ff41" /><path d="M131 28v-3a4 4 0 0 1 8 0v3" fill="none" stroke="#00ff41" strokeWidth="1.8" />
      <text x="148" y="37" fontSize="9" fill="#f0eeff">+ 2</text>
      <svg x="161" y="27" width="10" height="12" viewBox="0 0 24 24"><path fill="#8a86a8" d={PHONE_D} /></svg>
      <svg x="172" y="28" width="12" height="11" viewBox="0 0 24 24"><path fill="#8a86a8" d={PC_D} /></svg>
      <path d="M44 84L100 46M256 84L200 46" stroke="#00ff41" strokeWidth="2.4" strokeDasharray="5 4" />
      <svg x="16" y="84" width="40" height="40" viewBox="0 0 24 24"><path fill="#f0eeff" d={PHONE_D} /></svg>
      <svg x="244" y="84" width="40" height="40" viewBox="0 0 24 24"><path fill="#f0eeff" d={PC_D} /></svg>
      <text x="36" y="136" textAnchor="middle" fontSize="9" fill="#8a86a8">{L('unlocked', 'offen', 'ouvert')}</text>
      <text x="264" y="136" textAnchor="middle" fontSize="9" fill="#8a86a8">{L('unlocked', 'offen', 'ouvert')}</text>
      <rect x="70" y="60" width="14" height="12" rx="2" fill="#00ff41" /><path d="M73 61v-3a4 4 0 0 1 8 0v3" fill="none" stroke="#00ff41" strokeWidth="1.8" />
      <rect x="216" y="60" width="14" height="12" rx="2" fill="#00ff41" /><path d="M219 61v-3a4 4 0 0 1 8 0v3" fill="none" stroke="#00ff41" strokeWidth="1.8" />
    </svg>
  )
}

function Points({ L }: { L: Tx }) {
  return (
    <ul className="jts-points">
      <li><b>{L('Keep both', 'Beide behalten', 'Garder les deux')}</b> {L('- the same entry changed on both devices stays twice, nothing is lost.', '- derselbe Eintrag auf beiden Geräten geändert bleibt doppelt, nichts geht verloren.', "- la même entrée modifiée sur les deux appareils reste en double, rien n'est perdu.")}</li>
      <li><b>{L('Key', 'Schlüssel', 'Clé')}</b> {L('- only inside the QR code, never sent over the internet.', '- nur im QR-Code, nie übers Internet geschickt.', "- seulement dans le code QR, jamais envoyée par internet.")}</li>
      <li><b>{L('Our server', 'Unser Server', 'Notre serveur')}</b> {L('- passes the locked list, sees only that 2 devices linked, keeps nothing.', '- reicht die verschlossene Liste weiter, sieht nur 2 verbundene Geräte, speichert nichts.', '- transmet la liste verrouillée, voit seulement 2 appareils liés, ne garde rien.')}</li>
      <li><b>{L('Shared computer', 'Fremder Computer', 'Ordinateur partagé')}</b> {L('(library) - after the sync, one tap clears JobTrack from it.', '(Bibliothek) - nach dem Sync löscht ein Tipp JobTrack davon.', "(bibliothèque) - après la synchro, un geste efface JobTrack.")}</li>
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
function clearComputer(withCv: boolean) {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('kworld_jobtrack') || (withCv && k.startsWith('cvgen-'))) localStorage.removeItem(k)
    sessionStorage.clear()
  } catch { /* private mode - nothing stored anyway */ }
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
      {hasCv && <label className="jts-check"><input type="checkbox" checked={withCv} onChange={e => setWithCv(e.target.checked)} />{L('Also my CV from the CV page (not synced - download it first)', 'Auch meinen Lebenslauf von der CV-Seite (nicht synchronisiert - zuerst herunterladen)', 'Aussi mon CV de la page CV (non synchronisé - téléchargez-le avant)')}</label>}
      <button className="btn btn-glow" onClick={clearHere}>{L('Clear JobTrack from this computer', 'JobTrack von diesem Computer löschen', 'Effacer JobTrack de cet ordinateur')}</button>
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
      <li>{L('Phone -> scan this QR: Camera app (phone browser) or JobTrack app -> Sync -> Scan the QR code', 'Telefon -> diesen QR scannen: Kamera-App (Telefon-Browser) oder JobTrack-App -> Sync -> QR-Code scannen', 'Téléphone -> scannez ce QR: app Appareil photo (navigateur) ou app JobTrack -> Sync -> Scanner le code QR')}</li>
      <li>{L('Shared or library computer: after the sync, tap Clear JobTrack from this computer', 'Fremder oder Bibliotheks-Computer: nach dem Sync auf JobTrack von diesem Computer löschen tippen', 'Ordinateur partagé ou de bibliothèque: après la synchro, touchez Effacer JobTrack de cet ordinateur')}</li>
    </ol>
    {qr ? <img className="jts-qr" src={qr} alt={L('QR code to sync', 'QR-Code zum Synchronisieren', 'Code QR pour synchroniser')} /> : <div className="jts-qr" />}
    {state === 'syncing' && <p className="jts-wait"><span className="jts-spin" />{L('Syncing...', 'Synchronisiere...', 'Synchronisation...')}</p>}
  </>)

  return (
    <div className="modal" onClick={close}>
      <div className="modal-content jts-panel" onClick={e => e.stopPropagation()}>
        <h2 className="jts-title">{title}</h2>
        {body}
        {link && state !== 'done' && state !== 'lost' && state !== 'cleared' && <p className="jts-match">{L('Same words on both screens = your devices', 'Gleiche Wörter auf beiden Bildschirmen = Ihre Geräte', 'Mêmes mots sur les deux écrans = vos appareils')}: <code>{words(link.room)}</code></p>}
        {state !== 'cleared' && <><SyncPicture L={L} /><Points L={L} /></>}
        <div className="modal-buttons"><button className="btn-secondary" onClick={close}>{L('Close', 'Schliessen', 'Fermer')}</button></div>
      </div>
    </div>
  )
}
