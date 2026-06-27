/* eslint-disable @next/next/no-img-element */

/**
 * Scrollwork logo. The source art (public/Blue.png) has a white
 * background, so we present it on a rounded white tile — reads cleanly in
 * both light and dark mode.
 */
export function Logo({
  size = 28,
  className = "",
  rounded = "rounded-lg",
}: {
  size?: number;
  className?: string;
  rounded?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ${rounded} ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/Blue.png"
        alt="Scrollwork"
        width={size}
        height={size}
        className="h-full w-full object-contain"
      />
    </span>
  );
}
