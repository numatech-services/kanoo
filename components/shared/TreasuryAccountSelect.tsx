"use client";

import { useEffect, useState } from "react";
import { selectCls } from "@/components/ui/FormField";

interface Account { _id: string; label: string; type?: string; isActive?: boolean }

/**
 * Compte de trésorerie qui reçoit (ou paie) l'argent : caisse, banque, mobile
 * money. Un seul compte actif est présélectionné pour éviter un clic inutile.
 */
export function TreasuryAccountSelect({ value, onChange, required, id }: { value: string; onChange: (v: string) => void; required?: boolean; id?: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    fetch("/api/treasury-accounts?limit=100", { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const list = ((d?.data?.items ?? []) as Account[]).filter(a => a.isActive !== false);
        setAccounts(list);
        if (!value && list.length === 1) onChange(list[0]._id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <select id={id} className={selectCls} value={value} onChange={e => onChange(e.target.value)} required={required}>
      <option value="">— Choisir le compte —</option>
      {accounts.map(a => <option key={a._id} value={a._id}>{a.label}</option>)}
    </select>
  );
}
