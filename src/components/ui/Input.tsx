import { InputHTMLAttributes, forwardRef } from "react";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = "", ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={`bg-panel rounded-lg text-[13.5px] px-3 py-2 h-9 text-ink-900 placeholder:text-ink-400 shadow-card hover:shadow-card-lg focus:shadow-card-lg focus:outline-none transition-shadow ${className}`}
      {...rest}
    />
  );
});
