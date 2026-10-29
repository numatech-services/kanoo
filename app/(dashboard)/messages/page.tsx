"use client";
import { useState, useEffect } from "react";
import { MessageComposer } from "@/components/shared/MessageComposer";

import { Lightbulb } from "lucide-react";
import { apiJson } from "@/lib/api-client";
interface UserInfo {
  _id: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantType: "pme" | "association" | "administration";
}

const PROFILE_LABELS: Record<string, { title: string; subtitle: string }> = {
  pme:            { title: "Messagerie interne",       subtitle: "Échangez avec vos collaborateurs et équipes" },
  association:    { title: "Messagerie",                subtitle: "Communicez avec les membres du bureau et les adhérents" },
  administration: { title: "Messagerie interne",       subtitle: "Échangez avec les agents et services de votre organisation" },
};

export default function MessagesPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [tenantKind, setTenantKind] = useState<UserInfo["tenantType"] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson("/api/auth/me")
      .then(d => { setUser(d.data?.user || null); setTenantKind(d.data?.tenant?.type ?? null); })
      .finally(() => setLoading(false));
  }, []);

  // Le type d'organisation est porté par tenant.type (pas par l'utilisateur).
  const profile = tenantKind || user?.tenantType || "pme";
  const labels = PROFILE_LABELS[profile] || PROFILE_LABELS.pme;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-surface2 animate-pulse rounded-lg" />
        <div className="h-[600px] bg-surface2 animate-pulse rounded-[22px]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold tracking-[0.12em] uppercase text-ink3">Communication</p>
        <h1 className="text-[30px] font-extrabold tracking-[-0.03em] text-ink mt-1">{labels.title}</h1>
        <p className="text-sm text-ink2 mt-1">{labels.subtitle}</p>
      </div>

      {/* Onglets contextuels selon le profil */}
      {profile === "association" && (
        <div className="flex gap-2 text-xs text-ink2 bg-warn-50 border border-warn/25 rounded-xl px-4 py-2.5">
          <span className="inline-flex" aria-hidden><Lightbulb size={16} /></span>
          <span>Les conversations sont partagées avec les membres du bureau et les adhérents ayant un compte.</span>
        </div>
      )}

      {user && (
        <MessageComposer currentUserId={user._id} />
      )}
    </div>
  );
}
