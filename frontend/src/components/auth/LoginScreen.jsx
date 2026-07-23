import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getGoogleLoginUrl } from "@/api/auth";

export function LoginScreen({ error }) {
  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-border p-8 text-center shadow-sm">
        <ShieldCheck className="size-8 text-primary" />
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">CIS Controls Assistant</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with your Google account to continue.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          className="w-full"
          onClick={() => {
            window.location.href = getGoogleLoginUrl();
          }}
        >
          Sign in with Google
        </Button>
      </div>
    </div>
  );
}
