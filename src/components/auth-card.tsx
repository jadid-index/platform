import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ds";

// Centered single-card frame for the auth and form screens, inside the app shell.
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center sm:py-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-h1">{title}</h1>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
