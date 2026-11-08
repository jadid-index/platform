import { BadgeCheck, ExternalLink, Info, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { ReactNode } from "react";

import { Chip, TierBadge } from "@/components/ds";
import { format, formatDate, t, typeName } from "@/i18n";
import type { CvContacts, CvView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { safeHttpsUrl } from "@/lib/validation";

// The CV as one viewer may see it (the server already left out what this viewer may not see). Used by the
// editor's live preview, /cv/[id] and the print page. All text is rendered as React text (escaped); links are
// shown only if they are still valid https URLs, and open with rel="noopener noreferrer nofollow".
// showEmpty: the editor preview shows empty sections with a hint; the view hides them.
export function CvDocument({ cv, showEmpty = false, className }: { cv: CvView; showEmpty?: boolean; className?: string }) {
  const { content } = cv;
  const education = [cv.university, cv.faculty, cv.course != null ? format(t.cv.course, { n: cv.course }) : null]
    .filter(Boolean)
    .join(" · ");
  const hasSelfDeclared =
    content.about.length > 0 ||
    content.skills.length > 0 ||
    content.languages.length > 0 ||
    content.experience.length > 0 ||
    content.links.length > 0;

  return (
    <article className={cn("cv-document grid gap-6 text-text", className)} aria-label={t.cv.title}>
      <header className="flex items-start gap-4">
        <div className="grid min-w-0 flex-1 gap-1">
          <h1 className="text-h1 break-words">{cv.full_name}</h1>
          {education ? (
            <p className="text-small text-muted-foreground">
              <span className="sr-only">{t.cv.education}: </span>
              {education}
            </p>
          ) : null}
          {cv.updated_at ? (
            <p className="text-xs text-muted-foreground">{format(t.cv.updated, { date: formatDate(cv.updated_at) })}</p>
          ) : null}
        </div>
        <div className="grid justify-items-center gap-1">
          <TierBadge tier={cv.tier} size="lg" />
          <span className="text-xs text-muted-foreground">{t.cv.tier}</span>
        </div>
      </header>

      {cv.contacts ? <Contacts contacts={cv.contacts} showEmpty={showEmpty} /> : null}

      {hasSelfDeclared || showEmpty ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{t.cv.disclaimer}</span>
        </p>
      ) : null}

      {content.about || showEmpty ? (
        <Section title={t.cv.sections.about}>
          {content.about ? <p className="break-words whitespace-pre-line">{content.about}</p> : <Empty />}
        </Section>
      ) : null}

      {content.experience.length > 0 || showEmpty ? (
        <Section title={t.cv.sections.experience}>
          {content.experience.length ? (
            <ul className="grid gap-3">
              {content.experience.map((e, i) => (
                <li key={i} className="cv-entry grid gap-0.5">
                  <p className="font-semibold break-words">
                    {e.title} <span className="font-normal text-muted-foreground">· {e.organization}</span>
                  </p>
                  <p className="text-small text-muted-foreground tabular">
                    {formatMonth(e.start)} – {e.end ? formatMonth(e.end) : t.cv.present}
                  </p>
                  {e.description ? <p className="text-small break-words whitespace-pre-line">{e.description}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </Section>
      ) : null}

      {content.skills.length > 0 || showEmpty ? (
        <Section title={t.cv.sections.skills}>
          {content.skills.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {content.skills.map((s) => (
                <li key={s} className="rounded-full border px-2.5 py-0.5 text-small break-all">
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </Section>
      ) : null}

      {content.languages.length > 0 || showEmpty ? (
        <Section title={t.cv.sections.languages}>
          {content.languages.length ? (
            <ul className="grid gap-1 sm:grid-cols-2">
              {content.languages.map((l, i) => (
                <li key={i} className="text-small break-words">
                  <span className="font-medium">{l.name}</span>
                  <span className="text-muted-foreground"> · {t.cv.levels[l.level] ?? l.level}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </Section>
      ) : null}

      {content.links.length > 0 || showEmpty ? (
        <Section title={t.cv.sections.links}>
          {content.links.length ? (
            <ul className="grid gap-1">
              {content.links.map((l, i) => {
                const href = safeHttpsUrl(l.url);
                return (
                  <li key={i} className="text-small break-all">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        referrerPolicy="no-referrer"
                        className="inline-flex items-center gap-1 font-medium text-primary-text underline-offset-4 hover:underline"
                      >
                        {l.label}
                        <ExternalLink className="size-3.5 shrink-0 print:hidden" aria-hidden />
                      </a>
                    ) : (
                      <span className="font-medium">{l.label}</span>
                    )}
                    {/* The address is printed too, so a PDF still shows where the link goes. */}
                    <span className="block text-xs text-muted-foreground">{href ?? l.url}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty />
          )}
        </Section>
      ) : null}

      <Section title={t.cv.verifiedTitle} hint={t.cv.verifiedHint}>
        {cv.works.length ? (
          <ul className="grid gap-3">
            {cv.works.map((w) => (
              <li key={w.submission_id} className="cv-entry grid gap-0.5">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold break-words">
                  <span className="min-w-0 break-words">{w.title}</span>
                  <Chip tone="approved" className="gap-1">
                    <BadgeCheck className="size-3.5" aria-hidden />
                    {t.cv.verifiedBadge}
                  </Chip>
                </p>
                <p className="text-small break-words text-muted-foreground">
                  {w.issuer} · {formatDate(w.achievement_date)}
                </p>
                <p className="text-small text-muted-foreground">
                  {typeName(w.type_name)} · {t.levels[w.level]}
                  {w.result !== "confirmed" ? ` · ${t.results[w.result]}` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-muted-foreground">{t.cv.noWorks}</p>
        )}
      </Section>
    </article>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="cv-section grid gap-2 border-t pt-4">
      <h2 className="text-h2">{title}</h2>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {children}
    </section>
  );
}

function Empty() {
  return <p className="text-small text-muted-foreground italic">{t.cv.emptySection}</p>;
}

function Contacts({ contacts, showEmpty }: { contacts: CvContacts; showEmpty: boolean }) {
  const items: [ReactNode, string, string | null][] = [
    [<Phone key="p" className="size-4" aria-hidden />, t.cv.fields.phone, contacts.contact_phone],
    [<Mail key="e" className="size-4" aria-hidden />, t.cv.fields.email, contacts.contact_email],
    [<MessageCircle key="t" className="size-4" aria-hidden />, t.cv.fields.telegram, contacts.contact_telegram],
    [<MapPin key="c" className="size-4" aria-hidden />, t.cv.fields.city, contacts.contact_city],
  ];
  const filled = items.filter(([, , v]) => v);
  if (!filled.length && !showEmpty) return null;
  return (
    <section className="cv-section grid gap-2" aria-label={t.cv.sections.contacts}>
      {filled.length ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-small">
          {filled.map(([icon, label, value]) => (
            <li key={label} className="inline-flex min-w-0 items-center gap-1.5 break-all">
              <span className="text-muted-foreground">{icon}</span>
              <span className="sr-only">{label}: </span>
              {value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-muted-foreground italic">
          {t.cv.sections.contacts}: {t.cv.emptySection}
        </p>
      )}
    </section>
  );
}

// "2024-09" -> "09.2024"
export function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${m}.${y}`;
}
