"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Send, Search, Users, ArrowLeft } from "lucide-react";

import { promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { buttonClass } from "@/components/ui/button-class";
import {apiJson, apiSend } from "@/lib/api-client";
interface Message {
  _id: string;
  content: string;
  senderId: { _id: string; firstName: string; lastName: string; role: string } | null;
  createdAt: string;
}
interface Conversation {
  _id: string;
  title?: string;
  type: string;
  participantIds: Array<{ _id: string; firstName: string; lastName: string; role: string }>;
  lastMessage?: { content: string; sentAt: string };
}
interface DirUser { _id: string; firstName?: string; lastName?: string }

interface Props { currentUserId: string; conversationId?: string; compact?: boolean }

const initials = (name: string) => name.split(" ").filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";

export function MessageComposer({ currentUserId, conversationId: initConvId, compact = false }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(initConvId || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  // Conversation dont le fil est chargé : « chargement » se déduit (la
  // conversation ouverte n'a pas encore de réponse), sans setState avant la lecture.
  const [loadedConvId, setLoadedConvId] = useState<string | null>(null);
  const loading = !!activeConvId && loadedConvId !== activeConvId;
  const [picking, setPicking] = useState(false);
  const [dir, setDir] = useState<DirUser[]>([]);
  const [dq, setDq] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(() => {
    apiJson("/api/conversations").then(d => setConversations(d.data?.items || []));
  }, []);
  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    if (!activeConvId) return;
    apiJson(`/api/conversations/${activeConvId}/messages`).then(d => {
      // L'API renvoie du plus récent au plus ancien : on inverse pour un fil de discussion.
      setMessages((d.data || []).slice().reverse());
      setLoadedConvId(activeConvId);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    });
  }, [activeConvId]);

  useEffect(() => {
    if (!picking || dir.length) return;
    apiJson("/api/agenda/directory")
      .then(d => setDir((d.success ? d.data : []).filter((u: DirUser) => u._id !== currentUserId)));
  }, [picking, dir.length, currentUserId]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || !activeConvId) return;
    setSending(true);
    try {
      const res = await apiSend("POST", `/api/conversations/${activeConvId}/messages`, { content: newMessage });
      const d = res.data;
      if (res.ok) { setMessages(prev => [...prev, d.data]); setNewMessage(""); loadConversations(); setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 40); }
      else showToast(d.error || "Envoi impossible.", "error");
    } finally { setSending(false); }
  }

  async function startDirect(userId: string) {
    const res = await apiSend("POST", "/api/conversations", { type: "direct", participantIds: [userId] });
    const d = res.data;
    if (res.ok) { setPicking(false); setDq(""); loadConversations(); setActiveConvId(d.data._id); }
    else showToast(d.error || "Impossible de démarrer la conversation.", "error");
  }
  async function createGroup() {
    const name = await promptDialog({ title: "Nom du groupe :" }); if (!name) return;
    const res = await apiSend("POST", "/api/conversations", { type: "group", title: name });
    const d = res.data;
    if (res.ok) { setPicking(false); loadConversations(); setActiveConvId(d.data._id); }
  }

  function convName(conv: Conversation): string {
    if (conv.title) return conv.title;
    const others = conv.participantIds.filter(p => p._id !== currentUserId);
    if (others.length === 0) return "Moi-même";
    if (others.length === 1) return `${others[0].firstName} ${others[0].lastName}`;
    return `${others[0].firstName} + ${others.length - 1}`;
  }

  const Thread = (
    <>
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-2.5">
        {loading && <p className="text-center text-xs text-ink3 py-4">Chargement…</p>}
        {!loading && messages.length === 0 && <p className="text-center text-xs text-ink3 py-4">Aucun message. Écrivez le premier.</p>}
        {messages.map(m => {
          const mine = m.senderId?._id === currentUserId;
          return (
            <div key={m._id} className={`flex gap-2 items-end ${mine ? "flex-row-reverse" : ""}`}>
              {!mine && m.senderId && <div className="w-7 h-7 rounded-full bg-section text-onink grid place-items-center text-[10px] font-semibold shrink-0">{initials(`${m.senderId.firstName} ${m.senderId.lastName}`)}</div>}
              <div className={`max-w-[70%] px-3 py-2 text-sm rounded-2xl ${mine ? "bg-section text-onink rounded-br-sm" : "bg-surface2 text-ink rounded-bl-sm"}`}>
                {!mine && <p className="text-[10px] font-semibold mb-0.5 text-ink2">{m.senderId?.firstName} {m.senderId?.lastName}</p>}
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                <p className={`text-[10px] mt-1 text-right ${mine ? "text-white/60" : "text-ink3"}`}>{new Date(m.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={sendMessage} className="p-3 border-t border-line flex gap-2">
        <input value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="Écrire un message…"
          className="flex-1 px-3.5 h-10 rounded-full border border-line bg-surface2 text-sm text-ink outline-none focus:border-section" />
        <button type="submit" disabled={sending || !newMessage.trim()} className={buttonClass("primary", "md", "shrink-0")}><Send size={15} /></button>
      </form>
    </>
  );

  if (compact) {
    return <div className="flex flex-col h-full bg-surface">{Thread}</div>;
  }

  return (
    <div className="flex h-[600px] border border-line rounded-xl overflow-hidden bg-surface">
      {/* Liste des conversations */}
      <div className="w-64 border-r border-line flex flex-col shrink-0">
        <div className="p-3.5 border-b border-line flex justify-between items-center">
          <p className="font-semibold text-sm text-ink">Messages</p>
          <button onClick={() => setPicking(true)} className="w-7 h-7 grid place-items-center rounded-lg text-section hover:bg-section-soft" title="Nouvelle conversation"><Plus size={16} /></button>
        </div>
        <div className="flex-1 overflow-auto">
          {conversations.length === 0 && <p className="text-xs text-ink3 text-center p-5">Aucune conversation.<br />Cliquez sur + pour écrire à un collègue.</p>}
          {conversations.map(conv => (
            <button key={conv._id} onClick={() => setActiveConvId(conv._id)}
              className={`w-full flex gap-2 items-center px-3.5 py-2.5 text-left border-b border-line hover:bg-surface2/50 ${activeConvId === conv._id ? "bg-surface2" : ""}`}>
              <div className="w-9 h-9 rounded-full bg-section text-onink grid place-items-center text-[11px] font-semibold shrink-0">{conv.type === "group" ? <Users size={15} /> : initials(convName(conv))}</div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink truncate">{convName(conv)}</p>
                {conv.lastMessage && <p className="text-[11px] text-ink3 truncate">{conv.lastMessage.content}</p>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Zone principale : sélecteur, fil, ou vide */}
      {picking ? (
        <div className="flex-1 flex flex-col">
          <div className="p-3.5 border-b border-line flex items-center gap-2">
            <button onClick={() => setPicking(false)} className="text-ink2 hover:text-ink"><ArrowLeft size={17} /></button>
            <p className="font-semibold text-sm text-ink">Nouvelle conversation</p>
            <button onClick={createGroup} className="ml-auto text-xs text-section font-semibold inline-flex items-center gap-1"><Users size={13} /> Groupe</button>
          </div>
          <div className="p-3 border-b border-line relative">
            <Search size={15} className="absolute left-5 top-1/2 -translate-y-1/2 text-ink3" />
            <input value={dq} onChange={e => setDq(e.target.value)} placeholder="Rechercher un collègue…" className="w-full pl-8 pr-3 h-9 rounded-lg border border-line bg-surface2 text-sm outline-none" />
          </div>
          <div className="flex-1 overflow-auto">
            {dir.filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(dq.toLowerCase())).map(u => (
              <button key={u._id} onClick={() => startDirect(u._id)} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-surface2/50 border-b border-line">
                <div className="w-8 h-8 rounded-full bg-section text-onink grid place-items-center text-[11px] font-semibold">{initials(`${u.firstName} ${u.lastName}`)}</div>
                <span className="text-sm text-ink">{[u.firstName, u.lastName].filter(Boolean).join(" ")}</span>
              </button>
            ))}
            {dir.length === 0 && <p className="text-xs text-ink3 text-center p-5">Aucun autre collaborateur.</p>}
          </div>
        </div>
      ) : activeConvId ? (
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-3 border-b border-line bg-surface2/40">
            <p className="font-semibold text-[13px] text-ink">{convName(conversations.find(c => c._id === activeConvId) || { _id: "", type: "direct", participantIds: [] })}</p>
          </div>
          {Thread}
        </div>
      ) : (
        <div className="flex-1 grid place-items-center text-sm text-ink3">Sélectionnez une conversation, ou cliquez sur + pour en démarrer une.</div>
      )}
    </div>
  );
}
