"use client";
import { useState, useEffect } from "react";
import { MessageComposer } from "@/components/shared/MessageComposer";

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.json())
      .then(d => setUser(d.data?.user || null))
      .finally(() => setLoading(false));
  }, []);

  const profile = user?.tenantType || "pme";
  const labels = PROFILE_LABELS[profile] || PROFILE_LABELS.pme;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-sand animate-pulse rounded-lg" />
        <div className="h-[600px] bg-sand animate-pulse rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">{labels.title}</h1>
        <p className="text-sm text-moss mt-0.5">{labels.subtitle}</p>
      </div>

      {/* Onglets contextuels selon le profil */}
      {profile === "association" && (
        <div className="flex gap-2 text-xs text-moss bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          <span>💡</span>
          <span>Les conversations sont partagées avec les membres du bureau et les adhérents ayant un compte.</span>
        </div>
      )}

      {user && (
        <MessageComposer
          currentUserId={user._id}
          profileFilter={profile}
        />
      )}
    </div>
  );
}
