"use client";
import { useState, useEffect } from "react";

type Level = "ok" | "warn" | "critical";

interface Control {
  key: string;
  label: string;
  level: Level;
  value: string;
  detail: string;
}

const STYLES: Record<Level, { badge: string; dot: string; text: string }> = {
  ok:       { badge: "bg-green-50 border-green-200",  dot: "bg-green-600",  text: "text-green-800" },
  warn:     { badge: "bg-amber-50 border-amber-200",  dot: "bg-amber-500",  text: "text-amber-800" },
  critical: { badge: "bg-red-50 border-red-200",      dot: "bg-red-600",    text: "text-red-800" },
};

const SUMMARY: Record<Level, string> = {
  ok: "Aucun écart détecté sur les contrôles mesurables.",
  warn: "Des points d'attention subsistent — sans blocage immédiat.",
  critical: "Un ou plusieurs contrôles critiques sont en défaut.",
};

export default function SecurityPage() {
  const [controls, setControls] = useState<Control[]>([]);
  const [worst, setWorst] = useState<Level>("ok");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/superadmin/security/posture", { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (!d.success) throw new Error(d.error || "Lecture impossible");
        setControls(d.data.controls);
        setWorst(d.data.worst);
        setCheckedAt(d.data.checkedAt);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Posture de sécurité</h1>
        <p className="text-moss text-sm mt-1">
          État relevé sur cette instance à l&apos;instant de la consultation. Seuls les
          contrôles réellement observables à l&apos;exécution sont affichés.
        </p>
      </div>

      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 bg-sand animate-pulse rounded-xl" />)}
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm">
          Impossible de relever la posture : {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className={`p-4 rounded-xl border ${STYLES[worst].badge}`}>
            <p className={`font-semibold ${STYLES[worst].text}`}>{SUMMARY[worst]}</p>
            {checkedAt && (
              <p className="text-xs text-moss mt-1">
                Relevé le {new Date(checkedAt).toLocaleString("fr-FR")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {controls.map(c => (
              <div key={c.key} className="bg-white rounded-xl border border-clay/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs text-moss">{c.label}</p>
                  <span className={`h-2 w-2 rounded-full shrink-0 mt-1 ${STYLES[c.level].dot}`} />
                </div>
                <p className={`font-bold mt-1 ${STYLES[c.level].text}`}>{c.value}</p>
                <p className="text-xs text-moss mt-2 leading-relaxed">{c.detail}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
