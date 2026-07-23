import { useEffect, useMemo, useRef, useState } from "react";
import {
  SquarePen,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Pin,
  PinOff,
  PanelLeftClose,
  PanelLeft,
  Filter,
  Download,
  ClipboardCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DATE_FILTER_LABELS,
  filterConversationsByDate,
  groupConversationsByRecency,
} from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { ProviderToggle } from "./ProviderToggle";
import { UserMenu } from "./UserMenu";

function ConversationListItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onDelete,
  onPin,
  onExport,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversation.title);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  function startEditing() {
    setDraftTitle(conversation.title);
    setIsEditing(true);
  }

  function commitRename() {
    setIsEditing(false);
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(conversation.conversation_id, trimmed);
    }
  }

  if (isEditing) {
    return (
      <div className="px-2 py-1">
        <Input
          ref={inputRef}
          aria-label="Rename conversation"
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitRename();
            if (event.key === "Escape") setIsEditing(false);
          }}
          className="h-7 text-xs"
        />
      </div>
    );
  }

  return (
    <div
      className={`group/item flex items-center gap-1 rounded-lg px-1 ${
        isActive
          ? "bg-[color-mix(in_oklch,var(--primary),transparent_88%)] text-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60"
      }`}
    >
      <Button
        onClick={() => onSelect(conversation.conversation_id)}
        variant="ghost"
        className="h-auto min-w-0 flex-1 justify-start gap-1.5 overflow-hidden px-2 py-2 text-left font-normal hover:bg-transparent"
      >
        {conversation.kind === "compliance" && (
          <ClipboardCheck
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-label="Compliance check"
          />
        )}
        <span className="w-full truncate text-sm">{conversation.title}</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-muted-foreground opacity-0 group-hover/item:opacity-100 data-popup-open:opacity-100"
              aria-label="Conversation options"
            />
          }
        >
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onPin(conversation.conversation_id, !conversation.pinned)}>
            {conversation.pinned ? (
              <>
                <PinOff className="size-3.5" />
                Unpin
              </>
            ) : (
              <>
                <Pin className="size-3.5" />
                Pin
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={startEditing}>
            <Pencil className="size-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExport(conversation.conversation_id)}>
            <Download className="size-3.5" />
            Export as Markdown
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setIsDeleteDialogOpen(true)}>
            <Trash2 className="size-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              "{conversation.title}" and all its messages will be permanently deleted. This
              can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setIsDeleteDialogOpen(false);
                onDelete(conversation.conversation_id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  onPin,
  onExport,
  isLoading,
  provider,
  onProviderChange,
  isStreaming,
  user,
  onLogout,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("all");

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let result = conversations;
    if (query) {
      result = result.filter((conversation) => conversation.title.toLowerCase().includes(query));
    }
    return filterConversationsByDate(result, dateFilter);
  }, [conversations, searchQuery, dateFilter]);

  const groups = useMemo(
    () => groupConversationsByRecency(filteredConversations),
    [filteredConversations]
  );

  return (
    <div
      className={`flex shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar shadow-[1px_0_0_0_rgba(0,0,0,0.02)] transition-[width] duration-200 ease-in-out ${
        isCollapsed ? "w-[52px]" : "w-[260px]"
      }`}
    >
      <div className={`flex items-center gap-1 p-2 ${isCollapsed ? "flex-col" : ""}`}>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setIsCollapsed((prev) => !prev)}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="shrink-0"
        >
          {isCollapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
        {isCollapsed ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onNewChat}
            aria-label="New chat"
          >
            <SquarePen className="size-4" />
          </Button>
        ) : (
          <Button
            onClick={onNewChat}
            variant="ghost"
            className="flex-1 justify-start gap-2 font-normal whitespace-nowrap"
          >
            <SquarePen className="size-4 shrink-0" />
            New chat
          </Button>
        )}
      </div>

      {!isCollapsed && (
        <div className="flex items-center gap-1 px-2 pb-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search conversations"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search chats..."
              className="h-8 pl-8 text-xs"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant={dateFilter !== "all" ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label="Filter by date"
                  className="shrink-0"
                />
              }
            >
              <Filter className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={dateFilter} onValueChange={setDateFilter}>
                {Object.entries(DATE_FILTER_LABELS).map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto px-2">
          {isLoading && (
            <p className="px-2 py-2 text-xs text-muted-foreground">Loading...</p>
          )}
          {!isLoading && groups.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {searchQuery || dateFilter !== "all"
                ? "No matching conversations."
                : "No conversations yet."}
            </p>
          )}
          {groups.map(({ label, items }) => (
            <div key={label} className="mb-3">
              <p className="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                {label}
              </p>
              {items.map((conversation) => (
                <ConversationListItem
                  key={conversation.conversation_id}
                  conversation={conversation}
                  isActive={conversation.conversation_id === activeConversationId}
                  onSelect={onSelect}
                  onRename={onRename}
                  onDelete={onDelete}
                  onPin={onPin}
                  onExport={onExport}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {isCollapsed && <div className="flex-1" />}

      <div
        className={`flex items-center gap-1 border-t border-sidebar-border p-2 ${
          isCollapsed ? "flex-col" : "justify-between"
        }`}
      >
        <UserMenu user={user} onLogout={onLogout} isCollapsed={isCollapsed} />
        <div className={`flex items-center gap-1 ${isCollapsed ? "flex-col" : ""}`}>
          <ProviderToggle provider={provider} onChange={onProviderChange} disabled={isStreaming} />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
