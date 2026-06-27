/* eslint-disable @next/next/no-img-element */

/** Scrollwork logo — public/Blue.png, shown exactly as uploaded. */
export function Logo({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/Blue.png"
      alt="Scrollwork"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
