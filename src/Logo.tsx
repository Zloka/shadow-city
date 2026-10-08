/** Half sun, half shadow. Also the favicon. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <g transform="rotate(-40 16 16)">
        <circle cx="16" cy="16" r="14" fill="#1e2747" />
        <path d="M16 2a14 14 0 0 0 0 28z" fill="#fbbf24" />
      </g>
    </svg>
  )
}
