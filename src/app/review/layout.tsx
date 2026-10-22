import Link from "next/link";

import { t } from "@/i18n";

// Frame for reviewer pages. Access is checked on the server in each page and in each /api/review route.
export default function ReviewLayout({ children }: LayoutProps<"/review">) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <Link href="/review" className="text-xl font-semibold">
          {t.review.title}
        </Link>
        <Link href="/dashboard" className="text-sm text-primary-strong underline-offset-4 hover:underline">
          {t.review.toDashboard}
        </Link>
      </header>
      {children}
    </div>
  );
}
