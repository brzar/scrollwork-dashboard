import { SelectHTMLAttributes, forwardRef } from "react";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className = "", ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={`bg-panel rounded-lg text-[13.5px] px-3 py-2 h-9 text-ink-900 shadow-card hover:shadow-card-lg focus:shadow-card-lg focus:outline-none transition-shadow ${className}`}
      {...rest}
    />
  );
});
