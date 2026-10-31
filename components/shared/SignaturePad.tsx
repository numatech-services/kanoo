"use client";
import { useEffect, useRef } from "react";

type Pt = { x: number; y: number };

/**
 * Cadre de signature au doigt ou à la souris. À l'écran, le trait suit le
 * thème (clair ou sombre) ; l'image rendue (PNG en data-URI, fond
 * transparent) est toujours tracée en encre foncée, lisible à l'impression.
 * Rendue à chaque trait terminé, vide après « Effacer ».
 */
export function SignaturePad({ onChange, height = 160 }: { onChange: (png: string) => void; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pt[][]>([]);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio; c.height = height * ratio;
    const ctx = c.getContext("2d")!; ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(c).color;
  }, [height]);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>): Pt => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true;
    const p = pos(e); strokes.current.push([p]);
    const ctx = e.currentTarget.getContext("2d")!; ctx.beginPath(); ctx.moveTo(p.x, p.y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const p = pos(e); strokes.current[strokes.current.length - 1].push(p);
    const ctx = e.currentTarget.getContext("2d")!; ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function exportPng() {
    const c = ref.current; if (!c) return "";
    const out = document.createElement("canvas"); out.width = c.offsetWidth; out.height = height;
    const ctx = out.getContext("2d")!; ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
    for (const s of strokes.current) { if (s.length < 2) continue; ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); for (const p of s.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke(); }
    return out.toDataURL("image/png");
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    if (strokes.current.some(s => s.length > 1)) onChange(exportPng());
  }
  function clear() { const c = ref.current; if (!c) return; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); strokes.current = []; onChange(""); }
  return (
    <div className="space-y-1">
      <canvas ref={ref} style={{ height, touchAction: "none" }} className="w-full rounded-lg border border-line bg-surface text-ink cursor-crosshair"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Cadre de signature" />
      <button type="button" onClick={clear} className="text-xs text-ink3 underline">Effacer la signature</button>
    </div>
  );
}
