"use client";
/** Filtre « client » posé par un raccourci de la fiche client ; un clic le retire. */
export function ClientFilterChip({ name, onClear }: { name?: string; onClear: () => void }) {
  return (
    <button type="button" aria-pressed className="fchip"
      onClick={() => { onClear(); window.history.replaceState(null, "", window.location.pathname); }}>
      Client : {name || "sélectionné"} ✕
    </button>
  );
}
