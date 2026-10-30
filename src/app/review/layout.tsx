// Frame for reviewer pages. Access is checked on the server in each page and in each /api/review route.
export default function ReviewLayout({ children }: LayoutProps<"/review">) {
  return <div className="flex w-full flex-col gap-4">{children}</div>;
}
