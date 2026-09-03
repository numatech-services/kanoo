"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Payslip {
  _id:string; month:number; year:number; grossSalary:number; cnssEmployee:number; cnssEmployer:number;
  otherDeductions:number; netSalary:number; isPaid:boolean; paidAt?:string;
  employeeId:{firstName:string;lastName:string;code:string;position:string;cnssNumber?:string;bankAccount?:string}|null;
}

const MONTHS=["","Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

export default function PayslipDetailPage() {
  const { id } = useParams();
  const [mounted, setMounted] = useState(false);
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/payslips/${id}`, { credentials: "include" });
      const d = await res.json();
      setPayslip(d.data);
    } catch (err) {
      console.error("Erreur chargement bulletin", err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setMounted(true);
    if (id) load();
  }, [id, load]);

  async function handlePay() {
    if (!confirm("Marquer ce bulletin comme payé ? Cela enregistrera une sortie de trésorerie.")) return;
    setPaying(true);
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      const { csrfToken } = await csrfRes.json();
      const res = await fetch(`/api/payslips/${id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        credentials: "include"
      });
      const d = await res.json();
      if (res.ok) {
        alert("✅ Salaire marqué comme payé");
        load();
      } else {
        alert(`❌ Erreur: ${d.error}`);
      }
    } catch (err) {
      alert("❌ Erreur réseau");
    } finally {
      setPaying(false);
    }
  }

  if (!mounted) return null;
  if (loading) return <div className="p-6"><div className="h-64 bg-surface rounded-xl animate-pulse border border-line"/></div>;
  if (!payslip) return <div className="p-6 text-ink2 font-medium text-center bg-surface rounded-xl border border-line">Bulletin introuvable</div>;

  const emp = payslip.employeeId;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-10">
      {/* Barre d'outils (cachée à l'impression) */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <Link href="/payslips" className="text-xs font-bold text-ink2 hover:text-section transition-colors uppercase tracking-widest">
            ← Retour aux bulletins
          </Link>
          <h1 className="text-2xl font-black text-ink mt-1">
            Bulletin #{id?.toString().slice(-6).toUpperCase()}
          </h1>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => window.print()} 
            className="px-5 py-2.5 bg-surface border border-line rounded-xl text-sm font-bold text-ink hover:bg-surface2 transition-all shadow-sm flex items-center gap-2"
          >
            <span>🖨️</span> Imprimer
          </button>
          
          {!payslip.isPaid ? (
            <button 
              onClick={handlePay} 
              disabled={paying} 
              className="px-5 py-2.5 bg-pos text-white rounded-xl text-sm font-bold hover:brightness-95 disabled:opacity-50 shadow-md transition-all"
            >
              {paying ? "Paiement en cours..." : "💳 Marquer comme payé"}
            </button>
          ) : (
            <div className="px-5 py-2.5 bg-pos-50 border border-pos/25 text-pos rounded-xl text-sm font-bold flex items-center gap-2">
              <span>✅</span> Payé le {payslip.paidAt ? new Date(payslip.paidAt).toLocaleDateString("fr-FR") : "—"}
            </div>
          )}
        </div>
      </div>

      {/* Le Bulletin (Partie imprimable) */}
      <div className="bg-surface rounded-2xl border border-line shadow-xl overflow-hidden print:border-none print:shadow-none" id="payslip-to-print">
        {/* En-tête Entreprise */}
        <div className="bg-section text-white p-8 flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-black tracking-tighter uppercase italic">Kanoo</h2>
            <p className="text-white/60 text-xs font-bold tracking-widest uppercase mt-1">Gestion d'entreprise</p>
          </div>
          <div className="text-right">
            <h3 className="text-xl font-bold italic uppercase">Bulletin de Paie</h3>
            <p className="text-white/80 font-mono text-sm uppercase">{MONTHS[payslip.month]} {payslip.year}</p>
          </div>
        </div>

        {/* Infos Employé & Employeur */}
        <div className="grid grid-cols-2 gap-10 p-8 border-b border-line bg-surface2/20">
          <div>
            <p className="text-[10px] font-bold text-ink2 uppercase tracking-widest mb-3">Employeur</p>
            <div className="text-sm space-y-1">
              <p className="font-bold text-ink">KANOO SARL</p>
              <p className="text-ink2">Quartier Plateau, Niamey</p>
              <p className="text-ink2">NIF: 1234567-R · RCCM: NI-NIA-2024</p>
              <p className="text-ink2">République du Niger</p>
            </div>
          </div>
          <div className="bg-surface p-4 rounded-xl border border-line shadow-sm">
            <p className="text-[10px] font-bold text-ink2 uppercase tracking-widest mb-3">Salarié</p>
            {emp ? (
              <div className="text-sm space-y-1">
                <p className="font-bold text-ink text-base">{emp.firstName} {emp.lastName}</p>
                <p className="text-section font-medium italic">{emp.position}</p>
                <p className="text-ink2 font-mono text-xs mt-2">Matricule: {emp.code}</p>
                {emp.cnssNumber && <p className="text-ink2 text-xs">N° CNSS: {emp.cnssNumber}</p>}
                {emp.bankAccount && <p className="text-ink2 text-xs truncate">RIB: {emp.bankAccount}</p>}
              </div>
            ) : (
              <p className="text-neg italic text-sm">Infos employé manquantes</p>
            )}
          </div>
        </div>

        {/* Corps du bulletin */}
        <div className="p-8">
          <table className="table-dense">
            <thead>
              <tr className="border-b-2 border-line text-[11px] font-bold text-ink2 uppercase tracking-wider text-left">
                <th className="pb-3">Désignation</th>
                <th className="pb-3 text-right">Base / Gain</th>
                <th className="pb-3 text-right">Retenues</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              <tr className="border-b border-line">
                <td className="py-4 font-bold text-ink">Salaire de Base (Brut)</td>
                <td className="py-4 text-right font-mono">{payslip.grossSalary.toLocaleString("fr-FR")}</td>
                <td className="py-4 text-right font-mono">—</td>
              </tr>
              
              {payslip.cnssEmployee > 0 && (
                <tr className="border-b border-line text-ink2">
                  <td className="py-3 pl-4">Cotisation CNSS Salariale (3.6%)</td>
                  <td className="py-3 text-right font-mono">—</td>
                  <td className="py-3 text-right font-mono text-neg">-{payslip.cnssEmployee.toLocaleString("fr-FR")}</td>
                </tr>
              )}

              {payslip.otherDeductions > 0 && (
                <tr className="border-b border-line text-ink2">
                  <td className="py-3 pl-4">Autres retenues / Avances</td>
                  <td className="py-3 text-right font-mono">—</td>
                  <td className="py-3 text-right font-mono text-neg">-{payslip.otherDeductions.toLocaleString("fr-FR")}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-8 text-lg font-black text-ink uppercase italic">Net à Payer</td>
                <td colSpan={2} className="pt-8 text-right">
                  <span className="text-3xl font-black text-section font-mono">
                    {payslip.netSalary.toLocaleString("fr-FR")} <small className="text-sm font-bold">XOF</small>
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Pied de page / Mentions légales */}
        <div className="p-8 bg-surface2/10 border-t border-line flex justify-between items-end">
          <div className="space-y-4">
            <div className="p-3 bg-surface border border-line rounded-lg inline-block">
               <p className="text-[10px] font-bold text-ink2 uppercase mb-1">Cotisations Patronales (Info)</p>
               <p className="text-xs font-mono">CNSS Employeur (16.4%): {payslip.cnssEmployer.toLocaleString("fr-FR")} XOF</p>
            </div>
            <p className="text-[9px] text-ink2/60 italic max-w-xs">
              Pour vous aider à faire valoir vos droits, conservez ce bulletin de paie sans limitation de durée.
            </p>
          </div>
          
          <div className="text-center space-y-12">
            <p className="text-[10px] font-bold text-ink2 uppercase tracking-widest">Cachet et Signature</p>
            <div className="h-1 bg-ink/10 w-40 mx-auto"></div>
          </div>
        </div>
      </div>
      
      {/* CSS pour l'impression propre */}
      <style jsx global>{`
        @media print {
          body { background: white !important; }
          .print\:hidden { display: none !important; }
          #payslip-to-print { border: 1px solid #eee !important; width: 100% !important; }
        }
      `}</style>
    </div>
  );
}