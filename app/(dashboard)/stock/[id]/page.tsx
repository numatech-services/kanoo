"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Product { _id:string; code:string; label:string; description?:string; unit:string; stockQty:number; stockMinAlert:number; unitPrice:number; tvaRate:number; accountCode?:string; isService:boolean; }
interface Movement { _id:string; type:string; quantity:number; quantityBefore:number; quantityAfter:number; reason:string; linkedDocNumber?:string; createdAt:string; }

const TYPE_LABELS:Record<string,string>={entry:"Entrée",exit:"Sortie",adjustment:"Ajustement",return:"Retour",loss:"Perte/Casse"};
const TYPE_COLORS:Record<string,string>={entry:"text-pos",exit:"text-neg",adjustment:"text-info",return:"text-warn",loss:"text-neg"};

export default function StockDetailPage() {
  const { id } = useParams();
  const [product,setProduct]=useState<Product|null>(null);
  const [movements,setMovements]=useState<Movement[]>([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    Promise.all([
      fetch(`/api/products/${id}`,{credentials:"include"}).then(r=>r.json()).then(d=>setProduct(d.data)),
      fetch(`/api/stock/movements?productId=${id}&limit=50`,{credentials:"include"}).then(r=>r.json()).then(d=>setMovements(d.data?.items||[])),
    ]).finally(()=>setLoading(false));
  },[id]);

  if(loading) return <div className="p-6"><div className="h-48 bg-surface rounded-xl animate-pulse"/></div>;
  if(!product) return <div className="p-6 text-ink2">Produit introuvable</div>;

  const isAlert = product.stockQty <= product.stockMinAlert;

  return (
    <div className="space-y-5 max-w-3xl">
      <div><Link href="/stock" className="text-xs text-ink2 hover:text-ink">← Stock</Link><h1 className="text-2xl font-bold text-ink mt-1">{product.label}</h1><p className="text-ink2 text-sm font-mono">{product.code}</p></div>

      <div className="grid grid-cols-2 gap-5">
        <div className={`rounded-xl border p-5 ${isAlert?"bg-neg-50 border-neg/25":"bg-surface border-line"}`}>
          <p className="text-xs text-ink2 uppercase font-semibold mb-1">Quantité en stock</p>
          <p className={`text-4xl font-bold font-mono ${isAlert?"text-neg":"text-pos"}`}>{product.stockQty}</p>
          <p className="text-sm text-ink2 mt-1">{product.unit} — Seuil alerte : {product.stockMinAlert}</p>
          {isAlert && <p className="text-xs text-neg font-semibold mt-2">⚠ Stock sous le seuil minimum</p>}
        </div>
        <div className="bg-surface rounded-xl border border-line p-5 space-y-2 text-sm">
          {[["Prix unitaire",`${product.unitPrice.toLocaleString("fr-FR")} XOF`],["TVA",`${Math.round(product.tvaRate*100)}%`],["Valeur stock",`${(product.stockQty*product.unitPrice).toLocaleString("fr-FR")} XOF`],["Type",product.isService?"Service":"Produit physique"],["Code comptable",product.accountCode||"—"]].map(([k,v])=>(
            <div key={String(k)} className="flex justify-between py-1 border-b border-line last:border-0"><span className="text-ink2">{k}</span><span className="font-medium">{v}</span></div>
          ))}
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-line overflow-hidden">
        <h2 className="font-semibold text-ink px-5 py-4 border-b border-line">Historique des mouvements</h2>
        {movements.length===0 ? <p className="text-ink2 text-center py-8 text-sm">Aucun mouvement enregistré</p> : (
          <table className="table-dense">
            <thead><tr className="bg-surface2/50">{["Date","Type","Quantité","Avant","Après","Motif"].map(h=><th key={h} >{h}</th>)}</tr></thead>
            <tbody>
              {movements.map(m=>(
                <tr key={m._id} className="border-t border-line">
                  <td className="px-4 py-2.5 text-ink2 text-xs">{new Date(m.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-2.5"><span className={`text-xs font-medium ${TYPE_COLORS[m.type]||""}`}>{TYPE_LABELS[m.type]||m.type}</span></td>
                  <td className={`px-4 py-2.5 font-mono font-bold ${m.quantity>0?"text-pos":"text-neg"}`}>{m.quantity>0?"+":""}{m.quantity}</td>
                  <td className="px-4 py-2.5 font-mono text-ink2">{m.quantityBefore}</td>
                  <td className="px-4 py-2.5 font-mono font-semibold">{m.quantityAfter}</td>
                  <td className="px-4 py-2.5 text-ink2 text-xs">{m.reason}{m.linkedDocNumber&&<span className="ml-1 text-section">#{m.linkedDocNumber}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
