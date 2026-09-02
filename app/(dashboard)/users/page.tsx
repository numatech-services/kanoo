"use client";

import { useState, useEffect, useCallback } from "react";
import { DataTable, Column } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Pagination } from "@/components/ui/Pagination";

interface User { 
  _id: string; 
  firstName: string; 
  lastName: string; 
  email: string; 
  role: string; 
  isActive: boolean; 
  lastLoginAt?: string; 
}

export default function UsersPage() {
  const [mounted, setMounted] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0); 
  const [page, setPage] = useState(1); 
  const [loading, setLoading] = useState(true);
  const LIMIT = 20;

  // Fonction de révocation corrigée (syntaxe propre)
  async function handleRevokeSession(userId: string, userName: string) {
    if (!confirm(`Révoquer la session de ${userName} ? L'utilisateur devra se reconnecter immédiatement.`)) return;
    
    try {
      const csrfRes = await fetch("/api/auth/csrf"); 
      const { csrfToken } = await csrfRes.json();
      
      const res = await fetch(`/api/users/${userId}/revoke-session`, {
        method: "POST", 
        headers: { "x-csrf-token": csrfToken }, 
        credentials: "include"
      });
      
      const d = await res.json();
      alert(res.ok ? (d.data?.message || "Session révoquée") : (d.error || "Erreur"));
    } catch (err) {
      alert("Erreur lors de la communication avec le serveur");
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/users?page=${page}&limit=${LIMIT}`, { credentials: "include" });
      const d = await res.json(); 
      setUsers(d.data?.items || []); 
      setTotal(d.data?.pagination?.total || 0);
    } catch (err) {
      console.error("Erreur de chargement:", err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { setMounted(true); load(); }, [load]);

  if (!mounted) return null;

  const columns: Column<User>[] = [
    { 
      key: "lastName", 
      label: "Nom complet", 
      sortable: true, 
      render: (_v, r) => `${r.firstName} ${r.lastName}` 
    },
    { 
      key: "email", 
      label: "Email", 
      className: "text-moss text-sm" 
    },
    { 
      key: "role", 
      label: "Rôle", 
      render: (v) => (
        <span className="text-xs bg-cedar/10 text-cedar px-2 py-0.5 rounded font-medium">
          {String(v).replace(/_/g," ")}
        </span>
      ) 
    },
    { 
      key: "lastLoginAt", 
      label: "Dernière connexion", 
      render: (v) => v ? new Date(String(v)).toLocaleDateString("fr-FR") : <span className="text-moss">Jamais</span> 
    },
    { 
      key: "isActive", 
      label: "Statut", 
      render: (v) => <StatusBadge status={v ? "active" : "inactive"} /> 
    },
    {
      key: "_id",
      label: "Actions",
      render: (_v, r) => (
        <button 
          onClick={() => handleRevokeSession(r._id, `${r.firstName} ${r.lastName}`)}
          className="text-xs text-red-600 hover:text-red-800 font-medium"
        >
          Révoquer session
        </button>
      )
    }
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Utilisateurs</h1>
          <p className="text-sm text-moss mt-0.5">
            {total} utilisateur{total > 1 ? "s" : ""} enregistré{total > 1 ? "s" : ""}
          </p>
        </div>
        <button className="px-4 py-2 bg-cedar text-white rounded-lg text-sm font-medium hover:bg-ink transition-colors">
          + Inviter un utilisateur
        </button>
      </div>

      <DataTable 
        columns={columns} 
        data={users} 
        loading={loading} 
        keyExtractor={(u) => u._id} 
        emptyMessage="Aucun utilisateur trouvé" 
      />

      <Pagination 
        page={page} 
        totalPages={Math.ceil(total / LIMIT) || 1} 
        total={total} 
        limit={LIMIT} 
        onPage={setPage} 
      />
    </div>
  );
}