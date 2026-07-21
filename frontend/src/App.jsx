import { useState } from "react";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatViewport } from "@/components/chat/ChatViewport";
import { ChatInput } from "@/components/chat/ChatInput";

const INITIAL_MESSAGES = [
  {
    id: 1,
    role: "assistant",
    content: "Ask me a question about the CIS Controls v8 document.",
  },
];

const API_URL = "http://127.0.0.1:8000";

function App() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSend(text) {
    const userMessage = { id: Date.now(), role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });

      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }

      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: "assistant", content: data.answer },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: "Sorry, something went wrong reaching the backend.",
        },
      ]);
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      <ChatHeader />
      <ChatViewport messages={messages} />
      {isLoading && (
        <p className="px-4 text-xs text-gray-400 pb-1">Thinking...</p>
      )}
      <ChatInput onSend={handleSend} />
    </div>
  );
}

export default App;