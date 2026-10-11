import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface PageHeaderProps {
  title: React.ReactNode;
  /** Une phrase qui dit à quoi sert l'écran, ou un compteur. */
  subtitle?: React.ReactNode;
  /** Lien de retour vers la liste parente. */
  back?: { href: string; label: string };
  /** Boutons à droite : l'action principale en dernier. */
  actions?: React.ReactNode;
  /** Pastille de statut à côté du titre (fiche facture, devis…). */
  badge?: React.ReactNode;
}

/**
 * En-tête commun des écrans : titre, sous-titre, retour, actions. Il remplace
 * les dizaines d'en-têtes écrits à la main, dont les titres allaient de
 * `text-xl` à `text-3xl` et dont les actions passaient sous le titre sur
 * certains écrans et à droite sur d'autres.
 */
export function PageHeader({ title, subtitle, back, actions, badge }: PageHeaderProps) {
  return (
    <header className="space-y-2">
      {back && (
        <Link href={back.href} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink3 hover:text-ink">
          <ArrowLeft size={13} /> {back.label}
        </Link>
      )}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="page-title">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="text-sm text-ink2 mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
