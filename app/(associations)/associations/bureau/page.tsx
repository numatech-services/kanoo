"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

interface BureauMember { _id:string; firstName:string; lastName:string; role:string; customRoleLabel?:string; email?:string; phone?:string; mandateStart:string; mandateEnd?:string; isActive:boolean; projectIds:Array<{_id:string;code:string;name:string;executionRate:number;status:string}>; }

const ROLES: Array<[string,string]> = [
  ["president","Président(e)"],["vice_president","Vice-Président(e)"],
  ["secretaire_general","Secrétaire Général(e)"],["secretaire_adjoint","Secrétaire Adjoint(e)"],
  ["tresorier","Trésorier(e)"],["tresorier_adjoint","Trésorier(e) Adjoint(e)"],
  ["commissaire_aux_comptes","Commissaire aux Comptes"],["conseiller","Conseiller(ère)"],
  ["charge_de_mission","Chargé(e) de Mission"],["autre","Autre"],
];
const ROLE_ORDER = ["president","vice_president","secretaire_general","secretaire_adjoint","tresorier","tresorier_adjoint","commissaire_aux_comptes","conseiller","charge_de_mission","autre"];

export default function BureauPage() {
  const [mounted, setMounted] = useState(false);
  const [members, setMembers] = useState<BureauMember[]>([]);
  const [loading, setLoading] = useState(true);
  const pageVisibleRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/bureau", { credentials:"include" });
    const d = await res.json();
    setMembers(d.data?.items || []);
    setLoading(false);
  }, []);
  
  useEffect(() => { 
    setMounted(true);
    load();

    // Reload data when tab becomes visible (user returns from new page)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && pageVisibleRef.current === false) {
        load();
      }
      pageVisibleRef.current = document.visibilityState === 'visible';
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [load]);

  // Grouper par ordre de rôle
  const grouped = ROLE_ORDER.reduce((acc, role) => {
    const roleMembers = members.filter(m => m.role === role);
    if (roleMembers.length > 0) acc[role] = roleMembers;
    return acc;
  }, {} as Record<string, BureauMember[]>);

  if (!mounted) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Bureau de l'association</h1>
          <p className="text-sm text-moss">{members.filter(m => m.isActive).length} membres actifs</p>
        </div>
        <button onClick={() => window.location.href = "/associations/bureau/new"} className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink">+ Ajouter un membre</button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">{[...Array(6)].map((_,i) => <div key={i} className="h-32 bg-white rounded-xl animate-pulse border border-clay/20"/>)}</div>
      ) : members.length === 0 ? (
        <div className="bg-white rounded-xl border border-clay/20 p-12 text-center"><p className="text-4xl mb-3">&#127963;</p><p className="text-moss">Aucun membre du bureau enregistré</p></div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([role, roleMembers]) => (
            <div key={role}>
              <p className="text-xs font-semibold uppercase tracking-widest text-moss mb-3">{ROLES.find(r => r[0] === role)?.[1] || role}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {roleMembers.map(m => (
                  <div key={m._id} className="bg-white rounded-xl border border-clay/20 p-5">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 bg-cedar text-white rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0">
                        {m.firstName[0]}{m.lastName[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-ink">{m.firstName} {m.lastName}</p>
                        <p className="text-xs text-moss">{ROLES.find(r => r[0] === m.role)?.[1] || m.customRoleLabel}</p>
                      </div>
                      {m.isActive
                        ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Actif</span>
                        : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactif</span>
                      }
                    </div>
                    {m.email && <p className="text-xs text-moss mb-1">✉ {m.email}</p>}
                    {m.phone && <p className="text-xs text-moss mb-2">📞 {m.phone}</p>}
                    <p className="text-xs text-moss border-t border-clay/10 pt-2">
                      Mandat depuis le {new Date(m.mandateStart).toLocaleDateString("fr-FR")}
                      {m.mandateEnd && ` → ${new Date(m.mandateEnd).toLocaleDateString("fr-FR")}`}
                    </p>
                    {m.projectIds.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-clay/10">
                        <p className="text-xs font-medium text-moss mb-1">Projets :</p>
                        {m.projectIds.map(p => (
                          <div key={p._id} className="flex items-center justify-between text-xs mb-1">
                            <span className="text-ink truncate">{p.code} — {p.name}</span>
                            <span className={`ml-2 px-1.5 py-0.5 rounded font-mono flex-shrink-0 ${p.executionRate >= 80 ? "bg-green-100 text-green-700" : p.executionRate >= 40 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{p.executionRate}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
