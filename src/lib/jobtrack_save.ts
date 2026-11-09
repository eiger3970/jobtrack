// "Save job to JobTrack" bookmark (2026-11-03 owner: capture the job page at the moment of applying, on any company or agency site).
// Runs on the job page: reads the page address, title and - where the site publishes it - the schema.org JobPosting data
// (company, job title, town), then opens a small kworld window that writes it into JobTrack. Plain browser JS, no imports.
export function saveJobPage(origin: string): void {
  const clean = (u: string) => { try { const x = new URL(u); for (const k of [...x.searchParams.keys()]) if (/^utm_/i.test(k) || k === 'applySourceOverride') x.searchParams.delete(k); return x.toString() } catch { return u } }
  const d: Record<string, string> = { u: clean(location.href), t: document.title.slice(0, 200) }
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    const o = n as Record<string, unknown>
    const type = o['@type']
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) {
      const org = o.hiringOrganization as Record<string, unknown> | string | undefined
      d.c = (typeof org === 'string' ? org : (org && String(org.name || ''))) || d.c || ''
      d.r = String(o.title || d.r || '')
      const loc = (Array.isArray(o.jobLocation) ? o.jobLocation[0] : o.jobLocation) as Record<string, unknown> | undefined
      const adr = loc && (loc.address as Record<string, unknown> | undefined)
      if (adr) { d.p = String(adr.postalCode || ''); d.y = String(adr.addressLocality || ''); d.s = String(adr.streetAddress || '') }
    }
    Object.values(o).forEach(walk)
  }
  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => { try { walk(JSON.parse(s.textContent || '')) } catch { /* not valid JSON */ } })
  // the window opens at once (a click is needed for that), then gets the address when the job data is ready
  const w = window.open('', 'jobtracksave', 'width=360,height=200')
  const finish = () => { const url = origin + '/jobtrack_save.html#' + encodeURIComponent(JSON.stringify(d)); if (w) w.location.href = url; else window.open(url, 'jobtracksave', 'width=360,height=200') }
  // 2026-11-03 Job-Room pages carry no job data in the page itself (title is just "Search job"): ask Job-Room's public job-ad service
  const jr = /job-room\.ch\/job-search\/([0-9a-f-]{36})/i.exec(location.href)
  if (jr) {
    fetch('/jobadservice/api/jobAdvertisements/' + jr[1], { headers: { accept: 'application/json' } }).then(r => r.json()).then(j => {
      const jc = (j && j.jobContent) || {}, co = jc.company || {}, desc = (jc.jobDescriptions || [])[0] || {}
      const ch = jc.applyChannel || {}, pa = ch.postAddress || co, pc = jc.publicContact || {}
      if (co.name) d.c = String(co.name)
      if (desc.title) d.r = String(desc.title)
      if (pa.postalCode) d.p = String(pa.postalCode)
      if (pa.city) d.y = String(pa.city)
      if (pa.street) { d.s = String(pa.street); if (pa.houseNumber) d.n = String(pa.houseNumber) }
      const mail = ch.emailAddress || pc.email
      if (mail) d.e = String(mail)
      if (ch.phoneNumber || pc.phone) d.h = String(ch.phoneNumber || pc.phone)
      const who = [pc.firstName, pc.lastName].filter(Boolean).join(' ')
      if (who) d.k = who
      if (ch.formUrl) d.f = String(ch.formUrl)
      if (pa.postOfficeBoxNumber) d.b = String(pa.postOfficeBoxNumber)
      if (pa.countryIsoCode && String(pa.countryIsoCode).toUpperCase() !== 'CH') d.o = String(pa.countryIsoCode)
      const em = jc.employment || {}
      if (em.workloadPercentageMax) d.w = String(em.workloadPercentageMax)
    }).catch(() => { /* keep what the page gave */ }).then(finish)
  } else finish()
}
export function saveBookmarklet(origin: string): string {
  const body = '(' + saveJobPage.toString() + ')(' + JSON.stringify(origin) + ')'
  return 'javascript:void(' + encodeURIComponent(body.replace(/\n/g, ' ')) + ')'
}
