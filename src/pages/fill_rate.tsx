import { useEffect, useState } from 'react'

// 2026-10-15 owner: users rate the form FILLER - how well JobTrack filled their country's form.
// Anonymous (no email); the best-rated country fills (and later their contributors) earn the bragging rights.
const KEY = 'kworld_jobtrack_rated'

export default function FillRate({ country, t }: { country: string; t: (k: string) => string }) {
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(() => { try { return localStorage.getItem(KEY + country) === new Date().toISOString().slice(0, 10) } catch { return false } })
  const [avg, setAvg] = useState<{ n: number; avg: number } | null>(null)
  useEffect(() => { fetch('/api/fill-rating?country=' + country).then(r => r.json()).then(setAvg).catch(() => {}) }, [country])
  async function send() {
    if (!stars) return
    try {
      await fetch('/api/fill-rating', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ country, stars, comment }) })
      localStorage.setItem(KEY + country, new Date().toISOString().slice(0, 10))
    } catch { /* offline - the rating is optional */ }
    setSent(true)
  }
  if (sent) return <p className="jr-rate-thanks">{t('rate.thanks')}</p>
  return (
    <div className="jr-rate">
      <p className="orp-share-q">{t('rate.q')}{avg && avg.n > 0 ? <span className="jr-rate-avg"> {'\u2605'} {avg.avg} ({avg.n})</span> : null}</p>
      <div className="orp-stars" role="radiogroup" aria-label={t('rate.q')}>
        {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" role="radio" aria-checked={stars === n} className={n <= stars ? 'on' : ''} onClick={() => setStars(n)}>{'\u2605'}</button>)}
      </div>
      {stars > 0 && <>
        <textarea rows={2} maxLength={300} placeholder={t('rate.comment')} value={comment} onChange={e => setComment(e.target.value)} />
        <button type="button" className="btn-secondary" onClick={send}>{t('rate.send')}</button>
      </>}
    </div>
  )
}
