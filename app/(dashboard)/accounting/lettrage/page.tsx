"use client";
import { useState } from "react";
export default function LettrageePage() {
  const [selected, setSelected] = useState<string[]>([]);
  const [ref, setRef] = useState("");
  const [result, setResult] = useState("");
  async function handleLettrage() {
    if (selected.length < 2) return setResult("Sélectionnez au moins 2 écritures");
    if (!ref.trim()) return setResult("Saisissez une référence de lettrage");
    const csrfRes = await fetch("/api/auth/csrf"); const { csrfToken } = await csrfRes.json();
    const res = await fetch("/api/accounting-entries/lettrage", { method:"POST", headers:{"Content-Type":"application/json","x-csrf-token":csrfToken}, credentials:"include", body:JSON.stringify({entryIds:selected,letterRef:ref}) });
    const d = await res.json();
    setResult(res.ok ? `✅ ${d.data.message}` : `❌ ${d.error}`);
    if (res.ok) setSelected([]);
  }
  const inp = "px-3 py-2 border border-clay/30 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cedar/30";
  return (
    <div className="space-y-5 max-w-2xl">
      <div><a href="/accounting" className="text-xs text-moss hover:text-ink">← Comptabilité</a><h1 className="text-2xl font-bold text-ink mt-1">Lettrage</h1></div>
      <div className="bg-white rounded-xl border border-clay/20 p-5 space-y-4">
        <p className="text-sm text-moss">Le lettrage associe les factures clients/fournisseurs avec leurs règlements. Entrez les IDs des écritures à lettrer (séparés par des virgules).</p>
        <div>
          <label className="block text-xs font-medium text-moss mb-1">IDs des écritures à lettrer</label>
          <textarea className={inp+" w-full resize-y"} rows={3} placeholder="ID1&#10;ID2&#10;ID3" onChange={e=>setSelected(e.target.value.split(/[\n,]+/).map(s=>s.trim()).filter(Boolean))} />
          <p className="text-xs text-moss mt-1">{selected.length} écriture{selected.length>1?"s":""} sélectionnée{selected.length>1?"s":""}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-moss mb-1">Référence de lettrage *</label>
          <input className={inp+" w-full"} value={ref} onChange={e=>setRef(e.target.value)} placeholder="Ex: LET-2025-001" />
        </div>
        {result && <div className={`p-3 rounded-xl text-sm font-medium ${result.startsWith("✅")?"bg-green-50 text-green-700":"bg-red-50 text-red-700"}`}>{result}</div>}
        <button onClick={handleLettrage} disabled={selected.length<2} className="px-6 py-2.5 bg-cedar text-white rounded-xl text-sm font-medium hover:bg-ink disabled:opacity-60">Lettrer les écritures</button>
      </div>
      <div className="bg-white rounded-xl border border-clay/20 p-5">
        <h2 className="font-semibold text-ink mb-3">Annuler un lettrage existant</h2>
        <div className="flex gap-3">
          <input className={inp+" flex-1"} placeholder="Référence du lettrage à annuler" id="delRef" />
          <button onClick={async()=>{const r=(document.getElementById("delRef") as HTMLInputElement)?.value; if(!r)return; const csrfRes=await fetch("/api/auth/csrf");const{csrfToken}=await csrfRes.json(); const res=await fetch(`/api/accounting-entries/lettrage?ref=${r}`,{method:"DELETE",headers:{"x-csrf-token":csrfToken},credentials:"include"}); const d=await res.json(); setResult(res.ok?`✅ ${d.data.message}`:`❌ ${d.error}`);}} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600">Annuler</button>
        </div>
      </div>
    </div>
  );
}
