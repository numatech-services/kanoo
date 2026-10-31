"use client";
import { useEffect, useState } from "react";
import { BellRing, Sunrise, TrendingDown, Landmark, Wallet, Send, Stamp, PieChart, Users, AlertTriangle, Percent, PlugZap, PackageCheck, ShieldCheck, CalendarClock, ReceiptText, Gavel, ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { inputCls } from "@/components/ui/FormField";
import { showToast } from "@/components/ui/Toast";
import { apiJson, apiSend } from "@/lib/api-client";
import { useMe, meCanDo } from "@/lib/useMe";
import type { AutomationSettings } from "@/lib/automations";

interface Payload {
  settings: AutomationSettings;
  channels: { email: boolean; whatsapp: boolean; sms: boolean; ai: boolean; whatsappTemplates: Record<string, boolean> };
  users: Array<{ _id: string; name: string; role: string; hasPhone: boolean }>;
  recent: Array<{ kind: string; at: string }>;
  hasDesks: boolean; hasEasypay: boolean;
}

const DAYS = [["1", "Lun"], ["2", "Mar"], ["3", "Mer"], ["4", "Jeu"], ["5", "Ven"], ["6", "Sam"], ["0", "Dim"]] as const;
const KIND_LABEL: Record<string, string> = {
  brief: "Brief du matin", treasury: "Alerte de trésorerie", payroll: "Paie", packet: "Dossier du comptable",
  approvals: "Relance de validation", budget: "Alerte budgétaire", chapter: "Alerte de crédits", cotisation: "Relance de cotisation",
  "comptoir-morning": "Point du matin du comptoir", "easypay-balance": "Reversement EasyPay",
  checks: "Contrôles comptables", fiscal: "Rappel fiscal", suppliers: "Factures fournisseurs", tender: "Offre sans réponse",
  "weekly-inventory": "Inventaire de fin de semaine", "weekly-inventory-reminder": "Relance d'inventaire",
};

function Section({ icon, title, desc, on, onToggle, disabled, children, external }: {
  icon: React.ReactNode; title: string; desc: string; on: boolean; onToggle: (v: boolean) => void; disabled: boolean;
  children?: React.ReactNode; external?: boolean;
}) {
  return (
    <section className={`surface-card p-5 space-y-3 ${on ? "" : "opacity-80"}`}>
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${on ? "bg-section-soft text-section" : "bg-surface2 text-ink3"}`}>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold text-ink text-sm">{title}{external && <span className="ml-2 text-[11px] font-medium text-ink3">écrit hors de Kanoo</span>}</p>
            <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={e => onToggle(e.target.checked)}
              aria-label={`${on ? "Désactiver" : "Activer"} : ${title}`} className="h-4 w-4 accent-[rgb(var(--s-accent))]" />
          </div>
          <p className="text-xs text-ink2 mt-1 leading-relaxed">{desc}</p>
        </div>
      </div>
      {on && children && <div className="pl-12 space-y-3">{children}</div>}
    </section>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-warn flex gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{children}</p>;
}

function Checks<T extends string>({ options, value, onChange, disabled }: { options: Array<[T, string]>; value: T[]; onChange: (v: T[]) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-3">
      {options.map(([k, l]) => (
        <label key={k} className="flex items-center gap-1.5 text-sm text-ink2">
          <input type="checkbox" className="accent-section" disabled={disabled} checked={value.includes(k)}
            onChange={e => onChange(e.target.checked ? [...value, k] : value.filter(x => x !== k))} />{l}
        </label>
      ))}
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, suffix, disabled }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; suffix?: string; disabled: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink2">
      {label}
      <input type="number" className={`${inputCls} w-28`} value={value} min={min} max={max} disabled={disabled} onChange={e => onChange(Number(e.target.value))} />
      {suffix}
    </label>
  );
}

/**
 * Réglages → Automatisations. Les alertes internes sont actives d'office ;
 * ce qui écrit hors de Kanoo (gérant, comptable, adhérents) ou passe des
 * écritures attend d'être activé ici.
 */
export default function AutomationsPage() {
  const me = useMe();
  const canEdit = meCanDo(me, "companies", "update");
  const type = me.tenant?.type ?? "pme";
  const [data, setData] = useState<Payload | null>(null);
  const [s, setS] = useState<AutomationSettings | null>(null);
  const [emails, setEmails] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiJson("/api/automations").then(d => {
      setData(d.data); setS(d.data.settings); setEmails(d.data.settings.accountantPacket.emails.join(", "));
    }).catch(() => showToast("Réglages indisponibles.", "error"));
  }, []);

  const set = <K extends keyof AutomationSettings>(k: K, patch: Partial<AutomationSettings[K]>) =>
    setS(p => p && { ...p, [k]: { ...p[k], ...patch } });

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      const body = { ...s, accountantPacket: { ...s.accountantPacket, emails: emails.split(/[,;\s]+/).filter(Boolean) } };
      const res = await apiSend("PUT", "/api/automations", body);
      if (!res.ok) { showToast(res.data?.error || "Enregistrement refusé.", "error"); return; }
      setS(res.data.data.settings); setEmails(res.data.data.settings.accountantPacket.emails.join(", "));
      showToast("Automatisations enregistrées.", "success");
    } finally { setSaving(false); }
  }

  if (!s || !data) return <div className="space-y-6"><PageHeader title="Automatisations" back={{ href: "/settings", label: "Réglages" }} /><div className="h-64 surface-card animate-pulse" /></div>;
  const ro = !canEdit;
  const ch = data.channels;

  return (
    <div className="space-y-6">
      <PageHeader title="Automatisations"
        subtitle="Ce que Kanoo fait seul, chaque jour : alertes, rappels, envois et écritures de fin d'exercice."
        back={{ href: "/settings", label: "Réglages" }}
        actions={canEdit && <Button onClick={save} loading={saving}>Enregistrer</Button>} />

      <div className="grid lg:grid-cols-2 gap-4">
        <Section icon={<Sunrise size={18} />} title="Brief du matin" external disabled={ro} on={s.morningBrief.enabled} onToggle={v => set("morningBrief", { enabled: v })}
          desc="Chaque matin d'envoi : trésorerie disponible et les priorités du jour (encaissements, urgences, décisions), par e-mail ou WhatsApp, à chaque destinataire selon ses droits.">
          <Checks options={[["email", "E-mail"], ["whatsapp", "WhatsApp"]]} value={s.morningBrief.channels} onChange={v => set("morningBrief", { channels: v })} disabled={ro} />
          {s.morningBrief.channels.includes("email") && !ch.email && <Warn>Aucun fournisseur d&apos;e-mail configuré sur l&apos;instance : les envois ne partiront pas.</Warn>}
          {s.morningBrief.channels.includes("whatsapp") && !ch.whatsapp && <Warn>WhatsApp n&apos;est pas configuré sur l&apos;instance.</Warn>}
          {s.morningBrief.channels.includes("whatsapp") && ch.whatsapp && !ch.whatsappTemplates?.brief && <Warn>Modèle WhatsApp du brief non configuré (WHATSAPP_TEMPLATE_BRIEF) : WhatsApp refuse un message spontané hors d&apos;une conversation ouverte depuis moins de 24 h.</Warn>}
          <div className="flex flex-wrap gap-2">
            {DAYS.map(([d, l]) => {
              const n = Number(d), on = s.morningBrief.days.includes(n);
              return <button key={d} type="button" disabled={ro} onClick={() => set("morningBrief", { days: on ? s.morningBrief.days.filter(x => x !== n) : [...s.morningBrief.days, n] })}
                className={`px-2.5 h-8 rounded-lg text-xs font-semibold border ${on ? "bg-section text-onink border-section" : "border-line2 text-ink2"}`}>{l}</button>;
            })}
          </div>
          <div>
            <p className="text-xs text-ink3 mb-1">Destinataires (aucun coché = les dirigeants)</p>
            <div className="max-h-40 overflow-auto space-y-1">
              {data.users.map(u => (
                <label key={u._id} className="flex items-center gap-2 text-sm text-ink2">
                  <input type="checkbox" className="accent-section" disabled={ro} checked={s.morningBrief.recipientIds.includes(u._id)}
                    onChange={e => set("morningBrief", { recipientIds: e.target.checked ? [...s.morningBrief.recipientIds, u._id] : s.morningBrief.recipientIds.filter(x => x !== u._id) })} />
                  {u.name}{s.morningBrief.channels.includes("whatsapp") && !u.hasPhone && <span className="text-[11px] text-ink3">(sans téléphone)</span>}
                </label>
              ))}
            </div>
          </div>
        </Section>

        <Section icon={<TrendingDown size={18} />} title="Alerte de découvert prévu" disabled={ro} on={s.treasuryAlert.enabled} onToggle={v => set("treasuryAlert", { enabled: v })}
          desc="Chaque jour, la prévision de trésorerie (factures à encaisser, fournisseurs, charges récurrentes, salaires) est recalculée ; si le solde prévu passe sous le seuil, les responsables financiers sont prévenus (une fois par semaine au plus).">
          <NumberField label="Horizon" value={s.treasuryAlert.horizonDays} min={7} max={90} suffix="jours" disabled={ro} onChange={n => set("treasuryAlert", { horizonDays: n })} />
          <NumberField label="Seuil" value={s.treasuryAlert.threshold} suffix="FCFA" disabled={ro} onChange={n => set("treasuryAlert", { threshold: n })} />
        </Section>

        <Section icon={<Landmark size={18} />} title="Amortissements de fin d'exercice" disabled={ro} on={s.depreciation.enabled} onToggle={v => set("depreciation", { enabled: v })}
          desc="Le 1er de chaque mois, les dotations de l'exercice écoulé qui n'ont pas encore été passées le sont (681 / 28, au 31 décembre), au nom de votre comptable. Rien n'est passé sur un exercice clôturé ou une période verrouillée.">
          <p className="text-xs text-ink3">À activer une fois les immobilisations reprises : une immobilisation migrée dont l&apos;amortissement figure déjà dans les soldes d&apos;ouverture doit avoir son annuité marquée comptabilisée.</p>
        </Section>

        <Section icon={<Wallet size={18} />} title="Paie du mois" disabled={ro} on={s.payroll.enabled} onToggle={v => set("payroll", { enabled: v })}
          desc="À partir du jour choisi : rappel aux gestionnaires de paie — bulletins à faire, masse estimée, fiches incomplètes. Option : générer d'office, le dernier jour du mois, les bulletins à salaire fixe.">
          <NumberField label="Rappel le" value={s.payroll.reminderDay} min={1} max={28} suffix="du mois" disabled={ro} onChange={n => set("payroll", { reminderDay: n })} />
          <label className="flex items-center gap-2 text-sm text-ink2">
            <input type="checkbox" className="accent-section" disabled={ro} checked={s.payroll.autoGenerate} onChange={e => set("payroll", { autoGenerate: e.target.checked })} />
            Générer d&apos;office les bulletins à salaire fixe le dernier jour du mois (écritures de paie comprises)
          </label>
        </Section>

        <Section icon={<Send size={18} />} title="Dossier mensuel du comptable" external disabled={ro} on={s.accountantPacket.enabled} onToggle={v => set("accountantPacket", { enabled: v })}
          desc="Chaque mois, pour le mois écoulé : balance, balance cumulée, journal des écritures et états financiers provisoires en Excel, envoyés par e-mail.">
          <label className="block text-sm text-ink2">Adresse(s) du comptable
            <input className={`${inputCls} mt-1`} value={emails} disabled={ro} onChange={e => setEmails(e.target.value)} placeholder="cabinet@exemple.ne, associe@exemple.ne" />
          </label>
          <NumberField label="Envoi le" value={s.accountantPacket.day} min={1} max={28} suffix="du mois" disabled={ro} onChange={n => set("accountantPacket", { day: n })} />
          {!ch.email && <Warn>Aucun fournisseur d&apos;e-mail configuré sur l&apos;instance : le dossier ne partira pas.</Warn>}
        </Section>

        <Section icon={<Stamp size={18} />} title="Rappel des validations en attente" disabled={ro} on={s.approvalReminders.enabled} onToggle={v => set("approvalReminders", { enabled: v })}
          desc="Demandes d'approbation, notes de frais et congés restés sans décision : la personne qui doit décider reçoit une relance (notification et e-mail), tous les deux jours au plus.">
          <NumberField label="Après" value={s.approvalReminders.afterHours} min={12} max={240} suffix="heures d'attente" disabled={ro} onChange={n => set("approvalReminders", { afterHours: n })} />
        </Section>

        <Section icon={<PieChart size={18} />} title={type === "administration" ? "Consommation des crédits" : "Dépassement budgétaire"} disabled={ro} on={s.budgetAlerts.enabled} onToggle={v => set("budgetAlerts", { enabled: v })}
          desc={type === "administration" ? "Quand les engagements d'un chapitre atteignent un seuil des crédits ouverts, l'ordonnateur et la DAF sont prévenus (une fois par seuil)." : "Quand le réalisé d'une ligne de charges du budget de l'exercice atteint un seuil du montant prévu pour l'année, les responsables financiers sont prévenus (une fois par seuil)."}>
          <label className="flex items-center gap-2 text-sm text-ink2">Seuils (%)
            <input className={`${inputCls} w-40`} disabled={ro} defaultValue={s.budgetAlerts.thresholds.join(", ")}
              onBlur={e => set("budgetAlerts", { thresholds: e.target.value.split(/[,;\s]+/).map(Number).filter(n => n > 0) })} />
          </label>
        </Section>

        {type !== "association" && (
          <Section icon={<ShieldCheck size={18} />} title="Contrôles comptables du mois" disabled={ro} on={s.accountingChecks.enabled} onToggle={v => set("accountingChecks", { enabled: v })}
            desc="Chaque mois, les contrôles de cohérence de l'export complet (pièces sans écriture, trésorerie ≠ comptabilité, TVA déclarée ≠ comptable…) sont recalculés ; les responsables financiers reçoivent le nombre de constats critiques et majeurs.">
            <NumberField label="Le" value={s.accountingChecks.day} min={1} max={28} suffix="du mois" disabled={ro} onChange={n => set("accountingChecks", { day: n })} />
            <label className="flex items-center gap-2 text-sm text-ink2">
              <input type="checkbox" className="accent-section" disabled={ro} checked={s.accountingChecks.email} onChange={e => set("accountingChecks", { email: e.target.checked })} />
              Envoyer aussi la liste par e-mail aux responsables financiers
            </label>
            {s.accountingChecks.email && !ch.email && <Warn>Aucun fournisseur d&apos;e-mail configuré sur l&apos;instance.</Warn>}
          </Section>
        )}

        {type === "pme" && (
          <Section icon={<CalendarClock size={18} />} title="Calendrier fiscal" disabled={ro} on={s.fiscalCalendar.enabled} onToggle={v => set("fiscalCalendar", { enabled: v })}
            desc="TVA du mois écoulé (avant le 15) : montants à déclarer le 1er, rappels le 10 et le 14 tant qu'elle n'est pas enregistrée. Acomptes d'IS (20 % avant le 1er juillet, le 1er septembre et le 1er novembre) : rappel 15 jours avant. DSF : rappel en avril." />
        )}

        {type === "pme" && (
          <Section icon={<ReceiptText size={18} />} title="Factures fournisseurs à payer" disabled={ro} on={s.supplierPayments.enabled} onToggle={v => set("supplierPayments", { enabled: v })}
            desc="Une fois par semaine au plus : factures fournisseurs en retard et à payer dans les jours qui viennent (Achats & stock → Échéancier fournisseurs).">
            <NumberField label="Horizon" value={s.supplierPayments.horizonDays} min={1} max={60} suffix="jours" disabled={ro} onChange={n => set("supplierPayments", { horizonDays: n })} />
          </Section>
        )}

        <Section icon={<Gavel size={18} />} title="Offres sans réponse" disabled={ro} on={s.tenderFollowup.enabled} onToggle={v => set("tenderFollowup", { enabled: v })}
          desc="Un appel d'offres déposé ou en évaluation depuis trop longtemps : son responsable est invité à relancer l'acheteur ou à saisir le résultat.">
          <NumberField label="Après" value={s.tenderFollowup.afterDays} min={7} max={180} suffix="jours sans résultat" disabled={ro} onChange={n => set("tenderFollowup", { afterDays: n })} />
        </Section>

        {data.hasDesks && (
          <section className="lg:col-span-2 surface-card p-5 space-y-4">
            <div>
              <p className="font-semibold text-ink text-sm">Comptoir : point du matin</p>
              <p className="text-xs text-ink2 mt-1">Un seul message par comptoir et par jour, qui regroupe ce qui suit. Le gérant, la comptabilité et le chef du comptoir reçoivent tout (marges, réassort, EasyPay) ; le gestionnaire d'activité reçoit le réassort ; les caissiers ne reçoivent rien. Chacun ne reçoit que les comptoirs de son périmètre.</p>
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
              <Section icon={<Percent size={18} />} title="Marges de la veille" disabled={ro} on={s.comptoirMargins.enabled} onToggle={v => set("comptoirMargins", { enabled: v })}
                desc="Ventes une à une sous le coût d'achat, articles dont la marge réalisée est sous leur objectif (hors promotions, au-delà de 1 000 FCFA de manque à gagner), articles vendus sans coût.">
                <NumberField label="Écart toléré" value={s.comptoirMargins.tolerancePts} min={0} max={50} suffix="points sous l'objectif" disabled={ro} onChange={n => set("comptoirMargins", { tolerancePts: n })} />
              </Section>
              <Section icon={<PackageCheck size={18} />} title="Réassort" disabled={ro} on={s.comptoirReorder.enabled} onToggle={v => set("comptoirReorder", { enabled: v })}
                desc="Articles en rupture avant le prochain approvisionnement, ou à leur seuil d'alerte, déduction faite de ce qui est déjà en commande.">
                <label className="flex items-center gap-2 text-sm text-ink2">
                  <input type="checkbox" className="accent-section" disabled={ro} checked={s.comptoirReorder.autoOrder} onChange={e => set("comptoirReorder", { autoOrder: e.target.checked })} />
                  Préparer aussi les bons de commande brouillon, par fournisseur habituel (à valider par l&apos;acheteur ou le gérant)
                </label>
              </Section>
              <Section icon={<ClipboardCheck size={18} />} title="Inventaire de fin de semaine" disabled={ro} on={s.weeklyInventory.enabled} onToggle={v => set("weeklyInventory", { enabled: v })}
                desc="Le jour choisi, à 15 h, l'inventaire de chaque comptoir est ouvert d'office : l'équipe compte au scanner avant la fermeture, le chef valide et le stock est mis à jour. Relance du chef les deux jours suivants tant qu'il n'est pas validé.">
                <label className="flex items-center gap-2 text-sm text-ink2">Jour
                  <select className="h-9 rounded-lg border border-line bg-surface px-2 text-sm" disabled={ro} value={s.weeklyInventory.day} onChange={e => set("weeklyInventory", { day: Number(e.target.value) })}>
                    {["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"].map((j, i) => <option key={j} value={i}>{j}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-ink2">
                  <input type="checkbox" className="accent-section" disabled={ro} checked={s.weeklyInventory.level === "both"} onChange={e => set("weeklyInventory", { level: e.target.checked ? "both" : "desk" })} />
                  Compter aussi la réserve (stock en gros)
                </label>
              </Section>
              <Section icon={<ClipboardCheck size={18} />} title="Rapport du lundi des restaurants" disabled={ro} on={s.restaurantReport.enabled} onToggle={v => set("restaurantReport", { enabled: v })}
                desc="Chaque lundi matin, pour chaque restaurant : la semaine écoulée (tickets, CA, coût matière, pertes, écarts d'inventaire) et le mois (résultat et marge nette contre l'objectif, prix sous le minimum). Au chef du comptoir, à la gérance et à la comptabilité.">
                <label className="flex items-center gap-2 text-sm text-ink2">
                  <input type="checkbox" className="accent-section" disabled={ro} checked={s.restaurantReport.email} onChange={e => set("restaurantReport", { email: e.target.checked })} />
                  Envoyer aussi par e-mail
                </label>
              </Section>
              <Section icon={<ClipboardCheck size={18} />} title="Rappels d'hygiène des restaurants" disabled={ro} on={s.hygieneReminders.enabled} onToggle={v => set("hygieneReminders", { enabled: v })}
                desc="Chaque matin, l'équipe du comptoir est relancée pour les enceintes froides ou chaudes restées sans relevé de température la veille, et pour les plats témoins arrivés à échéance (à jeter et à noter)." />
              {data.hasEasypay && (
                <Section icon={<PlugZap size={18} />} title="EasyPay" disabled={ro} on={s.easypayRecon.enabled} onToggle={v => set("easypayRecon", { enabled: v })}
                  desc="Dans le point du matin : envois de la caisse en attente de traitement (quelle que soit leur date), tickets payés par carte hors comptabilité, caisse silencieuse depuis plus de 24 h. Une fois par semaine au plus, aux responsables financiers : reversement à faire.">
                  <NumberField label="Prévenir quand le solde dû dépasse" value={s.easypayRecon.threshold} min={0} suffix="FCFA (0 = jamais)" disabled={ro} onChange={n => set("easypayRecon", { threshold: n })} />
                </Section>
              )}
            </div>
          </section>
        )}

        {type === "association" && (
          <Section icon={<Users size={18} />} title="Relance des cotisations impayées" external disabled={ro} on={s.cotisationReminders.enabled} onToggle={v => set("cotisationReminders", { enabled: v })}
            desc="Les adhérents actifs dont la cotisation enregistrée n'est pas réglée reçoivent un rappel courtois, au plus une fois par intervalle choisi.">
            <Checks options={[["email", "E-mail"], ["sms", "SMS"], ["whatsapp", "WhatsApp"]]} value={s.cotisationReminders.channels} onChange={v => set("cotisationReminders", { channels: v })} disabled={ro} />
            <NumberField label="Tous les" value={s.cotisationReminders.intervalDays} min={7} max={120} suffix="jours" disabled={ro} onChange={n => set("cotisationReminders", { intervalDays: n })} />
            {s.cotisationReminders.channels.includes("sms") && !ch.sms && <Warn>Les SMS ne sont pas configurés sur l&apos;instance.</Warn>}
            {s.cotisationReminders.channels.includes("whatsapp") && (!ch.whatsapp || !ch.whatsappTemplates?.cotisation) && <Warn>WhatsApp : {ch.whatsapp ? "modèle de relance de cotisation non configuré (WHATSAPP_TEMPLATE_COTISATION) — les messages hors conversation ouverte seront refusés." : "non configuré sur l'instance."}</Warn>}
          </Section>
        )}
      </div>

      <section className="surface-card p-5 space-y-2">
        <p className="font-semibold text-ink text-sm flex items-center gap-2"><BellRing size={16} className="text-section" /> Toujours actif</p>
        <p className="text-xs text-ink2 leading-relaxed">
          Factures en retard, relances clients (selon leur barème), stock minimum et péremption, échéances de contrats, cautions et appels d&apos;offres, documents administratifs.
          {ch.ai ? " Lecture automatique des factures fournisseurs : bouton « Lire une facture » sur Dépenses → Nouvelle dépense." : ""}
        </p>
        {data.recent.length > 0 && (
          <div className="pt-2">
            <p className="text-xs text-ink3 mb-1">Dernières actions automatiques</p>
            <ul className="text-xs text-ink2 space-y-0.5">
              {data.recent.map((r, i) => <li key={i}>{new Date(r.at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} — {KIND_LABEL[r.kind] ?? r.kind}</li>)}
            </ul>
          </div>
        )}
      </section>
      {!canEdit && <p className="text-xs text-ink3">Seul un administrateur de l&apos;organisation peut modifier les automatisations.</p>}
    </div>
  );
}
