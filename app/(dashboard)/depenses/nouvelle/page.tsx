"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PurchaseForm, type PurchaseFormValue } from "@/components/achats/PurchaseForm";


import {apiJson, apiSend } from "@/lib/api-client";
import { showToast } from "@/components/ui/Toast";
function NewPurchase() {
  const router = useRouter();
  const sp = useSearchParams();
  const commandeId = sp.get("commandeId");
  const projectId = sp.get("projectId") ?? undefined;
  const [initial, setInitial] = useState<Partial<PurchaseFormValue> | null>(commandeId ? null : {
    kind: sp.get("kind") === "cash" ? "cash" : "invoice", pay: sp.get("kind") === "cash",
    lines: [{ description: "", accountCode: "605500", quantity: 1, unitPrice: 0, tvaRate: 0, projectId }],
  });

  // Depuis un bon de commande : fournisseur, lignes et imputation repris.
  useEffect(() => {
    if (!commandeId) return;
    apiJson(`/api/commandes/${commandeId}`).then(d => {
      const c = d.data;
      if (!c) { setInitial({}); return; }
      const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { _id: string })._id) : v ? String(v) : undefined);
      setInitial({
        kind: "invoice", supplierId: idOf(c.supplierId) ?? "", commandeId,
        lines: c.lines.map((l: { description: string; quantity: number; unitPrice: number; tvaRate?: number; productId?: unknown }) => ({
          description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, tvaRate: l.tvaRate ?? 0,
          accountCode: l.productId ? "601100" : "604000",
          projectId: idOf(c.projectId), activityId: idOf(c.activityId), costCenter: c.costCenter,
        })),
        notes: `Bon de commande ${c.number}`,
      });
    }).catch(() => setInitial({}));
  }, [commandeId]);

  async function submit(v: PurchaseFormValue, validate: boolean) {
    const res = await apiSend("POST", "/api/achats", {
        kind: v.kind, supplierId: v.supplierId || undefined, payee: v.payee, supplierRef: v.supplierRef, date: v.date, dueDate: v.dueDate || undefined,
        notes: v.notes, commandeId: v.commandeId, lines: v.lines, validate,
        ...(v.kind === "cash" && v.pay && validate ? { payment: { treasuryAccountId: v.treasuryAccountId } } : {}),
      });
    const d = res.data;
    if (!res.ok) throw new Error(d.error || "Enregistrement impossible");
    // Facture lue automatiquement : jointe comme justificatif. Un échec ici
    // n'annule pas l'achat enregistré ; on le signale et on continue.
    if (v.scanned) {
      const body = new FormData();
      body.append("file", v.scanned.blob, v.scanned.name);
      body.append("host", "purchases");
      body.append("hostId", d.data._id);
      body.append("category", "facture");
      body.append("label", "Facture fournisseur (lue automatiquement)");
      const up = await apiSend("POST", "/api/attachments", body).catch(() => ({ ok: false, data: {} as { error?: string } }));
      if (!up.ok) showToast(`Achat enregistré, mais la facture n'a pas pu être jointe : ${up.data?.error || "réessayez depuis la fiche"}.`, "error");
    }
    router.push(`/depenses/${d.data._id}`);
  }

  return (
    <div className="max-w-4xl space-y-5">
      <Link href="/depenses" className="text-xs text-ink2 hover:text-ink inline-flex items-center gap-1"><ArrowLeft size={12} /> Achats & dépenses</Link>
      <h1 className="page-title">Nouvel achat / dépense</h1>
      <div className="bg-surface rounded-2xl border border-line p-6">
        {initial ? <PurchaseForm initial={initial} onSubmit={submit} scan={!commandeId} /> : <div className="h-40 animate-pulse bg-surface2 rounded-xl" />}
      </div>
    </div>
  );
}

export default function NewPurchasePage() {
  return <Suspense fallback={null}><NewPurchase /></Suspense>;
}
