"use client";
import { useApi } from "@/lib/use-api";
import { AlertsPanel } from "@/components/home/AlertsPanel";
import type { AlertsBoard } from "@/lib/alerts-server";

/** Bloc des alertes pour les tableaux de bord rendus côté navigateur. */
export function AlertsBoardCard() {
  const board = useApi<AlertsBoard | null>("/api/alerts/board", d => d?.data ?? null, null, { quiet: true });
  return board.data ? <AlertsPanel board={board.data} /> : null;
}
