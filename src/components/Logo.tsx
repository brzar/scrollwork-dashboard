/* eslint-disable @next/next/no-img-element */

/** Scrollwork logo — public/logo.png (transparent), shown as-is. */
export function Logo({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/logo.png"
      alt="Scrollwork"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
