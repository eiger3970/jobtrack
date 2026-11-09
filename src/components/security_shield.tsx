import { useLanguage, type Lang } from '../context/language'
import PassphraseIcon from './passphrase_icon'
import type { ReactNode } from 'react'

export const SECURITY_TOPICS = {
  about: { en: 'About this site', de: 'Über diese Website', fr: 'À propos de ce site' },
  accounts: { en: 'Accounts and passphrases', de: 'Konten und Passphrasen', fr: 'Comptes et phrases de passe' },
  backups: { en: 'Backups', de: 'Sicherungen', fr: 'Sauvegardes' },
  devices: { en: 'Devices and updates', de: 'Geräte und Updates', fr: 'Appareils et mises à jour' },
  downloads: { en: 'Downloads and scripts', de: 'Downloads und Skripte', fr: 'Téléchargements et scripts' },
  messages: { en: 'Email and suspicious messages', de: 'E-Mail und verdächtige Nachrichten', fr: 'E-mails et messages suspects' },
  notes: { en: 'Notes need secrets removed', de: 'Notizen und Geheimnisse', fr: 'Notes et secrets' },
  payments: { en: 'Payments and shopping', de: 'Zahlungen und Einkäufe', fr: 'Paiements et achats' },
  privacy: { en: 'Privacy', de: 'Datenschutz', fr: 'Vie privée' },
  'shared-computers': { en: 'Shared and library computers', de: 'Geteilte und Bibliotheks-Computer', fr: 'Ordinateurs partagés et de bibliothèque' },
  transfers: { en: 'Transfers and encryption', de: 'Übertragung und Verschlüsselung', fr: 'Transferts et chiffrement' },
  'website-checks': { en: 'Website checks', de: 'Website-Prüfungen', fr: 'Vérifications de sites' },
} as const
export type SecurityTopic = keyof typeof SECURITY_TOPICS

export function securityTopicForPath(pathname: string, section?: string): SecurityTopic {
  if (pathname.startsWith('/security/personal') && section) {
    const topics: Record<string, SecurityTopic> = { accounts: 'accounts', email: 'messages', money: 'payments', phone: 'devices', shopping: 'payments', home: 'backups', organise: 'shared-computers', private: 'privacy' }
    return topics[section] ?? 'privacy'
  }
  if (pathname.startsWith('/downloads') || pathname.startsWith('/services/bookmarks')) return 'downloads'
  if (pathname.startsWith('/passphrase') || pathname.startsWith('/spv') || pathname.startsWith('/free') || pathname.startsWith('/redeem')) return 'accounts'
  if (pathname.startsWith('/jobtrack') || pathname.startsWith('/localsync')) return 'backups'
  if (pathname.startsWith('/transfer')) return 'transfers'
  if (pathname.startsWith('/security/notes')) return 'notes'
  if (pathname.startsWith('/security/personal')) return 'privacy'
  if (pathname.startsWith('/security')) return 'website-checks'
  if (pathname.startsWith('/shop')) return 'payments'
  if (pathname.startsWith('/cv') || pathname.startsWith('/cl-gen') || pathname.startsWith('/services/sign') || pathname.startsWith('/privacy')) return 'privacy'
  return 'about'
}

export function securityHref(topic: SecurityTopic, point?: string) { return `/website-security#${topic}${point ? '/' + encodeURIComponent(point) : ''}` }

export function revealSecurityTarget(id: string) {
  const [sectionId, requestedPoint] = id.split('/')
  const pointId = sectionId === 'backups' && requestedPoint === 'jobtrack-backup' ? 'backup-rule' : requestedPoint
  const target = document.getElementById(sectionId)
  if (!target) return
  if (target instanceof HTMLDetailsElement) target.open = true
  document.querySelectorAll('.security-point-highlight').forEach(el => el.classList.remove('security-point-highlight'))
  const point = pointId ? [...target.querySelectorAll<HTMLElement>('[data-security-point]')].find(el => el.dataset.securityPoint === pointId) : null
  point?.querySelector('.security-point-shield')?.classList.add('security-point-highlight')
  // the first point sits directly under the topic header: scroll to the header then (e.g. 'Transfers and encryption'); other points scroll to themselves
  const firstPoint = !!point && target.querySelector('[data-security-point]') === point
  const heading = point && !firstPoint ? point : (target.querySelector(':scope > summary') ?? target)
  let cancelled = false
  const align = () => {
    if (cancelled) return
    const headerBottom = Math.max(0, document.querySelector('.navbar')?.getBoundingClientRect().bottom ?? 0)
    target.style.scrollMarginTop = `${headerBottom + 12}px`
    window.scrollTo({ top: Math.max(0, window.scrollY + heading.getBoundingClientRect().top - headerBottom - 12), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(align) })
  if (document.fonts?.status === 'loading') void document.fonts.ready.then(() => { if (!cancelled) frame = requestAnimationFrame(align) })
  return () => { cancelled = true; cancelAnimationFrame(frame) }
}

export function SecurityTopicIcon({ topic }: { topic: SecurityTopic }) {
  if (topic === 'about') return <ShieldIcon size={22} />
  if (topic === 'accounts') return <PassphraseIcon className="security-passphrase-icon" size={.85} />
  const paths: Partial<Record<SecurityTopic, string>> = {
    'website-checks': 'M3 3h18v18H3V3Zm0 5h18M6 5.5h.01M9 5.5h.01M7 14l3 3 7-6',
    backups: 'M8 8V3h13v13h-5M3 8h13v13H3V8Z',
    devices: 'M7 2h10v20H7V2Zm3 16h4M10 5h4',
    downloads: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    messages: 'M2 5h20v14H2V5Zm0 1 10 7L22 6',
    notes: 'M14 2H4v20h16V8l-6-6Zm0 0v6h6M8 12h8m-8 4h5',
    payments: 'M2 5h20v14H2V5Zm0 5h20M6 15h4',
    privacy: 'M6 10V7a6 6 0 0 1 12 0v3M5 10h14v12H5zM12 15v3',
    'shared-computers': 'M3 3h18v12H3V3Zm4 18h10M12 15v6M7 8h4m2 0h4',
    transfers: 'M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4',
  }
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[topic]} /></svg>
}

// Shared verbatim with Transfer's privacy explanation and the security hub.
// Exact text from the existing Security Playbook, chapter 8.
export const BACKUP_SECURITY_TIPS = {
  "why": [
    "A backup that has never been restored is a hope, not a backup. Ransomware and failed disks are only survivable with a recent copy stored somewhere the attacker or failure can't reach.",
    "Ein Backup, das nie wiederhergestellt wurde, ist eine Hoffnung, kein Backup. Erpressersoftware und defekte Festplatten übersteht man nur mit einer aktuellen Kopie an einem Ort, den Angreifer oder Defekt nicht erreichen.",
    "Une sauvegarde jamais restaurée est un espoir, pas une sauvegarde. On ne survit à un rançongiciel ou à un disque défaillant qu'avec une copie récente, rangée là où l'attaquant ou la panne ne peut l'atteindre."
  ],
  "rule": [
    "Follow 3-2-1: three copies, on two different kinds of storage, one kept offsite.",
    "Folgen Sie 3-2-1: drei Kopien, auf zwei verschiedenen Speicherarten, eine davon ausser Haus.",
    "Suivez la règle 3-2-1: trois copies, sur deux types de stockage différents, dont une hors site."
  ]
} as const

export const TRANSFER_SECURITY_TIPS = {
  files: ['straight from phone to desktop - never a server or cloud.', 'direkt vom Telefon zum Computer - nie ein Server oder eine Cloud.', "directement du téléphone à l'ordinateur - jamais un serveur ni un cloud."],
  locked: ['on one device, unlocked only on the other - your Wi-Fi, hotspot or cable carries locked data only.', 'auf einem Gerät, nur auf dem anderen geöffnet - WLAN, Hotspot oder Kabel tragen nur Verschlossenes.', "sur un appareil, ouvert seulement sur l'autre - Wi-Fi, partage ou câble ne portent que du verrouillé."],
} as const
export const LOCAL_SYNC_TRUSTED_SOURCE = {
  intro: ['You came from the LocalSync app or its App Store listing', 'Du kommst aus der LocalSync-App oder ihrem App-Store-Eintrag', "Vous venez de l'app LocalSync ou de sa page App Store"],
  warning: ["not an email, ad, or a link you don't recognise", 'nicht aus einer E-Mail, einer Werbung oder einem unbekannten Link', "pas d'un e-mail, d'une publicité ou d'un lien que vous ne reconnaissez pas"],
} as const
export const securityText = (text: readonly [string, string, string], lang: Lang) => text[lang === 'de' ? 1 : lang === 'fr' ? 2 : 0]

export function LocalSyncTrustedSourceText() {
  const { lang } = useLanguage()
  return <>{securityText(LOCAL_SYNC_TRUSTED_SOURCE.intro, lang)}<br />- <span className="safety-check-warn">{securityText(LOCAL_SYNC_TRUSTED_SOURCE.warning, lang)}</span>.</>
}

// 2026-10-26 one shared shield: links to the public website security page. Used in the footer and beside every download.
export function ShieldIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-0.2em' }}>
      <path d="M12 2.5 4.5 5.5v6c0 4.6 3.1 8.4 7.5 10 4.4-1.6 7.5-5.4 7.5-10v-6L12 2.5Z" />
      <path d="m8.7 12 2.4 2.4 4.3-4.6" />
    </svg>
  )
}

const LABEL = { en: 'Website security', de: 'Website-Sicherheit', fr: 'Sécurité du site' } as const

export function ShieldLink({ topic = 'about', point, label, iconOnly = false, className = '', size, children }: { topic?: SecurityTopic; point?: string; label?: string; iconOnly?: boolean; className?: string; size?: number; children?: ReactNode }) {
  const { lang } = useLanguage()
  const description = `${LABEL[lang]}: ${SECURITY_TOPICS[topic][lang]}`
  return <a className={`shield-link ${className}`} href={'https://kworld.space' + securityHref(topic, point)} target="_blank" rel="noopener noreferrer" aria-label={description} title={description} onClick={e => e.stopPropagation()} style={iconOnly && !children ? { display: 'inline-flex', verticalAlign: 'middle', alignItems: 'center', marginLeft: '.35rem', color: 'var(--nebula-teal, #00ff41)' } : undefined}>{children ?? <ShieldIcon size={size} />}{!iconOnly && <> {label ?? LABEL[lang]}</>}</a>
}

export const DOWNLOAD_TIPS = {
  en: ['Back up first: copy your files before you run anything', 'Check what you run: compare the checksum on this page, read the script if you can', 'Provided as is: you run it at your own risk'],
  de: ['Zuerst sichern: Dateien kopieren, bevor etwas läuft', 'Prüfen, was läuft: Prüfsumme auf dieser Seite vergleichen, Skript lesen, wenn möglich', 'Wie besehen: Nutzung auf eigenes Risiko'],
  fr: ["Sauvegarde d'abord : copiez vos fichiers avant de lancer quoi que ce soit", 'Vérifiez ce que vous lancez : comparez la somme de contrôle de cette page, lisez le script si possible', 'Fourni tel quel : à vos risques'],
}

// Placed beside every download.
export function DownloadTips() {
  return (
    <div className="dl-tips" style={{ margin: '0.6rem auto 1.2rem', maxWidth: 520, fontSize: '0.85rem', textAlign: 'left', opacity: 0.9 }}>
      <ShieldLink topic="downloads" />
    </div>
  )
}

// Same gift SVG as JobTrack's feedback incentive.
export function GiftIcon({ className = '', size = 24 }: { className?: string; size?: number }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
}
