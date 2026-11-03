import { Suspense } from "react";

import { AdminNav, AdminNavFallback } from "./admin-nav";

// Frame for admin pages. Access is checked on the server in the proxy, in each page and in each /api/admin route.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex w-full flex-col gap-6">
      <Suspense fallback={<AdminNavFallback />}>
        <AdminNav />
      </Suspense>
      {children}
    </div>
  );
}
