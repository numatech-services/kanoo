/**
 * Compression d'une photo d'identité dans le navigateur, avant envoi.
 *
 * Vos photos de doctorants pèsent de 6 Ko à 3,2 Mo (20 Mo pour 30 photos) :
 * envoyées telles quelles, elles dépasseraient les limites de l'hébergement.
 * On les ramène à 1200 px de grand côté en JPEG (≈ 100–400 Ko), ce qui reste
 * largement suffisant pour une photo de carte, en respectant l'orientation EXIF
 * des photos prises au téléphone.
 */
export async function compressPhoto(blob: Blob, maxSide = 1200): Promise<string> {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Compression impossible dans ce navigateur.");
  ctx.fillStyle = "#ffffff";           // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  let quality = 0.88;
  let data = canvas.toDataURL("image/jpeg", quality);
  while (data.length > 2_600_000 && quality > 0.5) {
    quality -= 0.1;
    data = canvas.toDataURL("image/jpeg", quality);
  }
  return data;
}

const IMAGE_RX = /\.(jpe?g|png)$/i;

/**
 * Photos à importer : fichiers image sélectionnés et/ou contenu d'archives
 * .zip (comme votre dossier « 2025-2026-DOCTORANT »). Les fichiers parasites
 * de macOS (__MACOSX, « ._ ») sont ignorés.
 */
export async function collectPhotos(files: File[]): Promise<Array<{ name: string; blob: Blob }>> {
  const out: Array<{ name: string; blob: Blob }> = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(f);
      for (const entry of Object.values(zip.files)) {
        const base = entry.name.split("/").pop() ?? "";
        if (entry.dir || !IMAGE_RX.test(base) || entry.name.includes("__MACOSX") || base.startsWith("._")) continue;
        const buf = await entry.async("arraybuffer");
        out.push({ name: base, blob: new Blob([buf], { type: /\.png$/i.test(base) ? "image/png" : "image/jpeg" }) });
      }
    } else if (IMAGE_RX.test(f.name) || f.type.startsWith("image/")) {
      out.push({ name: f.name, blob: f });
    }
  }
  return out;
}
