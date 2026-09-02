"use client";
import { useState, useRef, useEffect } from "react";

interface LazyImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  placeholder?: "skeleton" | "blur" | "none";
  fallback?: string;
  style?: React.CSSProperties;
}

export function LazyImage({
  src, alt, width, height, className = "", priority = false,
  placeholder = "skeleton", fallback = "/icons/icon-96.png", style,
}: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [inView, setInView] = useState(priority);
  const ref = useRef<HTMLDivElement>(null);

  // Intersection Observer pour le lazy loading réel
  useEffect(() => {
    if (priority || inView) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { rootMargin: "200px" } // Précharger 200px avant l'entrée dans le viewport
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [priority, inView]);

  const aspectRatio = width && height ? height / width : undefined;
  const containerStyle: React.CSSProperties = {
    position: "relative",
    overflow: "hidden",
    width: width ? `${width}px` : "100%",
    paddingBottom: aspectRatio ? `${aspectRatio * 100}%` : undefined,
    ...style,
  };

  return (
    <div ref={ref} style={containerStyle} className={className}>
      {/* Skeleton pendant le chargement */}
      {placeholder === "skeleton" && !loaded && (
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(90deg, #f0ede6 25%, #e8e4db 50%, #f0ede6 75%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
        }} />
      )}

      {/* Image réelle — chargée seulement quand dans le viewport.
          Ce composant EST la stratégie de chargement différé du projet, bâtie
          sur IntersectionObserver : passer par next/image reviendrait à
          empiler deux mécanismes concurrents. */}
      {inView && !error && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          style={{
            position: aspectRatio ? "absolute" : "relative",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: loaded ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
        />
      )}

      {/* Repli si erreur : l'image `fallback` était acceptée en propriété puis
          jamais rendue — seul le texte alternatif apparaissait. */}
      {error && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: "4px",
          background: "var(--color-background-secondary)",
          color: "var(--color-text-secondary)", fontSize: "12px",
        }}>
          {fallback && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fallback} alt="" aria-hidden width={32} height={32}
              style={{ opacity: 0.5 }} />
          )}
          <span>{alt || "Image"}</span>
        </div>
      )}

      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );
}

/**
 * Avatar avec initiales et fallback image
 */
export function Avatar({
  src, name, size = 36, className = "",
}: { src?: string; name: string; size?: number; className?: string }) {
  const [imgError, setImgError] = useState(false);
  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  if (!src || imgError) {
    return (
      <div
        className={className}
        style={{
          width: size, height: size, borderRadius: "50%",
          background: "#2F3E46", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: Math.max(10, size * 0.35), fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {initials}
      </div>
    );
  }

  return (
    // Avatar : source arbitraire (téléversement du tenant), sans hôte déclaré
    // dans remotePatterns — next/image la refuserait.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src} alt={name}
      className={className}
      width={size} height={size}
      loading="lazy"
      onError={() => setImgError(true)}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
    />
  );
}
