// Website copy: a plain browser download. The JobTrack app's copy opens the
// iOS share sheet instead - same function names, so the tracker pages match.
export async function saveFile(name: string, data: Uint8Array | string, mime: string): Promise<void> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// YYYYMMDDhhmm - owner's file naming
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`
}
