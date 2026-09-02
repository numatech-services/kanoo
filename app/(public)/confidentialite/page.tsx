export const metadata = {
  title: "Politique de confidentialité | Kanoo",
  description: "Comment Kanoo (Numatech Services) collecte, utilise et protège vos données personnelles — conformément au RGPD et à la loi n°2017-28 du Niger.",
};

const SECTIONS: { h: string; body: string[] }[] = [
  { h: "1. Responsable du traitement", body: [
    "Kanoo est édité par Numatech Services SARL, dont le siège est à Niamey, Niger. Pour toute question relative à vos données : contact@kanoo.ne.",
  ] },
  { h: "2. Données que nous collectons", body: [
    "Données de compte : nom, prénom, adresse email, numéro de téléphone, rôle et organisation de rattachement.",
    "Données d'usage : journaux de connexion, actions sensibles (audit), adresse IP.",
    "Données saisies dans la plateforme par votre organisation (clients, factures, membres, participants, etc.), dont votre organisation reste responsable.",
  ] },
  { h: "3. Finalités et base légale", body: [
    "Fournir le service (exécution du contrat), sécuriser les comptes (intérêt légitime), vous adresser des communications selon vos consentements (consentement), respecter nos obligations légales et comptables (obligation légale).",
  ] },
  { h: "4. Consentements", body: [
    "Les communications par email, WhatsApp et SMS reposent sur votre consentement, recueilli séparément par canal et horodaté. Vous pouvez le retirer à tout moment depuis Paramètres → Confidentialité.",
  ] },
  { h: "5. Durées de conservation", body: [
    "Les données de compte sont conservées le temps de la relation contractuelle, puis archivées selon les obligations légales (notamment comptables). Les journaux de sécurité sont conservés pour une durée limitée à des fins de preuve.",
  ] },
  { h: "6. Destinataires et sous-traitants", body: [
    "Vos données ne sont jamais vendues. Elles peuvent être traitées par des sous-traitants strictement nécessaires au service : hébergement, envoi d'emails, envoi WhatsApp/SMS et prestataire de paiement (mobile money / carte). Chacun est encadré contractuellement.",
  ] },
  { h: "7. Vos droits", body: [
    "Vous disposez des droits d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité. Depuis Paramètres → Confidentialité, vous pouvez exporter vos données et demander la suppression de votre compte.",
    "Au Niger, la loi n°2017-28 relative à la protection des données à caractère personnel et l'APDP encadrent ces traitements ; pour les personnes concernées dans l'Union européenne, le RGPD s'applique.",
  ] },
  { h: "8. Cookies", body: [
    "Nous utilisons des cookies nécessaires au fonctionnement, et — avec votre accord — des cookies de mesure d'audience et de marketing. Vous gérez vos choix via le bandeau de consentement.",
  ] },
  { h: "9. Sécurité", body: [
    "Nous mettons en œuvre des mesures techniques et organisationnelles : chiffrement en transit (HTTPS), authentification à deux facteurs, contrôle d'accès par rôle, journalisation des actions sensibles.",
  ] },
];

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-5 sm:px-6 py-16">
      <span className="text-xs font-bold uppercase tracking-wider text-accent-700 bg-accent-50 px-3 py-1.5 rounded-full">Confidentialité</span>
      <h1 className="font-display font-semibold text-ink text-[clamp(2rem,5vw,3rem)] tracking-tight mt-5">Politique de confidentialité</h1>
      <p className="text-ink2 mt-3">Dernière mise à jour : 2026. Ce document décrit comment nous traitons vos données personnelles.</p>

      <div className="mt-10 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="font-display font-semibold text-ink text-xl">{s.h}</h2>
            <div className="mt-2 space-y-2">
              {s.body.map((p, i) => <p key={i} className="text-ink2 leading-relaxed">{p}</p>)}
            </div>
          </section>
        ))}
      </div>

      <p className="text-xs text-ink3 mt-12 border-t border-line pt-6">
        Modèle à adapter par votre conseil juridique avant mise en production. Numatech Services — Niamey, Niger.
      </p>
    </div>
  );
}
