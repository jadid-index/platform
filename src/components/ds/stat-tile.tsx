import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// One number with its label, e.g. points this year. Use inside a <dl>.
export function StatTile({
  label,
  value,
  unit,
  hint,
  emphasis = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1 rounded-xl border bg-surface-raised p-4", className)}>
      <dt className="text-small text-muted-foreground">{label}</dt>
      <dd className={cn("text-h1 tabular", emphasis && "text-primary-strong")}>
        {value}
        {unit ? <span className="ml-1 text-small font-normal text-muted-foreground">{unit}</span> : null}
      </dd>
      {hint ? <dd className="text-small text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}
