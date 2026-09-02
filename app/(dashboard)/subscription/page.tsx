"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

interface Plan { id:string; label:string; price:number; priceYearly:number; features:string[]; popular?:boolean; }

const PLANS: Plan[] = [
  { id:"starter", label:"PME Starter", price:15_000, priceYearly:150_000,
    features:["3 utilisateurs","Facturation + devis","Comptabilité de base","Clients & fournisseurs","Support email"] },
  { id:"pro", label:"PME Pro", price:35_000, priceYearly:350_000, popular:true,
    features:["10 utilisateurs","Tout Starter +","Paie CNSS + bulletins","Fiscalité Niger complète","Projets & contrats","API publique v1","Support prioritaire"] },
  { id:"asso_pro", label:"Association Pro", price:25_000, priceYearly:250_000,
    features:["10 utilisateurs","Membres + cotisations","Projets bailleurs","Portail adhérent","AG & bureau","Documents"] },
  { id:"admin", label:"Administration", price:50_000, priceYearly:500_000,
    features:["20 utilisateurs","Budget public","Marchés publics","Portail fournisseur","Personnel & projets","Rapports DGI"] },
];

export default function SubscriptionPage() {
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState<"monthly"|"yearly">("monthly");
  const [loading, setLoading] = useState<string|null>(null);
  const [status, setStatus] = useState<""|"success"|"cancelled">(
    (searchParams.get("status") as "success"|"cancelled") || ""
  );
  const [currentPlan, setCurrentPlan] = useState<string>("");

  useEffect(() => {
    fetch("/api/auth/me", { credentials:"include" }).then(r=>r.json()).then(d=>{
      setCurrentPlan(d.data?.user?.planId || "");
    });
  }, []);

  async function handleSubscribe(planId: string) {
    setLoading(planId);
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/subscription/pay", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-csrf-token":csrfToken},
      credentials:"include",
      body:JSON.stringify({ plan:planId, period }),
    });
    const d = await res.json();
    if (d.data?.paymentUrl) {
      window.location.href = d.data.paymentUrl;
    } else {
      alert(d.error || "Erreur lors de l'initiation du paiement");
    }
    setLoading(null);
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-ink">Abonnement</h1>
        <p className="text-sm text-moss mt-0.5">Paiement sécurisé via Orange Money, Airtel Money et carte bancaire</p>
      </div>

      {status === "success" && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <span className="text-green-600 text-xl">✅</span>
          <div>
            <p className="font-semibold text-green-800">Paiement confirmé !</p>
            <p className="text-sm text-green-600">Votre abonnement a été activé. Un email de confirmation vous a été envoyé.</p>
          </div>
        </div>
      )}

      {status === "cancelled" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-amber-800 text-sm">Paiement annulé. Votre compte reste actif en mode essai.</p>
        </div>
      )}

      {/* Toggle mensuel / annuel */}
      <div className="flex items-center gap-3">
        <span className={`text-sm ${period==="monthly"?"font-semibold text-ink":"text-moss"}`}>Mensuel</span>
        <button onClick={() => setPeriod(p => p==="monthly"?"yearly":"monthly")}
          className={`relative w-12 h-6 rounded-full transition-colors ${period==="yearly"?"bg-cedar":"bg-clay/30"}`}>
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${period==="yearly"?"translate-x-7":"translate-x-1"}`}/>
        </button>
        <span className={`text-sm ${period==="yearly"?"font-semibold text-ink":"text-moss"}`}>
          Annuel <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full ml-1">-17%</span>
        </span>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLANS.map(plan => {
          const price = period === "yearly" ? plan.priceYearly : plan.price;
          const isActive = currentPlan === plan.id;
          return (
            <div key={plan.id} className={`bg-white rounded-xl border p-5 flex flex-col transition-all ${plan.popular?"border-cedar shadow-sm":"border-clay/20"}`}>
              {plan.popular && (
                <div className="-mt-5 -mx-5 mb-3 bg-cedar text-white text-xs font-semibold text-center py-1.5 rounded-t-xl">
                  Recommandé
                </div>
              )}
              <p className="text-xs text-moss uppercase tracking-wide">{plan.label}</p>
              <p className="text-2xl font-bold text-ink mt-1 font-mono">
                {price.toLocaleString("fr-FR")}
                <span className="text-xs font-normal text-moss"> XOF/{period==="yearly"?"an":"mois"}</span>
              </p>
              {period === "yearly" && (
                <p className="text-xs text-green-600 mt-0.5">= {Math.round(plan.priceYearly/12/1000)}k XOF/mois</p>
              )}
              <ul className="mt-4 space-y-1.5 flex-1">
                {plan.features.map(f => (
                  <li key={f} className="text-xs text-moss flex items-start gap-1.5">
                    <span className="text-green-600 flex-shrink-0 mt-0.5">✓</span>{f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleSubscribe(plan.id)}
                disabled={!!loading || isActive}
                className={`mt-5 w-full py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-60 ${
                  isActive ? "bg-green-100 text-green-700 cursor-default"
                  : plan.popular ? "bg-cedar text-white hover:bg-ink"
                  : "border border-clay/30 text-moss hover:bg-sand"
                }`}
              >
                {isActive ? "✅ Plan actuel"
                 : loading === plan.id ? "Redirection…"
                 : "Payer via Orange Money / Carte"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="bg-sand rounded-xl p-4 flex items-start gap-3">
        <span className="text-lg flex-shrink-0">🔒</span>
        <div>
          <p className="text-sm font-medium text-ink">Paiement sécurisé par PayDunya</p>
          <p className="text-xs text-moss mt-0.5">Orange Money Niger · Airtel Money · Moov Money · Carte bancaire Visa/Mastercard. Vos données bancaires ne transitent jamais par Kanoo.</p>
        </div>
      </div>
    </div>
  );
}
