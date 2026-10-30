import { Inbox, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ds/card";

// Shown when a list has nothing in it.
export function EmptyState({
  text,
  hint,
  action,
  icon: Icon = Inbox,
}: {
  text: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="grid justify-items-center gap-3 py-4 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="grid gap-1">
          <p>{text}</p>
          {hint ? <p className="text-small text-muted-foreground">{hint}</p> : null}
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
