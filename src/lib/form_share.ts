// 2026-10-15 owner: contributors share their country's logged-in job-entry form. The bookmarklet
// reads ONLY field names - labels, ids, types, dropdown option texts - never what is typed in, so
// nothing personal leaves the agency site. The list goes to the clipboard; the person checks it on
// kworld.space before anything is sent.
export function scanForm(): string {
  const out: { label: string; id: string; name: string; type: string; options?: string[] }[] = []
  const label = (el: Element) => {
    const id = el.getAttribute('id')
    const l = (id && document.querySelector('label[for="' + id.replace(/"/g, '') + '"]')) || el.closest('label')
    return ((l && l.textContent) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 120)
  }
  document.querySelectorAll('input, select, textarea').forEach(el => {
    const type = (el.getAttribute('type') || el.tagName).toLowerCase()
    if (['hidden', 'password', 'submit', 'button'].includes(type)) return
    const row: { label: string; id: string; name: string; type: string; options?: string[] } = { label: label(el), id: (el.getAttribute('id') || '').slice(0, 120), name: (el.getAttribute('name') || '').slice(0, 80), type }
    if (el.tagName === 'SELECT') row.options = Array.from((el as HTMLSelectElement).options).map(o => (o.textContent || '').trim()).filter(Boolean).slice(0, 40)
    out.push(row)
  })
  return JSON.stringify({ formshare: 1, site: location.hostname, scanned: new Date().toISOString().slice(0, 10), fields: out })
}

export function shareBookmarklet(_origin?: string): string {
  const body = `(async()=>{const s=(${scanForm.toString()})();const n=JSON.parse(s).fields.length;if(n<8&&!confirm('Only '+n+' fields on this page.\\n\\nOK = copy it anyway (one page of a longer form)\\nCancel = stop (wrong page: open the screen where you ADD one job search)'))return;try{await navigator.clipboard.writeText(s);alert('Success! This page is copied ('+JSON.parse(s).fields.length+' fields).\\n\\nTap OK -> return to JobTrack -> paste.\\nMore than one page? Repeat for each page.')}catch(e){prompt('Copy this (Ctrl+C), then paste it into JobTrack:',s)}})()`
  return 'javascript:void(' + encodeURIComponent(body.replace(/\n/g, '')) + ')'
}
