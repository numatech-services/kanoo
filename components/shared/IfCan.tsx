"use client";
import type { ReactNode } from "react";
import { useMe, meCanDo } from "@/lib/useMe";

/**
 * N'affiche un bouton que si le compte a le droit correspondant — même calcul
 * que l'API (rôles cumulés, niveaux). Un bouton « Nouveau » qui débouche sur
 * un refus est pire qu'un bouton absent.
 */
export function IfCan({ resource, action = "create", children }: { resource: string; action?: "create" | "read" | "update" | "delete"; children: ReactNode }) {
  const me = useMe();
  return meCanDo(me, resource, action) ? <>{children}</> : null;
}
