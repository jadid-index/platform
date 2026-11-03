"use client";

import { CheckCircle2, CircleSlash, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { Card, CardContent, Chip, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { t, typeName } from "@/i18n";
import type { AdminCategory, AdminType } from "@/lib/db";

import { ReasonField, SaveError } from "./reason-field";
import { TypeSheet } from "./type-sheet";
import { useSave, validReason } from "./use-save";

const r = t.admin.rubric;

type Action = { kind: "activate" | "deactivate" | "delete"; type: AdminType };

// Active state: icon and label, never colour alone.
function ActiveChip({ active }: { active: boolean }) {
  return active ? (
    <Chip tone="approved">
      <CheckCircle2 aria-hidden />
      {r.active}
    </Chip>
  ) : (
    <Chip tone="muted">
      <CircleSlash aria-hidden />
      {r.inactive}
    </Chip>
  );
}

function RowActions({ type, onEdit, onAction }: { type: AdminType; onEdit: () => void; onAction: (a: Action) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={onEdit}>
        <Pencil aria-hidden />
        {r.editType}
      </Button>
      <Button variant="outline" size="sm" onClick={() => onAction({ kind: type.active ? "deactivate" : "activate", type })}>
        {type.active ? r.deactivate : r.activate}
      </Button>
      {/* A type that any submission or review refers to can only be deactivated, never deleted. */}
      {!type.in_use ? (
        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onAction({ kind: "delete", type })}>
          {r.delete}
        </Button>
      ) : null}
    </div>
  );
}

export function TypeList({ types, categories }: { types: AdminType[]; categories: AdminCategory[] }) {
  const [editing, setEditing] = useState<AdminType | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [action, setAction] = useState<Action | null>(null);

  const edit = (type: AdminType | null) => {
    setEditing(type);
    setSheetOpen(true);
  };
  const category = (code: string) => t.categories[code] ?? categories.find((c) => c.code === code)?.name ?? code;

  return (
    <div className="grid gap-3">
      <div>
        <Button onClick={() => edit(null)}>
          <Plus aria-hidden />
          {r.addType}
        </Button>
      </div>

      {types.length === 0 ? (
        <EmptyState text={r.typesEmpty} />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border bg-surface-raised lg:block">
            <Table>
              <TableCaption className="sr-only">{r.typesCaption}</TableCaption>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">{r.colType}</TableHead>
                  <TableHead>{r.colCategory}</TableHead>
                  <TableHead className="text-right">{r.colBase}</TableHead>
                  <TableHead>{r.colPlacement}</TableHead>
                  <TableHead>{r.colState}</TableHead>
                  <TableHead>{r.colUsage}</TableHead>
                  <TableHead className="pr-4">
                    <span className="sr-only">{r.editType}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((x) => (
                  <TableRow key={x.id} className="align-top">
                    <TableCell className="max-w-xs pl-4 whitespace-normal">
                      <div className="font-medium">{typeName(x.name)}</div>
                      {x.name.en ? <div className="text-small text-muted-foreground">{x.name.en}</div> : null}
                    </TableCell>
                    <TableCell>{category(x.category_code)}</TableCell>
                    <TableCell className="text-right tabular">{x.base_points}</TableCell>
                    <TableCell className="whitespace-normal">{x.has_placement ? r.placementYes : r.placementNo}</TableCell>
                    <TableCell>
                      <ActiveChip active={x.active} />
                    </TableCell>
                    <TableCell>{x.in_use ? r.used : r.unused}</TableCell>
                    <TableCell className="pr-4">
                      <RowActions type={x} onEdit={() => edit(x)} onAction={setAction} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <ul className="grid gap-3 lg:hidden">
            {types.map((x) => (
              <li key={x.id}>
                <Card className="gap-3 py-4">
                  <CardContent className="grid gap-2 px-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="grid min-w-0 gap-0.5">
                        <span className="font-medium">{typeName(x.name)}</span>
                        <span className="text-small text-muted-foreground">
                          {category(x.category_code)} · {r.colBase}: <span className="tabular">{x.base_points}</span>
                        </span>
                        <span className="text-small text-muted-foreground">
                          {x.has_placement ? r.placementYes : r.placementNo} · {r.colUsage}: {x.in_use ? r.used : r.unused}
                        </span>
                      </div>
                      <ActiveChip active={x.active} />
                    </div>
                    <RowActions type={x} onEdit={() => edit(x)} onAction={setAction} />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <TypeSheet open={sheetOpen} onOpenChange={setSheetOpen} type={editing} categories={categories} />
      <ActionSheet action={action} onClose={() => setAction(null)} />
    </div>
  );
}

function ActionSheet({ action, onClose }: { action: Action | null; onClose: () => void }) {
  return (
    <Sheet open={action !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="w-full sm:max-w-md">
        {action ? <ActionForm key={`${action.kind}-${action.type.id}`} action={action} onDone={onClose} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function ActionForm({ action, onDone }: { action: Action; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const { send, saving, error, setError } = useSave();
  const label = action.kind === "activate" ? r.activate : action.kind === "deactivate" ? r.deactivate : r.delete;

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!validReason(reason)) return setError(r.errors.reason_required);
    const url = `/api/admin/rubric/types/${action.type.id}`;
    const ok =
      action.kind === "delete"
        ? await send(url, "DELETE", { reason })
        : await send(url, "PATCH", { active: action.kind === "activate", reason });
    if (ok) onDone();
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {label}: {typeName(action.type.name)}
        </SheetTitle>
        <SheetDescription>{action.kind === "delete" ? r.typesDescription : r.futureOnly}</SheetDescription>
      </SheetHeader>
      <form onSubmit={confirm} className="grid gap-4 px-4 pb-6">
        <ReasonField id="action-reason" value={reason} onChange={setReason} />
        <SaveError message={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={saving} variant={action.kind === "delete" ? "destructive" : "default"} className="flex-1 sm:flex-none">
            {saving ? t.admin.saving : r.confirmAction}
          </Button>
          <Button type="button" variant="outline" onClick={onDone} className="flex-1 sm:flex-none">
            {r.cancel}
          </Button>
        </div>
      </form>
    </>
  );
}
