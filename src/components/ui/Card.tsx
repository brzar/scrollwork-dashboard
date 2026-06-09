import { HTMLAttributes } from "react";

/**
 * Surface primitive. Modeled on Linear / Spotify-for-Creators: large
 * radius, feather-light border-as-shadow (no aggressive 1px line), no
 * decoration.
 */
export function Card({
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-panel rounded-2xl shadow-card ${className}`}
      {...rest}
    />
  );
}

export function CardHeader({
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`px-6 pt-5 pb-4 border-b border-ink-100 ${className}`}
      {...rest}
    />
  );
}

export function CardTitle({
  className = "",
  ...rest
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={`text-[15px] font-semibold text-ink-900 tracking-tightish ${className}`}
      {...rest}
    />
  );
}

export function CardBody({
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-6 ${className}`} {...rest} />;
}
