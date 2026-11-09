// 2026-10-08 owner: "make the passphrase svg image universally 4 blocks with
// 3 hyphens" - one icon for every passphrase mention (passphrase page, login
// ranking, services card, personal checklist, shop). Outline blocks = words,
// short lines between = the hyphens, as in Correct1-horse-battery-staple.
// The original from /passphrase's "Why passphrases beat passwords" block,
// moved here unchanged so every page draws the same icon.

/** Standalone icon, 2:1 so the four blocks stay readable. */
export default function PassphraseIcon({ className, size = 1 }: { className?: string; size?: number }) {
  return (
    <svg className={className} viewBox="0 0 32 16" width={`${2.2 * size}em`} height={`${1.1 * size}em`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <rect x="0.8" y="4" width="4.9" height="8" rx="1.8" />
      <rect x="9.3" y="4" width="4.9" height="8" rx="1.8" />
      <rect x="17.8" y="4" width="4.9" height="8" rx="1.8" />
      <rect x="26.3" y="4" width="4.9" height="8" rx="1.8" />
      <path d="M6.8 8h1.4M15.3 8h1.4M23.8 8h1.4" />
    </svg>
  )
}

