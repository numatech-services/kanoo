"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useMe } from "@/lib/useMe";
import { sectionForPath, type SectionKey } from "@/lib/sections";
import { LayoutDashboard, Bell, MessageSquare, Users, FileText, Receipt, Truck, CreditCard, Factory, Package, Warehouse, Scroll, PenTool, Folder, FolderTree, CheckCircle2, Landmark, BookOpen, RefreshCw, BarChart3, Scissors, UserCircle, Settings, Hash, Diamond, Ticket, LogOut, Building2, Gavel, Megaphone, Heart, PieChart, ClipboardCheck, Globe, Banknote, ShieldAlert, ClipboardList, TrendingUp, User, FileSpreadsheet, History, Calendar, Repeat, Layers, Link2, ShieldCheck, BellRing, ReceiptText, FileClock, Mail, ChevronDown, PackageCheck, CalendarClock, Database, Store } from "lucide-react";

type ProfileType = "pme" | "association" | "administration" | "superadmin";

interface NavItem { 
  label: string; 
  href: string; 
  icon: React.ReactNode; 
  badge?: string; 
}

interface NavGroup {
  section: string;
  items: NavItem[];
  /**
   * Teinte du groupe. Elle est posée sur le bloc lui-même, si bien que chaque
   * famille d'écrans se reconnaît dans la barre latérale avant même d'être
   * ouverte — et que l'item actif reprend exactement la couleur que prendra la
   * page une fois chargée.
   */
  tone?: SectionKey;
}

const PME_NAV: NavGroup[] = [
  { section: "Accueil", items: [
    { label: "Tableau de bord", href: "/dashboard", icon: <LayoutDashboard size={18} /> },
    { label: "Agenda", href: "/agenda", icon: <CalendarClock size={18} /> },
    { label: "Activités", href: "/activites", icon: <Calendar size={18} /> },
    { label: "Notifications", href: "/notifications", icon: <Bell size={18} /> },
    { label: "Messages", href: "/messages", icon: <MessageSquare size={18} /> },
    { label: "Courriers", href: "/courriers", icon: <Mail size={18} /> },
  ]},
  { section: "Ventes", items: [
    { label: "Clients", href: "/clients", icon: <Users size={18} /> },
    { label: "Devis", href: "/devis", icon: <ClipboardList size={18} /> },
    { label: "Factures", href: "/invoices", icon: <Receipt size={18} /> },
    { label: "Bons de livraison", href: "/livraisons", icon: <Truck size={18} /> },
    { label: "Paiements", href: "/payments", icon: <CreditCard size={18} /> },
    { label: "Relances", href: "/relances", icon: <BellRing size={18} /> },
    { label: "Notes de frais", href: "/notes-de-frais", icon: <ReceiptText size={18} /> },
    { label: "Cartes ISIC", href: "/isic", icon: <CreditCard size={18} /> },
  ]},
  { section: "Achats & Stock", items: [
    { label: "Fournisseurs", href: "/suppliers", icon: <Factory size={18} /> },
    { label: "Commandes", href: "/commandes", icon: <Package size={18} /> },
    { label: "Stock", href: "/stock", icon: <Warehouse size={18} /> },
    { label: "Inventaires", href: "/inventaires", icon: <ClipboardCheck size={18} /> },
    { label: "Marchés", href: "/marches", icon: <Scroll size={18} /> },
    { label: "Marchés-cadres", href: "/marches-cadres", icon: <PackageCheck size={18} /> },
  ]},
  { section: "Abonnements", items: [
    { label: "Portefeuille", href: "/abonnements", icon: <Repeat size={18} /> },
    { label: "Contrats souscrits", href: "/abonnements/achats", icon: <Layers size={18} /> },
    { label: "Reventes", href: "/abonnements/reventes", icon: <Link2 size={18} /> },
  ]},
  { section: "Contrats & Projets", items: [
    { label: "Appels à candidatures", href: "/appels", icon: <Megaphone size={18} /> },
    { label: "Contrats", href: "/contracts", icon: <PenTool size={18} /> },
    { label: "CRM Pipeline", href: "/crm", icon: <BarChart3 size={18} /> },
    { label: "Projets", href: "/projects", icon: <Folder size={18} /> },
    { label: "Documents", href: "/documents", icon: <FolderTree size={18} /> },
    { label: "Documents administratifs", href: "/documents-administratifs", icon: <FileClock size={18} /> },
    { label: "Approbations", href: "/approbations", icon: <CheckCircle2 size={18} /> },
  ]},
  { section: "Finance", items: [
    { label: "Trésorerie", href: "/treasury", icon: <Landmark size={18} /> },
    { label: "Comptabilité", href: "/accounting", icon: <BookOpen size={18} /> },
    { label: "Comptoir (The Spot)", href: "/comptoir", icon: <Store size={18} /> },
    { label: "Rentabilité par secteur", href: "/analytique", icon: <PieChart size={18} /> },
    { label: "Budget prévisionnel", href: "/budget-previsionnel", icon: <PieChart size={18} /> },
    { label: "Dépenses récurrentes", href: "/recurring-expenses", icon: <RefreshCw size={18} /> },
    { label: "Fiscalité", href: "/fiscalite", icon: <BarChart3 size={18} /> },
    { label: "IS/BIC annuel", href: "/fiscalite/isbic", icon: <Landmark size={18} /> },
    { label: "Retenues / source", href: "/fiscalite/retenues", icon: <Scissors size={18} /> },
    { label: "Immobilisations", href: "/fixed-assets", icon: <Warehouse size={18} /> },
    { label: "Analytique 12 mois", href: "/analytics", icon: <TrendingUp size={18} /> },
  ]},
  { section: "RH", items: [
    { label: "Collaborateurs", href: "/employees", icon: <User size={18} /> },
    { label: "Bulletins de paie", href: "/payslips", icon: <FileSpreadsheet size={18} /> },
  ]},
  { section: "Paramètres", items: [
    { label: "Utilisateurs", href: "/users", icon: <Settings size={18} /> },
    { label: "Synthèse des accès", href: "/users/acces", icon: <ShieldCheck size={18} /> },
    { label: "Sécurité (2FA)", href: "/settings/securite", icon: <ShieldAlert size={18} /> },
    { label: "Confidentialité", href: "/settings/confidentialite", icon: <FileText size={18} /> },
    { label: "Numérotation", href: "/settings/numbering", icon: <Hash size={18} /> },
    { label: "Import / Export", href: "/data", icon: <Database size={18} /> },
    { label: "Facture certifiée", href: "/settings/facture-certifiee", icon: <ShieldCheck size={18} /> },
    { label: "Abonnement", href: "/subscription", icon: <Diamond size={18} /> },
    { label: "Support", href: "/support", icon: <Ticket size={18} /> },
    { label: "Journal d'audit", href: "/audit", icon: <History size={18} /> },
  ]},
];

const ASSO_NAV: NavGroup[] = [
  { section: "Accueil", items: [
    { label: "Tableau de bord", href: "/associations/dashboard", icon: <LayoutDashboard size={18} /> },
    { label: "Agenda", href: "/associations/agenda", icon: <CalendarClock size={18} /> },
    { label: "Activités", href: "/activites", icon: <Calendar size={18} /> },
    { label: "Messages", href: "/messages", icon: <MessageSquare size={18} /> },
    { label: "Import / Export", href: "/data", icon: <Database size={18} /> },
  ]},
  { section: "Gouvernance", items: [
    { label: "Bureau", href: "/associations/bureau", icon: <Building2 size={18} /> },
    { label: "Assemblées générales", href: "/associations/assemblee", icon: <Megaphone size={18} /> },
  ]},
  { section: "Membres", items: [
    { label: "Adhérents", href: "/associations/membres", icon: <Users size={18} /> },
    { label: "Cotisations", href: "/associations/cotisations", icon: <CreditCard size={18} /> },
    { label: "Dons", href: "/associations/dons", icon: <Heart size={18} /> },
  ]},
  { section: "Projets", items: [
    { label: "Projets / ONG", href: "/projects", icon: <Folder size={18} /> },
  ]},
  { section: "Paramètres", items: [
    { label: "Mon organisation", href: "/company", icon: <Building2 size={18} /> },
    { label: "Apparence des documents", href: "/company/branding", icon: <FileText size={18} /> },
    { label: "Utilisateurs", href: "/users", icon: <Users size={18} /> },
    { label: "Synthèse des accès", href: "/users/acces", icon: <ShieldCheck size={18} /> },
    { label: "Sécurité (2FA)", href: "/settings/securite", icon: <ShieldAlert size={18} /> },
    { label: "Mon profil", href: "/associations/profil", icon: <UserCircle size={18} /> },
  ]},
];

const ADMIN_NAV: NavGroup[] = [
  { section: "Accueil", items: [
    { label: "Tableau de bord", href: "/administration/dashboard", icon: <LayoutDashboard size={18} /> },
    { label: "Agenda", href: "/administration/agenda", icon: <CalendarClock size={18} /> },
    { label: "Activités", href: "/activites", icon: <Calendar size={18} /> },
    { label: "Messages", href: "/messages", icon: <MessageSquare size={18} /> },
    { label: "Import / Export", href: "/data", icon: <Database size={18} /> },
  ]},
  { section: "Budget", items: [
    { label: "Chapitres budgétaires", href: "/administration/budget", icon: <PieChart size={18} /> },
    { label: "Engagements", href: "/administration/budget/engagements", icon: <ClipboardCheck size={18} /> },
    { label: "Mandatements", href: "/administration/budget/mandatements", icon: <CheckCircle2 size={18} /> },
  ]},
  { section: "Marchés publics", items: [
    { label: "Appels d'offres", href: "/administration/marches-publics", icon: <Gavel size={18} /> },
  ]},
  { section: "Personnel", items: [
    { label: "Gestion du personnel", href: "/employees", icon: <UserCircle size={18} /> },
  ]},
  { section: "Recettes", items: [
    { label: "Recettes publiques", href: "/administration/recettes", icon: <Banknote size={18} /> },
    { label: "Services citoyens", href: "/administration/services", icon: <Globe size={18} /> },
  ]},
  { section: "Paramètres", items: [
    { label: "Mon organisation", href: "/company", icon: <Building2 size={18} /> },
    { label: "Apparence des documents", href: "/company/branding", icon: <FileText size={18} /> },
    { label: "Utilisateurs", href: "/users", icon: <Users size={18} /> },
    { label: "Synthèse des accès", href: "/users/acces", icon: <ShieldCheck size={18} /> },
    { label: "Sécurité (2FA)", href: "/settings/securite", icon: <ShieldAlert size={18} /> },
    { label: "Mon profil", href: "/profile", icon: <UserCircle size={18} /> },
  ]},
];

const SUPERADMIN_NAV: NavGroup[] = [
  { section: "Plateforme", items: [
    { label: "Tableau de bord", href: "/saas/dashboard", icon: <LayoutDashboard size={18} /> },
    { label: "Organisations", href: "/saas/tenants", icon: <Building2 size={18} /> },
    { label: "Plans tarifaires", href: "/saas/plans", icon: <Diamond size={18} /> },
  ]},
  { section: "Support & Sécurité", items: [
    { label: "Support tickets", href: "/saas/support", icon: <Ticket size={18} /> },
    { label: "Sécurité / Accès", href: "/saas/security", icon: <ShieldAlert size={18} /> },
  ]},
];

const NAV_MAP: Record<ProfileType, NavGroup[]> = {
  pme: PME_NAV, association: ASSO_NAV, administration: ADMIN_NAV, superadmin: SUPERADMIN_NAV,
};

export function Sidebar({ profile }: { profile: ProfileType }) {
  const pathname = usePathname();
  const nav = NAV_MAP[profile] || PME_NAV;
  const { tenant } = useMe();

  // Les compteurs sont un supplément : leur absence n'empêche jamais la
  // navigation de s'afficher, et un échec de lecture reste silencieux.
  const [counters, setCounters] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    fetch("/api/nav-counters", { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (alive && d.success) setCounters(d.data || {}); })
      .catch(() => { /* la navigation se passe très bien de ses pastilles */ });
    return () => { alive = false; };
  }, [pathname]);

  // ── Groupes repliables ──────────────────────────────────────────────────
  // On montre les modules (en-têtes de groupe) ; le clic déploie leurs entrées.
  // Le groupe de la page courante est toujours ouvert. Les autres retiennent le
  // choix de l'utilisateur d'une visite à l'autre.
  const isActiveItem = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const activeSection = nav.find(g => g.items.some(i => isActiveItem(i.href)))?.section;

  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("kanoo.nav.open") || "[]");
      if (Array.isArray(saved)) setOpenGroups(new Set(saved));
    } catch { /* localStorage indisponible : on part replié, ce n'est pas grave */ }
  }, []);
  const toggleGroup = (section: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(section) ? next.delete(section) : next.add(section);
      try { localStorage.setItem("kanoo.nav.open", JSON.stringify([...next])); } catch { /* sans persistance */ }
      return next;
    });
  };
  // Un groupe est ouvert s'il porte la page courante, ou si l'utilisateur l'a ouvert.
  const isOpen = (section: string) => section === activeSection || openGroups.has(section);

  return (
    <aside className="w-64 bg-chrome text-chromefg border-r border-chromefg/10 flex flex-col h-full overflow-hidden flex-shrink-0">
      <div className="px-6 py-5 border-b border-chromefg/10">
        <div className="flex items-center gap-2.5">
          {tenant?.logo ? (
            <span className="w-9 h-9 rounded-lg bg-chromefg/10 grid place-items-center overflow-hidden shrink-0">
              <img src={tenant.logo} alt="" className="max-w-full max-h-full object-contain" />
            </span>
          ) : null}
          <span className="text-lg font-black tracking-tight leading-tight line-clamp-2">
            {tenant?.name || "Kanoo"}
          </span>
        </div>
        <p className="text-[10px] font-bold text-chromefg/40 mt-2 uppercase tracking-widest">{profile}</p>
        {tenant?.name ? <p className="text-[9px] text-chromefg/25 mt-0.5">propulsé par Kanoo</p> : null}
      </div>

      <nav className="flex-1 overflow-y-auto py-6 px-3 custom-scrollbar">
        {nav.map((group) => {
          // À défaut de teinte déclarée, on prend celle du premier item : les
          // deux tables resteront cohérentes sans double saisie.
          const tone = group.tone ?? sectionForPath(group.items[0]?.href ?? "/");
          const open = isOpen(group.section);
          // Somme des compteurs du groupe : quand il est replié, une pastille sur
          // l'en-tête signale qu'il s'y passe quelque chose (impayés, alertes…).
          const groupCount = group.items.reduce((n, it) => n + (counters[it.href] ?? 0), 0);
          return (
            <div key={group.section} className="mb-2" data-section={tone}>
              <button type="button" onClick={() => toggleGroup(group.section)}
                aria-expanded={open}
                className="w-full flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-chromefg/40 hover:text-chromefg/70 px-3 py-2 rounded-lg transition-colors">
                <span className="h-1.5 w-1.5 rounded-full bg-section shrink-0" aria-hidden />
                <span className="flex-1 text-left">{group.section}</span>
                {!open && groupCount > 0 && (
                  <span className="num text-[9px] font-bold rounded-full px-1.5 bg-section text-chromefg">{groupCount}</span>
                )}
                <ChevronDown size={13} className={`shrink-0 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
              </button>
              {open && <div className="mt-1 mb-3">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link key={item.href} href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 mb-1 ${
                      active
                      ? "bg-chromeactive text-chromeactivefg shadow-lg font-bold"
                      : "text-chromefg/60 hover:bg-chromefg/5 hover:text-chromefg"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r bg-chromeactivefg/40" aria-hidden />
                    )}
                    <span className={`flex items-center justify-center ${active ? "text-chromeactivefg" : "text-chromefg/40"}`}>
                      {item.icon}
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {(counters[item.href] ?? item.badge) && (
                      <span className={`num text-[10px] font-bold rounded-full px-1.5 min-w-[1.25rem] text-center ${
                        active ? "bg-chromeactivefg/25 text-chromeactivefg" : "bg-chromefg/15 text-chromefg"
                      }`}>
                        {counters[item.href] ?? item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
              </div>}
            </div>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-chromefg/10">
        <button 
          onClick={async () => { 
            await fetch("/api/auth/logout", { method: "POST" }); 
            window.location.href = "/login"; 
          }}
          className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-chromefg/50 hover:bg-neg/10 hover:text-neg transition-all"
        >
          <LogOut size={16} />
          <span>Déconnexion</span>
        </button>
      </div>
    </aside>
  );
}