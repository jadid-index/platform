"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";

const BASE = "/admin/audit";
const ALL = "all";

// Applied on submit, so typing a name or picking a date does not reload the list on every key.
export function AuditFilters(props: {
  actor: string;
  action?: string;
  from: string;
  to: string;
  actions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actor, setActor] = useState(props.actor);
  const [action, setAction] = useState(props.action ?? ALL);
  const [from, setFrom] = useState(props.from);
  const [to, setTo] = useState(props.to);

  function go(values: { actor: string; action: string; from: string; to: string }) {
    const qs = new URLSearchParams();
    if (values.actor.trim()) qs.set("actor", values.actor.trim());
    if (values.action !== ALL) qs.set("action", values.action);
    if (values.from) qs.set("from", values.from);
    if (values.to) qs.set("to", values.to);
    const s = qs.toString();
    startTransition(() => router.push(s ? `${BASE}?${s}` : BASE, { scroll: false }));
  }

  return (
    <form
      role="search"
      aria-busy={pending}
      className="grid gap-3 rounded-xl border bg-surface-raised p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        go({ actor, action, from, to });
      }}
    >
      <div className="grid gap-2 sm:col-span-2 lg:col-span-1">
        <Label htmlFor="audit-actor">{t.admin.filterActor}</Label>
        <Input
          id="audit-actor"
          value={actor}
          placeholder={t.admin.actorPlaceholder}
          autoComplete="off"
          onChange={(e) => setActor(e.target.value)}
          className="h-10"
        />
      </div>
      <div className="grid gap-2 sm:col-span-2 lg:col-span-1">
        <Label htmlFor="audit-action">{t.admin.filterAction}</Label>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger id="audit-action" className="w-full data-[size=default]:h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t.admin.allActions}</SelectItem>
            {props.actions.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="audit-from">{t.admin.filterFrom}</Label>
        <Input id="audit-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-10" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="audit-to">{t.admin.filterTo}</Label>
        <Input id="audit-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-10" />
      </div>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <Button type="submit" className="h-10 flex-1 lg:flex-none" disabled={pending}>
          {t.admin.applyFilters}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 flex-1 lg:flex-none"
          disabled={pending}
          onClick={() => {
            setActor("");
            setAction(ALL);
            setFrom("");
            setTo("");
            go({ actor: "", action: ALL, from: "", to: "" });
          }}
        >
          {t.admin.resetFilters}
        </Button>
      </div>
    </form>
  );
}
