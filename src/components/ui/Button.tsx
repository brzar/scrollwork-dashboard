import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const base =
  "inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed select-none";

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-[12.5px] h-8",
  md: "px-4 py-2 text-[13.5px] h-9",
};

const variants: Record<Variant, string> = {
  primary:
    "bg-ink-900 text-ink-50 shadow-button hover:bg-ink-800 active:bg-ink-950",
  secondary:
    "bg-panel text-ink-800 shadow-card hover:bg-ink-100 active:bg-ink-200",
  ghost: "bg-transparent text-ink-700 hover:bg-ink-100 hover:text-ink-900",
  danger: "bg-red-600 text-white shadow-button hover:bg-red-700",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", className = "", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...rest}
    />
  );
});
