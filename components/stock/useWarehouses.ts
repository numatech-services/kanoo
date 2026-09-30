"use client";
import { useEffect, useState } from "react";

export interface WarehouseLite { _id: string; code: string; name: string; kind: string; isDefault?: boolean; isActive?: boolean; articles?: number; units?: number; value?: number; address?: string; deskId?: string }

let cache: Promise<WarehouseLite[]> | null = null;
/** Entrepôts actifs (mis en cache pour la page ; `refresh` pour recharger). */
export function useWarehouses(): { warehouses: WarehouseLite[]; refresh: () => void } {
  const [warehouses, setW] = useState<WarehouseLite[]>([]);
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!cache || v > 0) cache = fetch("/api/warehouses", { credentials: "include" }).then(r => r.ok ? r.json() : null).then(d => d?.data ?? []).catch(() => []);
    cache.then(setW);
  }, [v]);
  return { warehouses, refresh: () => setV(x => x + 1) };
}

export const KIND_LABEL: Record<string, string> = { main: "Magasin principal", depot: "Dépôt", store: "Boutique", comptoir: "Comptoir", vehicle: "Véhicule", other: "Autre" };
