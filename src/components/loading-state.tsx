import { Loader2 } from "lucide-react";

import { t } from "@/i18n";

export function LoadingState() {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{t.common.loading}</span>
    </div>
  );
}
