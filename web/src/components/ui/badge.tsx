import type { HTMLAttributes } from "react";
import { clsx } from "clsx";

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "secondary" | "outline" }) {
  const styles =
    variant === "secondary"
      ? "bg-secondary text-secondary-foreground border-transparent"
      : variant === "outline"
        ? "border-border text-muted-foreground bg-transparent"
        : "bg-primary/15 text-primary border-primary/30";
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles,
        className,
      )}
      {...props}
    />
  );
}
