"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Message {
  _id: string;
  content: string;
  senderId: { _id: string; firstName: string; lastName: string; role: string } | null;
  createdAt: string;
  readBy: string[];
  attachments?: Array<{ name: string; url: string }>;
}

interface Conversation {
  _id: string;
  title?: string;
  type: string;
  participantIds: Array<{ _id: string; firstName: string; lastName: string; role: string }>;
  lastMessage?: { content: string; sentAt: string };
  unreadCounts?: Record<string, number>;
}

interface MessageComposerProps {
  currentUserId: string;
  conversationId?: string;
  compact?: boolean;
  /** Filtre le type de conversation selon le profil connecté */
  profileFilter?: "pme" | "association" | "administration";
}

export function MessageComposer({ currentUserId, conversationId: initConvId, compact = false, profileFilter = "pme" }: MessageComposerProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(initConvId || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Charger les conversations
  useEffect(() => {
    fetch("/api/conversations", { credentials: "include" })
      .then(r => r.json())
      .then(d => setConversations(d.data?.items || []));
  }, []);

  // Charger les messages de la conversation active
  const loadMessages = useCallback(async (convId: string) => {
    setLoading(true);
    const res = await fetch(`/api/conversations/${convId}/messages`, { credentials: "include" });
    const d = await res.json();
    setMessages(d.data || []);
    setLoading(false);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, []);

  useEffect(() => {
    if (activeConvId) loadMessages(activeConvId);
  }, [activeConvId, loadMessages]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || !activeConvId) return;
    setSending(true);
    const csrfRes = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    const res = await fetch(`/api/conversations/${activeConvId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include",
      body: JSON.stringify({ content: newMessage }),
    });
    const d = await res.json();
    if (res.ok) {
      setMessages(prev => [...prev, d.data]);
      setNewMessage("");
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
    setSending(false);
  }

  function getConvName(conv: Conversation): string {
    if (conv.title) return conv.title;
    const others = conv.participantIds.filter(p => p._id !== currentUserId);
    if (others.length === 0) return "Moi-même";
    if (others.length === 1) return `${others[0].firstName} ${others[0].lastName}`;
    return `${others[0].firstName} + ${others.length - 1} autres`;
  }

  function getInitials(name: string): string {
    return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  }

  if (compact && activeConvId) {
    // Mode compact : juste la fenêtre de messages
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--color-background-primary)" }}>
        <div style={{ flex: 1, overflow: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {loading && <div style={{ textAlign: "center", color: "var(--color-text-secondary)", fontSize: "12px", padding: "20px" }}>Chargement…</div>}
          {messages.map(m => {
            const isMine = m.senderId?._id === currentUserId;
            return (
              <div key={m._id} style={{ display: "flex", flexDirection: isMine ? "row-reverse" : "row", gap: "8px", alignItems: "flex-end" }}>
                {!isMine && m.senderId && (
                  <div style={{ width: "28px", height: "28px", background: "#2F3E46", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "10px", fontWeight: 500, flexShrink: 0 }}>
                    {getInitials(`${m.senderId.firstName} ${m.senderId.lastName}`)}
                  </div>
                )}
                <div style={{ maxWidth: "70%", padding: "8px 12px", borderRadius: isMine ? "12px 12px 2px 12px" : "12px 12px 12px 2px", background: isMine ? "#2F3E46" : "var(--color-background-secondary)", color: isMine ? "#fff" : "var(--color-text-primary)", fontSize: "13px", lineHeight: "1.4" }}>
                  {!isMine && <p style={{ fontSize: "10px", fontWeight: 500, marginBottom: "2px", color: isMine ? "rgba(255,255,255,0.7)" : "var(--color-text-secondary)" }}>{m.senderId?.firstName} {m.senderId?.lastName}</p>}
                  {m.content}
                  <p style={{ fontSize: "10px", marginTop: "2px", opacity: 0.6, textAlign: "right" }}>
                    {new Date(m.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
        <form onSubmit={sendMessage} style={{ padding: "10px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", display: "flex", gap: "8px" }}>
          <input
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            placeholder="Écrire un message…"
            style={{ flex: 1, padding: "8px 12px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "20px", fontSize: "13px", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", outline: "none" }}
          />
          <button type="submit" disabled={sending || !newMessage.trim()} style={{ background: "#2F3E46", color: "#fff", border: "none", borderRadius: "50%", width: "36px", height: "36px", cursor: "pointer", opacity: sending || !newMessage.trim() ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2z"/></svg>
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "600px", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "12px", overflow: "hidden", background: "var(--color-background-primary)" }}>
      {/* Liste conversations */}
      <div style={{ width: "240px", borderRight: "0.5px solid var(--color-border-tertiary)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <p style={{ fontWeight: 500, fontSize: "14px", margin: 0, color: "var(--color-text-primary)" }}>Messages</p>
          <button
            onClick={async () => {
              const name = prompt("Nom du groupe :");
              if (!name) return;
              const csrfRes = await fetch("/api/auth/csrf");
              const { csrfToken } = await csrfRes.json();
              const res = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, credentials: "include", body: JSON.stringify({ type: "group", title: name }) });
              const d = await res.json();
              if (res.ok) { setConversations(prev => [d.data, ...prev]); setActiveConvId(d.data._id); }
            }}
            style={{ fontSize: "18px", lineHeight: 1, background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)" }}
          >+</button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {conversations.length === 0 && <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", textAlign: "center", padding: "20px" }}>Aucune conversation</p>}
          {conversations.map(conv => (
            <div
              key={conv._id}
              onClick={() => setActiveConvId(conv._id)}
              style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "0.5px solid var(--color-border-tertiary)", background: activeConvId === conv._id ? "var(--color-background-secondary)" : "transparent" }}
            >
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <div style={{ width: "34px", height: "34px", background: "#2F3E46", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "11px", fontWeight: 500, flexShrink: 0 }}>
                  {conv.type === "group" ? "G" : getInitials(getConvName(conv))}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "12px", fontWeight: 500, margin: 0, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getConvName(conv)}</p>
                  {conv.lastMessage && <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", margin: "1px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.lastMessage.content}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Zone messages */}
      {activeConvId ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 16px", borderBottom: "0.5px solid var(--color-border-tertiary)", background: "var(--color-background-secondary)" }}>
            <p style={{ fontWeight: 500, fontSize: "13px", margin: 0, color: "var(--color-text-primary)" }}>
              {getConvName(conversations.find(c => c._id === activeConvId) || { _id: "", type: "direct", participantIds: [] })}
            </p>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {loading && <div style={{ textAlign: "center", color: "var(--color-text-secondary)", fontSize: "12px" }}>Chargement…</div>}
            {messages.map(m => {
              const isMine = m.senderId?._id === currentUserId;
              return (
                <div key={m._id} style={{ display: "flex", flexDirection: isMine ? "row-reverse" : "row", gap: "8px", alignItems: "flex-end" }}>
                  {!isMine && m.senderId && (
                    <div style={{ width: "30px", height: "30px", background: "#2F3E46", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "10px", fontWeight: 500, flexShrink: 0 }}>
                      {getInitials(`${m.senderId.firstName} ${m.senderId.lastName}`)}
                    </div>
                  )}
                  <div style={{ maxWidth: "65%", padding: "9px 13px", borderRadius: isMine ? "14px 14px 2px 14px" : "14px 14px 14px 2px", background: isMine ? "#2F3E46" : "var(--color-background-secondary)", color: isMine ? "#fff" : "var(--color-text-primary)", fontSize: "13px" }}>
                    {!isMine && <p style={{ fontSize: "10px", fontWeight: 500, margin: "0 0 3px", color: "var(--color-text-secondary)" }}>{m.senderId?.firstName} {m.senderId?.lastName}</p>}
                    {m.content}
                    <p style={{ fontSize: "10px", margin: "4px 0 0", opacity: 0.55, textAlign: "right" }}>
                      {new Date(m.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={sendMessage} style={{ padding: "12px 14px", borderTop: "0.5px solid var(--color-border-tertiary)", display: "flex", gap: "8px" }}>
            <input
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              placeholder="Écrire un message… (Entrée pour envoyer)"
              style={{ flex: 1, padding: "9px 14px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "22px", fontSize: "13px", background: "var(--color-background-secondary)", color: "var(--color-text-primary)", outline: "none" }}
            />
            <button type="submit" disabled={sending || !newMessage.trim()} style={{ background: "#2F3E46", color: "#fff", border: "none", borderRadius: "50%", width: "38px", height: "38px", cursor: "pointer", opacity: !newMessage.trim() ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="white"><path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2z"/></svg>
            </button>
          </form>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-secondary)", fontSize: "13px" }}>
          Sélectionnez une conversation
        </div>
      )}
    </div>
  );
}
