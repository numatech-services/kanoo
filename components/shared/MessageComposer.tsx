"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Send, Search, Users, ArrowLeft, MessageSquare } from "lucide-react";

import { promptDialog } from "@/components/ui/Dialogs";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
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
type Filter = "all" | "direct" | "group";

const initials = (name: string) => name.split(" ").filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
const fullName = (u?: { firstName?: string; lastName?: string } | null) => [u?.firstName, u?.lastName].filter(Boolean).join(" ");
const dayKey = (iso: string) => new Date(iso).toDateString();
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Heure (aujourd'hui), « Hier », ou date courte : la colonne de droite de la liste. */
function when(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
/** Séparateur de jour dans le fil. */
function dayTitle(iso: string) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return "Aujourd'hui";
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

/** Pastille d'initiales, couleur stable par nom. */
function Avatar({ name, size = 36, group = false }: { name: string; size?: number; group?: boolean }) {
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const colors = ["47 89 223", "110 68 188", "0 150 180", "200 110 40", "0 120 64", "194 39 45"];
  return (
    <span className="rounded-full grid place-items-center font-bold text-white shrink-0" aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.32, background: `rgb(${colors[h % colors.length]})` }}>
      {group ? <Users size={size * 0.42} /> : initials(name)}
    </span>
  );
}

/**
 * Messagerie interne : liste des conversations (filtres, recherche) et fil.
 * `compact` : le fil seul (panneau latéral d'un document).
 */
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
  const [dir, setDir] = useState<DirUser[] | null>(null);
  const [dq, setDq] = useState("");
  const [cq, setCq] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
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
    if (!picking || dir) return;
    apiJson("/api/agenda/directory")
      .then(d => setDir((d.success ? d.data : []).filter((u: DirUser) => u._id !== currentUserId)))
      .catch(() => setDir([]));
  }, [picking, dir, currentUserId]);

  async function send() {
    if (sending || !newMessage.trim() || !activeConvId) return;
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
      <div className="flex-1 overflow-auto px-4 py-4 flex flex-col gap-1.5">
        {loading && <p className="text-center text-xs text-ink3 py-4">Chargement…</p>}
        {!loading && messages.length === 0 && <p className="text-center text-xs text-ink3 py-4">Aucun message. Écrivez le premier.</p>}
        {messages.map((m, i) => {
          const mine = m.senderId?._id === currentUserId;
          const prev = messages[i - 1];
          const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
          const firstOfRun = newDay || prev?.senderId?._id !== m.senderId?._id;
          return (
            <div key={m._id}>
              {newDay && (
                <div className="flex items-center gap-3 my-3" role="separator">
                  <span className="flex-1 h-px bg-line" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink3 capitalize">{dayTitle(m.createdAt)}</span>
                  <span className="flex-1 h-px bg-line" />
                </div>
              )}
              <div className={`flex gap-2 items-end ${mine ? "flex-row-reverse" : ""} ${firstOfRun ? "mt-2" : ""}`}>
                {!mine && (firstOfRun && m.senderId ? <Avatar name={fullName(m.senderId)} size={28} /> : <span className="w-7 shrink-0" />)}
                <div className={`max-w-[75%] px-3.5 py-2 text-[14px] rounded-2xl shadow-sm ${mine ? "grad-brand text-white rounded-br-md" : "bg-surface border border-line text-ink rounded-bl-md"}`}>
                  {!mine && firstOfRun && <p className="text-[11px] font-semibold mb-0.5 text-section">{fullName(m.senderId)}</p>}
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                  <p className={`text-[10px] mt-1 text-right ${mine ? "text-white/70" : "text-ink3"}`}>{new Date(m.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={e => { e.preventDefault(); send(); }} className="p-3 border-t border-line flex items-end gap-2 bg-surface">
        <textarea value={newMessage} onChange={e => setNewMessage(e.target.value)} rows={1} placeholder="Écrire un message… (Entrée pour envoyer, Maj+Entrée pour aller à la ligne)"
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} aria-label="Message"
          className="flex-1 resize-none max-h-32 px-4 py-2.5 rounded-2xl border border-line bg-surface2 text-sm text-ink outline-none focus:border-section focus:ring-2 focus:ring-section/20" />
        <button type="submit" disabled={sending || !newMessage.trim()} aria-label="Envoyer"
          className="w-11 h-11 rounded-full grad-brand grad-brand-glow grid place-items-center shrink-0 disabled:opacity-50"><Send size={17} /></button>
      </form>
    </>
  );

  if (compact) {
    return <div className="flex flex-col h-full bg-surface2/30">{Thread}</div>;
  }

  const counts = { all: conversations.length, direct: conversations.filter(c => c.type !== "group").length, group: conversations.filter(c => c.type === "group").length };
  const shown = conversations
    .filter(c => (filter === "all" ? true : filter === "group" ? c.type === "group" : c.type !== "group"))
    .filter(c => !cq.trim() || norm(`${convName(c)} ${c.lastMessage?.content ?? ""}`).includes(norm(cq.trim())));
  const active = conversations.find(c => c._id === activeConvId);
  const others = active ? active.participantIds.filter(p => p._id !== currentUserId) : [];
  const mainOpen = picking || !!activeConvId;

  return (
    <div className="flex h-[calc(100dvh-230px)] min-h-[560px] rounded-[22px] border border-line shadow-card overflow-hidden bg-surface">
      {/* Conversations (masquées sur téléphone quand un fil est ouvert) */}
      <aside className={`w-full md:w-80 md:border-r border-line flex-col shrink-0 ${mainOpen ? "hidden md:flex" : "flex"}`} aria-label="Conversations">
        <div className="p-4 space-y-3 border-b border-line">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-bold text-ink">Conversations <span className="num text-[12px] text-ink3 font-semibold">{conversations.length}</span></p>
            <button onClick={() => setPicking(true)} className="h-9 px-3.5 rounded-full grad-brand text-[13px] font-semibold inline-flex items-center gap-1.5"><Plus size={15} /> Nouvelle</button>
          </div>
          <label className="relative block">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
            <input value={cq} onChange={e => setCq(e.target.value)} placeholder="Rechercher une conversation…" aria-label="Rechercher une conversation"
              className="w-full h-10 pl-10 pr-3 rounded-full border border-line bg-surface2 text-sm outline-none focus:border-section" />
          </label>
          <div className="flex p-1 rounded-xl bg-surface2 gap-1" role="group" aria-label="Filtre">
            {([["all", "Toutes"], ["direct", "Directes"], ["group", "Groupes"]] as Array<[Filter, string]>).map(([k, l]) => (
              <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}
                className={`flex-1 h-8 rounded-lg text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 ${filter === k ? "bg-surface text-ink shadow-sm" : "text-ink2"}`}>
                {l} <span className="num text-[10.5px] text-ink3">{counts[k]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-0.5">
          {conversations.length === 0 && <p className="text-xs text-ink3 text-center p-5">Aucune conversation.<br />« Nouvelle » pour écrire à un collègue.</p>}
          {conversations.length > 0 && shown.length === 0 && <p className="text-xs text-ink3 text-center p-5">Aucune conversation ne correspond.</p>}
          {shown.map(conv => {
            const on = activeConvId === conv._id;
            return (
              <button key={conv._id} onClick={() => { setPicking(false); setActiveConvId(conv._id); }}
                className={`w-full flex gap-3 items-center px-3 py-2.5 rounded-xl text-left ${on ? "bg-section-soft" : "hover:bg-surface2/70"}`}>
                <Avatar name={convName(conv)} group={conv.type === "group"} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`text-[13.5px] font-semibold truncate flex-1 ${on ? "text-section" : "text-ink"}`}>{convName(conv)}</span>
                    <span className="text-[11px] text-ink3 shrink-0">{when(conv.lastMessage?.sentAt)}</span>
                  </span>
                  <span className="block text-[12px] text-ink3 truncate">{conv.lastMessage?.content ?? (conv.type === "group" ? "Groupe" : "Nouvelle conversation")}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Fil, nouvelle conversation, ou accueil */}
      {picking ? (
        <section className="flex-1 flex flex-col min-w-0" aria-label="Nouvelle conversation">
          <div className="px-4 py-3 border-b border-line flex items-center gap-2">
            <button onClick={() => setPicking(false)} className="w-9 h-9 grid place-items-center rounded-full text-ink2 hover:bg-surface2" aria-label="Retour"><ArrowLeft size={17} /></button>
            <p className="font-bold text-[15px] text-ink">Nouvelle conversation</p>
            <button onClick={createGroup} className="ml-auto h-9 px-3.5 rounded-full border border-line text-[13px] font-semibold text-ink inline-flex items-center gap-1.5 hover:bg-surface2"><Users size={14} /> Créer un groupe</button>
          </div>
          <div className="p-4 border-b border-line">
            <label className="relative block">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
              <input value={dq} onChange={e => setDq(e.target.value)} placeholder="Rechercher un collègue…" aria-label="Rechercher un collègue" autoFocus
                className="w-full h-10 pl-10 pr-3 rounded-full border border-line bg-surface2 text-sm outline-none focus:border-section" />
            </label>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {dir === null && <p className="text-xs text-ink3 text-center p-5">Chargement des collègues…</p>}
            {dir?.filter(u => norm(fullName(u)).includes(norm(dq))).map(u => (
              <button key={u._id} onClick={() => startDirect(u._id)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-surface2/70">
                <Avatar name={fullName(u)} size={36} />
                <span className="text-[14px] font-medium text-ink">{fullName(u)}</span>
              </button>
            ))}
            {dir?.length === 0 && <p className="text-xs text-ink3 text-center p-5">Aucun autre collaborateur.</p>}
          </div>
        </section>
      ) : activeConvId ? (
        <section className="flex-1 flex flex-col min-w-0 bg-surface2/30" aria-label={active ? convName(active) : "Conversation"}>
          <div className="px-4 py-3 border-b border-line bg-surface flex items-center gap-3">
            <button onClick={() => setActiveConvId(null)} className="md:hidden w-9 h-9 grid place-items-center rounded-full text-ink2 hover:bg-surface2" aria-label="Retour aux conversations"><ArrowLeft size={17} /></button>
            {active && <Avatar name={convName(active)} group={active.type === "group"} size={40} />}
            <span className="min-w-0">
              <span className="block font-bold text-[15px] text-ink truncate">{active ? convName(active) : "Conversation"}</span>
              <span className="block text-[12px] text-ink3 truncate">
                {active?.type === "group" ? `Groupe · ${active.participantIds.length} membre${active.participantIds.length > 1 ? "s" : ""}` : others.map(fullName).join(", ") || "Conversation directe"}
              </span>
            </span>
          </div>
          <div className="flex-1 flex min-h-0">
            <div className="flex-1 flex flex-col min-w-0">{Thread}</div>
            {active?.type === "group" && (
              <aside className="hidden xl:block w-60 border-l border-line bg-surface p-4 overflow-auto" aria-label="Membres">
                <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink3 mb-3">Membres</p>
                <ul className="space-y-2.5">
                  {active.participantIds.map(p => (
                    <li key={p._id} className="flex items-center gap-2.5"><Avatar name={fullName(p)} size={30} /><span className="text-[13px] text-ink truncate">{fullName(p)}{p._id === currentUserId ? " (vous)" : ""}</span></li>
                  ))}
                </ul>
              </aside>
            )}
          </div>
        </section>
      ) : (
        <section className="flex-1 hidden md:grid place-items-center p-8 bg-surface2/30">
          <div className="text-center max-w-xs">
            <span className="w-14 h-14 rounded-2xl grad-brand grid place-items-center mx-auto"><MessageSquare size={24} /></span>
            <p className="mt-4 text-[16px] font-bold text-ink">Vos échanges d&apos;équipe</p>
            <p className="mt-1 text-sm text-ink2">Choisissez une conversation, ou écrivez à un collègue.</p>
            <button onClick={() => setPicking(true)} className="mt-4 h-10 px-4 rounded-full grad-brand text-sm font-semibold inline-flex items-center gap-2"><Plus size={15} /> Nouvelle conversation</button>
          </div>
        </section>
      )}
    </div>
  );
}
