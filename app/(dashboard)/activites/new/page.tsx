"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Plus, Trash2, MapPin, Video } from "lucide-react";
import toast from "react-hot-toast";

interface TicketType { name: string; price: number; quantity: number; }

const STEPS = ["Informations", "Date & lieu", "Capacité", "Billets", "Publication"];

export default function NewActivitePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    title: "", description: "", category: "", tags: "", coverImage: "",
    startAt: "", endAt: "", locationType: "physical", address: "", meetingLink: "",
    capacity: 0, visibility: "public", isPaid: false,
    sendConfirmation: true, reminderHoursBefore: 24, status: "draft",
  });
  const [tickets, setTickets] = useState<TicketType[]>([{ name: "Tarif normal", price: 0, quantity: 0 }]);

  const u = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  function canNext(): boolean {
    if (step === 0 && !form.title.trim()) { toast.error("Le titre est requis"); return false; }
    if (step === 1) {
      if (!form.startAt) { toast.error("La date de début est requise"); return false; }
      if (form.locationType === "physical" && !form.address.trim()) { toast.error("Le lieu est requis"); return false; }
      if (form.locationType === "online" && !form.meetingLink.trim()) { toast.error("Le lien de visio est requis"); return false; }
    }
    return true;
  }

  async function submit(publish: boolean) {
    if (!form.title.trim() || !form.startAt) { toast.error("Titre et date requis"); setStep(0); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...form,
          capacity: Number(form.capacity) || 0,
          reminderHoursBefore: Number(form.reminderHoursBefore) || 24,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
          ticketTypes: form.isPaid ? tickets.filter((t) => t.name.trim()) : [],
          status: publish ? "published" : "draft",
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Création impossible");
      toast.success(publish ? "Activité publiée" : "Brouillon enregistré");
      router.push(`/activites/${d.data._id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
      setSaving(false);
    }
  }

  const input = "w-full h-10 px-3 bg-surface border border-line2 rounded-md text-sm text-ink placeholder:text-ink3 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-50";
  const label = "block text-xs font-medium text-ink mb-1.5";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="page-title">Nouvelle activité</h1>
        <p className="text-sm text-ink2 mt-0.5">Configurez votre événement, sa billetterie et sa communication.</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2 flex-1 last:flex-none">
            <div className={`flex items-center gap-2 ${i <= step ? "text-accent-700" : "text-ink3"}`}>
              <span className={`w-6 h-6 rounded-full grid place-items-center text-xs font-semibold flex-none ${
                i < step ? "bg-accent text-white" : i === step ? "bg-accent-50 text-accent-700 ring-2 ring-accent" : "bg-surface2 text-ink3"
              }`}>{i < step ? <Check size={13} /> : i + 1}</span>
              <span className="text-xs font-semibold hidden sm:block">{s}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`h-px flex-1 ${i < step ? "bg-accent" : "bg-line"}`} />}
          </div>
        ))}
      </div>

      <div className="card card-p space-y-4">
        {step === 0 && (
          <>
            <div><label className={label}>Titre de l'activité *</label><input className={input} value={form.title} onChange={(e) => u("title", e.target.value)} placeholder="Assemblée générale annuelle" /></div>
            <div><label className={label}>Description</label><textarea className={input + " h-28 py-2 resize-none"} value={form.description} onChange={(e) => u("description", e.target.value)} placeholder="Ordre du jour, informations pratiques…" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Catégorie</label><input className={input} value={form.category} onChange={(e) => u("category", e.target.value)} placeholder="Réunion, Formation, Gala…" /></div>
              <div><label className={label}>Tags (séparés par ,)</label><input className={input} value={form.tags} onChange={(e) => u("tags", e.target.value)} placeholder="membres, 2026" /></div>
            </div>
            <div><label className={label}>Image de couverture (URL)</label><input className={input} value={form.coverImage} onChange={(e) => u("coverImage", e.target.value)} placeholder="https://…" /></div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Début *</label><input type="datetime-local" className={input} value={form.startAt} onChange={(e) => u("startAt", e.target.value)} /></div>
              <div><label className={label}>Fin</label><input type="datetime-local" className={input} value={form.endAt} onChange={(e) => u("endAt", e.target.value)} /></div>
            </div>
            <div>
              <label className={label}>Lieu</label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                {[{ v: "physical", ic: <MapPin size={15} />, l: "Sur place" }, { v: "online", ic: <Video size={15} />, l: "En ligne" }].map((o) => (
                  <button key={o.v} type="button" onClick={() => u("locationType", o.v)}
                    className={`flex items-center gap-2 justify-center h-10 rounded-md border text-sm font-medium transition-colors ${
                      form.locationType === o.v ? "border-accent bg-accent-50 text-accent-700" : "border-line2 text-ink2 hover:bg-surface2"}`}>
                    {o.ic} {o.l}
                  </button>
                ))}
              </div>
              {form.locationType === "physical" ? (
                <input className={input} value={form.address} onChange={(e) => u("address", e.target.value)} placeholder="Adresse ou salle" />
              ) : (
                <input className={input} value={form.meetingLink} onChange={(e) => u("meetingLink", e.target.value)} placeholder="Lien Zoom / Meet / Teams" />
              )}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div><label className={label}>Jauge maximale (0 = illimitée)</label><input type="number" min={0} className={input} value={form.capacity} onChange={(e) => u("capacity", Number(e.target.value))} /></div>
            <div>
              <label className={label}>Visibilité</label>
              <div className="grid grid-cols-2 gap-2">
                {[{ v: "public", l: "Publique" }, { v: "private", l: "Sur invitation" }].map((o) => (
                  <button key={o.v} type="button" onClick={() => u("visibility", o.v)}
                    className={`h-10 rounded-md border text-sm font-medium transition-colors ${form.visibility === o.v ? "border-accent bg-accent-50 text-accent-700" : "border-line2 text-ink2 hover:bg-surface2"}`}>{o.l}</button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-3 p-3 rounded-md border border-line2 cursor-pointer">
              <input type="checkbox" checked={form.isPaid} onChange={(e) => u("isPaid", e.target.checked)} className="accent-accent w-4 h-4" />
              <span className="text-sm"><b className="font-semibold">Activité payante</b><br /><span className="text-ink2 text-xs">Active la billetterie (types de billets à l'étape suivante).</span></span>
            </label>
          </>
        )}

        {step === 3 && (
          form.isPaid ? (
            <div className="space-y-3">
              {tickets.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_90px_90px_auto] gap-2 items-end">
                  <div><label className={label}>Nom du billet</label><input className={input} value={t.name} onChange={(e) => setTickets((ts) => ts.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></div>
                  <div><label className={label}>Prix (F)</label><input type="number" min={0} className={input} value={t.price} onChange={(e) => setTickets((ts) => ts.map((x, j) => j === i ? { ...x, price: Number(e.target.value) } : x))} /></div>
                  <div><label className={label}></label><input type="number" min={0} className={input} value={t.quantity} onChange={(e) => setTickets((ts) => ts.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))} /></div>
                  <button type="button" onClick={() => setTickets((ts) => ts.filter((_, j) => j !== i))} className="h-10 w-10 grid place-items-center rounded-md border border-line2 text-neg hover:bg-neg-50" aria-label="Supprimer"><Trash2 size={15} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setTickets((ts) => [...ts, { name: "", price: 0, quantity: 0 }])} className="btn-secondary"><Plus size={15} /> Ajouter un type de billet</button>
              <p className="text-xs text-ink2">Quantité 0 = illimitée. Le paiement en ligne (mobile money / carte) sera branché dans une phase dédiée ; les inscriptions sont déjà fonctionnelles.</p>
            </div>
          ) : (
            <div className="text-center py-8 text-ink2 text-sm">Activité gratuite — aucun billet payant à configurer. <button type="button" onClick={() => setStep(4)} className="text-accent-700 font-semibold hover:underline">Passer à la publication</button>.</div>
          )
        )}

        {step === 4 && (
          <>
            <label className="flex items-center gap-3 p-3 rounded-md border border-line2 cursor-pointer">
              <input type="checkbox" checked={form.sendConfirmation} onChange={(e) => u("sendConfirmation", e.target.checked)} className="accent-accent w-4 h-4" />
              <span className="text-sm">Envoyer une confirmation d'inscription (email / WhatsApp)</span>
            </label>
            <div><label className={label}>Rappel avant l'événement (heures)</label><input type="number" min={0} className={input} value={form.reminderHoursBefore} onChange={(e) => u("reminderHoursBefore", Number(e.target.value))} /></div>
            <div className="rounded-md bg-surface2 p-3 text-sm text-ink2">
              <b className="text-ink font-semibold">{form.title || "Sans titre"}</b><br />
              {form.startAt ? new Date(form.startAt).toLocaleString("fr-FR") : "Date à définir"} · {form.locationType === "online" ? "En ligne" : form.address || "Lieu à définir"}<br />
              {form.isPaid ? `${tickets.length} type(s) de billet` : "Entrée gratuite"} · {form.capacity > 0 ? `${form.capacity} places` : "Places illimitées"}
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="btn-secondary disabled:opacity-40"><ChevronLeft size={16} /> Précédent</button>
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={() => { if (canNext()) setStep((s) => s + 1); }} className="btn-primary">Suivant <ChevronRight size={16} /></button>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => submit(false)} disabled={saving} className="btn-secondary">Enregistrer le brouillon</button>
            <button type="button" onClick={() => submit(true)} disabled={saving} className="btn-primary">{saving ? "Publication…" : "Publier l'activité"}</button>
          </div>
        )}
      </div>
    </div>
  );
}
