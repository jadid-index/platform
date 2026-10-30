import type { ComponentProps } from "react";

import { Card as BaseCard } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export { CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

// Rounded-xl card with a thin soft border. No resting shadow; `interactive` cards lift on hover.
export function Card({ interactive = false, className, ...props }: ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <BaseCard
      className={cn(
        interactive && "transition-[box-shadow,background-color] hover:bg-primary-soft/40 hover:shadow-card-hover",
        className,
      )}
      {...props}
    />
  );
}
