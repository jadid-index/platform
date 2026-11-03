import Link from "next/link";

import { t } from "@/i18n";
import { CONTACT_EMAIL } from "@/lib/contact";

// On every page: contact address and the privacy policy.
export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-content px-4 pb-8 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t pt-6 text-small text-muted-foreground">
        <span>© {t.common.appName}</span>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/privacy" className="font-medium text-primary-text underline-offset-4 hover:underline">
            {t.home.footerPrivacy}
          </Link>
          <span>
            {t.home.footerContact}{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary-text underline-offset-4 hover:underline">
              {CONTACT_EMAIL}
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
