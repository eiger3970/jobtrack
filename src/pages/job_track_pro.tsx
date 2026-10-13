import { Capacitor } from '@capacitor/core'
import { buyPro, makeL, ProBox, useProKey } from '../lib/pro'

// 2026-10-06: JobTrack Pro, $5 once (Kevin: "More Pro tiers", like
// Transfer Pro). Everything in the free JobTrack stays free forever - Pro
// only adds: what's working (reply rate, best CV), follow-ups in your own
// calendar. All worked out in this browser; no application data leaves it.

const PRO_KEY = 'kworld_jobtrack_pro'
const PRO_CHF = 5
const SCOPE = `jobtrack-pro-${PRO_CHF}`

interface App { id: number; company: string; role: string; date: string; status: string; cv: string; cover: string; nextDate: string; notes: string }

const REPLIED = ['screening', 'interview', 'technical', 'offer', 'accepted', 'rejected']
const INTERVIEWED = ['interview', 'technical', 'offer', 'accepted']
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)

// Which CV (or cover letter) version gets the most replies - 2+ uses only.
function best(apps: App[], field: 'cv' | 'cover') {
  const by = new Map<string, { n: number; replied: number }>()
  for (const a of apps) {
    const k = a[field].trim()
    if (!k) continue
    const s = by.get(k) ?? { n: 0, replied: 0 }
    s.n++; if (REPLIED.includes(a.status)) s.replied++
    by.set(k, s)
  }
  return [...by.entries()].filter(([, s]) => s.n >= 2)
    .map(([name, s]) => ({ name, n: s.n, rate: pct(s.replied, s.n) }))
    .sort((a, b) => b.rate - a.rate || b.n - a.n)[0]
}

// One .ics file with every follow-up still ahead, 09:00 with a reminder.
function calendarFile(apps: App[], L: ReturnType<typeof makeL>) {
  const today = new Date().toISOString().slice(0, 10)
  const esc = (s: string) => s.replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const events = apps.filter(a => a.nextDate && a.nextDate >= today).map(a => {
    const d = a.nextDate.replace(/-/g, '')
    return ['BEGIN:VEVENT', `UID:jobtrack-${a.id}-${d}@kworld.space`, `DTSTAMP:${stamp}`,
      `DTSTART:${d}T090000`, `DTEND:${d}T093000`,
      `SUMMARY:${esc(L('Follow up', 'Nachfassen', 'Relancer') + ': ' + a.company + (a.role ? ' - ' + a.role : ''))}`,
      'BEGIN:VALARM', 'TRIGGER:-PT0M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(a.company)}`, 'END:VALARM', 'END:VEVENT'].join('\r\n')
  })
  return { count: events.length, text: ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//kworld.space//JobTrack//EN', ...events, 'END:VCALENDAR'].join('\r\n') }
}

export default function JobTrackPro({ apps, lang }: { apps: App[]; lang: string }) {
  const L = makeL(lang)
  // App Store build: paid once at download, so Pro is included - Apple allows
  // no PayPal / Lightning purchase inside an app (guideline 3.1.1).
  const { pro: webPro } = useProKey(PRO_KEY, 'jobtrack-pro-')
  const pro = webPro || Capacitor.isNativePlatform()
  const total = apps.length
  const replied = apps.filter(a => REPLIED.includes(a.status)).length
  const interviewed = apps.filter(a => INTERVIEWED.includes(a.status)).length
  const today = new Date().toISOString().slice(0, 10)
  const overdue = apps.filter(a => a.nextDate && a.nextDate < today && !['accepted', 'rejected'].includes(a.status)).length
  const bestCv = best(apps, 'cv'), bestCover = best(apps, 'cover')
  const cal = calendarFile(apps, L)

  function downloadCalendar() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([cal.text], { type: 'text/calendar' }))
    a.download = 'jobtrack_follow_ups.ics'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 30000)
  }

  const cards = [
    { k: L('Replies', 'Antworten', 'Réponses'), v: `${pct(replied, total)}%`, s: L(`${replied} of ${total} answered`, `${replied} von ${total} beantwortet`, `${replied} sur ${total} ont répondu`) },
    { k: L('Interviews', 'Interviews', 'Entretiens'), v: `${pct(interviewed, total)}%`, s: L(`${interviewed} reached an interview`, `${interviewed} bis zum Interview`, `${interviewed} jusqu'à l'entretien`) },
    { k: L('Best CV', 'Bester Lebenslauf', 'Meilleur CV'), v: bestCv ? `${bestCv.rate}%` : '-', s: bestCv ? `${bestCv.name} · ${bestCv.n}x` : L('Name your CV versions', 'CV-Versionen benennen', 'Nommez vos versions de CV') },
    { k: L('Best cover letter', 'Bestes Anschreiben', 'Meilleure lettre'), v: bestCover ? `${bestCover.rate}%` : '-', s: bestCover ? `${bestCover.name} · ${bestCover.n}x` : L('Name your letter versions', 'Anschreiben-Versionen benennen', 'Nommez vos versions de lettre') },
    { k: L('Follow-ups overdue', 'Nachfassen überfällig', 'Relances en retard'), v: String(overdue), s: L('Next date passed, still open', 'Datum vorbei, noch offen', 'Date passée, toujours ouvert') },
  ]

  return (
    <section className={`jt-pro${pro ? '' : ' jt-pro-locked'}`}>
      <h2 className="jt-pro-h">{L("What's working", 'Was funktioniert', 'Ce qui marche')} <span className="jt-pro-tag">Pro</span></h2>
      <div className="jt-pro-cards" aria-hidden={!pro}>
        {cards.map(c => (
          <div key={c.k} className="jt-pro-card"><div className="jt-pro-k">{c.k}</div><div className="jt-pro-v">{pro ? c.v : '00%'}</div><div className="jt-pro-s">{pro ? c.s : '······'}</div></div>
        ))}
      </div>
      {pro ? (
        <div className="jt-pro-cal">
          <button type="button" className="btn-secondary export-btn" onClick={downloadCalendar} disabled={!cal.count}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><path d="M12 14v4M10 16h4" /></svg>
            <span>{L(`Add ${cal.count} follow-ups to my calendar`, `${cal.count} Nachfass-Termine in meinen Kalender`, `Ajouter ${cal.count} relances à mon calendrier`)}</span>
          </button>
          <p className="jt-pro-hint">{L('Opens in your phone or computer calendar - a reminder at 9:00 on each Next date. Download again after changes.', 'Öffnet sich im Kalender von Telefon oder Computer - Erinnerung um 9:00 an jedem Nächsten Datum. Nach Änderungen neu laden.', "S'ouvre dans le calendrier du téléphone ou de l'ordinateur - rappel à 9h00 à chaque date Suivante. Retéléchargez après chaque changement.")}</p>
        </div>
      ) : (
        <ProBox L={L} title="JobTrack Pro" amount={PRO_CHF}
          why={L('See which CV and letter actually get replies, and never miss a follow-up - so every application counts.', 'Sieh, welcher Lebenslauf und welches Anschreiben wirklich Antworten bekommen, und verpasse kein Nachfassen - damit jede Bewerbung zählt.', "Voyez quel CV et quelle lettre obtiennent vraiment des réponses, et ne manquez aucune relance - pour que chaque candidature compte.")}
          get={[
            L('Best CV and cover letter - which version gets the most replies', 'Bester Lebenslauf und Anschreiben - welche Version die meisten Antworten bekommt', 'Meilleur CV et lettre - quelle version obtient le plus de réponses'),
            L('Calendar, every follow-up with a 9:00 reminder - phone or computer', 'Kalender, jedes Nachfassen mit Erinnerung um 9:00 - Telefon oder Computer', 'Calendrier, chaque relance avec rappel à 9h00 - téléphone ou ordinateur'),
            L('Reply and interview rates, worked out for you', 'Antwort- und Interviewquote, für dich berechnet', "Taux de réponse et d'entretien, calculés pour vous"),
            L('Overdue follow-ups, counted so none slip', 'Überfälliges Nachfassen, gezählt, damit nichts untergeht', 'Relances en retard, comptées pour ne rien oublier'),
          ]}
          never={[
            L('Applications, never leave this browser', 'Bewerbungen, verlassen nie diesen Browser', 'Candidatures, ne quittent jamais ce navigateur'),
            L('Free features, never taken away - JobTrack stays free', 'Gratis-Funktionen, nie weggenommen - JobTrack bleibt gratis', 'Fonctions gratuites, jamais retirées - JobTrack reste gratuit'),
            L('Payments, never again - one time only', 'Zahlungen, nie wieder - nur einmal', 'Paiements, plus jamais - une seule fois'),
          ]}
          onBuy={() => buyPro({ scope: SCOPE, amount: PRO_CHF, title: 'JobTrack Pro', subtitle: L('Best CV + reply rates + calendar follow-ups, for good', 'Bester Lebenslauf + Antwortquoten + Kalender, für immer', 'Meilleur CV + taux de réponse + relances au calendrier, pour toujours') })} />
      )}
    </section>
  )
}
