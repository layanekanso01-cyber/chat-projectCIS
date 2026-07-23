import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PROVIDER_LABELS = {
  ollama: "Ollama (local)",
  gemini: "Gemini 2.5 Flash",
};

export function ProviderToggle({ provider, onChange, disabled = false }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={`Model: ${PROVIDER_LABELS[provider]}`}
            data-tour="provider-toggle"
          />
        }
      >
        <Bot className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={provider} onValueChange={onChange}>
          {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
