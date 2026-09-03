// Server Component — bons de livraison récents
import { connectDB } from "@/lib/db";
import { getServerAuth } from "@/lib/server-auth";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import Link from "next/link";

async function getRecentDeliveries() {
  try {
    const auth = await getServerAuth();
    if (!auth) return [];
    await connectDB();
    const items = await DeliveryNoteModel.find({ tenantId: auth.tenantId })
      .populate("clientId", "name")
      .sort({ deliveryDate: -1 })
      .limit(5)
      .lean();
    return items;
  } catch {
    return [];
  }
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft:               { label: "Brouillon",    cls: "bg-surface2 text-ink2" },
    issued:              { label: "Émis",         cls: "bg-info-50 text-info" },
    delivered:           { label: "Livré",        cls: "bg-pos-50 text-pos" },
    partially_delivered: { label: "Part. livré", cls: "bg-warn-50 text-warn" },
    returned:            { label: "Retourné",     cls: "bg-neg-50 text-neg" },
  };
  const s = map[status] || { label: status, cls: "bg-surface2 text-ink2" };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>;
}

export async function RecentDeliveries() {
  const deliveries = await getRecentDeliveries();

  return (
    <div className="bg-surface rounded-xl border border-line">
      <div className="flex items-center justify-between px-5 py-4 border-b border-line">
        <h2 className="font-semibold text-ink">Bons de livraison</h2>
        <Link href="/livraisons" className="text-sm text-section hover:underline">Voir tout →</Link>
      </div>

      {deliveries.length === 0 ? (
        <div className="px-5 py-8 text-sm text-ink2 text-center">Aucun bon de livraison</div>
      ) : (
        <div className="divide-y divide-line">
          {deliveries.map((d: any) => (
            <Link
              key={String(d._id)}
              href={`/livraisons/${d._id}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-surface2/40 transition-colors"
            >
              <span className="font-mono text-xs text-section font-semibold w-20 shrink-0">{d.number}</span>
              <span className="flex-1 text-sm text-ink truncate">
                {d.clientId && typeof d.clientId === "object" ? (d.clientId as any).name : "—"}
              </span>
              <span className="text-xs text-ink2 shrink-0">
                {new Date(d.deliveryDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
              </span>
              <StatusPill status={d.status} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
