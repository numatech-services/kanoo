"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { SECTIONS, sectionForPath, type SectionKey } from "@/lib/sections";
import { moduleEnabled } from "@/lib/modules";
import { useMe, meCan } from "@/lib/useMe";
import { resourceForHref } from "@/lib/nav-resources";
import { NAV_MAP, type ProfileType } from "@/components/layout/Sidebar";

interface Command {
  label: string;
  href: string;
  section: SectionKey;
  /** Libellé de groupe affiché (espaces association / administration, résultats de recherche). */
  group?: string;
  /** Mots-clés supplémentaires : « avoir » doit trouver Factures. */
  keywords?: string;
}

/**
 * Les écrans viennent du menu (NAV_MAP) : une seule liste, si bien qu'un écran
 * ajouté au menu est aussitôt trouvable, sous le même nom. S'y ajoutent des
 * synonymes que l'utilisateur tape (« avoir » doit trouver Factures) et des
 * raccourcis vers des écrans profonds que le menu ne montre pas.
 */
const KEYWORDS: Record<string, string> = {
  "/dashboard": "accueil synthèse indicateurs",
  "/rapports": "état export synthèse rapport",
  "/agenda": "calendrier rendez-vous échéance",
  "/clients": "client prospect université",
  "/crm": "pipeline opportunité prospect",
  "/devis": "proforma offre",
  "/contracts": "marché contrat client exécution acompte échéancier marge",
  "/marches-cadres": "livraison lot tranche reliquat isic marché cadre",
  "/invoices": "avoir facturation",
  "/livraisons": "BL expédition",
  "/payments": "paiement encaissement règlement",
  "/relances": "recouvrement impayés mise en demeure barème dso",
  "/suppliers": "fournisseur",
  "/commandes": "bon de commande achat BC",
  "/depenses": "achat dépense facture fournisseur",
  "/depenses/echeancier": "échéancier balance âgée fournisseur à payer retard",
  "/recurring-expenses": "abonnement charge fixe loyer",
  "/stock": "inventaire article produit",
  "/stock/lots": "péremption lot date limite fefo",
  "/inventaires": "comptage stock écart régularisation aveugle",
  "/appels": "appel d'offres candidature soumission veille",
  "/projects": "projet tâche jalon ong",
  "/approbations": "validation circuit",
  "/treasury": "banque caisse solde",
  "/treasury/prevision": "prévision trésorerie projection",
  "/accounting": "écriture journal OHADA SYSCOHADA",
  "/accounting/etats": "bilan compte de résultat balance grand livre",
  "/fiscalite": "TVA impôt DGI",
  "/fiscalite/isbic": "impôt société annuel",
  "/budget-previsionnel": "prévision écart prorata projection exercice",
  "/fixed-assets": "amortissement immobilisation",
  "/marges": "marge produit coût cmup taux de marque rentabilité article",
  "/analytique": "analytique secteur activité marge résultat rentabilité",
  "/analytics": "analytique graphique tendance",
  "/employees": "employé salarié personnel",
  "/payslips": "salaire CNSS IR paie",
  "/conges": "congé absence",
  "/notes-de-frais": "frais remboursement justificatif reçu mission déplacement",
  "/documents": "ged fichier pièce jointe",
  "/courriers": "lettre correspondance rapport attestation",
  "/documents-administratifs": "rccm nif attestation patente agrément assurance bail échéance renouvellement expiration",
  "/comptoir": "the spot caisse stock matière arrêté bar vente",
  "/restauration": "restaurant restauration cantine marge nette objectif vue d'ensemble",
  "/restauration/fiches": "fiche technique recette portion rendement allergène grammage",
  "/restauration/production": "production cuisine menu prévision couverts bon de sortie restes fin de service",
  "/restauration/prix": "prix de vente prix d'achat marge minimum 20 % carte",
  "/restauration/achats": "achats fournisseur comparaison historique prix facture rapprochement",
  "/restauration/equipe": "personnel équipe paie cuisinier serveur restaurant affectation",
  "/restauration/pilotage": "pilotage point mort charges fixes variables simulation baisse budget réel amortissement équipement répartition clé",
  "/restauration/planning": "planning pointage horaires heures service présence absence repas du personnel",
  "/isic": "carte étudiant lot impression",
  "/isic/registre": "étudiant numéro licence renouvellement isic registre",
  "/abonnements": "revente marge licence abonnement",
  "/abonnements/achats": "éditeur compilatio abonnement",
  "/abonnements/reventes": "client final licence abonnement",
  "/activites": "événement billetterie activité",
  "/settings/modules": "activer désactiver option",
  "/settings/automatisations": "brief matin alerte découvert paie comptable relance cotisation amortissement automatique",
  "/users": "compte rôle droit",
  "/settings/securite": "mot de passe authentification",
  "/settings/facture-certifiee": "SECeF DGI MCF QR code impôts",
  "/settings/numbering": "préfixe séquence numérotation",
  "/settings/confidentialite": "RGPD données",
  "/subscription": "facturation plan abonnement",
  "/audit": "traçabilité historique",
  "/support": "aide ticket",
};

const SHORTCUTS: Command[] = [
  { label: "Nouveau client", href: "/clients?new=1", section: "ventes", group: "Raccourci", keywords: "créer ajouter" },
  { label: "Nouveau devis", href: "/devis/new", section: "ventes", group: "Raccourci", keywords: "créer proforma" },
  { label: "Nouvelle facture", href: "/invoices/new", section: "ventes", group: "Raccourci", keywords: "créer facturer" },
  { label: "Factures impayées", href: "/invoices?overdue=true", section: "ventes", group: "Raccourci", keywords: "retard relance échue" },
  { label: "Lettrage", href: "/accounting/lettrage", section: "finance", group: "Raccourci", keywords: "rapprochement" },
  { label: "Déclaration de TVA", href: "/fiscalite/tva", section: "finance", group: "Raccourci", keywords: "déclaration mensuelle" },
  { label: "Nouvelle note de frais", href: "/notes-de-frais/new", section: "rh", group: "Raccourci", keywords: "créer saisir dépense" },
  { label: "Paramètres", href: "/settings", section: "parametres", group: "Raccourci", keywords: "réglages configuration" },
];

function commandsFor(profile: ProfileType): Command[] {
  const fromNav = NAV_MAP[profile].flatMap(g => g.items.map(i => ({
    label: i.label, href: i.href, section: sectionForPath(i.href), group: g.section, keywords: KEYWORDS[i.href],
  })));
  return profile === "pme" ? [...fromNav, ...SHORTCUTS] : fromNav;
}

/** Retire accents et casse : « fiscalite » doit trouver « Fiscalité ». */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Palette de commandes (⌘K / Ctrl+K).
 *
 * Le seul geste qui change vraiment la vie d'un utilisateur quotidien : sur
 * 126 écrans, retrouver le bon dans une barre latérale à sept sections coûte
 * plus cher que taper trois lettres. C'est aussi ce qui rend le produit
 * utilisable au clavier de bout en bout.
 */
export function CommandPalette({ profile = "pme" }: { profile?: ProfileType }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Même règle que la barre latérale : on ne propose pas un écran que le rôle
  // ne peut pas ouvrir. Tant que les droits ne sont pas chargés, on montre tout.
  const { resources, loading, tenant } = useMe();
  // Chaque espace a ses écrans : une association ou une administration ne doit
  // pas se voir proposer le tableau de bord PME.
  const commands = useMemo<Command[]>(() => commandsFor(profile), [profile]);
  const visible = useMemo(() => commands.filter(cmd => {
    if (!moduleEnabled(cmd.href, tenant?.disabledModules)) return false;
    const res = resourceForHref(cmd.href);
    return !res || loading || resources.length === 0 || meCan(resources, res);
  }), [resources, loading, commands, tenant]);

  // Recherche de fiches (clients, factures) en plus des écrans : la barre du
  // haut annonce « Rechercher une facture, un client… ».
  const [found, setFound] = useState<Command[]>([]);
  // Requête trop courte : plus de fiches proposées (vidé pendant le rendu).
  const noSearch = profile !== "pme" || query.trim().length < 2;
  if (noSearch && found.length > 0) setFound([]);
  useEffect(() => {
    const q = query.trim();
    if (noSearch) return;
    const t = setTimeout(async () => {
      const get = (url: string) => fetch(url, { credentials: "include" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
      const [c, i, l] = await Promise.all([
        meCan(resources, "clients") ? get(`/api/clients?search=${encodeURIComponent(q)}&limit=4`) : null,
        meCan(resources, "invoices") ? get(`/api/invoices?search=${encodeURIComponent(q)}&limit=4`) : null,
        meCan(resources, "documents") ? get(`/api/courriers?q=${encodeURIComponent(q)}&limit=4`) : null,
      ]);
      setFound([
        ...((c?.data?.items ?? []) as Array<{ _id: string; name: string }>).map(x => ({ label: x.name, href: `/clients/${x._id}`, section: "ventes" as SectionKey, group: "Client" })),
        ...((i?.data?.items ?? []) as Array<{ _id: string; number: string }>).map(x => ({ label: `Facture ${x.number}`, href: `/invoices/${x._id}`, section: "ventes" as SectionKey, group: "Facture" })),
        ...((l?.data?.items ?? []) as Array<{ _id: string; reference?: string; subject: string }>).map(x => ({ label: `${x.reference ? `${x.reference} — ` : ""}${x.subject}`, href: `/courriers?q=${encodeURIComponent(x.reference || x.subject)}`, section: "accueil" as SectionKey, group: "Courrier" })),
      ]);
    }, 250);
    return () => clearTimeout(t);
  }, [query, noSearch, resources]);

  const results = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return visible.slice(0, 8);
    return visible
      .map(cmd => {
        const label = normalize(cmd.label);
        const keywords = normalize(cmd.keywords || "");
        // Un début de libellé prime sur une occurrence au milieu, qui prime
        // sur un mot-clé : taper « fac » doit proposer Factures en premier.
        if (label.startsWith(q)) return { cmd, score: 0 };
        if (label.includes(q)) return { cmd, score: 1 };
        if (keywords.includes(q)) return { cmd, score: 2 };
        return null;
      })
      .filter((x): x is { cmd: Command; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, 10)
      .map(x => x.cmd)
      .concat(found);
  }, [query, visible, found]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const go = useCallback((href: string) => {
    close();
    router.push(href);
  }, [close, router]);

  // Raccourci global. `metaKey` couvre macOS, `ctrlKey` Windows et Linux.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Nouvelle saisie : la sélection revient en tête (ajustée pendant le rendu).
  const [activeQuery, setActiveQuery] = useState(query);
  if (query !== activeQuery) {
    setActiveQuery(query);
    setActive(0);
  }

  // La ligne active suit les flèches, y compris hors du cadre visible.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4"
      role="dialog" aria-modal="true" aria-label="Rechercher une page">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm fade" onClick={close} />

      <div className="relative w-full max-w-lg surface-card shadow-soft overflow-hidden rise">
        <div className="flex items-center gap-3 px-4 border-b border-line">
          <Search size={16} className="text-ink3 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active].href); }
            }}
            placeholder={profile === "pme" ? "Aller à… ou chercher un client, une facture" : "Aller à…"}
            aria-label="Rechercher une page"
            className="flex-1 h-12 bg-transparent outline-none text-sm text-ink placeholder:text-ink3"
          />
          <kbd className="text-[10px] font-mono text-ink3 border border-line rounded px-1.5 py-0.5 shrink-0">esc</kbd>
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink3">
            Rien ne correspond à « {query} ».
          </p>
        ) : (
          <ul ref={listRef} className="max-h-80 overflow-y-auto py-1.5" role="listbox">
            {results.map((cmd, i) => (
              <li key={cmd.href + cmd.label} role="option" aria-selected={i === active}
                data-section={cmd.section}>
                <button
                  type="button"
                  onClick={() => go(cmd.href)}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                    i === active ? "bg-section-soft text-ink" : "text-ink2 hover:bg-surface2"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-section shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{cmd.label}</span>
                  <span className="text-[11px] text-ink3 shrink-0">{cmd.group ?? SECTIONS[cmd.section].label}</span>
                  {i === active && <CornerDownLeft size={13} className="text-ink3 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
