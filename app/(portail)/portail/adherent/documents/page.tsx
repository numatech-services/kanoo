"use client";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
export default function AdherentDocumentsPage() {
  return (
    <div className="space-y-5">
      <div><Link href="/portail/adherent" className="text-xs text-ink2 hover:text-ink">← Mon espace</Link><h1 className="page-title mt-1">Mes documents</h1></div>
      <div className="bg-surface rounded-xl border border-line p-10 text-center"><p className="mb-3 text-ink3 flex justify-center" aria-hidden><FolderOpen size={30} /></p><p className="text-ink2 text-sm">Les documents partagés par votre association apparaîtront ici.</p></div>
    </div>
  );
}
