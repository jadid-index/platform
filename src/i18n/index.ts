import { uz, type Messages } from "@/i18n/uz";

// Only Uzbek (Latin) for now. Add ru.ts / en.ts with the same shape and pick by locale here.
export const locale = "uz";
export const t: Messages = uz;

// Replaces {name} placeholders: format(t.dashboard.greeting, { name: "Ali" }).
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

export function achievementTypeName(id: number, fallback: string): string {
  return t.achievementTypes[id] ?? fallback;
}

// "2026-09-15" or an ISO timestamp -> "15.09.2026" (dates are shown in Uzbekistan time).
export function formatDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}.${m}.${y}`;
  }
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

// "3 kun oldin" style age of a timestamp.
export function formatAge(value: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return t.review.ageJustNow;
  if (minutes < 60) return format(t.review.ageMinutes, { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return format(t.review.ageHours, { n: hours });
  return format(t.review.ageDays, { n: Math.floor(hours / 24) });
}

// Academic year start year -> "2026/27".
export function academicYearLabel(year: number): string {
  return `${year}/${String((year + 1) % 100).padStart(2, "0")}`;
}
