"use client";

import { useState, useEffect } from "react";
import { User, Mail, Shield, Camera, Save, Lock, ArrowLeft, Phone, Loader2, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export default function ProfilPage() {
  // 1. État complet du formulaire pour correspondre à ton UserModel
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    role: "",
    avatar: ""
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

  // 2. Chargement des données
  useEffect(() => {
    setMounted(true);
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const u = d.data.user;
          setFormData({
            firstName: u.firstName || "",
            lastName: u.lastName || "",
            email: u.email || "",
            phone: u.phone || "",
            role: u.role || "",
            avatar: u.avatar || ""
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // 3. Sauvegarde vers l'API PATCH
  const handleUpdate = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          phone: formData.phone
          // On n'envoie pas l'email ni le rôle (sécurité serveur)
        }),
      });

      const data = await res.json();
      if (data.success) {
        setStatus({ type: 'success', msg: "Profil mis à jour avec succès !" });
        setTimeout(() => setStatus(null), 3000);
      } else {
        setStatus({ type: 'error', msg: data.error || "Erreur lors de la mise à jour" });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: "Erreur de connexion réseau" });
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) return null;
  if (loading) return <div className="p-10 text-moss animate-pulse font-medium">Récupération de vos informations...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-16">
      
      {/* Navigation & Status */}
      <div className="flex justify-between items-center">
        <Link href="/associations/dashboard" className="inline-flex items-center gap-2 text-xs font-bold text-moss hover:text-cedar transition-colors uppercase tracking-widest">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Link>
        {status && (
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold animate-in zoom-in-95 ${status.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {status.type === 'success' && <CheckCircle2 className="w-4 h-4" />}
            {status.msg}
          </div>
        )}
      </div>

      {/* Carte d'identité visuelle */}
      <div className="flex items-center gap-6 bg-white p-8 rounded-3xl border border-clay/15 shadow-sm">
        <div className="relative group">
          <div className="w-24 h-24 bg-cedar text-white rounded-full flex items-center justify-center text-3xl font-bold shadow-inner uppercase">
            {formData.firstName?.[0]}{formData.lastName?.[0]}
          </div>
          <button className="absolute bottom-0 right-0 p-2 bg-white border border-clay/20 rounded-full shadow-md text-ink hover:text-cedar transition-transform active:scale-90">
            <Camera className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-ink leading-tight">
            {formData.firstName} {formData.lastName}
          </h1>
          <div className="flex items-center gap-3">
             <span className="text-moss font-bold flex items-center gap-2 uppercase text-[10px] tracking-widest bg-clay/5 px-2 py-1 rounded-md">
              <Shield className="w-3 h-3 text-cedar" /> {formData.role.replace(/_/g, " ")}
            </span>
            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Compte Actif</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Formulaire Principal */}
        <div className="md:col-span-2 bg-white p-8 rounded-3xl border border-clay/15 shadow-sm space-y-8">
          <div>
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider border-b border-clay/10 pb-4">
              Détails du profil
            </h2>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Prénom */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-moss uppercase tracking-wider ml-1">Prénom</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-moss/30" />
                <input 
                  type="text" 
                  value={formData.firstName}
                  onChange={(e) => setFormData({...formData, firstName: e.target.value})}
                  className="w-full pl-10 pr-4 py-3 bg-sand/20 border border-clay/15 rounded-xl text-sm focus:ring-2 focus:ring-cedar/20 focus:border-cedar transition-all outline-none text-ink font-medium"
                />
              </div>
            </div>

            {/* Nom */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-moss uppercase tracking-wider ml-1">Nom de famille</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-moss/30" />
                <input 
                  type="text" 
                  value={formData.lastName}
                  onChange={(e) => setFormData({...formData, lastName: e.target.value})}
                  className="w-full pl-10 pr-4 py-3 bg-sand/20 border border-clay/15 rounded-xl text-sm focus:ring-2 focus:ring-cedar/20 focus:border-cedar transition-all outline-none text-ink font-medium"
                />
              </div>
            </div>

            {/* Email - Lecture seule */}
            <div className="space-y-2 sm:col-span-2">
              <label className="text-[10px] font-bold text-moss/50 uppercase tracking-wider ml-1 flex justify-between">
                Email professionnel <Lock className="w-3 h-3" />
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-moss/20" />
                <input 
                  type="email" 
                  value={formData.email}
                  disabled
                  className="w-full pl-10 pr-4 py-3 bg-clay/5 border border-clay/10 rounded-xl text-sm text-moss/50 cursor-not-allowed outline-none font-medium"
                />
              </div>
            </div>

            {/* Téléphone */}
            <div className="space-y-2 sm:col-span-2">
              <label className="text-[10px] font-bold text-moss uppercase tracking-wider ml-1">Numéro de téléphone</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-moss/30" />
                <input 
                  type="text" 
                  value={formData.phone}
                  onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  placeholder="+227 00 00 00 00"
                  className="w-full pl-10 pr-4 py-3 bg-sand/20 border border-clay/15 rounded-xl text-sm focus:ring-2 focus:ring-cedar/20 focus:border-cedar transition-all outline-none text-ink font-medium"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-clay/10">
            <button 
              onClick={handleUpdate}
              disabled={saving}
              className="w-full sm:w-auto flex items-center justify-center gap-3 px-8 py-4 bg-cedar text-white rounded-2xl text-[11px] font-bold uppercase tracking-widest hover:bg-ink transition-all active:scale-[0.98] shadow-lg shadow-cedar/10 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? "Mise à jour en cours..." : "Enregistrer les modifications"}
            </button>
          </div>
        </div>

        {/* Sidebar Actions */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-3xl border border-clay/15 shadow-sm">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider mb-4 flex items-center gap-2">
              <Lock className="w-4 h-4 text-cedar" /> Sécurité
            </h2>
            <p className="text-[11px] text-moss mb-5 leading-relaxed">
              Il est conseillé de mettre à jour votre mot de passe tous les 6 mois.
            </p>
            <button className="w-full py-3 border border-clay/30 text-ink rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-sand transition-colors">
              Changer le mot de passe
            </button>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-clay/15 shadow-sm">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider mb-2 flex items-center gap-2">
               Informations Système
            </h2>
            <div className="space-y-2 mt-4">
              <div className="flex justify-between border-b border-clay/5 pb-2">
                <span className="text-[10px] text-moss">Rôle</span>
                <span className="text-[10px] font-bold text-ink uppercase">{formData.role.split('_')[1] || 'Membre'}</span>
              </div>
              <div className="flex justify-between border-b border-clay/5 pb-2">
                <span className="text-[10px] text-moss">Tenant</span>
                <span className="text-[10px] font-bold text-ink uppercase">Association</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}