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

// small padlock for the relay paths
const MiniLock = ({ x, y }: { x: number; y: number }) => (
  <g>
    <rect x={x} y={y + 4} width="14" height="11" rx="2" fill="#00ff41" />
    <path d={`M${x + 3} ${y + 5}v-2.5a4 4 0 0 1 8 0v2.5`} fill="none" stroke="#00ff41" strokeWidth="1.8" />
  </g>
)

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
      {variant === 'relay' && <MiniLock x={157} y={22} />}
      <path d="M44 80L131 38M256 80L169 38" stroke="#8a86a8" strokeWidth="1.6" strokeDasharray="4 4" />
      {variant === 'direct' ? (<>
        <rect x="70" y="50" width="16" height="11" rx="2" fill="#03020a" stroke="#8a86a8" strokeWidth="1.4" /><path d="M70 51l8 5 8-5" fill="none" stroke="#8a86a8" strokeWidth="1.2" />
        <rect x="214" y="50" width="16" height="11" rx="2" fill="#03020a" stroke="#8a86a8" strokeWidth="1.4" /><path d="M214 51l8 5 8-5" fill="none" stroke="#8a86a8" strokeWidth="1.2" />
      </>) : (<>
        <MiniLock x={71} y={46} />
        <MiniLock x={215} y={46} />
      </>)}
      <svg x="16" y="80" width="40" height="40" viewBox="0 0 24 24"><path fill="#00ff41" d={PHONE_D} /></svg>
      <svg x="244" y="80" width="40" height="40" viewBox="0 0 24 24"><path fill="#4488ff" d={PC_D} /></svg>
      <path d="M47.7 104H247.3" stroke="#00ff41" strokeWidth="3" strokeDasharray={variant === 'relay' ? '2 6' : undefined} strokeLinecap="round" />
      <g className="trx-flow-lock" role="button" tabIndex={0} aria-expanded={lockExpanded} aria-label={lockTip}
        onClick={onLock} onKeyDown={e => { if (onLock && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onLock() } }}>
        <title>{lockTip}</title>
        <rect x="128" y="80" width="44" height="40" fill="transparent" />
        <rect x="139" y="95" width="22" height="18" rx="3" fill="#00ff41" /><path d="M143 96v-5a7 7 0 0 1 14 0v5" fill="none" stroke="#00ff41" strokeWidth="2.6" />
        {/* the passphrase symbol inside the lock (4 blocks, 3 hyphens - components/passphrase_icon.tsx) */}
        <svg x="141.5" y="99.5" width="17" height="8.5" viewBox="0 0 32 16" fill="none" stroke="#03020a" strokeWidth="2.6" strokeLinecap="round"><rect x="0.8" y="4" width="4.9" height="8" rx="1.8" /><rect x="9.3" y="4" width="4.9" height="8" rx="1.8" /><rect x="17.8" y="4" width="4.9" height="8" rx="1.8" /><rect x="26.3" y="4" width="4.9" height="8" rx="1.8" /><path d="M6.8 8h1.4M15.3 8h1.4M23.8 8h1.4" /></svg>
      </g>
      <path d="M96 97h12l4 4v12h-16z" fill="#03020a" stroke="#f0eeff" strokeWidth="1.4" /><path d="M192 97h12l4 4v12h-16z" fill="#03020a" stroke="#f0eeff" strokeWidth="1.4" />
    </svg>
  )
}
