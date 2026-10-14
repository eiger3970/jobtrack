// 2026-10-14 owner: "is this the same image as /transfer, are you reinventing
// the wheel?" - one drawing for both pages. Phone (green) and computer (blue)
// with the lock and passphrase symbol on the line between them: the key only
// ever lives on those two. The server above:
//  - direct (/transfer): passes a short note so the devices find each other;
//    the files go straight between them.
//  - relay (JobTrack sync): passes the list on, but only locked - the dashed
//    lines carry small locks instead of notes.

const PHONE_D = 'M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z'
const PC_D = 'M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z'

// small padlock sealing an envelope (relay: the list travels inside, locked)
const SealLock = ({ x, y }: { x: number; y: number }) => (
  <g>
    <rect x={x} y={y + 3} width="9" height="7" rx="1.5" fill="#00ff41" stroke="#03020a" strokeWidth="0.8" />
    <path d={`M${x + 2} ${y + 3.5}v-1.6a2.5 2.5 0 0 1 5 0v1.6`} fill="none" stroke="#00ff41" strokeWidth="1.3" />
  </g>
)

// a page whose "text" is rows of passphrase blocks (short first line, longer ones below)
function LockedList({ x, y, small = false }: { x: number; y: number; small?: boolean }) {
  const rows = small ? [3, 5, 4] : [4, 7, 5, 6]
  return (
    <g>
      <path d={small ? `M${x} ${y}h12l4 4v15h-16z` : `M${x} ${y}h16l5 5v22h-21z`} fill="#03020a" stroke={small ? '#8a86a8' : '#f0eeff'} strokeWidth="1.4" strokeLinejoin="round" />
      {rows.map((n, r) => (
        <g key={r}>
          {/* the hyphen line joining the blocks, like the passphrase symbol */}
          <path d={`M${x + 3.3} ${y + 7.8 + r * 5}h${(n - 1) * 2.25}`} stroke="#00ff41" strokeWidth="0.45" />
          {Array.from({ length: n }, (_, i) => (
            <rect key={i} x={x + 2.6 + i * 2.25} y={y + 6.5 + r * 5} width="1.4" height="2.6" rx="0.5" fill="#00ff41" />
          ))}
        </g>
      ))}
    </g>
  )
}

export default function SyncFlow({ variant, label, lockTip, onLock, lockExpanded, className = 'trx-flow' }: {
  variant: 'direct' | 'relay'; label: string; lockTip: string; onLock?: () => void; lockExpanded?: boolean; className?: string
}) {
  return (
    <svg className={className} viewBox="0 0 300 136" role="group" aria-label={label}>
      {/* 2026-10-14 owner: the server as a server inside the internet globe */}
      <g fill="none" stroke="#8a86a8" strokeWidth="1.3">
        <circle cx="150" cy="25" r="22" fill="#0f0d1c" strokeWidth="1.6" />
        <ellipse cx="150" cy="25" rx="10" ry="22" opacity="0.6" />
        <path d="M128 25h44M131 14h38M131 36h38" opacity="0.6" />
      </g>
      <g fill="#0f0d1c" stroke="#f0eeff" strokeWidth="1.3">
        <rect x="139" y="15" width="22" height="8" rx="1.5" /><rect x="139" y="25" width="22" height="8" rx="1.5" />
      </g>
      <circle cx="143.5" cy="19" r="1.2" fill="#00ff41" /><circle cx="143.5" cy="29" r="1.2" fill="#00ff41" />
      <path d="M44 81L131 38M262 86L169 38" stroke="#8a86a8" strokeWidth="1.6" strokeDasharray="4 4" />
      {/* envelopes on the way up: /transfer = the introduction note; JobTrack = the list, sealed with a lock */}
      {variant === 'direct' ? (<>
        {/* /transfer: the setup note - how phone and computer reach each other, no files */}
        <rect x="70" y="50" width="16" height="11" rx="2" fill="#03020a" stroke="#8a86a8" strokeWidth="1.4" /><path d="M70 51l8 5 8-5" fill="none" stroke="#8a86a8" strokeWidth="1.2" />
        <rect x="214" y="50" width="16" height="11" rx="2" fill="#03020a" stroke="#8a86a8" strokeWidth="1.4" /><path d="M214 51l8 5 8-5" fill="none" stroke="#8a86a8" strokeWidth="1.2" />
      </>) : (<>
        {/* JobTrack: the server only ever carries the list, locked */}
        <LockedList x={68} y={44} small />
        <SealLock x={80} y={58} />
        <LockedList x={212} y={44} small />
        <SealLock x={224} y={58} />
      </>)}
      <svg x="16" y="80" width="40" height="40" viewBox="0 0 24 24"><path fill="#00ff41" d={PHONE_D} /></svg>
      <svg x="244" y="80" width="40" height="40" viewBox="0 0 24 24"><path fill="#4488ff" d={PC_D} /></svg>
      <path d="M47.7 104H247.3" stroke="#00ff41" strokeWidth="3" strokeDasharray={variant === 'relay' ? '2 6' : undefined} strokeLinecap="round" />
      <g className="trx-flow-lock" role="button" tabIndex={0} aria-expanded={lockExpanded} aria-label={lockTip}
        onClick={onLock} onKeyDown={e => { if (onLock && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onLock() } }}>
        <title>{lockTip}</title>
        <rect x="128" y="80" width="44" height="40" fill="transparent" />
        {/* 2026-10-14 owner: a KEY, not a padlock - one shared secret key, handed over in the QR code;
            its teeth are passphrase blocks */}
        <circle cx="140" cy="104" r="8" fill="none" stroke="#00ff41" strokeWidth="3.2" />
        <circle cx="140" cy="104" r="2.6" fill="#00ff41" />
        <path d="M148 104H171" stroke="#00ff41" strokeWidth="3.4" strokeLinecap="round" />
        {[153, 158.5, 164].map(x => <rect key={x} x={x} y="105.5" width="3.6" height="6" rx="1.2" fill="#00ff41" />)}
      </g>
      {/* 2026-10-14 owner: the list itself, locked - lines of mini passphrase blocks instead of text */}
      {/* /transfer only: the files go straight along the bottom line, locked. JobTrack's list
          never goes direct - there the line only means "these two share the key". */}
      {variant === 'direct' && <><LockedList x={90} y={90} /><LockedList x={186} y={90} /></>}
    </svg>
  )
}
