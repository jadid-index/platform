import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TONES = {
  primary: "bg-primary-soft text-primary-strong",
  muted: "bg-muted text-muted-foreground",
  pending: "bg-status-pending text-status-pending-foreground",
  approved: "bg-status-approved text-status-approved-foreground",
  rejected: "bg-status-rejected text-status-rejected-foreground",
  scientific: "bg-category-scientific text-category-scientific-foreground",
  innovation: "bg-category-innovation text-category-innovation-foreground",
  social: "bg-category-social text-category-social-foreground",
  personal_growth: "bg-category-personal text-category-personal-foreground",
} as const;

export type ChipTone = keyof typeof TONES;

// Small pastel label. The text carries the meaning; the tint only supports it.
export function Chip({ tone = "primary", className, ...props }: ComponentProps<typeof Badge> & { tone?: ChipTone }) {
  return <Badge className={cn("px-2.5 py-0.5 text-xs font-medium", TONES[tone], className)} {...props} />;
}
