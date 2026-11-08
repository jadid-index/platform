"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useDeferredValue, useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { CvDocument, formatMonth } from "@/components/cv/cv-document";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ds";
import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { format, t } from "@/i18n";
import { CV_LANGUAGE_LEVELS, type CvDoc, type CvExperience, type CvLanguageLevel, type OwnCv } from "@/lib/types";
import { CV_LIMITS, charLength, currentMonthInTashkent, cvBodySchema } from "@/lib/validation";

import { CvShare } from "./cv-share";
import { CvVisibilityControl } from "./cv-visibility";

type Errors = Record<string, string>;

const FIELD_MAX: Record<string, number> = {
  about: CV_LIMITS.about,
  skills: CV_LIMITS.skill,
  name: CV_LIMITS.language,
  title: CV_LIMITS.expTitle,
  organization: CV_LIMITS.expOrganization,
  description: CV_LIMITS.expDescription,
  label: CV_LIMITS.linkLabel,
  url: CV_LIMITS.linkUrl,
  contact_city: CV_LIMITS.city,
};

// The same schema as the server, so the form shows the errors the server would return.
function validate(doc: CvDoc): Errors {
  const parsed = cvBodySchema.safeParse(doc);
  if (parsed.success) return {};
  const errors: Errors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".");
    if (errors[key]) continue;
    const last = String(issue.path.findLast((p) => typeof p === "string") ?? "");
    const value = issue.path.reduce<unknown>((v, p) => (v as Record<PropertyKey, unknown> | undefined)?.[p as PropertyKey], doc);
    const m = t.cv.invalidField;
    let text: string;
    if (issue.message === "duplicate_skill") text = m.duplicate;
    else if (issue.message === "control_characters") text = m.characters;
    else if (issue.message === "https_only") text = m.url;
    else if (issue.message === "future_month") text = m.future;
    else if (issue.message === "end_before_start") text = m.endBeforeStart;
    else if (last === "start" || last === "end") text = m.month;
    else if (last === "contact_phone") text = m.phone;
    else if (last === "contact_email") text = m.email;
    else if (last === "contact_telegram") text = m.telegram;
    else if (typeof value === "string" && value.trim() === "") text = m.required;
    else if (typeof value === "string" && FIELD_MAX[last] && charLength(value.trim()) > FIELD_MAX[last]) {
      text = format(m.tooLong, { max: FIELD_MAX[last] });
    } else text = m.tooShort;
    errors[key] = text;
  }
  return errors;
}

const ERRORS = t.cv.errors;

export function CvEditor({ initial }: { initial: OwnCv }) {
  const [doc, setDoc] = useState<CvDoc>(initial.doc);
  const [saved, setSaved] = useState<string>(JSON.stringify(initial.doc));
  const [updatedAt, setUpdatedAt] = useState<string | null>(initial.updated_at);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const dirty = JSON.stringify(doc) !== saved;
  const errors = useMemo(() => (showErrors ? validate(doc) : {}), [doc, showErrors]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const deferred = useDeferredValue(doc);
  const preview = useMemo(
    () => ({
      ...initial.view,
      content: {
        about: deferred.about,
        skills: deferred.skills,
        languages: deferred.languages,
        experience: deferred.experience.map((e) => ({ ...e, start: e.start || currentMonthInTashkent() })),
        links: deferred.links,
      },
      contacts: {
        contact_phone: deferred.contact_phone || null,
        contact_email: deferred.contact_email || null,
        contact_telegram: deferred.contact_telegram || null,
        contact_city: deferred.contact_city || null,
      },
      updated_at: updatedAt,
    }),
    [deferred, initial.view, updatedAt],
  );

  const update = (patch: Partial<CvDoc>) => {
    setDoc((d) => ({ ...d, ...patch }));
    if (state === "saved") setState("idle");
  };

  async function save() {
    setShowErrors(true);
    if (Object.keys(validate(doc)).length > 0) {
      setState("error");
      setMessage(t.cv.invalid);
      return;
    }
    setState("saving");
    setMessage(null);
    try {
      const res = await fetch("/api/me/cv", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      const body = (await res.json().catch(() => ({}))) as { updated_at?: string; error?: string };
      if (!res.ok) {
        setState("error");
        setMessage((body.error && ERRORS[body.error]) ?? t.cv.saveError);
        return;
      }
      setSaved(JSON.stringify(doc));
      setUpdatedAt(body.updated_at ?? updatedAt);
      setShowErrors(false);
      setState("saved");
    } catch {
      setState("error");
      setMessage(t.cv.saveError);
    }
  }

  const editor = (
    <div className="grid gap-4">
      <AboutCard value={doc.about} error={errors.about} onChange={(about) => update({ about })} />
      <ExperienceCard items={doc.experience} errors={errors} onChange={(experience) => update({ experience })} />
      <SkillsCard items={doc.skills} error={errors.skills} onChange={(skills) => update({ skills })} />
      <LanguagesCard items={doc.languages} errors={errors} onChange={(languages) => update({ languages })} />
      <LinksCard items={doc.links} errors={errors} onChange={(links) => update({ links })} />
      <ContactsCard doc={doc} errors={errors} onChange={update} />

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-full border bg-surface-raised/95 py-2 pr-2 pl-4 shadow-nav backdrop-blur-md">
        <p className="min-w-0 flex-1 text-small" role="status" aria-live="polite">
          {state === "saving" ? <span className="text-muted-foreground">{t.cv.saving}</span> : null}
          {state === "saved" && !dirty ? <span className="text-primary-text">{t.cv.saved}</span> : null}
          {state === "error" && message ? <span className="text-destructive">{message}</span> : null}
          {state !== "error" && state !== "saving" && dirty ? <span className="text-muted-foreground">{t.cv.unsaved}</span> : null}
        </p>
        <Button onClick={save} disabled={state === "saving" || !dirty} className="rounded-full">
          {state === "saving" ? t.cv.saving : t.cv.save}
        </Button>
      </div>
    </div>
  );

  const side = (
    <div className="grid gap-4">
      <Card className="gap-3 py-5">
        <CardHeader className="px-5">
          <CardTitle className="text-h2">{t.cv.previewTitle}</CardTitle>
          <CardDescription>{t.cv.previewHint}</CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          <CvDocument cv={preview} showEmpty />
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <CvVisibilityControl initial={initial.visibility} />
        <CvShare studentId={initial.view.student_id} />
      </div>
      {/* Below lg: two tabs. From lg: both side by side (the tab bar is hidden, both panels show).
          forceMount keeps both mounted, so switching tabs never loses form state. */}
      <Tabs defaultValue="edit" className="gap-4">
        <TabsList className="w-full lg:hidden">
          <TabsTrigger value="edit">{t.cv.tabs.edit}</TabsTrigger>
          <TabsTrigger value="preview">{t.cv.tabs.preview}</TabsTrigger>
        </TabsList>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
          <TabsContent value="edit" forceMount className="data-[state=inactive]:hidden lg:data-[state=inactive]:block">
            {editor}
          </TabsContent>
          <TabsContent
            value="preview"
            forceMount
            className="data-[state=inactive]:hidden lg:sticky lg:top-(--nav-offset) lg:data-[state=inactive]:block"
          >
            {side}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------------ sections

function SectionCard({
  title,
  count,
  children,
}: {
  title: string;
  count?: { n: number; max: number };
  children: ReactNode;
}) {
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-h2">{title}</CardTitle>
          {count ? (
            <span className="ml-auto text-small text-muted-foreground tabular">{format(t.cv.count, count)}</span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 px-5">{children}</CardContent>
    </Card>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const n = charLength(value.trim());
  return (
    <span className={n > max ? "text-destructive" : undefined}>{format(t.cv.count, { n, max })}</span>
  );
}

function AboutCard({ value, error, onChange }: { value: string; error?: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <SectionCard title={t.cv.sections.about}>
      <div className="grid gap-2">
        <Label htmlFor={id}>{t.cv.fields.about}</Label>
        <Textarea
          id={id}
          value={value}
          rows={5}
          placeholder={t.cv.placeholders.about}
          aria-invalid={!!error}
          aria-describedby={`${id}-message`}
          onChange={(e) => onChange(e.target.value)}
        />
        <p id={`${id}-message`} className="flex justify-between gap-2 text-sm">
          <span className="text-destructive">{error}</span>
          <span className="text-muted-foreground tabular">
            <Counter value={value} max={CV_LIMITS.about} />
          </span>
        </p>
      </div>
    </SectionCard>
  );
}

function SkillsCard({ items, error, onChange }: { items: string[]; error?: string; onChange: (v: string[]) => void }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const full = items.length >= CV_LIMITS.skills;

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (charLength(v) > CV_LIMITS.skill) return setDraftError(format(t.cv.invalidField.tooLong, { max: CV_LIMITS.skill }));
    if (items.some((s) => s.toLowerCase() === v.toLowerCase())) return setDraftError(t.cv.invalidField.duplicate);
    onChange([...items, v]);
    setDraft("");
    setDraftError(null);
  }

  return (
    <SectionCard title={t.cv.sections.skills} count={{ n: items.length, max: CV_LIMITS.skills }}>
      {items.length ? (
        <ul className="flex flex-wrap gap-2">
          {items.map((s, i) => (
            <li key={`${s}-${i}`} className="inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-3 text-small">
              <span className="break-all">{s}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 rounded-full"
                aria-label={format(t.cv.removeItem, { item: s })}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-muted-foreground">{t.cv.emptySection}</p>
      )}
      <div className="grid gap-2">
        <Label htmlFor={id}>{t.cv.fields.skill}</Label>
        <div className="flex gap-2">
          <Input
            id={id}
            value={draft}
            maxLength={CV_LIMITS.skill * 2}
            placeholder={t.cv.placeholders.skill}
            disabled={full}
            aria-invalid={!!(draftError || error)}
            aria-describedby={`${id}-message`}
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={add} disabled={full || !draft.trim()}>
            <Plus className="size-4" aria-hidden />
            {t.cv.add.skill}
          </Button>
        </div>
        <p id={`${id}-message`} className="text-sm">
          {draftError || error ? (
            <span className="text-destructive">{draftError ?? error}</span>
          ) : full ? (
            <span className="text-muted-foreground">{format(t.cv.maxReached, { max: CV_LIMITS.skills })}</span>
          ) : null}
        </p>
      </div>
    </SectionCard>
  );
}

function LanguagesCard({
  items,
  errors,
  onChange,
}: {
  items: CvDoc["languages"];
  errors: Errors;
  onChange: (v: CvDoc["languages"]) => void;
}) {
  const id = useId();
  const set = (i: number, patch: Partial<CvDoc["languages"][number]>) =>
    onChange(items.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const full = items.length >= CV_LIMITS.languages;
  return (
    <SectionCard title={t.cv.sections.languages} count={{ n: items.length, max: CV_LIMITS.languages }}>
      {items.length === 0 ? <p className="text-small text-muted-foreground">{t.cv.emptySection}</p> : null}
      {items.map((l, i) => (
        <div key={i} className="grid gap-3 rounded-lg border bg-surface-sunken p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-start">
          <Field id={`${id}-${i}-name`} label={t.cv.fields.languageName} error={errors[`languages.${i}.name`]}>
            <Input
              id={`${id}-${i}-name`}
              value={l.name}
              placeholder={t.cv.placeholders.languageName}
              aria-invalid={!!errors[`languages.${i}.name`]}
              aria-describedby={`${id}-${i}-name-message`}
              onChange={(e) => set(i, { name: e.target.value })}
            />
          </Field>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-${i}-level`}>{t.cv.fields.languageLevel}</Label>
            <Select value={l.level} onValueChange={(v) => set(i, { level: v as CvLanguageLevel })}>
              <SelectTrigger id={`${id}-${i}-level`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CV_LANGUAGE_LEVELS.map((lv) => (
                  <SelectItem key={lv} value={lv}>
                    {t.cv.levels[lv]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <RemoveButton label={l.name || t.cv.newItem} onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton
        label={t.cv.add.language}
        full={full}
        max={CV_LIMITS.languages}
        onClick={() => onChange([...items, { name: "", level: "B1" }])}
      />
    </SectionCard>
  );
}

function ExperienceCard({
  items,
  errors,
  onChange,
}: {
  items: CvExperience[];
  errors: Errors;
  onChange: (v: CvExperience[]) => void;
}) {
  const id = useId();
  // Entries open for editing; a new entry opens at once, saved ones show a summary line.
  const [open, setOpen] = useState<Set<number>>(new Set());
  const set = (i: number, patch: Partial<CvExperience>) => onChange(items.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const full = items.length >= CV_LIMITS.experience;
  const hasError = (i: number) => Object.keys(errors).some((k) => k.startsWith(`experience.${i}.`));

  function remove(i: number) {
    onChange(items.filter((_, j) => j !== i));
    setOpen((s) => new Set([...s].filter((x) => x !== i).map((x) => (x > i ? x - 1 : x))));
  }

  return (
    <SectionCard title={t.cv.sections.experience} count={{ n: items.length, max: CV_LIMITS.experience }}>
      {items.length === 0 ? <p className="text-small text-muted-foreground">{t.cv.emptySection}</p> : null}
      {items.map((e, i) => {
        const p = `${id}-${i}`;
        const err = (k: string) => errors[`experience.${i}.${k}`];
        if (!open.has(i) && !hasError(i)) {
          return (
            <div key={i} className="flex items-start gap-3 rounded-lg border bg-surface-sunken p-3">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <p className="font-medium break-words">
                  {e.title || t.cv.newItem}
                  {e.organization ? <span className="font-normal text-muted-foreground"> · {e.organization}</span> : null}
                </p>
                <p className="text-small text-muted-foreground tabular">
                  {e.start ? formatMonth(e.start) : "…"} – {e.end === null ? t.cv.present : e.end ? formatMonth(e.end) : "…"}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen((s) => new Set(s).add(i))}>
                {t.cv.edit}
              </Button>
              <RemoveButton label={e.title || t.cv.newItem} onClick={() => remove(i)} />
            </div>
          );
        }
        return (
          <fieldset key={i} className="grid gap-3 rounded-lg border bg-surface-sunken p-3">
            <legend className="sr-only">{e.title || t.cv.newItem}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`${p}-title`} label={t.cv.fields.expTitle} error={err("title")}>
                <Input
                  id={`${p}-title`}
                  value={e.title}
                  placeholder={t.cv.placeholders.expTitle}
                  aria-invalid={!!err("title")}
                  aria-describedby={`${p}-title-message`}
                  onChange={(ev) => set(i, { title: ev.target.value })}
                />
              </Field>
              <Field id={`${p}-org`} label={t.cv.fields.expOrganization} error={err("organization")}>
                <Input
                  id={`${p}-org`}
                  value={e.organization}
                  placeholder={t.cv.placeholders.expOrganization}
                  aria-invalid={!!err("organization")}
                  aria-describedby={`${p}-org-message`}
                  onChange={(ev) => set(i, { organization: ev.target.value })}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <MonthField id={`${p}-start`} label={t.cv.fields.expStart} value={e.start} error={err("start")} onChange={(start) => set(i, { start })} />
              <div className="grid gap-2">
                {e.end === null ? (
                  <div className="grid gap-2">
                    <span className="text-sm leading-none font-medium">{t.cv.fields.expEnd}</span>
                    <p className="flex h-9 items-center text-small text-muted-foreground">{t.cv.present}</p>
                  </div>
                ) : (
                  <MonthField id={`${p}-end`} label={t.cv.fields.expEnd} value={e.end} error={err("end")} onChange={(end) => set(i, { end })} />
                )}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${p}-present`}
                    checked={e.end === null}
                    onCheckedChange={(c) => set(i, { end: c === true ? null : "" })}
                  />
                  <Label htmlFor={`${p}-present`} className="font-normal">
                    {t.cv.fields.expPresent}
                  </Label>
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${p}-desc`}>{t.cv.fields.expDescription}</Label>
              <Textarea
                id={`${p}-desc`}
                value={e.description}
                rows={3}
                aria-invalid={!!err("description")}
                aria-describedby={`${p}-desc-message`}
                onChange={(ev) => set(i, { description: ev.target.value })}
              />
              <p id={`${p}-desc-message`} className="flex justify-between gap-2 text-sm">
                <span className="text-destructive">{err("description")}</span>
                <span className="text-muted-foreground tabular">
                  <Counter value={e.description} max={CV_LIMITS.expDescription} />
                </span>
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => remove(i)}>
                <Trash2 className="size-4" aria-hidden />
                {t.cv.remove}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen((s) => new Set([...s].filter((x) => x !== i)))}
              >
                {t.cv.done}
              </Button>
            </div>
          </fieldset>
        );
      })}
      <AddButton
        label={t.cv.add.experience}
        full={full}
        max={CV_LIMITS.experience}
        onClick={() => {
          onChange([...items, { title: "", organization: "", start: "", end: null, description: "" }]);
          setOpen((s) => new Set(s).add(items.length));
        }}
      />
    </SectionCard>
  );
}

// Month and year as two Selects (type="month" is not supported by every browser). The value is "YYYY-MM";
// a half-filled value ("2024-" or "-09") fails validation with "choose a month".
function MonthField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  const [y = "", m = ""] = value.split("-");
  const thisYear = Number(currentMonthInTashkent().slice(0, 4));
  const years = Array.from({ length: thisYear - 1979 }, (_, k) => String(thisYear - k));
  return (
    <div className="grid gap-2" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="text-sm leading-none font-medium">
        {label}
      </span>
      <div className="grid grid-cols-2 gap-2">
        <Select value={m || undefined} onValueChange={(v) => onChange(`${y}-${v}`)}>
          <SelectTrigger id={id} className="w-full" aria-label={`${label}: ${t.cv.fields.month}`} aria-invalid={!!error}>
            <SelectValue placeholder={t.cv.fields.month} />
          </SelectTrigger>
          <SelectContent>
            {t.cv.months.map((name, k) => (
              <SelectItem key={name} value={String(k + 1).padStart(2, "0")}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={y || undefined} onValueChange={(v) => onChange(`${v}-${m}`)}>
          <SelectTrigger className="w-full" aria-label={`${label}: ${t.cv.fields.year}`} aria-invalid={!!error}>
            <SelectValue placeholder={t.cv.fields.year} />
          </SelectTrigger>
          <SelectContent>
            {years.map((yr) => (
              <SelectItem key={yr} value={yr}>
                {yr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function LinksCard({ items, errors, onChange }: { items: CvDoc["links"]; errors: Errors; onChange: (v: CvDoc["links"]) => void }) {
  const id = useId();
  const set = (i: number, patch: Partial<CvDoc["links"][number]>) => onChange(items.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const full = items.length >= CV_LIMITS.links;
  return (
    <SectionCard title={t.cv.sections.links} count={{ n: items.length, max: CV_LIMITS.links }}>
      {items.length === 0 ? <p className="text-small text-muted-foreground">{t.cv.emptySection}</p> : null}
      {items.map((l, i) => (
        <div key={i} className="grid gap-3 rounded-lg border bg-surface-sunken p-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-start">
          <Field id={`${id}-${i}-label`} label={t.cv.fields.linkLabel} error={errors[`links.${i}.label`]}>
            <Input
              id={`${id}-${i}-label`}
              value={l.label}
              placeholder={t.cv.placeholders.linkLabel}
              aria-invalid={!!errors[`links.${i}.label`]}
              aria-describedby={`${id}-${i}-label-message`}
              onChange={(e) => set(i, { label: e.target.value })}
            />
          </Field>
          <Field id={`${id}-${i}-url`} label={t.cv.fields.linkUrl} error={errors[`links.${i}.url`]}>
            <Input
              id={`${id}-${i}-url`}
              type="url"
              inputMode="url"
              value={l.url}
              placeholder={t.cv.placeholders.linkUrl}
              aria-invalid={!!errors[`links.${i}.url`]}
              aria-describedby={`${id}-${i}-url-message`}
              onChange={(e) => set(i, { url: e.target.value })}
            />
          </Field>
          <RemoveButton label={l.label || t.cv.newItem} onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton label={t.cv.add.link} full={full} max={CV_LIMITS.links} onClick={() => onChange([...items, { label: "", url: "https://" }])} />
    </SectionCard>
  );
}

function ContactsCard({ doc, errors, onChange }: { doc: CvDoc; errors: Errors; onChange: (patch: Partial<CvDoc>) => void }) {
  const id = useId();
  const fields = [
    { key: "contact_phone", label: t.cv.fields.phone, placeholder: t.cv.placeholders.phone, type: "tel", mode: "tel" },
    { key: "contact_email", label: t.cv.fields.email, placeholder: t.cv.placeholders.email, type: "email", mode: "email" },
    { key: "contact_telegram", label: t.cv.fields.telegram, placeholder: t.cv.placeholders.telegram, type: "text", mode: "text" },
    { key: "contact_city", label: t.cv.fields.city, placeholder: t.cv.placeholders.city, type: "text", mode: "text" },
  ] as const;
  return (
    <Card className="gap-4 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-h2">{t.cv.sections.contacts}</CardTitle>
        <CardDescription>{t.cv.contactsHint}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-5 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.key} id={`${id}-${f.key}`} label={f.label} error={errors[f.key]}>
            <Input
              id={`${id}-${f.key}`}
              type={f.type}
              inputMode={f.mode}
              autoComplete="off"
              value={doc[f.key] ?? ""}
              placeholder={f.placeholder}
              aria-invalid={!!errors[f.key]}
              aria-describedby={`${id}-${f.key}-message`}
              onChange={(e) => onChange({ [f.key]: e.target.value })}
            />
          </Field>
        ))}
      </CardContent>
    </Card>
  );
}

function AddButton({ label, full, max, onClick }: { label: string; full: boolean; max: number; onClick: () => void }) {
  return (
    <div className="grid gap-1">
      <Button type="button" variant="outline" className="w-fit" disabled={full} onClick={onClick}>
        <Plus className="size-4" aria-hidden />
        {label}
      </Button>
      {full ? <p className="text-sm text-muted-foreground">{format(t.cv.maxReached, { max })}</p> : null}
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="sm:mt-6"
      aria-label={format(t.cv.removeItem, { item: label })}
      onClick={onClick}
    >
      <Trash2 className="size-4" aria-hidden />
    </Button>
  );
}
