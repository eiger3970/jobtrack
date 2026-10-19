// The picture of a button being dragged up into the browser's bookmarks bar (also used by the Job-Room set-up step)
export default function BookmarkPic({ barLabel, button }: { barLabel: string; button: string }) {
  // the label shrinks to fit the left part of the bar (long German/French labels) so it never runs into the target box
  const fs = Math.min(10, 170 / (barLabel.length * 0.6))
  return (
    <svg viewBox="0 0 320 120" className="orp-setup-pic" role="img" aria-label={barLabel}>
      <rect x="6" y="6" width="308" height="108" rx="8" fill="#0f0d1c" stroke="#2a2a3a" />
      <rect x="6" y="6" width="308" height="22" rx="8" fill="#1a1a2a" />
      <text x="14" y="21" fontSize={fs} fill="#d0d0e0">{barLabel}</text>
      <rect x="206" y="10" width="82" height="14" rx="4" fill="none" stroke="#00ff41" strokeDasharray="3 2" />
      <text x="247" y="21" fontSize="9" textAnchor="middle" fill="#00ff41">{button}</text>
      <rect x="40" y="76" width="110" height="26" rx="6" fill="#00ff41" />
      <text x="95" y="93" fontSize="11" textAnchor="middle" fill="#03020a" fontWeight="700">{button}</text>
      <path d="M118 74 C 160 48, 210 50, 238 32" fill="none" stroke="#f0eeff" strokeWidth="2" strokeDasharray="5 4" />
      <path d="M232 30 L240 31 L237 38" fill="none" stroke="#f0eeff" strokeWidth="2" />
      <path d="M128 88 l0 14 l4 -4 l3 6 l3 -1 l-3 -6 l5 0 z" fill="#f0eeff" stroke="#03020a" strokeWidth="0.8" />
    </svg>
  )
}
