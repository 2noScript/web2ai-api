import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";

export function Button({
  className,
  variant = "default",
  size = "default",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
  children: ReactNode;
}) {
  const variants = {
    default: "bg-primary text-primary-foreground hover:opacity-90",
    outline: "border border-border bg-transparent text-foreground hover:bg-secondary",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  };
  const sizes = {
    default: "h-9 px-4 text-sm",
    sm: "h-8 px-3 text-xs",
    lg: "h-10 px-5 text-sm",
  };
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
