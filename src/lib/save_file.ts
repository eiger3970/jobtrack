import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

// One call for "give the user this file": on the phone the iOS share sheet
// (Save to Files, Mail, AirDrop), in a browser a plain download.
export async function saveFile(name: string, data: Uint8Array | string, mime: string): Promise<void> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  if (Capacitor.isNativePlatform()) {
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const res = await Filesystem.writeFile({ path: name, data: btoa(bin), directory: Directory.Cache })
    await Share.share({ title: name, url: res.uri })
    return
  }
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
