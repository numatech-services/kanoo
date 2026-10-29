"use client";
import { History } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";

/** Bandeau « brouillon retrouvé » d'un formulaire (lib/use-draft). */
export function DraftBanner({ savedAt, onRestore, onDiscard }: { savedAt: number; onRestore: () => void; onDiscard: () => void }) {
  const when = new Date(savedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl border border-info/30 bg-info/10 text-sm text-ink">
      <History size={16} className="text-info shrink-0" />
      <span className="flex-1 min-w-[12rem]">Une saisie non enregistrée a été retrouvée ({when}).</span>
      <button type="button" onClick={onRestore} className={buttonClass("primary", "sm")}>Reprendre</button>
      <button type="button" onClick={onDiscard} className={buttonClass("ghost", "sm")}>Ignorer</button>
    </div>
  );
}
