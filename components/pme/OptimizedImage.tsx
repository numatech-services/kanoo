"use client";

import { useState } from "react";
import Image from "next/image";

interface OptimizedImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  rounded?: boolean;
  fallback?: string;
  objectFit?: "cover" | "contain" | "fill";
}

/**
 * Composant image optimisé pour Kanoo
 * - Lazy loading automatique (priority=false par défaut)
 * - Skeleton pendant le chargement
 * - Fallback si l'image échoue (logo texte)
 * - Format WebP automatique via next/image
 */
export function OptimizedImage({
  src,
  alt,
  width = 400,
  height = 300,
  className = "",
  priority = false,
  rounded = false,
  fallback,
  objectFit = "cover",
}: OptimizedImageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const borderRadius = rounded ? "50%" : undefined;

  if (error || !src) {
    return (
      <div
        className={className}
        style={{
          width, height, borderRadius,
          background: "var(--color-background-secondary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "0.5px solid var(--color-border-tertiary)",
          fontSize: Math.min(width, height) * 0.3,
          color: "var(--color-text-secondary)",
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {fallback || alt.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width, height, flexShrink: 0 }}>
      {loading && (
        <div
          style={{
            position: "absolute", inset: 0, borderRadius,
            background: "var(--color-background-secondary)",
            animation: "pulse 1.5s ease-in-out infinite",
          }}
          className="animate-pulse"
        />
      )}
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        loading={priority ? "eager" : "lazy"}
        className={className}
        style={{
          objectFit,
          borderRadius,
          opacity: loading ? 0 : 1,
          transition: "opacity 0.2s ease",
        }}
        onLoad={() => setLoading(false)}
        onError={() => { setLoading(false); setError(true); }}
      />
    </div>
  );
}

/**
 * Logo tenant avec fallback initiales — utilisé dans la TopBar et les PDFs
 */
export function TenantLogo({ src, name, size = 32 }: { src?: string; name: string; size?: number }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map(w => w[0])
    .join("")
    .toUpperCase();

  if (!src) {
    return (
      <div style={{
        width: size, height: size, borderRadius: 8,
        background: "#2F3E46", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.35, fontWeight: 500, flexShrink: 0,
      }}>
        {initials}
      </div>
    );
  }

  return (
    <OptimizedImage
      src={src}
      alt={name}
      width={size}
      height={size}
      priority
      objectFit="contain"
      fallback={initials}
      rounded={false}
    />
  );
}
