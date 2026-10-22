import { CheckCircle2, Clock, Undo2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { t } from "@/i18n";
import type { SubmissionStatus } from "@/lib/types";

// Every status shows an icon and a label, never color alone.
const STYLES: Record<SubmissionStatus, { className: string; Icon: typeof Clock }> = {
  pending: { className: "bg-status-pending text-status-pending-foreground", Icon: Clock },
  approved: { className: "bg-status-approved text-status-approved-foreground", Icon: CheckCircle2 },
  rejected: { className: "bg-status-rejected text-status-rejected-foreground", Icon: XCircle },
  withdrawn: { className: "bg-muted text-muted-foreground", Icon: Undo2 },
};

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  const { className, Icon } = STYLES[status];
  return (
    <Badge className={className}>
      <Icon aria-hidden />
      {t.status[status]}
    </Badge>
  );
}
