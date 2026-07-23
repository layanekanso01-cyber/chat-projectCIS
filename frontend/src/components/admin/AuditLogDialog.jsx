import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchAuditLogs, AUDIT_LOG_ACTIONS } from "@/api/admin";

const PAGE_SIZE = 50;
const ALL_ACTIONS = "all";

function statusColor(statusCode) {
  if (statusCode >= 500) return "text-destructive";
  if (statusCode >= 400) return "text-amber-600 dark:text-amber-500";
  return "text-muted-foreground";
}

export function AuditLogDialog({ open, onOpenChange }) {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const [userEmail, setUserEmail] = useState("");
  const [path, setPath] = useState("");
  const [action, setAction] = useState(ALL_ACTIONS);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function load(nextOffset) {
    setIsLoading(true);
    setError(null);
    fetchAuditLogs({
      limit: PAGE_SIZE,
      offset: nextOffset,
      userEmail: userEmail.trim() || undefined,
      path: path.trim() || undefined,
      action: action === ALL_ACTIONS ? undefined : action,
      from: from || undefined,
      to: to || undefined,
    })
      .then((data) => {
        setLogs(data.items);
        setTotal(data.total);
        setOffset(nextOffset);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleFilterSubmit(event) {
    event.preventDefault();
    load(0);
  }

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Audit log</DialogTitle>
          <DialogDescription>
            Every request handled by the middleware — most recent first.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleFilterSubmit} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-32 flex-1 flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="audit-filter-user">
              User contains
            </label>
            <Input
              id="audit-filter-user"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder="email"
            />
          </div>
          <div className="flex min-w-32 flex-1 flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="audit-filter-path">
              Path contains
            </label>
            <Input
              id="audit-filter-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/api/rag/..."
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="audit-filter-action">
              Action
            </label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger id="audit-filter-action" className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ACTIONS}>All actions</SelectItem>
                {AUDIT_LOG_ACTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="audit-filter-from">
              From
            </label>
            <Input
              id="audit-filter-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="audit-filter-to">
              To
            </label>
            <Input
              id="audit-filter-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" variant="secondary" disabled={isLoading}>
            Filter
          </Button>
        </form>

        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
          {isLoading && (
            <p className="p-4 text-sm text-muted-foreground">Loading...</p>
          )}
          {error && <p className="p-4 text-sm text-destructive">{error}</p>}
          {!isLoading && !error && logs.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No requests match these filters.</p>
          )}
          {!isLoading && !error && logs.length > 0 && (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-xs">
                <tr className="text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 font-medium">Path</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => (
                  <tr key={entry.id} className="border-t border-border">
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="max-w-40 truncate px-3 py-1.5">
                      {entry.userEmail || <span className="text-muted-foreground">anonymous</span>}
                    </td>
                    <td className="max-w-36 truncate px-3 py-1.5 font-mono">{entry.action}</td>
                    <td className="px-3 py-1.5 font-mono">{entry.method}</td>
                    <td className="max-w-64 truncate px-3 py-1.5 font-mono">{entry.path}</td>
                    <td className={`px-3 py-1.5 font-mono ${statusColor(entry.statusCode)}`}>
                      {entry.statusCode}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                      {entry.durationMs} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {total === 0 ? "0 results" : `${rangeStart}–${rangeEnd} of ${total}`}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isLoading || offset === 0}
              onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isLoading || offset + PAGE_SIZE >= total}
              onClick={() => load(offset + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
