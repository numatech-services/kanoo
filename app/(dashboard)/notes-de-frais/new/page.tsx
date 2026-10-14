"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FormField, inputCls, selectCls, textareaCls } from "@/components/ui/FormField";
import { Inset } from "@/components/ui/Primitives";

import { buttonClass } from "@/components/ui/button-class";
interface Employee { _id: string; firstName: string; lastName: string; code?: string }

const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export default function NouvelleNotePage() {
  const router = useRouter();
  const now = new Date();
  const [form, setForm] = useState({
    title: "",
    employeeId: "",
    periodMonth: now.getMonth() + 1,
    periodYear: now.getFullYear(),
    notes: "",
  });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [canPickOther, setCanPickOther] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // La liste ne sert qu'à ceux qui valident ; pour les autres, l'API impose
    // déjà le bénéficiaire et le champ resterait décoratif.
    fetch("/api/employees?limit=200", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setEmployees(d.data?.items || []);
          setCanPickOther(true);
        }
      })
      .catch(() => setCanPickOther(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { csrfToken } = await fetch("/api/auth/csrf").then(r => r.json());
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify({
          ...form,
          employeeId: form.employeeId || undefined,
          lines: [],
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Création refusée");
      // On enchaîne directement sur la saisie des dépenses : créer une note
      // vide puis revenir à la liste ferait perdre l'élan.
      router.push(`/notes-de-frais/${d.data._id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible");
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/notes-de-frais" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1">
          <ArrowLeft size={13} /> Notes de frais
        </Link>
        <h1 className="page-title mt-1">Nouvelle note de frais</h1>
        <p className="text-sm text-ink2">
          L&apos;en-tête d&apos;abord, les dépenses ensuite — avec leurs justificatifs.
        </p>
      </div>

      {error && <p className="px-4 py-3 bg-neg-50 border border-neg/25 rounded-xl text-sm text-neg">{error}</p>}

      <form onSubmit={submit} className="surface-card p-6 space-y-5">
        <FormField label="Objet" required
          hint="« Mission Maradi, septembre » se retrouve dans six mois ; « Note 47 » non.">
          <input className={inputCls} value={form.title} required autoFocus
            placeholder="Mission Maradi, septembre"
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
        </FormField>

        <div className="grid sm:grid-cols-2 gap-4">
          <FormField label="Mois concerné">
            <select className={selectCls} value={form.periodMonth}
              onChange={e => setForm(f => ({ ...f, periodMonth: Number(e.target.value) }))}>
              {MOIS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </FormField>
          <FormField label="Année">
            <input type="number" className={inputCls} value={form.periodYear}
              min={2020} max={2100}
              onChange={e => setForm(f => ({ ...f, periodYear: Number(e.target.value) }))} />
          </FormField>
        </div>

        {canPickOther && employees.length > 0 && (
          <FormField label="Bénéficiaire du remboursement"
            hint="Laisser vide pour vous-même. Désigner quelqu'un d'autre suppose le droit de valider.">
            <select className={selectCls} value={form.employeeId}
              onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}>
              <option value="">— Moi-même —</option>
              {employees.map(emp => (
                <option key={emp._id} value={emp._id}>
                  {emp.firstName} {emp.lastName}{emp.code ? ` (${emp.code})` : ""}
                </option>
              ))}
            </select>
          </FormField>
        )}

        <FormField label="Notes">
          <textarea className={textareaCls} rows={3} value={form.notes}
            placeholder="Contexte de la mission, référence de l'ordre de mission…"
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </FormField>

        <Inset tone="info">
          Chaque dépense demandera son justificatif. Sans lui, la charge n&apos;est pas
          déductible et la TVA pas récupérable&nbsp;: la note ne pourra pas partir en
          validation.
        </Inset>

        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <Link href="/notes-de-frais"
            className={buttonClass("secondary", "md")}>
            Annuler
          </Link>
          <button type="submit" disabled={saving || !form.title.trim()}
            className={buttonClass("primary", "md")}>
            {saving ? "Création…" : "Créer et saisir les dépenses"}
          </button>
        </div>
      </form>
    </div>
  );
}
