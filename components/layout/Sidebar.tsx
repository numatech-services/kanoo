"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useMe, meCan } from "@/lib/useMe";
import { resourceForHref } from "@/lib/nav-resources";
import { sectionForPath, type SectionKey } from "@/lib/sections";
import { moduleEnabled } from "@/lib/modules";
import { LayoutDashboard, Bell, MessageSquare, Users, FileText, Receipt, Truck, CreditCard, Factory, Package, Warehouse, PenTool, Folder, FolderTree, CheckCircle2, Landmark, BookOpen, RefreshCw, BarChart3, Scissors, UserCircle, Hash, Diamond, Ticket, LogOut, Building2, Gavel, Megaphone, Heart, PieChart, ClipboardCheck, Globe, Banknote, ShieldAlert, ClipboardList, TrendingUp, User, FileSpreadsheet, History, Calendar, Repeat, Layers, Link2, ShieldCheck, BellRing, ReceiptText, FileClock, Mail, ChevronDown, PackageCheck, CalendarClock, Database, Store, BookUser, Scale, Boxes, Sparkles, Zap, Bug, Percent } from "lucide-react";

import { apiJson, apiSend } from "@/lib/api-client";
import { getPendingCount, purgeOfflineData } from "@/lib/offline/sync-queue";
import { confirmDialog } from "@/components/ui/Dialogs";
/** Où mène la pastille d'une entrée : la liste filtrée sur ce qu'elle compte. */
const BADGE_TARGET: Record<string, { href: string; title: string }> = {
  "/invoices": { href: "/invoices?overdue=true", title: "Voir les factures en retard" },
  "/relances": { href: "/invoices?overdue=true", title: "Voir les factures en retard" },
  "/stock": { href: "/stock?alertOnly=true", title: "Voir les articles sous le seuil" },
};

export type ProfileType = "pme" | "association" | "administration" | "superadmin";

const PROFILE_LABEL: Record<ProfileType, string> = {
  pme: "Entreprise", association: "Association", administration: "Administration", superadmin: "Plateforme",
};

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

// Sept espaces métier, puis les modules optionnels et les réglages. Chaque
// écran n'apparaît qu'à un endroit, sous le nom qu'il porte dans sa page
// (audit d'octobre 2026 : 61 entrées en 8 groupes, « Activité » y avait cinq
// sens et les achats étaient rangés en Finance).
const PME_NAV: NavGroup[] = [
  { section: "Pilotage", tone: "accueil", items: [
    { label: "Tableau de bord", href: "/dashboard", icon: <LayoutDashboard size={18} /> },
    { label: "Rapports", href: "/rapports", icon: <FileSpreadsheet size={18} /> },
    { label: "Agenda", href: "/agenda", icon: <CalendarClock size={18} /> },
    { label: "Notifications", href: "/notifications", icon: <Bell size={18} /> },
    { label: "Messages", href: "/messages", icon: <MessageSquare size={18} /> },
  ]},
  { section: "Ventes", tone: "ventes", items: [
    { label: "Clients", href: "/clients", icon: <Users size={18} /> },
    { label: "Pipeline commercial", href: "/crm", icon: <BarChart3 size={18} /> },
    { label: "Devis", href: "/devis", icon: <ClipboardList size={18} /> },
    { label: "Marchés & contrats clients", href: "/contracts", icon: <PenTool size={18} /> },
    { label: "Marchés-cadres", href: "/marches-cadres", icon: <PackageCheck size={18} /> },
    { label: "Factures", href: "/invoices", icon: <Receipt size={18} /> },
    { label: "Bons de livraison", href: "/livraisons", icon: <Truck size={18} /> },
    { label: "Encaissements", href: "/payments", icon: <CreditCard size={18} /> },
    { label: "Relances", href: "/relances", icon: <BellRing size={18} /> },
  ]},
  { section: "Achats & stock", tone: "achats", items: [
    { label: "Fournisseurs", href: "/suppliers", icon: <Factory size={18} /> },
    { label: "Bons de commande", href: "/commandes", icon: <Package size={18} /> },
    { label: "Factures & dépenses", href: "/depenses", icon: <ReceiptText size={18} /> },
    { label: "Charges récurrentes", href: "/recurring-expenses", icon: <RefreshCw size={18} /> },
    { label: "Stock", href: "/stock", icon: <Warehouse size={18} /> },
    { label: "Entrepôts", href: "/stock/entrepots", icon: <Building2 size={18} /> },
    { label: "Lots & péremptions", href: "/stock/lots", icon: <CalendarClock size={18} /> },
    { label: "Inventaires", href: "/inventaires", icon: <ClipboardCheck size={18} /> },
  ]},
  { section: "Appels d'offres & projets", tone: "contrats", items: [
    { label: "Veille & offres", href: "/appels", icon: <Megaphone size={18} /> },
    { label: "Cautions", href: "/cautions", icon: <ShieldCheck size={18} /> },
    { label: "Projets", href: "/projects", icon: <Folder size={18} /> },
    { label: "Approbations", href: "/approbations", icon: <CheckCircle2 size={18} /> },
  ]},
  { section: "Finance", tone: "finance", items: [
    { label: "Trésorerie", href: "/treasury", icon: <Landmark size={18} /> },
    { label: "Prévision de trésorerie", href: "/treasury/prevision", icon: <TrendingUp size={18} /> },
    { label: "Comptabilité", href: "/accounting", icon: <BookOpen size={18} /> },
    { label: "États comptables", href: "/accounting/etats", icon: <FileSpreadsheet size={18} /> },
    { label: "Plan comptable", href: "/accounting/plan", icon: <Hash size={18} /> },
    { label: "Fiscalité", href: "/fiscalite", icon: <Scale size={18} /> },
    { label: "IS / BIC annuel", href: "/fiscalite/isbic", icon: <Landmark size={18} /> },
    { label: "Retenues à la source", href: "/fiscalite/retenues", icon: <Scissors size={18} /> },
    { label: "Budget prévisionnel", href: "/budget-previsionnel", icon: <PieChart size={18} /> },
    { label: "Immobilisations", href: "/fixed-assets", icon: <Boxes size={18} /> },
    { label: "Secteurs", href: "/analytique", icon: <Layers size={18} /> },
    { label: "Marges par produit", href: "/marges", icon: <Percent size={18} /> },
    { label: "Évolution sur 12 mois", href: "/analytics", icon: <TrendingUp size={18} /> },
  ]},
  { section: "Équipe", tone: "rh", items: [
    { label: "Collaborateurs", href: "/employees", icon: <User size={18} /> },
    { label: "Bulletins de paie", href: "/payslips", icon: <FileSpreadsheet size={18} /> },
    { label: "Congés", href: "/conges", icon: <CalendarClock size={18} /> },
    { label: "Notes de frais", href: "/notes-de-frais", icon: <ReceiptText size={18} /> },
  ]},
  { section: "Documents", tone: "documents", items: [
    { label: "Documents", href: "/documents", icon: <FolderTree size={18} /> },
    { label: "Courriers", href: "/courriers", icon: <Mail size={18} /> },
    { label: "Coffre administratif", href: "/documents-administratifs", icon: <FileClock size={18} /> },
  ]},
  { section: "Modules", tone: "abonnements", items: [
    { label: "Comptoirs", href: "/comptoir", icon: <Store size={18} /> },
    { label: "Cartes ISIC", href: "/isic", icon: <CreditCard size={18} /> },
    { label: "Registre ISIC", href: "/isic/registre", icon: <BookUser size={18} /> },
    { label: "Licences : portefeuille", href: "/abonnements", icon: <Repeat size={18} /> },
    { label: "Licences : contrats éditeurs", href: "/abonnements/achats", icon: <Layers size={18} /> },
    { label: "Licences : reventes", href: "/abonnements/reventes", icon: <Link2 size={18} /> },
    { label: "Événements", href: "/activites", icon: <Calendar size={18} /> },
  ]},
  { section: "Réglages", tone: "parametres", items: [
    { label: "Mon organisation", href: "/company", icon: <Building2 size={18} /> },
    { label: "Apparence des documents", href: "/company/branding", icon: <FileText size={18} /> },
    { label: "Assistant Claude", href: "/company/assistant", icon: <Sparkles size={18} /> },
    { label: "Modules", href: "/settings/modules", icon: <Boxes size={18} /> },
    { label: "Automatisations", href: "/settings/automatisations", icon: <Zap size={18} /> },
    { label: "Utilisateurs et droits", href: "/users", icon: <Users size={18} /> },
    { label: "Synthèse des accès", href: "/users/acces", icon: <ShieldCheck size={18} /> },
    { label: "Sécurité (2FA)", href: "/settings/securite", icon: <ShieldAlert size={18} /> },
    { label: "Confidentialité", href: "/settings/confidentialite", icon: <FileText size={18} /> },
    { label: "Numérotation", href: "/settings/numbering", icon: <Hash size={18} /> },
    { label: "Facture certifiée", href: "/settings/facture-certifiee", icon: <ShieldCheck size={18} /> },
    { label: "Import / Export", href: "/data", icon: <Database size={18} /> },
    { label: "Mon forfait Kanoo", href: "/subscription", icon: <Diamond size={18} /> },
    { label: "Support", href: "/support", icon: <Ticket size={18} /> },
    { label: "Journal d'audit", href: "/audit", icon: <History size={18} /> },
  ]},
];

const ASSO_NAV: NavGroup[] = [
  { section: "Pilotage", tone: "accueil", items: [
    { label: "Tableau de bord", href: "/associations/dashboard", icon: <LayoutDashboard size={18} /> },
    { label: "Agenda", href: "/associations/agenda", icon: <CalendarClock size={18} /> },
    { label: "Événements", href: "/activites", icon: <Calendar size={18} /> },
    { label: "Notifications", href: "/notifications", icon: <Bell size={18} /> },
    { label: "Messages", href: "/messages", icon: <MessageSquare size={18} /> },
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
  // Écrans communs aux trois espaces, ouverts par les rôles de l'association
  // (role-resources) mais absents du menu : notes de frais, fiscalité,
  // documents, support, journal d'audit. Chaque entrée reste filtrée par droit.
  { section: "Finances", tone: "finance", items: [
    { label: "Trésorerie", href: "/treasury", icon: <Landmark size={18} /> },
    { label: "Comptabilité", href: "/accounting", icon: <BookOpen size={18} /> },
    { label: "Fiscalité", href: "/fiscalite", icon: <Scale size={18} /> },
    { label: "Notes de frais", href: "/notes-de-frais", icon: <ReceiptText size={18} /> },
  ]},
  { section: "Projets", items: [
    { label: "Projets / ONG", href: "/projects", icon: <Folder size={18} /> },
  ]},
  { section: "Documents", tone: "documents", items: [
    { label: "Documents", href: "/documents", icon: <FolderTree size={18} /> },
    { label: "Courriers", href: "/courriers", icon: <Mail size={18} /> },
  ]},
  { section: "Réglages", tone: "parametres", items: [
    { label: "Mon organisation", href: "/company", icon: <Building2 size={18} /> },
    { label: "Apparence des documents", href: "/company/branding", icon: <FileText size={18} /> },
    { label: "Assistant Claude", href: "/company/assistant", icon: <Sparkles size={18} /> },
    { label: "Utilisateurs", href: "/users", icon: <Users size={18} /> },
    { label: "Synthèse des accès", href: "/users/acces", icon: <ShieldCheck size={18} /> },
    { label: "Automatisations", href: "/settings/automatisations", icon: <Zap size={18} /> },
    { label: "Sécurité (2FA)", href: "/settings/securite", icon: <ShieldAlert size={18} /> },
    { label: "Import / Export", href: "/data", icon: <Database size={18} /> },
    { label: "Support", href: "/support", icon: <Ticket size={18} /> },
    { label: "Journal d'audit", href: "/audit", icon: <History size={18} /> },
    { label: "Mon profil", href: "/associations/profil", icon: <UserCircle size={18} /> },
  ]},
];

const ADMIN_NAV: NavGroup[] = [
  { section: "Pilotage", tone: "accueil", items: [
    { label: "Tableau de bord", href: "/administration/dashboard", icon: <LayoutDashboard size={18} /> },
    { label: "Agenda", href: "/administration/agenda", icon: <CalendarClock size={18} /> },
    { label: "Événements", href: "/activites", icon: <Calendar size={18} /> },
    { label: "Notifications", href: "/notifications", icon: <Bell size={18} /> },
    { label: "Messages", href: "/messages", icon: <MessageSquare size={18} /> },
  ]},
  { section: "Budget", items: [
    { label: "Chapitres budgétaires", href: "/administration/budget", icon: <PieChart size={18} /> },
    { label: "Engagements", href: "/administration/budget/engagements", icon: <ClipboardCheck size={18} /> },
    { label: "Mandatements", href: "/administration/budget/mandatements", icon: <CheckCircle2 size={18} /> },
  ]},
  { section: "Marchés publics", items: [
    { label: "Appels d'offres", href: "/administration/marches-publics", icon: <Gavel size={18} /> },
    { label: "Fournisseurs", href: "/suppliers", icon: <Factory size={18} /> },
  ]},
  // Comptable public et DAF : trésorerie, comptabilité et fiscalité étaient
  // accordées (role-resources) sans entrée de menu.
  { section: "Finances", tone: "finance", items: [
    { label: "Trésorerie", href: "/treasury", icon: <Landmark size={18} /> },
    { label: "Comptabilité", href: "/accounting", icon: <BookOpen size={18} /> },
    { label: "Fiscalité", href: "/fiscalite", icon: <Scale size={18} /> },
  ]},
  { section: "Personnel", items: [
    { label: "Gestion du personnel", href: "/employees", icon: <UserCircle size={18} /> },
    { label: "Notes de frais", href: "/notes-de-frais", icon: <ReceiptText size={18} /> },
  ]},
  { section: "Documents", tone: "documents", items: [
    { label: "Documents", href: "/documents", icon: <FolderTree size={18} /> },
    { label: "Courriers", href: "/courriers", icon: <Mail size={18} /> },
  ]},
  { section: "Recettes", items: [
    { label: "Recettes publiques", href: "/administration/recettes", icon: <Banknote size={18} /> },
    { label: "Services citoyens", href: "/administration/services", icon: <Globe size={18} /> },
  ]},
  { section: "Réglages", tone: "parametres", items: [
    { label: "Mon organisation", href: "/company", icon: <Building2 size={18} /> },
    { label: "Apparence des documents", href: "/company/branding", icon: <FileText size={18} /> },
    { label: "Assistant Claude", href: "/company/assistant", icon: <Sparkles size={18} /> },
    { label: "Utilisateurs", href: "/users", icon: <Users size={18} /> },
    { label: "Synthèse des accès", href: "/users/acces", icon: <ShieldCheck size={18} /> },
    { label: "Automatisations", href: "/settings/automatisations", icon: <Zap size={18} /> },
    { label: "Sécurité (2FA)", href: "/settings/securite", icon: <ShieldAlert size={18} /> },
    { label: "Import / Export", href: "/data", icon: <Database size={18} /> },
    { label: "Support", href: "/support", icon: <Ticket size={18} /> },
    { label: "Journal d'audit", href: "/audit", icon: <History size={18} /> },
    { label: "Mon profil", href: "/profile", icon: <UserCircle size={18} /> },
  ]},
];

const SUPERADMIN_NAV: NavGroup[] = [
  { section: "Plateforme", items: [
    { label: "Tableau de bord", href: "/saas/dashboard", icon: <LayoutDashboard size={18} /> },
    { label: "Organisations", href: "/saas/tenants", icon: <Building2 size={18} /> },
    { label: "Plans tarifaires", href: "/saas/plans", icon: <Diamond size={18} /> },
    { label: "Facturation", href: "/saas/billing", icon: <Receipt size={18} /> },
  ]},
  { section: "Support & Sécurité", items: [
    { label: "Support tickets", href: "/saas/support", icon: <Ticket size={18} /> },
    { label: "Sécurité / Accès", href: "/saas/security", icon: <ShieldAlert size={18} /> },
    { label: "Journal des erreurs", href: "/saas/erreurs", icon: <Bug size={18} /> },
  ]},
];

export const NAV_MAP: Record<ProfileType, NavGroup[]> = {
  pme: PME_NAV, association: ASSO_NAV, administration: ADMIN_NAV, superadmin: SUPERADMIN_NAV,
};


// Groupes ouverts retenus dans le navigateur (texte brut : instantané stable).
// Aucun au rendu serveur et pendant l'hydratation, la valeur gardée ensuite.
const noSubscribe = () => () => {};
function savedOpenGroups(): string {
  try { return localStorage.getItem("kanoo.nav.open") || "[]"; } catch { return "[]"; /* localStorage indisponible */ }
}

export function Sidebar({ profile }: { profile: ProfileType }) {
  const pathname = usePathname();
  const router = useRouter();
  // Téléphone et tablette : le menu est un tiroir, ouvert depuis la barre du
  // haut ou la barre du bas (événement « kanoo:nav »), refermé à chaque page.
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setMobileOpen(v => !v);
    window.addEventListener("kanoo:nav", toggle);
    return () => window.removeEventListener("kanoo:nav", toggle);
  }, []);
  // Refermé à chaque changement de page (motif « ajuster l'état pendant le rendu »).
  const [menuPath, setMenuPath] = useState(pathname);
  if (pathname !== menuPath) {
    setMenuPath(pathname);
    setMobileOpen(false);
  }
  const rawNav = NAV_MAP[profile] || PME_NAV;
  const { tenant, resources, loading, user } = useMe();

  // Filtrage par droits : on masque les entrées dont on SAIT qu'elles sont
  // inaccessibles. Tant que les droits ne sont pas chargés (ou vides), on
  // n'ampute rien — pas de menu qui « clignote » vide au chargement. Superadmin
  // porte « * » et voit tout. Un groupe sans entrée visible disparaît.
  const canSee = (href: string) => {
    if (!moduleEnabled(href, tenant?.disabledModules)) return false;
    const res = resourceForHref(href);
    if (!res) return true;
    if (loading || resources.length === 0) return true;
    return meCan(resources, res);
  };
  const nav = rawNav
    .map(g => ({ ...g, items: g.items.filter(it => canSee(it.href)) }))
    .filter(g => g.items.length > 0);

  // Les compteurs sont un supplément : leur absence n'empêche jamais la
  // navigation de s'afficher, et un échec de lecture reste silencieux.
  const [counters, setCounters] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    apiJson("/api/nav-counters")
      .then(d => { if (alive && d.success) setCounters(d.data || {}); })
      .catch(() => { /* la navigation se passe très bien de ses pastilles */ });
    return () => { alive = false; };
  }, [pathname]);

  // ── Groupes repliables ──────────────────────────────────────────────────
  // On montre les modules (en-têtes de groupe) ; le clic déploie leurs entrées.
  // Le groupe de la page courante est toujours ouvert. Les autres retiennent le
  // choix de l'utilisateur d'une visite à l'autre.
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // Seul le lien le plus précis est actif : sur /isic/registre, « Registre ISIC »
  // et non aussi « Cartes ISIC » (/isic).
  const activeHref = nav.flatMap(g => g.items.map(i => i.href)).filter(matches).sort((a, b) => b.length - a.length)[0];
  const isActiveItem = (href: string) => href === activeHref;
  const activeSection = nav.find(g => g.items.some(i => isActiveItem(i.href)))?.section;

  const savedRaw = useSyncExternalStore(noSubscribe, savedOpenGroups, () => "[]");
  const savedGroups = useMemo(() => {
    try {
      const saved = JSON.parse(savedRaw);
      if (Array.isArray(saved)) return new Set<string>(saved);
    } catch { /* valeur illisible : on part replié, ce n'est pas grave */ }
    return new Set<string>();
  }, [savedRaw]);
  // Choix faits pendant la visite ; avant le premier clic, la valeur gardée.
  const [toggledGroups, setOpenGroups] = useState<Set<string> | null>(null);
  const openGroups = toggledGroups ?? savedGroups;
  const toggleGroup = (section: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev ?? savedGroups);
      if (next.has(section)) next.delete(section); else next.add(section);
      try { localStorage.setItem("kanoo.nav.open", JSON.stringify([...next])); } catch { /* sans persistance */ }
      return next;
    });
  };
  // Un groupe est ouvert s'il porte la page courante, ou si l'utilisateur l'a ouvert.
  const isOpen = (section: string) => section === activeSection || openGroups.has(section);

  return (
    <>
    {mobileOpen && <div className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />}
    <aside aria-label="Menu principal" className={`w-[248px] bg-chrome text-chromefg border-r border-chromefg/10 flex-col h-full overflow-hidden flex-shrink-0 ${
      mobileOpen ? "flex fixed inset-y-0 left-0 z-50 shadow-xl" : "hidden"} lg:flex lg:static lg:z-auto lg:shadow-none`}>
      {/* Marque : logo (ou initiale sur pastille dégradée), nom, espace. */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-4">
        {tenant?.logo ? (
          <span className="w-[38px] h-[38px] rounded-xl bg-surface border border-chromefg/10 grid place-items-center overflow-hidden shrink-0">
            <img src={tenant.logo} alt="" className="max-w-full max-h-full object-contain" />
          </span>
        ) : (
          <span className="w-[38px] h-[38px] rounded-xl grad-brand grad-brand-glow grid place-items-center font-extrabold text-[17px] shrink-0" aria-hidden>
            {(tenant?.name || "K").trim()[0]?.toUpperCase()}
          </span>
        )}
        <span className="min-w-0">
          <span className="block font-bold text-[16px] tracking-tight leading-tight truncate">{tenant?.name || "Kanoo"}</span>
          <span className="block text-[11.5px] text-chromefg/55 truncate">{PROFILE_LABEL[profile]}{tenant?.name ? " · propulsé par Kanoo" : ""}</span>
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto pt-2 pb-4 px-4 custom-scrollbar">
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
                className="w-full flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-chromefg/45 hover:text-chromefg/75 px-3 py-2 rounded-lg transition-colors">
                <span className="flex-1 text-left">{group.section}</span>
                {!open && groupCount > 0 && (
                  <span className="num text-[10px] font-bold rounded-full px-1.5 min-w-[18px] h-[18px] grid place-items-center bg-neg-50 text-neg normal-case tracking-normal">{groupCount}</span>
                )}
                <ChevronDown size={13} className={`shrink-0 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
              </button>
              {open && <div className="mt-1 mb-3">
              {group.items.map((item) => {
                const active = isActiveItem(item.href);
                return (
                  <Link key={item.href} href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-3 h-[42px] px-3.5 rounded-[13px] text-[14px] transition-all duration-200 mb-[3px] ${
                      active
                      ? "grad-brand grad-brand-glow font-semibold"
                      : "text-chromefg/75 font-medium hover:bg-chromefg/[0.06] hover:text-chromefg"
                    }`}
                  >
                    <span className={`flex items-center justify-center ${active ? "text-chromeactivefg" : "text-chromefg/55"}`}>
                      {item.icon}
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {(counters[item.href] ?? item.badge) && (
                      // La pastille ouvre la liste filtrée sur ce qu'elle compte
                      // (factures en retard, articles sous le seuil…).
                      <span
                        title={BADGE_TARGET[item.href] ? BADGE_TARGET[item.href].title : undefined}
                        onClick={BADGE_TARGET[item.href] ? (e) => { e.preventDefault(); e.stopPropagation(); router.push(BADGE_TARGET[item.href].href); } : undefined}
                        className={`num text-[11px] font-bold rounded-full px-1.5 min-w-[22px] h-[22px] grid place-items-center ${BADGE_TARGET[item.href] ? "cursor-pointer hover:ring-1 hover:ring-chromefg/40" : ""} ${
                        active ? "bg-white/25 text-chromeactivefg" : item.href === "/invoices" || item.href === "/relances" ? "bg-neg-50 text-neg" : "bg-accent-50 text-accent"
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

      {/* Aide, puis l'utilisateur connecté et la déconnexion. */}
      <div className="px-4 pb-4">
        <div className="hidden lg:flex [@media(max-height:860px)]:!hidden flex-col gap-1.5 rounded-[18px] p-4 bg-gradient-to-br from-accent-50 to-[rgb(228_228_255)] dark:to-accent-100 text-ink">
          <Sparkles size={20} className="text-accent opacity-80" aria-hidden />
          <p className="text-sm font-bold">Besoin d&apos;aide ?</p>
          <p className="text-[12.5px] leading-snug text-ink2">Guides, assistance et questions à l&apos;équipe Kanoo.</p>
          <Link href="/support" className="mt-1.5 self-start h-[34px] px-3.5 rounded-full border border-accent/40 bg-surface grid place-items-center text-[12.5px] font-semibold text-accent hover:bg-accent-50">Centre d&apos;aide →</Link>
        </div>
        <div className="flex items-center gap-2.5 mt-3 pt-3.5 border-t border-chromefg/10 px-1">
          <Link href={profile === "association" ? "/associations/profil" : "/profile"} className="flex items-center gap-2.5 min-w-0 flex-1 rounded-xl hover:bg-chromefg/[0.06] p-1 -m-1">
            <span className="w-[38px] h-[38px] rounded-full grid place-items-center text-[13px] font-bold text-white shrink-0 bg-gradient-to-br from-[rgb(234_153_82)] to-[rgb(225_75_57)]" aria-hidden>
              {(user?.firstName?.[0] ?? "").toUpperCase()}{(user?.lastName?.[0] ?? "").toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-semibold truncate">{user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : "…"}</span>
              <span className="block text-xs text-chromefg/55 truncate capitalize">{user?.role?.replace(/_/g, " ") ?? ""}</span>
            </span>
          </Link>
          <button type="button" aria-label="Déconnexion" title="Déconnexion"
            onClick={async () => {
              // Écritures faites hors ligne pas encore envoyées : elles seraient abandonnées.
              const pending = await getPendingCount().catch(() => 0);
              if (pending > 0 && !(await confirmDialog({
                title: `${pending} action(s) hors ligne pas encore envoyée(s)`,
                message: "Si vous vous déconnectez maintenant, elles seront abandonnées. Reconnectez-vous au réseau pour les envoyer d'abord.",
                confirmLabel: "Me déconnecter quand même", danger: true,
              }))) return;
              await apiSend("POST", "/api/auth/logout");
              // Téléphone partagé : données gardées hors ligne et file effacées.
              await purgeOfflineData("all");
              // Rechargement complet voulu après déconnexion : purge tout l'état client (caches, profil).
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign("/login");
            }}
            className="w-8 h-8 rounded-[9px] grid place-items-center text-chromefg/55 hover:bg-neg/10 hover:text-neg transition-colors shrink-0">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}