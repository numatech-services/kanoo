"use client";
import Link from "next/link";
export default function AssoDocumentsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-ink">Documents associatifs</h1>
      <p className="text-moss text-sm">Statuts, PV d'AG, conventions, rapports d'activité. Partagez ce module avec <Link href="/documents" className="text-cedar hover:underline">la GED centrale</Link>.</p>
    </div>
  );
}
