"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Check, Users } from "lucide-react";

interface Plan {
  code: string;
  label: string;
  targetType: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  maxUsers: number;
  features: string[];
  highlighted: boolean;
}

export default function TarifsPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [filter, setFilter] = useState<"all" | "pme" | "association" | "administration">("all");

  useEffect(() => {
    fetch("/api/public/plans")
      .then((r) => r.json())
      .then((d) => setPlans(d.data || []))
      .catch(() => {});
  }, []);

  const filtered = plans.filter((p) => filter === "all" || p.targetType === filter);
  const fmt = (n: number) => n.toLocaleString("fr-FR") + " F";

  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-6 py-16">
      <div className="text-center max-w-2xl mx-auto">
        <span className="text-xs font-bold uppercase tracking-wider text-accent-700 bg-accent-50 px-3 py-1.5 rounded-full">Tarifs</span>
        <h1 className="font-display font-semibold text-ink text-[clamp(2rem,5vw,3rem)] tracking-tight mt-5">Simples et transparents.</h1>
        <p className="text-ink2 mt-3 text-lg">Conçus pour les PME, associations et administrations du Niger.</p>

        <div className="flex items-center justify-center gap-3 mt-7">
          <span className={`text-sm ${billing === "monthly" ? "text-ink font-semibold" : "text-ink2"}`}>Mensuel</span>
          <button
            onClick={() => setBilling((b) => (b === "monthly" ? "yearly" : "monthly"))}
            aria-label="Basculer mensuel / annuel"
            className={`relative w-12 h-6 rounded-full transition-colors ${billing === "yearly" ? "bg-accent" : "bg-line2"}`}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${billing === "yearly" ? "translate-x-7" : "translate-x-1"}`} />
          </button>
          <span className={`text-sm ${billing === "yearly" ? "text-ink font-semibold" : "text-ink2"}`}>
            Annuel <span className="text-acacia font-semibold">(−17 %)</span>
          </span>
        </div>

        <div className="flex items-center justify-center gap-2 mt-5 flex-wrap">
          {(["all", "pme", "association", "administration"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 h-9 rounded-full text-sm font-medium transition-colors ${filter === f ? "bg-ink text-bg" : "bg-surface border border-line2 text-ink2 hover:bg-surface2"}`}
            >
              {f === "all" ? "Tous" : f === "pme" ? "PME" : f === "association" ? "Associations" : "Administrations"}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-ink2 mt-14">Chargement des offres…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mt-12">
          {filtered.map((plan) => (
            <div key={plan.code} className={`rounded-2xl bg-surface p-6 flex flex-col border ${plan.highlighted ? "border-accent shadow-soft" : "border-line"}`}>
              {plan.highlighted && (
                <span className="self-start bg-accent text-white text-xs px-3 py-1 rounded-full font-semibold mb-4">Recommandé</span>
              )}
              <span className="text-xs font-bold uppercase tracking-wider text-accent-700">
                {plan.targetType === "pme" ? "PME" : plan.targetType === "association" ? "Association" : "Administration"}
              </span>
              <h3 className="font-display font-semibold text-xl text-ink mt-1">{plan.label}</h3>

              <div className="mt-4 mb-6">
                <span className="font-display text-4xl font-semibold text-ink num">{fmt(billing === "monthly" ? plan.priceMonthly : Math.round(plan.priceYearly / 12))}</span>
                <span className="text-ink2 text-sm">/mois</span>
                {billing === "yearly" && <p className="text-xs text-acacia mt-1">Facturé {fmt(plan.priceYearly)}/an</p>}
              </div>

              <ul className="space-y-2.5 flex-1 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-ink">
                    <span className="w-4 h-4 rounded-full bg-acacia-50 text-acacia grid place-items-center flex-none mt-0.5"><Check size={11} /></span>{f}
                  </li>
                ))}
                <li className="flex items-start gap-2.5 text-sm text-ink2"><Users size={14} className="mt-0.5" />{plan.maxUsers} utilisateurs max</li>
              </ul>

              <Link
                href={`/souscrire?plan=${plan.code}`}
                className={`w-full h-11 rounded-full text-sm font-semibold inline-flex items-center justify-center transition-colors ${plan.highlighted ? "bg-accent text-white hover:bg-accent-600" : "border border-accent text-accent-700 hover:bg-accent-50"}`}
              >
                Commencer l'essai gratuit
              </Link>
            </div>
          ))}
        </div>
      )}

      <p className="text-center mt-10 text-ink2 text-sm">
        <span className="text-acacia font-semibold">30 jours d'essai gratuit</span> — aucune carte bancaire requise. Résiliable à tout moment.
      </p>
    </div>
  );
}
