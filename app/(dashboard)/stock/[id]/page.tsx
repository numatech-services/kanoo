"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Product { _id:string; code:string; label:string; description?:string; unit:string; stockQty:number; stockMinAlert:number; unitPrice:number; tvaRate:number; accountCode?:string; isService:boolean; }
interface Movement { _id:string; type:string; quantity:number; quantityBefore:number; quantityAfter:number; reason:string; linkedDocNumber?:string; createdAt:string; }

const TYPE_LABELS:Record<string,string>={entry:"Entrée",exit:"Sortie",adjustment:"Ajustement",return:"Retour",loss:"Perte/Casse"};
const TYPE_COLORS:Record<string,string>={entry:"text-green-700",exit:"text-red-600",adjustment:"text-blue-600",return:"text-amber-600",loss:"text-red-800"};

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

  if(loading) return <div className="p-6"><div className="h-48 bg-white rounded-xl animate-pulse"/></div>;
  if(!product) return <div className="p-6 text-moss">Produit introuvable</div>;

  const isAlert = product.stockQty <= product.stockMinAlert;

  return (
    <div className="space-y-5 max-w-3xl">
      <div><Link href="/stock" className="text-xs text-moss hover:text-ink">← Stock</Link><h1 className="text-2xl font-bold text-ink mt-1">{product.label}</h1><p className="text-moss text-sm font-mono">{product.code}</p></div>

      <div className="grid grid-cols-2 gap-5">
        <div className={`rounded-xl border p-5 ${isAlert?"bg-red-50 border-red-200":"bg-white border-clay/20"}`}>
          <p className="text-xs text-moss uppercase font-semibold mb-1">Quantité en stock</p>
          <p className={`text-4xl font-bold font-mono ${isAlert?"text-red-600":"text-green-700"}`}>{product.stockQty}</p>
          <p className="text-sm text-moss mt-1">{product.unit} — Seuil alerte : {product.stockMinAlert}</p>
          {isAlert && <p className="text-xs text-red-600 font-semibold mt-2">⚠ Stock sous le seuil minimum</p>}
        </div>
        <div className="bg-white rounded-xl border border-clay/20 p-5 space-y-2 text-sm">
          {[["Prix unitaire",`${product.unitPrice.toLocaleString("fr-FR")} XOF`],["TVA",`${Math.round(product.tvaRate*100)}%`],["Valeur stock",`${(product.stockQty*product.unitPrice).toLocaleString("fr-FR")} XOF`],["Type",product.isService?"Service":"Produit physique"],["Code comptable",product.accountCode||"—"]].map(([k,v])=>(
            <div key={String(k)} className="flex justify-between py-1 border-b border-clay/10 last:border-0"><span className="text-moss">{k}</span><span className="font-medium">{v}</span></div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-clay/20 overflow-hidden">
        <h2 className="font-semibold text-ink px-5 py-4 border-b border-clay/10">Historique des mouvements</h2>
        {movements.length===0 ? <p className="text-moss text-center py-8 text-sm">Aucun mouvement enregistré</p> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-sand/50">{["Date","Type","Quantité","Avant","Après","Motif"].map(h=><th key={h} className="px-4 py-2 text-left text-xs font-semibold text-moss uppercase">{h}</th>)}</tr></thead>
            <tbody>
              {movements.map(m=>(
                <tr key={m._id} className="border-t border-clay/10">
                  <td className="px-4 py-2.5 text-moss text-xs">{new Date(m.createdAt).toLocaleDateString("fr-FR")}</td>
                  <td className="px-4 py-2.5"><span className={`text-xs font-medium ${TYPE_COLORS[m.type]||""}`}>{TYPE_LABELS[m.type]||m.type}</span></td>
                  <td className={`px-4 py-2.5 font-mono font-bold ${m.quantity>0?"text-green-700":"text-red-600"}`}>{m.quantity>0?"+":""}{m.quantity}</td>
                  <td className="px-4 py-2.5 font-mono text-moss">{m.quantityBefore}</td>
                  <td className="px-4 py-2.5 font-mono font-semibold">{m.quantityAfter}</td>
                  <td className="px-4 py-2.5 text-moss text-xs">{m.reason}{m.linkedDocNumber&&<span className="ml-1 text-cedar">#{m.linkedDocNumber}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
