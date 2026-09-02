import Link from "next/link";

const SETTINGS_ITEMS = [
  { href:"/settings/numerotation", icon:"🔢", title:"Numérotation des documents", desc:"Personnalisez les préfixes FAC-, DEV-, BC-… pour chaque type de document. Migration depuis un logiciel existant." },
  { href:"/companies", icon:"🏢", title:"Mon organisation", desc:"NIF, RCCM, adresse, logo, couleurs de la plateforme." },
  { href:"/users", icon:"👥", title:"Utilisateurs & Rôles", desc:"Gérez les accès, invitez de nouveaux utilisateurs, modifiez les rôles." },
  { href:"/subscription", icon:"💎", title:"Abonnement", desc:"Plan actuel, dates de renouvellement, changement de plan." },
  { href:"/company/branding", icon:"🎨", title:"Apparence", desc:"Couleurs, logo, personnalisation de l'interface." },
  { href:"/support", icon:"🎫", title:"Support", desc:"Ouvrez un ticket ou consultez l'historique de vos demandes." },
  { href:"/audit", icon:"🔍", title:"Journal d'audit", desc:"Toutes les actions effectuées dans votre espace, tracées et horodatées." },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Paramètres</h1>
        <p className="text-sm text-moss mt-1">Configuration de votre espace Kanoo</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {SETTINGS_ITEMS.map(item => (
          <Link key={item.href} href={item.href}
            className="bg-white rounded-xl border border-clay/20 p-5 hover:border-cedar/40 hover:shadow-sm transition-all group flex gap-4">
            <span className="text-2xl mt-0.5 flex-shrink-0">{item.icon}</span>
            <div>
              <p className="font-semibold text-ink text-sm group-hover:text-cedar transition-colors">{item.title}</p>
              <p className="text-xs text-moss mt-1 leading-relaxed">{item.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
