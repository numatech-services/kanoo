"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

/**
 * Confirmations et saisies courtes, en remplacement de `window.confirm`,
 * `window.prompt` et `window.alert`.
 *
 * Les fenêtres natives bloquent l'onglet, ignorent le thème, s'affichent en
 * anglais selon le navigateur (« OK / Cancel »), et un navigateur peut les
 * supprimer après plusieurs appels — une suppression partait alors sans
 * confirmation. Ici, l'appel reste une seule ligne :
 *
 *   if (!(await confirmDialog({ title: "Supprimer ce client ?", danger: true }))) return;
 *   const motif = await promptDialog({ title: "Motif du rejet", required: true });
 *   if (motif === null) return;            // annulé
 *
 * L'hôte (<DialogHost />) est monté une fois à la racine de l'application.
 */

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action destructrice : bouton rouge. */
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: React.ReactNode;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Refuse une réponse vide. */
  required?: boolean;
  /** Zone de texte sur plusieurs lignes (motif, commentaire). */
  multiline?: boolean;
  type?: "text" | "number" | "date" | "email";
}

export interface AlertOptions {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
}

type Request =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: "alert"; opts: AlertOptions; resolve: () => void };

let enqueue: ((r: Request) => void) | null = null;

const asOpts = <T extends { title: string }>(o: T | string): T => (typeof o === "string" ? { title: o } as T : o);

/** Demande une confirmation. Résout `true` si l'utilisateur confirme. */
export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const o = asOpts(opts);
  if (!enqueue) return Promise.resolve(typeof window !== "undefined" && window.confirm(o.title));
  return new Promise(resolve => enqueue!({ kind: "confirm", opts: o, resolve }));
}

/** Demande une valeur. Résout `null` si l'utilisateur annule. */
export function promptDialog(opts: PromptOptions | string): Promise<string | null> {
  const o = asOpts(opts);
  if (!enqueue) return Promise.resolve(typeof window !== "undefined" ? window.prompt(o.title, o.defaultValue) : null);
  return new Promise(resolve => enqueue!({ kind: "prompt", opts: o, resolve }));
}

/**
 * Message qui exige d'être lu (résultat d'une opération longue, consigne).
 * Pour une erreur ou un succès ordinaire, préférer `showToast`.
 */
export function alertDialog(opts: AlertOptions | string): Promise<void> {
  const o = asOpts(opts);
  if (!enqueue) { if (typeof window !== "undefined") window.alert(o.title); return Promise.resolve(); }
  return new Promise(resolve => enqueue!({ kind: "alert", opts: o, resolve }));
}

export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const current = queue[0];

  useEffect(() => {
    enqueue = r => setQueue(q => [...q, r]);
    return () => { enqueue = null; };
  }, []);

  useEffect(() => {
    if (current?.kind === "prompt") {
      setValue(current.opts.defaultValue ?? "");
      setTouched(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [current]);

  if (!current) return null;

  const finish = (result: boolean) => {
    if (current.kind === "confirm") current.resolve(result);
    else if (current.kind === "alert") current.resolve();
    else current.resolve(result ? value : null);
    setQueue(q => q.slice(1));
  };

  const invalid = current.kind === "prompt" && current.opts.required && !value.trim();
  const submit = () => {
    if (invalid) { setTouched(true); return; }
    finish(true);
  };

  const { opts } = current;
  const footer = current.kind === "alert" ? (
    <Button onClick={() => finish(true)} autoFocus>{opts.confirmLabel ?? "Compris"}</Button>
  ) : (
    <>
      <Button variant="secondary" onClick={() => finish(false)}>
        {(current.kind === "confirm" && current.opts.cancelLabel) || "Annuler"}
      </Button>
      <Button variant={current.kind === "confirm" && current.opts.danger ? "danger" : "primary"} onClick={submit}
        autoFocus={current.kind === "confirm"}>
        {opts.confirmLabel ?? (current.kind === "confirm" ? "Confirmer" : "Valider")}
      </Button>
    </>
  );

  return (
    <Modal open onClose={() => finish(false)} title={opts.title} size="sm" footer={footer}>
      {opts.message && <div className="text-sm text-ink2 whitespace-pre-line">{opts.message}</div>}
      {current.kind === "prompt" && (
        <form onSubmit={e => { e.preventDefault(); submit(); }} className={opts.message ? "mt-3" : ""}>
          {current.opts.label && <label className="label" htmlFor="dialog-prompt">{current.opts.label}</label>}
          {current.opts.multiline ? (
            <textarea id="dialog-prompt" ref={inputRef} rows={3} value={value} placeholder={current.opts.placeholder}
              onChange={e => setValue(e.target.value)} className="input h-auto py-2" />
          ) : (
            <input id="dialog-prompt" ref={inputRef} type={current.opts.type ?? "text"} value={value}
              placeholder={current.opts.placeholder} onChange={e => setValue(e.target.value)} className="input" />
          )}
          {touched && invalid && <p className="text-xs text-neg mt-1.5">Ce champ est obligatoire.</p>}
        </form>
      )}
      {!opts.message && current.kind !== "prompt" && <span className="sr-only">{opts.title}</span>}
    </Modal>
  );
}
