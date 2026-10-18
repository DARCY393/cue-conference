import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  accent: "btn-accent",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
};

/** Shared classnames for anything styled like a Cue button (incl. next/link CTAs). */
export function buttonClasses(variant: ButtonVariant = "primary", className = ""): string {
  return `${VARIANT_CLASSES[variant]} ${className}`.trim();
}

export function Button({
  variant = "primary",
  fullWidth = false,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  fullWidth?: boolean;
}) {
  return (
    <button
      className={buttonClasses(variant, `${fullWidth ? "w-full" : ""} ${className}`.trim())}
      {...rest}
    />
  );
}
