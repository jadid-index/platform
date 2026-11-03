import Link from "next/link";

import { t } from "@/i18n";

// Wordmark: a dark rounded mark with the primary-colored letter, then the name. Links home.
export function Logo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span
        aria-hidden
        className="flex size-9 items-center justify-center rounded-xl bg-surface-inverse text-body font-extrabold text-inverse-accent"
      >
        J
      </span>
      <span className="text-body font-extrabold tracking-tight whitespace-nowrap text-text">{t.common.appName}</span>
    </Link>
  );
}
