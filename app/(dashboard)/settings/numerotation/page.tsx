"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import { FormField, inputCls } from "@/components/ui/FormField";

interface Numbering {
  prefixes: Record<string, string>;
  sequences: Record<string, number>;
  defaults: Record<string, string>;
  exampleNumbers: Record<string, string>;
}

const DOCUMENT_TYPES = [
  { key: "invoice",  label: "Factures",          icon: "🧾", example: "FAC-2025-00001" },
  { key: "devis",    label: "Devis",              icon: "📋", example: "DEV-2025-00001" },
  { key: "commande", label: "Bons de commande",   icon: "📦", example: "BC-2025-00001" },
  { key: "delivery", label: "Bons de livraison",  icon: "🚚", example: "BL-2025-00001" },
  { key: "marche",   label: "Marchés",            icon: "📜", example: "MRC-2025-00001" },
  { key: "contract", label: "Contrats",           icon: "✍️", example: "CTR-2025-00001" },
];

const SEQ_TYPES = [
  { key: "invoice",  label: "Factures" },
  { key: "devis",    label: "Devis" },
  { key: "commande", label: "Bons de commande" },
  { key: "delivery", label: "Bons de livraison" },
];

export default function NumerotationPage() {
  const { toast } = useToast();
  const [numbering, setNumbering] = useState<Numbering | null>(null);
  const [prefixes, setPrefixes] = useState<Record<string, string>>({});
  const [sequences, setSequences] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showMigration, setShowMigration] = useState(false);

  useEffect(() => {
    fetch("/api/companies/numbering", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        setNumbering(d.data);
        setPrefixes(d.data?.prefixes || {});
        setSequences(d.data?.sequences || {});
      })
      .finally(() => setLoading(false));
  }, []);

  function previewNumber(type: string): string {
    const prefix = prefixes[type] || "XXX";
    const year = new Date().getFullYear();
    const start = sequences[type] || 0;
    return `${prefix.toUpperCase()}-${year}-${String(start + 1).padStart(5, "0")}`;
  }

  function isModified(type: string): boolean {
    return (prefixes[type] || "").toUpperCase() !== (numbering?.defaults[type] || "").toUpperCase();
  }

  async function handleSave() {
    setSaving(true);
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      const res = await fetch("/api/companies/numbering", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include",
        body: JSON.stringify({ prefixes, sequences }),
      });
      const d = await res.json();
      if (res.ok) {
        toast("Numérotation mise à jour avec succès", "success");
        setNumbering(prev => prev ? { ...prev, prefixes, sequences } : prev);
      } else {
        toast(d.error || "Erreur de sauvegarde", "error");
      }
    } catch {
      toast("Erreur réseau", "error");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!numbering) return;
    setPrefixes(numbering.defaults);
    setSequences({});
  }

  if (loading) {
    return (
      <div className="space-y-4 max-w-2xl">
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white rounded-xl animate-pulse border border-clay/20" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <div className="flex items-center gap-2 text-xs text-moss mb-2">
          <a href="/dashboard" className="hover:text-ink">Paramètres</a>
          <span>→</span>
          <span className="text-ink">Numérotation</span>
        </div>
        <h1 className="text-2xl font-bold text-ink">Numérotation des documents</h1>
        <p className="text-sm text-moss mt-1">
          Personnalisez le préfixe de chaque type de document.
          Format : <code className="bg-sand px-1.5 py-0.5 rounded font-mono text-xs">PRÉFIXE-AAAA-NNNNN</code>
        </p>
      </div>

      {/* Préfixes */}
      <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
        <div className="px-5 py-4 border-b border-clay/10 flex justify-between items-center">
          <h2 className="font-semibold text-ink">Préfixes des documents</h2>
          <button onClick={handleReset} className="text-xs text-moss hover:text-ink hover:underline">
            Rétablir les valeurs par défaut
          </button>
        </div>
        <div className="divide-y divide-clay/10">
          {DOCUMENT_TYPES.map(({ key, label, icon }) => {
            const modified = isModified(key);
            const preview = previewNumber(key);
            const validation = prefixes[key]
              ? /^[A-Z0-9\-]{2,6}$/i.test(prefixes[key])
              : true;

            return (
              <div key={key} className="px-5 py-4 flex items-center gap-4">
                <span className="text-xl w-8 text-center flex-shrink-0">{icon}</span>
                <div className="w-32 flex-shrink-0">
                  <p className="text-sm font-medium text-ink">{label}</p>
                  <p className="text-xs text-moss mt-0.5">
                    Défaut : <code className="font-mono">{numbering?.defaults[key]}</code>
                  </p>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <input
                      className={`w-24 px-3 py-2 border rounded-lg text-sm font-mono uppercase text-center focus:outline-none focus:ring-2 focus:ring-cedar/30 ${
                        !validation
                          ? "border-red-300 bg-red-50"
                          : modified
                          ? "border-cedar/50 bg-cedar/5"
                          : "border-clay/30"
                      }`}
                      value={prefixes[key] || ""}
                      onChange={e => setPrefixes(prev => ({ ...prev, [key]: e.target.value.toUpperCase().slice(0, 6) }))}
                      placeholder={numbering?.defaults[key] || ""}
                      maxLength={6}
                    />
                    <span className="text-moss text-sm">-</span>
                    <span className="text-moss text-sm font-mono">{new Date().getFullYear()}</span>
                    <span className="text-moss text-sm">-</span>
                    <span className="text-moss text-sm font-mono">00001</span>
                  </div>
                  {!validation && (
                    <p className="text-xs text-red-600 mt-1">2 à 6 caractères (lettres, chiffres, tiret)</p>
                  )}
                </div>
                <div className="text-right min-w-0">
                  <p className="text-xs text-moss">Aperçu</p>
                  <code className={`text-sm font-mono font-semibold ${modified ? "text-cedar" : "text-moss"}`}>
                    {preview}
                  </code>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Migration — numéro de départ */}
      <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
        <button
          onClick={() => setShowMigration(!showMigration)}
          className="w-full px-5 py-4 flex justify-between items-center text-left hover:bg-sand/50 transition-colors"
        >
          <div>
            <p className="font-semibold text-ink text-sm">Migration depuis un logiciel existant</p>
            <p className="text-xs text-moss mt-0.5">Définissez le numéro de séquence de départ pour continuer votre numérotation actuelle</p>
          </div>
          <span className="text-moss text-lg">{showMigration ? "−" : "+"}</span>
        </button>

        {showMigration && (
          <div className="px-5 pb-5 pt-2 border-t border-clay/10">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 mb-4">
              ⚠️ <strong>Important :</strong> Si vos dernières factures se terminent à FAC-2025-00247, saisissez <strong>247</strong> comme numéro de départ pour que la prochaine facture soit FAC-2025-00248.
            </div>
            <div className="grid grid-cols-2 gap-4">
              {SEQ_TYPES.map(({ key, label }) => (
                <FormField key={key} label={`${label} — numéro de départ`} hint={`Prochaine : ${previewNumber(key)}`}>
                  <input
                    type="number"
                    className={inputCls}
                    value={sequences[key] || 0}
                    onChange={e => setSequences(prev => ({ ...prev, [key]: Math.max(0, parseInt(e.target.value) || 0) }))}
                    min={0}
                    max={999999}
                  />
                </FormField>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <button onClick={handleReset} className="px-5 py-2.5 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand transition-colors">
          Annuler les modifications
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink transition-colors disabled:opacity-60"
        >
          {saving ? "Enregistrement…" : "Enregistrer la numérotation"}
        </button>
      </div>
    </div>
  );
}
