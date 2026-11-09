import type { Metadata } from "next";
import { Suspense } from "react";

import { checkAdminPage } from "@/components/admin-gate";
import { Card, CardContent, EmptyState, ErrorState, ListSkeleton, SectionHeader, TierBadge } from "@/components/ds";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, formatDate, t } from "@/i18n";
import { listUsersForAdmin, type AdminUser } from "@/lib/db";
import { adminUsersQuerySchema, type AdminUsersQuery } from "@/lib/validation";

import { AccountStatusChip } from "../account-status-chip";
import { Pager } from "../pager";
import { CvCleanup } from "./cv-cleanup";
import { UserControls } from "./user-controls";
import { UserFilters } from "./user-filters";

export const metadata: Metadata = { title: `${t.admin.usersTitle} · ${t.common.appName}` };

const PAGE_SIZE = 50;

export default function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  return (
    <div className="grid gap-4">
      <SectionHeader as="h1" title={t.admin.usersTitle} description={t.admin.usersDescription} />
      <Suspense fallback={<ListSkeleton rows={6} />}>
        <Users searchParams={searchParams} />
      </Suspense>
      <CvCleanup />
    </div>
  );
}

function parse(sp: Record<string, string | string[] | undefined>): AdminUsersQuery {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const parsed = adminUsersQuerySchema.safeParse({
    q: one("q"),
    role: one("role"),
    status: one("status"),
    offset: one("offset"),
    limit: PAGE_SIZE,
  });
  // A hand-edited URL with an unknown filter falls back to the unfiltered first page.
  return parsed.success ? parsed.data : adminUsersQuerySchema.parse({ limit: PAGE_SIZE });
}

async function Users({ searchParams }: { searchParams: PageProps<"/admin/users">["searchParams"] }) {
  const { adminId } = await checkAdminPage();
  const query = parse(await searchParams);

  let rows: AdminUser[];
  let total: number;
  try {
    ({ rows, total } = await listUsersForAdmin(query));
  } catch (error) {
    console.error("load admin users failed", error);
    return <ErrorState message={t.admin.usersError} />;
  }

  return (
    <div className="grid gap-4">
      <UserFilters q={query.q ?? ""} role={query.role} status={query.status} />
      <p className="text-small text-muted-foreground">{format(t.admin.usersCount, { count: total })}</p>

      {rows.length === 0 ? (
        <EmptyState text={t.admin.usersEmpty} />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border bg-surface-raised lg:block">
            <Table>
              <TableCaption className="sr-only">{t.admin.usersCaption}</TableCaption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">{t.admin.colName}</TableHead>
                  <TableHead>{t.admin.colUniversity}</TableHead>
                  <TableHead>{t.admin.colStatus}</TableHead>
                  <TableHead>{t.admin.colPoints}</TableHead>
                  <TableHead>{t.admin.colCreated}</TableHead>
                  <TableHead className="pr-4">
                    {t.admin.colRole} / {t.admin.colStatus}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.id} className="align-top">
                    <TableCell className="pl-4 whitespace-normal">
                      <div className="font-medium">
                        {u.full_name}
                        {u.id === adminId ? <span className="text-muted-foreground"> ({t.admin.you})</span> : null}
                      </div>
                      <div className="text-small break-all text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal">
                      <div>{u.university ?? "—"}</div>
                      {u.faculty ? <div className="text-small text-muted-foreground">{u.faculty}</div> : null}
                    </TableCell>
                    <TableCell>
                      <AccountStatusChip status={u.status} />
                    </TableCell>
                    <TableCell>
                      <YearPoints user={u} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular">{formatDate(u.created_at)}</TableCell>
                    <TableCell className="pr-4">
                      <UserControls user={u} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 lg:hidden">
            {rows.map((u) => (
              <li key={u.id}>
                <Card className="gap-3 py-4">
                  <CardContent className="grid gap-3 px-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="grid min-w-0 gap-0.5">
                        <span className="font-medium">
                          {u.full_name}
                          {u.id === adminId ? <span className="text-muted-foreground"> ({t.admin.you})</span> : null}
                        </span>
                        <span className="text-small break-all text-muted-foreground">{u.email}</span>
                        {u.university ? (
                          <span className="text-small text-muted-foreground">
                            {u.university}
                            {u.faculty ? ` · ${u.faculty}` : ""}
                          </span>
                        ) : null}
                      </div>
                      <AccountStatusChip status={u.status} />
                    </div>
                    <YearPoints user={u} />
                    <UserControls user={u} />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <Pager
        base="/admin/users"
        params={{ q: query.q, role: query.role, status: query.status }}
        offset={query.offset}
        limit={query.limit}
        total={total}
        shown={rows.length}
      />
    </div>
  );
}

// Admins see exact points: a student's points this academic year and the tier they give. Others: nothing.
function YearPoints({ user }: { user: AdminUser }) {
  if (user.year_points === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <TierBadge tier={user.tier} size="sm" />
      <span className="text-small tabular">{format(t.admin.pointsValue, { points: user.year_points })}</span>
    </span>
  );
}
