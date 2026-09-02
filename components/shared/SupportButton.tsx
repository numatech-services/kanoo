"use client";
import { useState } from "react";

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || "+22796000000";
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER.replace(/\D/g, "")}?text=${encodeURIComponent("Bonjour, j'ai besoin d'aide avec Kanoo. Mon organisation : ")}`;

export function SupportButton() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject: "", message: "", priority: "medium" });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  async function handleTicket(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    const csrfRes = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    await fetch("/api/support/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include",
      body: JSON.stringify(form),
    });
    setSent(true);
    setSending(false);
    setTimeout(() => { setSent(false); setOpen(false); setForm({ subject: "", message: "", priority: "medium" }); }, 3000);
  }

  const inp = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";

  return (
    <>
      {/* Bouton flottant */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed", bottom: "24px", right: "24px", zIndex: 40,
          width: "52px", height: "52px", borderRadius: "50%",
          background: "#2F3E46", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        }}
        aria-label="Support"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>

      {/* Panneau support */}
      {open && (
        <div style={{
          position: "fixed", bottom: "84px", right: "24px", zIndex: 40,
          width: "320px", background: "#fff", borderRadius: "16px",
          border: "0.5px solid rgba(0,0,0,0.12)", overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ background: "#2F3E46", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ color: "#fff", fontWeight: 500, fontSize: "14px", margin: 0 }}>Support Kanoo</p>
              <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "11px", margin: "2px 0 0" }}>Nous répondons sous 24h</p>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: "18px" }}>×</button>
          </div>

          <div style={{ padding: "14px 16px" }}>
            {/* WhatsApp */}
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex", alignItems: "center", gap: "10px",
                background: "#25D366", color: "#fff", padding: "10px 14px",
                borderRadius: "10px", textDecoration: "none", marginBottom: "12px",
                fontSize: "13px", fontWeight: 500,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Chat WhatsApp
            </a>

            {/* Formulaire ticket */}
            {sent ? (
              <div style={{ textAlign: "center", padding: "16px", background: "#EAF3DE", borderRadius: "10px" }}>
                <p style={{ color: "#3B6D11", fontSize: "13px", fontWeight: 500, margin: 0 }}>✅ Ticket envoyé !</p>
                <p style={{ color: "#639922", fontSize: "11px", margin: "4px 0 0" }}>Réponse sous 24h par email</p>
              </div>
            ) : (
              <form onSubmit={handleTicket} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <p style={{ fontSize: "12px", fontWeight: 500, color: "#374151", margin: 0 }}>Ou ouvrez un ticket :</p>
                <input
                  className={inp}
                  value={form.subject}
                  onChange={e => setForm(p => ({ ...p, subject: e.target.value }))}
                  placeholder="Sujet *"
                  required
                />
                <select
                  className={inp}
                  value={form.priority}
                  onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}
                >
                  <option value="low">Faible</option>
                  <option value="medium">Moyenne</option>
                  <option value="high">Haute</option>
                  <option value="critical">Critique</option>
                </select>
                <textarea
                  className={inp}
                  rows={3}
                  value={form.message}
                  onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
                  placeholder="Décrivez votre problème… *"
                  style={{ resize: "none" }}
                  required
                />
                <button
                  type="submit"
                  disabled={sending}
                  style={{
                    background: "#2F3E46", color: "#fff", border: "none",
                    borderRadius: "8px", padding: "9px", fontSize: "13px",
                    fontWeight: 500, cursor: "pointer", opacity: sending ? 0.6 : 1,
                  }}
                >
                  {sending ? "Envoi…" : "Envoyer le ticket"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
