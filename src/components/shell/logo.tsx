import Link from "next/link";

import { t } from "@/i18n";

export function Logo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span
        aria-hidden
        className="flex size-8 items-center justify-center rounded-lg bg-primary text-small font-bold text-primary-foreground"
      >
        J
      </span>
      <span className="text-body font-semibold tracking-tight text-text">{t.common.appName}</span>
    </Link>
  );
}
