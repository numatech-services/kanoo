"use client";
import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/Toast";

interface NumberingConfig {
  invoicePrefix: string; quotePrefix: string; orderPrefix: string;
  deliveryPrefix: string; contractPrefix: string;
  separator: string; digitCount: number; yearInNumber: boolean;
  resetYearly: boolean; invoiceStartAt: number;
}
interface Previews { invoice:string; quote:string; order:string; delivery:string; contract:string; }

const FIELDS: Array<{ key: keyof NumberingConfig; label: string; previewKey: keyof Previews }> = [
  { key: "invoicePrefix",  label: "Factures",          previewKey: "invoice"  },
  { key: "quotePrefix",    label: "Devis",             previewKey: "quote"    },
  { key: "orderPrefix",    label: "Bons de commande",  previewKey: "order"    },
  { key: "deliveryPrefix", label: "Bons de livraison", previewKey: "delivery" },
  { key: "contractPrefix", label: "Contrats",          previewKey: "contract" },
];

export default function NumberingPage() {
  const { toast } = useToast();
  const [config, setConfig] = useState<Partial<NumberingConfig>>({});
  const [previews, setPreviews] = useState<Partial<Previews>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/companies/numbering", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        setConfig(d.data?.config || {});
        setPreviews(d.data?.previews || {});
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const csrfRes = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/companies/numbering", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include",
      body: JSON.stringify(config),
    });
    const d = await res.json();
    if (res.ok) {
      toast("Configuration de numérotation enregistrée", "success");
      // Rafraîchir les prévisualisations
      const fresh = await fetch("/api/companies/numbering", { credentials: "include" }).then(r => r.json());
      setPreviews(fresh.data?.previews || {});
    } else {
      toast(d.error || "Erreur", "error");
    }
    setSaving(false);
  }

  const u = (k: keyof NumberingConfig, v: unknown) => setConfig(p => ({ ...p, [k]: v }));
  const inp = "px-3 py-2 border border-clay/30 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cedar/30 uppercase";

  if (loading) return <div className="h-64 bg-white rounded-xl animate-pulse border border-clay/20" />;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <a href="/settings" className="text-xs text-moss hover:text-ink">← Paramètres</a>
        <h1 className="text-2xl font-bold text-ink mt-1">Numérotation des documents</h1>
        <p className="text-sm text-moss mt-1">
          Personnalisez les préfixes de vos factures, devis et autres documents.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-5">

        {/* Préfixes par type */}
        <div className="bg-white rounded-xl border border-clay/20 p-5">
          <h2 className="font-semibold text-ink mb-4">Préfixes par type de document</h2>
          <p className="text-xs text-moss mb-4">Max 10 caractères — lettres majuscules, chiffres, <code>-</code> ou <code>/</code></p>
          <div className="space-y-3">
            {FIELDS.map(f => (
              <div key={f.key} className="grid grid-cols-3 gap-4 items-center">
                <label className="text-sm text-moss">{f.label}</label>
                <input
                  className={inp}
                  value={(config[f.key] as string) || ""}
                  onChange={e => u(f.key, e.target.value.toUpperCase())}
                  placeholder="FAC"
                  maxLength={10}
                />
                <span className="font-mono text-xs text-cedar bg-cedar/5 px-2 py-1 rounded-lg">
                  → {previews[f.previewKey] || "…"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Format */}
        <div className="bg-white rounded-xl border border-clay/20 p-5">
          <h2 className="font-semibold text-ink mb-4">Format du numéro</h2>
          <div className="space-y-4">

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-moss mb-1">Séparateur</label>
                <select
                  className="w-full px-3 py-2 border border-clay/30 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cedar/30"
                  value={config.separator || "-"}
                  onChange={e => u("separator", e.target.value)}
                >
                  {["-", "/", "_", "."].map(s => (
                    <option key={s} value={s}>
                      {s === "-" ? "Tiret (-)" : s === "/" ? "Slash (/)" : s === "_" ? "Underscore (_)" : "Point (.)"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-moss mb-1">Nombre de chiffres</label>
                <select
                  className="w-full px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30"
                  value={config.digitCount || 5}
                  onChange={e => u("digitCount", Number(e.target.value))}
                >
                  {[3, 4, 5, 6, 7, 8].map(n => (
                    <option key={n} value={n}>{n} chiffres (ex: {"0".repeat(n - 1)}1)</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" className="accent-cedar w-4 h-4"
                  checked={config.yearInNumber !== false}
                  onChange={e => u("yearInNumber", e.target.checked)} />
                <span className="text-sm text-ink">Inclure l'année dans le numéro (ex: FAC-<strong>2025</strong>-00001)</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" className="accent-cedar w-4 h-4"
                  checked={config.resetYearly !== false}
                  onChange={e => u("resetYearly", e.target.checked)} />
                <span className="text-sm text-ink">Réinitialiser le compteur chaque 1er janvier</span>
              </label>
            </div>
          </div>
        </div>

        {/* Migration — numéro de départ */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <h2 className="font-semibold text-ink mb-2">Migration depuis un ancien logiciel</h2>
          <p className="text-xs text-moss mb-3">
            Si vous migrez depuis un autre système, définissez le numéro de départ pour éviter les doublons avec vos factures existantes.
          </p>
          <div className="grid grid-cols-2 gap-4 items-center">
            <label className="text-sm text-moss">Prochain numéro de facture</label>
            <input
              type="number"
              className="px-3 py-2 border border-clay/30 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cedar/30"
              value={config.invoiceStartAt || 1}
              onChange={e => u("invoiceStartAt", Number(e.target.value))}
              min={1}
            />
          </div>
          <p className="text-xs text-moss mt-2">
            Exemple : si votre dernière facture était <code className="bg-white px-1 rounded">FAC-2024-00847</code>, saisissez <strong>848</strong>.
          </p>
        </div>

        {/* Prévisualisation live */}
        <div className="bg-white rounded-xl border border-clay/20 p-5">
          <h2 className="font-semibold text-ink mb-3">Prévisualisation</h2>
          <div className="flex flex-wrap gap-2">
            {FIELDS.map(f => (
              <span key={f.key} className="font-mono text-sm bg-cedar/5 text-cedar border border-cedar/20 px-3 py-1.5 rounded-lg">
                {previews[f.previewKey] || "…"}
              </span>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-60 transition-colors"
          >
            {saving ? "Enregistrement…" : "Enregistrer la configuration"}
          </button>
        </div>
      </form>
    </div>
  );
}
