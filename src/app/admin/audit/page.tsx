import type { Metadata } from "next";
import { Suspense } from "react";

import { checkAdminPage } from "@/components/admin-gate";
import { Card, CardContent, EmptyState, ErrorState, ListSkeleton, SectionHeader } from "@/components/ds";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, t, typeName } from "@/i18n";
import { listAuditActions, listAuditLog, type AuditEntry } from "@/lib/db";
import type { TypeName } from "@/lib/types";
import { adminAuditQuerySchema, type AdminAuditQuery } from "@/lib/validation";

import { Pager } from "../pager";
import { AuditFilters } from "./audit-filters";

export const metadata: Metadata = { title: `${t.admin.auditTitle} · ${t.common.appName}` };

const PAGE_SIZE = 50;

export default function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  return (
    <div className="grid gap-4">
      <SectionHeader as="h1" title={t.admin.auditTitle} description={t.admin.auditDescription} />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Audit searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function parse(sp: Record<string, string | string[] | undefined>): AdminAuditQuery {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const parsed = adminAuditQuerySchema.safeParse({
    actor: one("actor"),
    action: one("action"),
    from: one("from") || undefined,
    to: one("to") || undefined,
    offset: one("offset"),
    limit: PAGE_SIZE,
  });
  return parsed.success ? parsed.data : adminAuditQuerySchema.parse({ limit: PAGE_SIZE });
}

const actionLabel = (a: string) => t.admin.actions[a] ?? a;

function actorLabel(e: AuditEntry): string {
  return e.actor_name ?? e.actor_email ?? (e.actor_id ? e.actor_id : t.admin.system);
}

function targetLabel(e: AuditEntry): string {
  if (e.target_name) return e.target_name;
  // UUIDs are shortened; rubric keys (type id, "3:national:winner", category code) are shown in full.
  const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(e.entity_id);
  return `${e.entity} ${uuid ? e.entity_id.slice(0, 8) : e.entity_id}`;
}

const show = (v: unknown): string =>
  v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

// "old → new". Role and status values are translated; for whole rows (rubric types) only the fields that changed
// are listed. The reason, when there is one, is shown on its own line.
function changeLabel(e: AuditEntry): string {
  const d = e.details ?? {};
  if ("old" in d && "new" in d) {
    const dict = e.action === "profile.role_changed" ? t.admin.roles : e.action === "profile.status_changed" ? t.admin.statuses : {};
    const isRow = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
    if (isRow(d.old) && isRow(d.new)) {
      const before = d.old;
      const after = d.new;
      const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
        (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
      );
      return fields.map((k) => `${k}: ${show(before[k])} → ${show(after[k])}`).join("; ");
    }
    if (isRow(d.new) && d.old === null) return typeName(d.new.name as TypeName) || show(d.new);
    if (isRow(d.old) && d.new === null) return typeName(d.old.name as TypeName) || show(d.old);
    return `${dict[String(d.old)] ?? show(d.old)} → ${dict[String(d.new)] ?? show(d.new)}`;
  }
  return Object.entries(d)
    .filter(([k]) => k !== "reason")
    .map(([k, v]) => `${k}: ${show(v)}`)
    .join(", ");
}

const reasonOf = (e: AuditEntry) => (typeof e.details?.reason === "string" ? e.details.reason : null);

async function Audit({ searchParams }: { searchParams: PageProps<"/admin/audit">["searchParams"] }) {
  await checkAdminPage();
  const query = parse(await searchParams);

  let rows: AuditEntry[];
  let total: number;
  let actions: string[];
  try {
    [{ rows, total }, actions] = await Promise.all([listAuditLog(query), listAuditActions()]);
  } catch (error) {
    console.error("load audit log failed", error);
    return <ErrorState message={t.admin.auditError} />;
  }

  return (
    <div className="grid gap-4">
      <AuditFilters
        actor={query.actor ?? ""}
        action={query.action}
        from={query.from ?? ""}
        to={query.to ?? ""}
        actions={actions.map((a) => ({ value: a, label: actionLabel(a) }))}
      />

      {rows.length === 0 ? (
        <EmptyState text={t.admin.auditEmpty} />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border bg-surface-raised lg:block">
            <Table>
              <TableCaption className="sr-only">{t.admin.auditCaption}</TableCaption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">{t.admin.colTime}</TableHead>
                  <TableHead>{t.admin.colActor}</TableHead>
                  <TableHead>{t.admin.colAction}</TableHead>
                  <TableHead>{t.admin.colTarget}</TableHead>
                  <TableHead className="pr-4">{t.admin.colChange}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id} className="align-top">
                    <TableCell className="pl-4 whitespace-nowrap tabular">{formatDateTime(e.created_at)}</TableCell>
                    <TableCell className="whitespace-normal">
                      <div>{actorLabel(e)}</div>
                      {e.actor_email && e.actor_name ? (
                        <div className="text-small break-all text-muted-foreground">{e.actor_email}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{actionLabel(e.action)}</TableCell>
                    <TableCell className="whitespace-normal">{targetLabel(e)}</TableCell>
                    <TableCell className="max-w-sm pr-4 whitespace-normal break-words">
                      <div>{changeLabel(e)}</div>
                      {reasonOf(e) ? (
                        <div className="text-small text-muted-foreground">
                          {t.admin.reasonLabel}: {reasonOf(e)}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 lg:hidden">
            {rows.map((e) => (
              <li key={e.id}>
                <Card className="gap-2 py-4">
                  <CardContent className="grid gap-1 px-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium">{actionLabel(e.action)}</span>
                      <span className="text-xs text-muted-foreground tabular">{formatDateTime(e.created_at)}</span>
                    </div>
                    <span className="text-small">
                      {t.admin.colActor}: {actorLabel(e)}
                    </span>
                    <span className="text-small">
                      {t.admin.colTarget}: {targetLabel(e)}
                    </span>
                    <span className="text-small break-words text-muted-foreground">{changeLabel(e)}</span>
                    {reasonOf(e) ? (
                      <span className="text-small break-words text-muted-foreground">
                        {t.admin.reasonLabel}: {reasonOf(e)}
                      </span>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <Pager
        base="/admin/audit"
        params={{ actor: query.actor, action: query.action, from: query.from, to: query.to }}
        offset={query.offset}
        limit={query.limit}
        total={total}
        shown={rows.length}
      />
    </div>
  );
}
