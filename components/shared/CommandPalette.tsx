"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { SECTIONS, sectionForPath, type SectionKey } from "@/lib/sections";
import { useMe, meCan } from "@/lib/useMe";
import { resourceForHref } from "@/lib/nav-resources";

interface Command {
  label: string;
  href: string;
  section: SectionKey;
  /** Mots-clés supplémentaires : « avoir » doit trouver Factures. */
  keywords?: string;
}

/**
 * Toutes les destinations, à plat. La table est écrite ici plutôt que dérivée
 * de la barre latérale : la palette doit aussi mener à des écrans profonds que
 * la navigation ne montre pas, et à des synonymes que l'utilisateur tape.
 */
const COMMANDS: Command[] = [
  { label: "Tableau de bord", href: "/dashboard", section: "accueil" },
  { label: "Notifications", href: "/notifications", section: "accueil" },
  { label: "Messages", href: "/messages", section: "accueil" },
  { label: "Activités", href: "/activites", section: "accueil", keywords: "événement billetterie" },

  { label: "Clients", href: "/clients", section: "ventes" },
  { label: "Nouveau client", href: "/clients", section: "ventes", keywords: "créer ajouter" },
  { label: "Devis", href: "/devis", section: "ventes" },
  { label: "Nouveau devis", href: "/devis/new", section: "ventes", keywords: "créer proforma" },
  { label: "Factures", href: "/invoices", section: "ventes", keywords: "avoir facturation" },
  { label: "Nouvelle facture", href: "/invoices/new", section: "ventes", keywords: "créer facturer" },
  { label: "Factures impayées", href: "/invoices?overdue=true", section: "ventes", keywords: "retard relance échue" },
  { label: "Relances", href: "/relances", section: "ventes", keywords: "recouvrement impayés mise en demeure barème dso" },
  { label: "Courriers", href: "/courriers", section: "accueil", keywords: "lettre correspondance rapport attestation" },
  { label: "Marchés-cadres", href: "/marches-cadres", section: "achats", keywords: "livraison lot tranche reliquat isic marché cadre" },
  { label: "Notes de frais", href: "/notes-de-frais", section: "finance", keywords: "frais remboursement justificatif reçu mission déplacement" },
  { label: "Documents administratifs", href: "/documents-administratifs", section: "contrats", keywords: "rccm nif attestation patente agrément assurance bail échéance renouvellement expiration" },
  { label: "Inventaires physiques", href: "/inventaires", section: "achats", keywords: "comptage stock écart régularisation aveugle" },
  { label: "Budget prévisionnel", href: "/budget-previsionnel", section: "finance", keywords: "prévision écart prorata projection exercice" },
  { label: "Nouvelle note de frais", href: "/notes-de-frais/new", section: "finance", keywords: "créer saisir dépense" },
  { label: "Bons de livraison", href: "/livraisons", section: "ventes", keywords: "BL expédition" },
  { label: "Paiements", href: "/payments", section: "ventes", keywords: "encaissement règlement" },
  { label: "CRM", href: "/crm", section: "ventes", keywords: "pipeline opportunité prospect" },

  { label: "Fournisseurs", href: "/suppliers", section: "achats" },
  { label: "Commandes", href: "/commandes", section: "achats", keywords: "bon de commande achat" },
  { label: "Stock", href: "/stock", section: "achats", keywords: "inventaire article" },
  { label: "Marchés publics", href: "/marches", section: "achats", keywords: "appel d'offres CMP" },

  { label: "Portefeuille d'abonnements", href: "/abonnements", section: "abonnements", keywords: "revente marge licence" },
  { label: "Contrats souscrits", href: "/abonnements/achats", section: "abonnements", keywords: "éditeur compilatio" },
  { label: "Reventes d'abonnements", href: "/abonnements/reventes", section: "abonnements", keywords: "client final licence" },

  { label: "Contrats", href: "/contracts", section: "contrats" },
  { label: "Projets", href: "/projects", section: "contrats" },
  { label: "Documents", href: "/documents", section: "contrats" },
  { label: "Approbations", href: "/approbations", section: "contrats", keywords: "validation circuit" },

  { label: "Trésorerie", href: "/treasury", section: "finance", keywords: "banque caisse solde" },
  { label: "Comptabilité", href: "/accounting", section: "finance", keywords: "écriture journal OHADA" },
  { label: "Lettrage", href: "/accounting/lettrage", section: "finance", keywords: "rapprochement" },
  { label: "Dépenses récurrentes", href: "/recurring-expenses", section: "finance", keywords: "abonnement charge fixe" },
  { label: "Fiscalité", href: "/fiscalite", section: "finance", keywords: "TVA impôt DGI" },
  { label: "TVA", href: "/fiscalite/tva", section: "finance", keywords: "déclaration mensuelle" },
  { label: "IS / BIC", href: "/fiscalite/isbic", section: "finance", keywords: "impôt société annuel" },
  { label: "Retenues à la source", href: "/fiscalite/retenues", section: "finance" },
  { label: "Immobilisations", href: "/fixed-assets", section: "finance", keywords: "amortissement" },
  { label: "Analytique", href: "/analytics", section: "finance", keywords: "rapport graphique" },
  { label: "Rentabilité par secteur", href: "/analytique", section: "finance", keywords: "analytique secteur activité marge résultat" },
  { label: "Comptoir (The Spot)", href: "/comptoir", section: "finance", keywords: "the spot caisse stock matière arrêté bar vente" },
  { label: "Cartes ISIC", href: "/isic", section: "ventes", keywords: "carte étudiant lot impression" },
  { label: "Registre ISIC", href: "/isic/registre", section: "ventes", keywords: "étudiant numéro licence renouvellement isic registre" },
  { label: "Appels à candidatures", href: "/appels", section: "contrats", keywords: "appel d'offres candidature soumission" },

  { label: "Collaborateurs", href: "/employees", section: "rh", keywords: "employé salarié personnel" },
  { label: "Bulletins de paie", href: "/payslips", section: "rh", keywords: "salaire CNSS IR" },

  { label: "Utilisateurs", href: "/users", section: "parametres", keywords: "compte rôle droit" },
  { label: "Sécurité et 2FA", href: "/settings/securite", section: "parametres", keywords: "mot de passe authentification" },
  { label: "Facture certifiée SECeF", href: "/settings/facture-certifiee", section: "parametres", keywords: "DGI MCF QR code impôts" },
  { label: "Numérotation", href: "/settings/numbering", section: "parametres", keywords: "préfixe séquence" },
  { label: "Confidentialité", href: "/settings/confidentialite", section: "parametres", keywords: "RGPD données" },
  { label: "Abonnement Kanoo", href: "/subscription", section: "parametres", keywords: "facturation plan" },
  { label: "Journal d'audit", href: "/audit", section: "parametres", keywords: "traçabilité historique" },
  { label: "Support", href: "/support", section: "parametres", keywords: "aide ticket" },
];

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
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Même règle que la barre latérale : on ne propose pas un écran que le rôle
  // ne peut pas ouvrir. Tant que les droits ne sont pas chargés, on montre tout.
  const { resources, loading } = useMe();
  const visible = useMemo(() => COMMANDS.filter(cmd => {
    const res = resourceForHref(cmd.href);
    return !res || loading || resources.length === 0 || meCan(resources, res);
  }), [resources, loading]);

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
      .map(x => x.cmd);
  }, [query, visible]);

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

  useEffect(() => { setActive(0); }, [query]);

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
            placeholder="Aller à…  facture, TVA, abonnement, paie"
            aria-label="Rechercher une page"
            className="flex-1 h-12 bg-transparent outline-none text-sm text-ink placeholder:text-ink3"
          />
          <kbd className="text-[10px] font-mono text-ink3 border border-line rounded px-1.5 py-0.5 shrink-0">esc</kbd>
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink3">
            Aucune page ne correspond à « {query} ».
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
                  <span className="text-[11px] text-ink3 shrink-0">{SECTIONS[cmd.section].label}</span>
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
