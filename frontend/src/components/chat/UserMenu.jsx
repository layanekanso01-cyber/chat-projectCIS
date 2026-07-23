import { useState } from "react";
import { LogOut, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AuditLogDialog } from "@/components/admin/AuditLogDialog";

function initialsFor(user) {
  const source = user.name || user.email || "?";
  return source.trim().charAt(0).toUpperCase();
}

function AccountAvatar({ user, className }) {
  const [imageFailed, setImageFailed] = useState(false);

  if (user.avatarUrl && !imageFailed) {
    return (
      <img
        src={user.avatarUrl}
        alt=""
        className={`size-6 rounded-full object-cover ${className || ""}`}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className={`flex size-6 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground ${className || ""}`}
    >
      {initialsFor(user)}
    </span>
  );
}

export function UserMenu({ user, onLogout, isCollapsed }) {
  const [isAuditLogOpen, setIsAuditLogOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Account menu"
              className="shrink-0 rounded-full"
            />
          }
        >
          <AccountAvatar user={user} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align={isCollapsed ? "start" : "end"}>
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            <p className="truncate font-medium text-foreground">{user.name || "Signed in"}</p>
            <p className="truncate">{user.email}</p>
          </div>
          {user.role === "Admin" && (
            <DropdownMenuItem onClick={() => setIsAuditLogOpen(true)}>
              <ScrollText className="size-3.5" />
              Audit log
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={onLogout}>
            <LogOut className="size-3.5" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {user.role === "Admin" && (
        <AuditLogDialog open={isAuditLogOpen} onOpenChange={setIsAuditLogOpen} />
      )}
    </>
  );
}
