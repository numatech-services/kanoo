// Server Component — lit directement la DB
import { connectDB } from "@/lib/db";
import { getServerAccess } from "@/lib/server-auth";
import { InvoiceModel } from "@/models/Invoice";
import Link from "next/link";

async function getRecentInvoices() {
  try {
    const access = await getServerAccess();
    // Même droit que l'API « invoices » : sans lui, le bloc n'est pas affiché.
    if (!access || !access.can("invoices")) return null;
    const auth = access.auth;
    await connectDB();
    const items = await InvoiceModel.find({ tenantId: auth.tenantId })
      .populate("clientId", "name")
      .sort({ issueDate: -1 })
      .limit(8)
      .lean();
    return items;
  } catch {
    return [];
  }
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft:    { label: "Brouillon",    cls: "bg-surface2 text-ink2" },
    sent:     { label: "Émise",        cls: "bg-info-50 text-info" },
    partial:  { label: "Part. payée", cls: "bg-warn-50 text-warn" },
    paid:     { label: "Soldée",       cls: "bg-pos-50 text-pos" },
    overdue:  { label: "En retard",   cls: "bg-neg-50 text-neg" },
    cancelled:{ label: "Annulée",      cls: "bg-surface2 text-ink3" },
  };
  const s = map[status] || { label: status, cls: "bg-surface2 text-ink2" };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>;
}

export async function RecentInvoices() {
  const invoices = await getRecentInvoices();
  if (invoices === null) return null;

  return (
    <div className="bg-surface rounded-xl border border-line">
      <div className="flex items-center justify-between px-6 py-4 border-b border-line">
        <h2 className="font-semibold text-ink">Factures récentes</h2>
        <Link href="/invoices" className="text-sm text-section hover:underline">Voir tout →</Link>
      </div>

      {invoices.length === 0 ? (
        <div className="px-6 py-10 text-sm text-ink2 text-center">
          Aucune facture pour le moment
        </div>
      ) : (
        <div className="divide-y divide-line">
          {invoices.map((inv: any) => {
            const overdue = !["paid","cancelled"].includes(inv.status) && new Date(inv.dueDate) < new Date();
            const displayStatus = overdue ? "overdue" : inv.status;
            const remaining = inv.totalTTC - inv.paidAmount - (inv.creditedAmount ?? 0) - (inv.retentionAmount ?? 0);
            return (
              <Link
                key={String(inv._id)}
                href={`/invoices/${inv._id}`}
                className="flex items-center gap-4 px-6 py-3 hover:bg-surface2/40 transition-colors"
              >
                <span className="font-mono text-sm text-section font-semibold w-28 shrink-0">{inv.number}</span>
                <span className="flex-1 text-sm text-ink truncate">
                  {inv.clientId && typeof inv.clientId === "object" ? (inv.clientId as any).name : "—"}
                </span>
                <span className={`text-xs font-mono shrink-0 ${overdue ? "text-neg font-semibold" : "text-ink2"}`}>
                  {new Date(inv.dueDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                </span>
                <span className="font-mono text-sm font-semibold shrink-0 w-36 text-right">
                  {remaining > 0
                    ? <span className="text-neg">{remaining.toLocaleString("fr-FR")} FCFA dû</span>
                    : <span className="text-pos">{inv.totalTTC.toLocaleString("fr-FR")} FCFA</span>
                  }
                </span>
                <StatusPill status={displayStatus} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
