"use client";

import { useRef, useState, useEffect } from "react";

interface SignatureCanvasProps {
  onSave: (signatureDataUrl: string) => void;
  onCancel: () => void;
  label?: string;
  signerName?: string;
  onSignerNameChange?: (name: string) => void;
}

export function SignatureCanvas({
  onSave, onCancel, label = "Signer", signerName = "", onSignerNameChange,
}: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mode, setMode] = useState<"draw" | "upload">("draw");
  const [isEmpty, setIsEmpty] = useState(true);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Fond blanc
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [mode]);

  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    setIsDrawing(true);
    setIsEmpty(false);
    const pos = getPos(e, canvas);
    setLastPos(pos);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.x, lastPos.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setLastPos(pos);
  }

  function stopDraw() {
    setIsDrawing(false);
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Ajuster pour conserver les proportions
        const ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
        const x = (canvas.width - img.width * ratio) / 2;
        const y = (canvas.height - img.height * ratio) / 2;
        ctx.drawImage(img, x, y, img.width * ratio, img.height * ratio);
        setIsEmpty(false);
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas || isEmpty) return;
    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl);
  }

  const inp = "w-full px-3 py-2 border border-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-section/30";

  return (
    <div className="space-y-4">
      {/* Nom du signataire */}
      {onSignerNameChange && (
        <div>
          <label className="block text-xs font-medium text-ink2 mb-1">Nom du signataire *</label>
          <input className={inp} value={signerName} onChange={e => onSignerNameChange(e.target.value)} placeholder="Nom et prénom" required/>
        </div>
      )}

      {/* Onglets mode */}
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode("draw")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode==="draw" ? "bg-section text-white" : "border border-line text-ink2 hover:bg-surface2"}`}>
          ✍️ Dessiner
        </button>
        <button type="button" onClick={() => setMode("upload")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode==="upload" ? "bg-section text-white" : "border border-line text-ink2 hover:bg-surface2"}`}>
          📁 Importer une image
        </button>
      </div>

      {/* Zone de signature */}
      <div className="border-2 border-line rounded-xl overflow-hidden bg-surface">
        <div className="h-6 bg-surface2/50 border-b border-line flex items-center px-3">
          <span className="text-xs text-ink2">{label}</span>
        </div>
        <canvas
          ref={canvasRef}
          width={500}
          height={150}
          className="w-full touch-none cursor-crosshair"
          style={{ display: "block" }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />
        {isEmpty && mode === "draw" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-ink2 text-sm">Signez ici…</p>
          </div>
        )}
      </div>

      {mode === "upload" && (
        <div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleUpload} className="hidden"/>
          <button type="button" onClick={() => fileRef.current?.click()}
            className="w-full py-3 border-2 border-dashed border-line rounded-xl text-sm text-ink2 hover:border-section/40 hover:text-section transition-colors">
            📎 Cliquer pour importer une signature (PNG, JPG, SVG)
          </button>
        </div>
      )}

      {/* Date automatique */}
      <p className="text-xs text-ink2">
        Date : <strong>{new Date().toLocaleDateString("fr-FR")}</strong> à <strong>{new Date().toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" })}</strong>
      </p>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={clearCanvas} className="px-4 py-2 border border-line rounded-xl text-sm text-ink2 hover:bg-surface2">
          🗑 Effacer
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 border border-line rounded-xl text-sm text-ink2 hover:bg-surface2">
          Annuler
        </button>
        <button type="button" onClick={handleSave} disabled={isEmpty || (!!onSignerNameChange && !signerName.trim())}
          className="flex-1 py-2 bg-section text-white rounded-xl text-sm font-medium hover:brightness-95 disabled:opacity-60 transition-colors">
          ✅ {label}
        </button>
      </div>
    </div>
  );
}
