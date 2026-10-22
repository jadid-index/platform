import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { format, t } from "@/i18n";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// Profile photo if the student uploaded one, otherwise their initials on a pastel circle.
export function StudentAvatar({ name, url, className }: { name: string; url: string | null; className?: string }) {
  return (
    <Avatar className={cn("size-10", className)}>
      {url ? <AvatarImage src={url} alt={format(t.leaderboard.avatarAlt, { name })} /> : null}
      <AvatarFallback className="bg-primary-soft text-sm font-semibold text-primary-foreground" aria-hidden>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
