"use client";

import { useEffect, useState } from "react";
import { Nav } from "@/components/nav";
import { callTool, decodeTeamId, decodeUserId } from "@/lib/api";

interface ConversationSummary {
  id: string;
  contactId: string;
  contactName: string | null;
  lastMessagePreview: string;
  lastMessageAt: string;
  unread: boolean;
}

export default function InboxPage() {
  const teamId = decodeTeamId();
  const userId = decodeUserId();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadConversations() {
    if (!teamId) return;
    try {
      const list = await callTool<ConversationSummary[]>("/inbox/conversations/list", { teamId, status: "OPEN" });
      setConversations(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossibile caricare l'inbox");
    }
  }

  useEffect(() => {
    loadConversations();
  }, [teamId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    try {
      await callTool("/inbox/messages/send", {
        teamId,
        conversationId: selected,
        operatorId: userId,
        text,
      });
      setText("");
      loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invio messaggio fallito");
    }
  }

  return (
    <div>
      <Nav />
      <main className="mx-auto grid max-w-4xl grid-cols-1 gap-4 p-6 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <h1 className="mb-2 text-lg font-semibold">Conversazioni</h1>
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setSelected(c.id)}
                  className={`w-full rounded border p-2 text-left text-sm ${
                    selected === c.id ? "border-brand-dark bg-green-50" : "bg-white"
                  }`}
                >
                  <div className="font-medium">{c.contactName ?? "Contatto senza nome"}</div>
                  <div className="truncate text-gray-500">{c.lastMessagePreview}</div>
                </button>
              </li>
            ))}
            {conversations.length === 0 && <p className="text-sm text-gray-400">Nessuna conversazione aperta.</p>}
          </ul>
        </div>
        <div className="sm:col-span-2">
          {selected ? (
            <form onSubmit={handleSend} className="space-y-2 rounded border bg-white p-4">
              <textarea
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Scrivi una risposta..."
                className="h-32 w-full rounded border px-3 py-2 text-sm"
              />
              <button type="submit" className="rounded bg-brand-dark px-4 py-2 text-sm font-medium text-white">
                Invia
              </button>
              <p className="text-xs text-gray-400">
                I messaggi liberi sono consegnabili solo entro 24h dall&apos;ultimo messaggio del cliente.
              </p>
            </form>
          ) : (
            <p className="text-sm text-gray-400">Seleziona una conversazione per rispondere.</p>
          )}
        </div>
        {error && <p className="col-span-full text-sm text-red-600">{error}</p>}
      </main>
    </div>
  );
}
