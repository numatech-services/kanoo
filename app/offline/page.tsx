"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getPendingCount, triggerSync } from "@/lib/offline/sync-queue";

import { WifiOff } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
export default function OfflinePage() {
  const [mounted, setMounted] = useState(false);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
    setOnline(navigator.onLine);
    getPendingCount().then(setPending);

    const goOnline = () => { setOnline(true); router.back(); };
    window.addEventListener("online", goOnline);
    return () => window.removeEventListener("online", goOnline);
  }, [router]);

  if (!mounted) return null;

  async function handleSync() {
    await triggerSync();
    router.back();
  }

  return (
    <div className="min-h-screen bg-surface2 flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <p className="mb-6 text-ink3 flex justify-center" aria-hidden><WifiOff size={60} /></p>
        <h1 className="page-title">
          {online ? "Connexion rétablie" : "Vous êtes hors-ligne"}
        </h1>
        <p className="text-ink2 mt-3 leading-relaxed">
          {online
            ? "Vous pouvez reprendre votre travail. Les modifications seront synchronisées."
            : "Pas d'inquiétude — vos actions sont sauvegardées localement et seront envoyées au serveur dès le retour de la connexion."
          }
        </p>
        {pending > 0 && (
          <div className="mt-4 bg-warn-50 border border-warn/25 rounded-xl p-3 text-sm text-warn">
            <strong>{pending}</strong> action{pending > 1 ? "s" : ""} en attente de synchronisation
          </div>
        )}
        <div className="flex flex-col gap-3 mt-8">
          {online && (
            <button onClick={handleSync}
              className={buttonClass("primary", "md")}>
              Synchroniser maintenant
            </button>
          )}
          <button onClick={() => router.back()}
            className="px-6 py-3 border border-line text-ink2 rounded-xl hover:bg-surface transition-colors">
            ← Retour
          </button>
        </div>
        <p className="text-xs text-ink2/60 mt-8">Kanoo fonctionne même sans internet</p>
      </div>
    </div>
  );
}
