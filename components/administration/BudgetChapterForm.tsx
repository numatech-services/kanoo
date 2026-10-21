"use client";
import { useState } from "react";
import { FormField, inputCls, selectCls } from "@/components/ui/FormField";

import { buttonClass } from "@/components/ui/button-class";
interface BudgetChapterFormProps { 
  onSave: (d: Record<string, unknown>) => Promise<void>; 
  onCancel: () => void; 
}

export function BudgetChapterForm({ onSave, onCancel }: BudgetChapterFormProps) {
  const [form, setForm] = useState({ 
    code: "", 
    label: "", 
    year: new Date().getFullYear(), 
    level: "chapitre", 
    allocatedAmount: 0, 
    parentId: "" // La chaîne vide cause le crash MongoDB
  });
  
  const [saving, setSaving] = useState(false);
  const u = (f: string, v: unknown) => setForm(p => ({ ...p, [f]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    // NETTOYAGE : On prépare une copie des données
    const payload: Omit<typeof form, "parentId"> & { parentId: string | null } = { ...form };
    
    // Si parentId est vide, on le passe à null pour éviter l'erreur "Cast to ObjectId failed"
    if (payload.parentId === "") {
      payload.parentId = null;
    }

    try {
      await onSave(payload);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Code" required>
          <input 
            className={inputCls} 
            value={form.code} 
            onChange={e => u("code", e.target.value)} 
            placeholder="CHAP-11" 
            required 
          />
        </FormField>
        <FormField label="Niveau" required>
          <select 
            className={selectCls} 
            value={form.level} 
            onChange={e => u("level", e.target.value)}
          >
            <option value="titre">Titre</option>
            <option value="chapitre">Chapitre</option>
            <option value="article">Article</option>
            <option value="ligne">Ligne</option>
          </select>
        </FormField>
      </div>

      <FormField label="Intitulé" required>
        <input 
          className={inputCls} 
          value={form.label} 
          onChange={e => u("label", e.target.value)} 
          required 
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Exercice" required>
          <input 
            type="number" 
            className={inputCls} 
            value={form.year} 
            onChange={e => u("year", Number(e.target.value))} 
            required 
          />
        </FormField>
        <FormField label="Crédit alloué (FCFA)" required>
          <input 
            type="number" 
            className={inputCls} 
            value={form.allocatedAmount} 
            onChange={e => u("allocatedAmount", Number(e.target.value))} 
            min={0} 
            required 
          />
        </FormField>
      </div>

      {/* Optionnel : Champ ParentId si nécessaire, sinon il restera null par le script ci-dessus */}

      <div className="flex justify-end gap-3 pt-3 border-t border-line">
        <button 
          type="button" 
          onClick={onCancel} 
          className={buttonClass("secondary", "md")}
        >
          Annuler
        </button>
        <button 
          type="submit" 
          disabled={saving} 
          className={buttonClass("primary", "md")}
        >
          {saving ? "Création..." : "Créer le chapitre"}
        </button>
      </div>
    </form>
  );
}