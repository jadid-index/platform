import { CheckCircle2, Clock, EyeOff, XCircle } from "lucide-react";

import { Chip, type ChipTone } from "@/components/ds";
import { t } from "@/i18n";
import type { ProfileStatus } from "@/lib/validation";

// Every status shows an icon and a label, never color alone.
const STYLES: Record<ProfileStatus, { tone: ChipTone; Icon: typeof Clock }> = {
  active: { tone: "approved", Icon: CheckCircle2 },
  hidden: { tone: "rejected", Icon: EyeOff },
  pending: { tone: "pending", Icon: Clock },
  rejected: { tone: "rejected", Icon: XCircle },
};

export function AccountStatusChip({ status }: { status: ProfileStatus }) {
  const { tone, Icon } = STYLES[status];
  return (
    <Chip tone={tone}>
      <Icon aria-hidden />
      {t.admin.statuses[status]}
    </Chip>
  );
}
