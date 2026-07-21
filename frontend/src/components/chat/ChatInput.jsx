import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function ChatInput({ onSend }) {
  const [value, setValue] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 border-t border-gray-200 px-4 py-3"
    >
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Type your question..."
        className="flex-1"
      />
      <Button type="submit">Send</Button>
    </form>
  );
}