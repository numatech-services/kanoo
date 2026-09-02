"use client";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /**
   * Action en cours. Sans cela, rien n'empêchait un second clic de relancer
   * l'opération — une conversion de devis pouvait produire deux factures.
   */
  busy?: boolean;
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, message, confirmLabel = "Confirmer", cancelLabel = "Annuler",
  danger = false, busy = false, busyLabel = "En cours…", onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={busy ? undefined : onCancel} />
      <div className="relative bg-surface rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        <p className="text-sm text-moss mt-2">{message}</p>
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} disabled={busy}
            className="flex-1 py-2 border border-clay/30 rounded-xl text-sm text-moss hover:bg-sand transition-colors disabled:opacity-50">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 py-2 rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-60 ${
              danger ? "bg-neg hover:brightness-95" : "bg-cedar hover:bg-ink"
            }`}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
