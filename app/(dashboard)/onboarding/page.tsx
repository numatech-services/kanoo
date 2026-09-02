"use client";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const STEPS = [
  { id:1, icon:"🏢", title:"Votre organisation",     desc:"Informations de base (NIF, RCCM, adresse)" },
  { id:2, icon:"🔢", title:"Numérotation",            desc:"Préfixes de vos documents (FAC, DEV…)" },
  { id:3, icon:"📊", title:"Fiscalité Niger",         desc:"TVA, régime fiscal, CNSS" },
  { id:4, icon:"🏦", title:"Trésorerie",              desc:"Comptes bancaires de départ" },
  { id:5, icon:"👥", title:"Premiers clients",        desc:"Importez ou créez vos clients" },
  { id:6, icon:"🚀", title:"Prêt à démarrer",        desc:"Récapitulatif et ressources" },
];

const VIDEO_LINKS = [
  { label:"Créer une facture", url:"https://loom.com/share/placeholder-facture", duration:"4 min" },
  { label:"Configurer la paie", url:"https://loom.com/share/placeholder-paie", duration:"6 min" },
  { label:"Déclarer la TVA", url:"https://loom.com/share/placeholder-tva", duration:"5 min" },
  { label:"Gérer les adhérents", url:"https://loom.com/share/placeholder-adherents", duration:"4 min" },
];

const GUIDE_LINKS = [
  { label:"Guide Facturation PDF", href:"/docs/guides/facturation.pdf", icon:"📄" },
  { label:"Guide RH & Paie PDF", href:"/docs/guides/rh-paie.pdf", icon:"📄" },
  { label:"Guide Comptabilité OHADA PDF", href:"/docs/guides/comptabilite.pdf", icon:"📄" },
  { label:"Guide Fiscalité Niger PDF", href:"/docs/guides/fiscalite.pdf", icon:"📄" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [form, setForm] = useState({
    name:"", nif:"", rccm:"", phone:"", email:"", address:"",
    invoicePrefix:"FAC", quotePrefix:"DEV", orderPrefix:"BC",
    tvaActif:true, tvaRegime:"reel_normal", cnssActif:true,
    bankName:"", bankAccount:"", bankBalance:0,
    importClients:false,
  });

  const u = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const inp = "w-full px-3 py-2.5 border border-clay/30 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  const lbl = "block text-xs font-medium text-moss mb-1";

  async function handleNext() {
    if (step < 6) {
      setCompleted(prev => new Set([...prev, step]));
      setStep(s => s + 1);
      return;
    }
    // Étape finale : sauvegarder tout
    setSaving(true);
    const csrfRes = await fetch("/api/auth/csrf");
    const { csrfToken } = await csrfRes.json();
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
      credentials: "include",
      body: JSON.stringify({ ...form, completed: true }),
    });
    setSaving(false);
    router.push("/dashboard?onboarded=1");
  }

  const stepContent: Record<number, React.ReactNode> = {
    1: (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><label className={lbl}>Nom de l'organisation *</label><input className={inp} value={form.name} onChange={e=>u("name",e.target.value)} required/></div>
          <div><label className={lbl}>NIF (Numéro Identifiant Fiscal)</label><input className={inp} value={form.nif} onChange={e=>u("nif",e.target.value)} placeholder="NNNNNNNNN"/></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={lbl}>RCCM</label><input className={inp} value={form.rccm} onChange={e=>u("rccm",e.target.value)}/></div>
          <div><label className={lbl}>Téléphone</label><input className={inp} value={form.phone} onChange={e=>u("phone",e.target.value)} placeholder="+227 XX XX XX XX"/></div>
        </div>
        <div><label className={lbl}>Email de l'organisation</label><input type="email" className={inp} value={form.email} onChange={e=>u("email",e.target.value)}/></div>
        <div><label className={lbl}>Adresse</label><input className={inp} value={form.address} onChange={e=>u("address",e.target.value)} placeholder="Niamey, Niger"/></div>
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
          💡 Ces informations apparaîtront sur toutes vos factures et documents officiels.
        </div>
      </div>
    ),
    2: (
      <div className="space-y-4">
        <div className="p-3 bg-sand rounded-xl text-xs text-moss mb-2">
          Personnalisez les préfixes de vos documents. Exemple : préfixe <code className="bg-white px-1 rounded">NML</code> → <strong>NML-2025-00001</strong>
        </div>
        {[
          ["invoicePrefix","Factures (ex: FAC, INV, NML)","FAC"],
          ["quotePrefix","Devis (ex: DEV, QTE)","DEV"],
          ["orderPrefix","Bons de commande (ex: BC, PO)","BC"],
        ].map(([key, label, placeholder]) => (
          <div key={key} className="flex items-center gap-4">
            <div className="flex-1">
              <label className={lbl}>{label}</label>
              <input className={inp + " uppercase font-mono"} value={String(form[key as keyof typeof form])} onChange={e=>u(key,e.target.value.toUpperCase())} placeholder={placeholder} maxLength={10}/>
            </div>
            <div className="flex-shrink-0 text-sm font-mono text-cedar bg-cedar/5 px-3 py-2 rounded-lg mt-4">
              → {String(form[key as keyof typeof form])||placeholder}-2025-00001
            </div>
          </div>
        ))}
        <Link href="/settings/numbering" className="text-xs text-cedar hover:underline">⚙ Configuration avancée (séparateur, nombre de chiffres, numéro de départ) →</Link>
      </div>
    ),
    3: (
      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 bg-white border border-clay/20 rounded-xl">
          <div><p className="font-medium text-ink text-sm">TVA Niger (19%)</p><p className="text-xs text-moss mt-0.5">Taxe sur la Valeur Ajoutée — CGI Niger</p></div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only" checked={form.tvaActif} onChange={e=>u("tvaActif",e.target.checked)}/>
            <div className={`w-10 h-5 rounded-full transition-colors ${form.tvaActif?"bg-cedar":"bg-clay/30"}`}>
              <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 ml-0.5 transition-transform ${form.tvaActif?"translate-x-5":""}`}/>
            </div>
          </label>
        </div>
        {form.tvaActif && (
          <div>
            <label className={lbl}>Régime fiscal</label>
            <select className={inp} value={form.tvaRegime} onChange={e=>u("tvaRegime",e.target.value)}>
              <option value="reel_normal">Régime réel normal</option>
              <option value="reel_simplifie">Régime réel simplifié</option>
              <option value="forfait">Forfait (petites entreprises)</option>
              <option value="exonere">Exonéré de TVA</option>
            </select>
          </div>
        )}
        <div className="flex items-center justify-between p-4 bg-white border border-clay/20 rounded-xl">
          <div><p className="font-medium text-ink text-sm">CNSS (Caisse Nationale de Sécurité Sociale)</p><p className="text-xs text-moss mt-0.5">3,6% salarié + 16,4% patronal</p></div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only" checked={form.cnssActif} onChange={e=>u("cnssActif",e.target.checked)}/>
            <div className={`w-10 h-5 rounded-full transition-colors ${form.cnssActif?"bg-cedar":"bg-clay/30"}`}>
              <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 ml-0.5 transition-transform ${form.cnssActif?"translate-x-5":""}`}/>
            </div>
          </label>
        </div>
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
          ⚠ Ces paramètres affectent les calculs fiscaux automatiques. Vous pouvez les modifier à tout moment dans <strong>Fiscalité → Paramètres</strong>.
        </div>
      </div>
    ),
    4: (
      <div className="space-y-4">
        <div className="p-3 bg-sand rounded-xl text-xs text-moss">
          Ajoutez au moins un compte bancaire pour activer le suivi de trésorerie.
        </div>
        <div><label className={lbl}>Banque principale</label><input className={inp} value={form.bankName} onChange={e=>u("bankName",e.target.value)} placeholder="BIA Niger, Coris Bank, Ecobank…"/></div>
        <div><label className={lbl}>N° de compte</label><input className={inp} value={form.bankAccount} onChange={e=>u("bankAccount",e.target.value)} placeholder="XXXXXXXXXXXX"/></div>
        <div><label className={lbl}>Solde de départ (XOF)</label><input type="number" className={inp} value={form.bankBalance} onChange={e=>u("bankBalance",Number(e.target.value))} min={0}/></div>
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
          💡 Vous pouvez ajouter d'autres comptes (caisse, mobile money) depuis <strong>Trésorerie</strong> après l'onboarding.
        </div>
      </div>
    ),
    5: (
      <div className="space-y-4">
        <div className="p-3 bg-sand rounded-xl text-xs text-moss">
          Vous pouvez importer vos clients existants maintenant ou les créer manuellement plus tard.
        </div>
        <div className="grid grid-cols-2 gap-4">
          <button type="button" onClick={()=>u("importClients",false)}
            className={`p-5 rounded-xl border-2 text-left transition-all ${!form.importClients?"border-cedar bg-cedar/5":"border-clay/20 hover:border-cedar/30"}`}>
            <p className="text-2xl mb-2">✏️</p>
            <p className="font-semibold text-ink text-sm">Créer manuellement</p>
            <p className="text-xs text-moss mt-1">Je saisirai mes clients un par un depuis l'interface.</p>
          </button>
          <button type="button" onClick={()=>u("importClients",true)}
            className={`p-5 rounded-xl border-2 text-left transition-all ${form.importClients?"border-cedar bg-cedar/5":"border-clay/20 hover:border-cedar/30"}`}>
            <p className="text-2xl mb-2">📥</p>
            <p className="font-semibold text-ink text-sm">Importer un fichier CSV</p>
            <p className="text-xs text-moss mt-1">J'ai une liste existante à importer (Excel → CSV).</p>
          </button>
        </div>
        {form.importClients && (
          <div className="p-4 bg-white border border-clay/20 rounded-xl">
            <p className="text-sm font-medium text-ink mb-2">Format CSV attendu :</p>
            <code className="text-xs bg-sand px-3 py-2 rounded-lg block font-mono">nom,email,telephone,nif,adresse</code>
            <p className="text-xs text-moss mt-2">Vous pourrez importer votre fichier depuis <strong>Clients → Importer</strong> après l'onboarding.</p>
          </div>
        )}
      </div>
    ),
    6: (
      <div className="space-y-5">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="font-semibold text-green-800">🎉 Configuration terminée !</p>
          <p className="text-sm text-green-700 mt-1">Votre organisation est prête. Voici les ressources pour démarrer rapidement.</p>
        </div>

        {/* Vidéos de formation */}
        <div>
          <p className="text-sm font-semibold text-ink mb-3">📹 Vidéos de démarrage (Loom)</p>
          <div className="grid grid-cols-2 gap-3">
            {VIDEO_LINKS.map(v => (
              <a key={v.label} href={v.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-white border border-clay/20 rounded-xl hover:border-cedar/40 transition-colors">
                <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center text-sm flex-shrink-0">▶️</div>
                <div><p className="text-xs font-medium text-ink">{v.label}</p><p className="text-xs text-moss">{v.duration}</p></div>
              </a>
            ))}
          </div>
        </div>

        {/* Guides PDF */}
        <div>
          <p className="text-sm font-semibold text-ink mb-3">📄 Guides PDF par module</p>
          <div className="grid grid-cols-2 gap-3">
            {GUIDE_LINKS.map(g => (
              <a key={g.label} href={g.href} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-white border border-clay/20 rounded-xl hover:border-cedar/40 transition-colors">
                <span className="text-lg">{g.icon}</span>
                <p className="text-xs font-medium text-ink">{g.label}</p>
              </a>
            ))}
          </div>
        </div>

        {/* Support chat */}
        <div className="bg-cedar/5 border border-cedar/20 rounded-xl p-4 flex items-start gap-3">
          <span className="text-xl">💬</span>
          <div>
            <p className="text-sm font-semibold text-ink">Support personnalisé — 7 premiers jours</p>
            <p className="text-xs text-moss mt-0.5">Notre équipe répond sous 2h pendant vos 7 premiers jours d'utilisation. Utilisez le bouton support en bas à droite ou WhatsApp.</p>
          </div>
        </div>

        <div className="p-4 bg-white border border-clay/20 rounded-xl">
          <p className="text-xs font-semibold text-moss uppercase tracking-wide mb-3">Récapitulatif de votre configuration</p>
          <dl className="space-y-1.5 text-xs">
            {[
              ["Organisation", form.name || "—"],
              ["NIF", form.nif || "—"],
              ["Préfixe factures", `${form.invoicePrefix||"FAC"}-2025-00001`],
              ["TVA", form.tvaActif ? `Activée (${form.tvaRegime})` : "Désactivée"],
              ["CNSS", form.cnssActif ? "Activée (3,6% + 16,4%)" : "Désactivée"],
              ["Banque", form.bankName || "—"],
            ].map(([label, val]) => (
              <div key={label} className="flex justify-between py-1 border-b border-clay/10 last:border-0">
                <dt className="text-moss">{label}</dt>
                <dd className="font-medium text-ink text-right">{val}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    ),
  };

  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  return (
    <div className="min-h-screen bg-sand flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-2xl font-bold text-cedar">Kanoo</p>
          <p className="text-moss text-sm mt-1">Configuration initiale — {Math.round(progress)}% complété</p>
        </div>

        {/* Barre de progression */}
        <div className="h-2 bg-white border border-clay/20 rounded-full mb-6 overflow-hidden">
          <div className="h-2 bg-cedar rounded-full transition-all duration-500" style={{ width:`${progress}%` }}/>
        </div>

        {/* Étapes indicatrices */}
        <div className="flex justify-between mb-6">
          {STEPS.map(s => (
            <button key={s.id} onClick={() => completed.has(s.id) ? setStep(s.id) : undefined}
              className={`flex flex-col items-center text-center ${s.id === step ? "opacity-100" : completed.has(s.id) ? "opacity-80 cursor-pointer" : "opacity-30"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm mb-1 ${s.id === step ? "bg-cedar text-white" : completed.has(s.id) ? "bg-green-500 text-white" : "bg-white border border-clay/30 text-moss"}`}>
                {completed.has(s.id) ? "✓" : s.icon}
              </div>
              <p className="text-xs text-moss hidden sm:block">{s.title.split(" ")[0]}</p>
            </button>
          ))}
        </div>

        {/* Carte étape */}
        <div className="bg-white rounded-2xl border border-clay/20 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <span className="text-2xl">{STEPS[step-1].icon}</span>
            <div>
              <p className="font-semibold text-ink">{STEPS[step-1].title}</p>
              <p className="text-xs text-moss">{STEPS[step-1].desc}</p>
            </div>
          </div>
          {stepContent[step]}
        </div>

        {/* Navigation */}
        <div className="flex gap-3 mt-4">
          {step > 1 && (
            <button onClick={() => setStep(s => s - 1)}
              className="px-5 py-3 border border-clay/30 rounded-xl text-sm text-moss hover:bg-white transition-colors">
              ← Retour
            </button>
          )}
          <button onClick={handleNext} disabled={saving}
            className="flex-1 py-3 bg-cedar text-white rounded-xl font-semibold hover:bg-ink transition-colors disabled:opacity-60">
            {saving ? "Finalisation…" : step < 6 ? "Continuer →" : "🚀 Accéder à mon dashboard"}
          </button>
        </div>

        <p className="text-center text-xs text-moss mt-3">
          <button onClick={() => router.push("/dashboard")} className="hover:underline">
            Passer l'onboarding → accéder directement au dashboard
          </button>
        </p>
      </div>
    </div>
  );
}
