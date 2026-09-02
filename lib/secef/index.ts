import type { SecefDriver } from "./types";
import { portalDriver, ESECEF_PORTAL_URL } from "./portal";
import { emcfDriver } from "./emcf";

export * from "./types";
export { portalDriver, ESECEF_PORTAL_URL } from "./portal";
export { emcfDriver } from "./emcf";

const DRIVERS: SecefDriver[] = [emcfDriver, portalDriver];

/**
 * Pilote actif.
 *
 * `SECEF_DRIVER` permet de forcer un choix ; sinon on prend le premier pilote
 * configuré. L'ordre place l'e-MCF avant le portail : dès que l'agrément est
 * obtenu et les variables renseignées, la certification devient automatique
 * sans changer une ligne d'appelant.
 */
export function activeSecefDriver(): SecefDriver {
  const forced = process.env.SECEF_DRIVER;
  if (forced) {
    const driver = DRIVERS.find(d => d.name === forced);
    if (driver) return driver;
    console.warn(`[SECeF] Pilote « ${forced} » inconnu — repli sur le mode portail.`);
  }
  return DRIVERS.find(d => d.isConfigured()) ?? portalDriver;
}

/** État de la certification, pour l'écran de paramètres. */
export function secefStatus() {
  const active = activeSecefDriver();
  return {
    activeDriver: active.name,
    activeLabel: active.label,
    automatic: active.automatic,
    portalUrl: ESECEF_PORTAL_URL,
    drivers: DRIVERS.map(d => ({
      name: d.name,
      label: d.label,
      automatic: d.automatic,
      configured: d.isConfigured(),
    })),
  };
}

/**
 * L'organisation est-elle en règle pour émettre ?
 *
 * Kanoo ne peut pas vérifier un agrément auprès de la DGI : il constate
 * seulement ce qui est renseigné. La réponse dit donc ce qui manque, sans
 * jamais affirmer que tout est conforme.
 */
export function readinessChecklist(identity: { nif?: string; isf?: string; mcfId?: string }) {
  return [
    {
      key: "nif",
      label: "NIF de l'organisation",
      done: Boolean(identity.nif),
      hint: "Obligatoire sur toute facture certifiée.",
    },
    {
      key: "isf",
      label: "Identifiant ISF du logiciel de facturation",
      done: Boolean(identity.isf),
      hint: "Délivré par la DGI avec le certificat de conformité du SFE.",
    },
    {
      key: "mcf",
      label: "Module de contrôle rattaché",
      done: Boolean(identity.mcfId),
      hint: "Boîtier MCF, unité de facturation, ou compte e-MCF.",
    },
    {
      key: "driver",
      label: "Certification automatique",
      done: activeSecefDriver().automatic && activeSecefDriver().isConfigured(),
      hint: "Sans agrément, le mode portail reste disponible : émission sur e-SECeF puis report des codes.",
    },
  ];
}
