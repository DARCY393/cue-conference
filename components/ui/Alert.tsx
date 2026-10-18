import type { HTMLAttributes, ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from "lucide-react";

export type AlertTone = "info" | "success" | "warning" | "danger";

const TONE_CONFIG: Record<AlertTone, { bg: string; fg: string; icon: LucideIcon }> = {
  info: { bg: "bg-cue-navy-050", fg: "text-cue-navy-600", icon: Info },
  success: { bg: "bg-cue-green-100", fg: "text-cue-green-600", icon: CheckCircle2 },
  warning: { bg: "bg-cue-amber-100", fg: "text-cue-amber-600", icon: AlertTriangle },
  danger: { bg: "bg-cue-red-100", fg: "text-cue-red-600", icon: AlertCircle },
};

export function Alert({
  title,
  children,
  tone = "info",
  onDismiss,
  className = "",
  ...rest
}: {
  title?: string;
  children?: ReactNode;
  tone?: AlertTone;
  onDismiss?: () => void;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "title">) {
  const t = TONE_CONFIG[tone];
  const Icon = t.icon;
  return (
    <div
      role="status"
      className={`flex gap-3 rounded-tile p-4 ${t.bg} text-cue-stone-700 ${className}`.trim()}
      {...rest}
    >
      <Icon aria-hidden className={`mt-0.5 h-[19px] w-[19px] shrink-0 ${t.fg}`} />
      <div className="min-w-0 flex-1">
        {title && (
          <div className={`text-sm font-semibold ${t.fg} ${children ? "mb-1" : ""}`}>{title}</div>
        )}
        {children && <div className="text-sm leading-relaxed">{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={`flex h-fit shrink-0 opacity-70 hover:opacity-100 ${t.fg}`}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
