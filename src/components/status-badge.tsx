import { CheckCircle2, Clock, Undo2, XCircle } from "lucide-react";

import { Chip, type ChipTone } from "@/components/ds/chip";
import { t } from "@/i18n";
import type { SubmissionStatus } from "@/lib/types";

// Every status shows an icon and a label, never color alone.
const STYLES: Record<SubmissionStatus, { tone: ChipTone; Icon: typeof Clock }> = {
  pending: { tone: "pending", Icon: Clock },
  approved: { tone: "approved", Icon: CheckCircle2 },
  rejected: { tone: "rejected", Icon: XCircle },
  withdrawn: { tone: "muted", Icon: Undo2 },
};

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  const { tone, Icon } = STYLES[status];
  return (
    <Chip tone={tone}>
      <Icon aria-hidden />
      {t.status[status]}
    </Chip>
  );
}
