/**
 * Scrollwork logo — a blue refresh ring with a play triangle.
 * Pure SVG so it stays crisp at any size and needs no asset file.
 */
export function Logo({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Scrollwork"
    >
      <defs>
        <linearGradient
          id="sw-logo-grad"
          x1="8"
          y1="5"
          x2="40"
          y2="43"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#46A0FF" />
          <stop offset="1" stopColor="#1A6CE6" />
        </linearGradient>
      </defs>
      {/* Circular refresh ring with a gap at the top. */}
      <path
        d="M30.8 9.4 A16.5 16.5 0 1 1 17.2 9.4"
        stroke="url(#sw-logo-grad)"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      {/* Arrowhead capping the ring at the top-right. */}
      <path d="M28.6 3.2 L37 9.2 L28.6 14 Z" fill="url(#sw-logo-grad)" />
      {/* Play triangle in the center. */}
      <path
        d="M20.5 16.8 L20.5 31.2 L32 24 Z"
        fill="url(#sw-logo-grad)"
        strokeLinejoin="round"
      />
    </svg>
  );
}
