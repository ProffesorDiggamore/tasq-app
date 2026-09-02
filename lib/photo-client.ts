'use client';

/**
 * Client-side photo prep for the optional photo-proof feature. No libraries:
 * one <canvas>, two encodes. Memory is the top constraint, so every photo is
 * shrunk on the phone BEFORE it ever touches the network or the database:
 *  - full image: long edge capped at 1280px, JPEG quality 0.70
 *  - thumbnail:  long edge capped at 320px,  JPEG quality 0.70
 * A 1280px JPEG at q70 lands far under the 2MB cap for any real phone photo;
 * if it somehow does not, we re-encode once, harder, before giving up.
 */

export const PHOTO_FULL_EDGE = 1280;
export const PHOTO_THUMB_EDGE = 320;
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export interface PreparedPhoto {
  /** The ~1280px JPEG to store as the full image. */
  full: Blob;
  /** The ~320px JPEG the board serves on the card. */
  thumb: Blob;
}

/** Raised when even the fallback re-encode cannot get under the cap. */
export class PhotoTooLargeError extends Error {
  constructor() {
    super('photo too large after compression');
    this.name = 'PhotoTooLargeError';
  }
}

function fit(width: number, height: number, maxEdge: number): { w: number; h: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas toBlob failed'))),
      'image/jpeg',
      quality,
    );
  });
}

/** One decode path for every browser: createImageBitmap when it exists, an
 *  <img> with an object URL otherwise. The object URL is always revoked. */
async function decode(file: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('image decode failed');
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function drawToBlob(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxEdge: number,
  quality: number,
): Promise<Blob> {
  const { w, h } = fit(width, height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('canvas unavailable'));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return canvasToBlob(canvas, quality);
}

/**
 * Take the file the picker/camera handed us and produce { full, thumb }.
 * Throws PhotoTooLargeError only if a normal photo could not be squeezed under
 * the cap — practically never at 1280px/q70.
 */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const image = await decode(file);
  try {
    let full = await drawToBlob(image.source, image.width, image.height, PHOTO_FULL_EDGE, 0.7);
    if (full.size > PHOTO_MAX_BYTES) {
      // First fallback: same size, harder squeeze.
      full = await drawToBlob(image.source, image.width, image.height, PHOTO_FULL_EDGE, 0.45);
    }
    if (full.size > PHOTO_MAX_BYTES) {
      // Last resort: noticeably smaller. Still comfortably sharp on a phone.
      full = await drawToBlob(image.source, image.width, image.height, 1000, 0.4);
    }
    if (full.size > PHOTO_MAX_BYTES) throw new PhotoTooLargeError();

    const thumb = await drawToBlob(image.source, image.width, image.height, PHOTO_THUMB_EDGE, 0.7);
    return { full, thumb };
  } finally {
    image.close();
  }
}

/** The board's <img> URL for a task photo. `t` is the row's updatedAt, so a
 *  replaced photo gets a fresh URL and the old one can stay cached forever. */
export function photoUrl(taskId: number, updatedAt: number, size: 'full' | 'thumb'): string {
  return `/api/tasks/${taskId}/photo?size=${size}&t=${updatedAt}`;
}
