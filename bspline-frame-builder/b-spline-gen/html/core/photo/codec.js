/**
 * photo/codec.js — F34 item 1: the ONLY canvas/Image-touching code in the
 * Photo filter. Everything else (core/photo/ops.js, core/photo/state.js,
 * core/noise/photo.js) is pure array math and unit-tested directly; this
 * file cannot be (this repo's own test environment, happy-dom, has no real
 * Canvas 2D context -- tests/decal-png.test.js already documents this) and
 * is verified live instead (screenshots, a real Send).
 *
 * `rgbToGrey` is split out as its own pure function specifically so IT can
 * still be unit-tested without a canvas.
 */

// Downscaled so an embedded project stays small (dispatch: "downscaled to
// the terrain resolution, so files stay small") -- a fixed cap rather than
// the LIVE terrain grid (which changes with board size/spacing) is simpler
// and still far above any terrain grid's own nx/nz in practice.
export const PHOTO_MAX_DIM = 512;

// Standard ITU-R BT.601 luma weights -- the common "perceptual brightness"
// formula (matches what most photo tools call "greyscale" or "luminosity").
export function rgbToGrey(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Read a <input type=file> File as a data: URL. */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

/** The size a photo is sampled (and, item 74a, stored) at: its own size, or scaled down so its long side is
 * `maxDim`. One declaration for both, so the stored copy is exactly what the decode samples. */
export function photoSize(naturalWidth, naturalHeight, maxDim = PHOTO_MAX_DIM) {
  const scale = Math.min(1, maxDim / Math.max(naturalWidth, naturalHeight));
  return { w: Math.max(1, Math.round(naturalWidth * scale)), h: Math.max(1, Math.round(naturalHeight * scale)) };
}

/** Item 74a (seat D, measured: a 5.5 MB phone JPEG went into P as-is, the session save hit the storage quota and a
 * reload lost the whole board): the photo as P stores it -- core/state.js's declared "downscaled at upload time".
 * A data: URL larger than `maxDim` is redrawn at photoSize as a PNG (the same size and draw decodeImageToGrey
 * samples, so the terrain is unchanged); one already within it comes back as the same string, and a plain URL (a
 * built-in pattern) passes through. */
export function downscalePhotoDataUrl(dataUrl, maxDim = PHOTO_MAX_DIM) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return Promise.resolve(dataUrl);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const { w, h } = photoSize(image.naturalWidth, image.naturalHeight, maxDim);
        if (w === image.naturalWidth && h === image.naturalHeight) { resolve(dataUrl); return; }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(image, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    image.onerror = () => reject(new Error('Image failed to load'));
    image.src = dataUrl;
  });
}

/** Decode a data: URL (or any <img>-loadable URL) into a downscaled
 * greyscale buffer: { data: Float32Array, w, h }, values 0..1. */
export function decodeImageToGrey(dataUrl, maxDim = PHOTO_MAX_DIM) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const { w, h } = photoSize(image.naturalWidth, image.naturalHeight, maxDim);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, w, h);
        const { data: rgba } = ctx.getImageData(0, 0, w, h);
        const grey = new Float32Array(w * h);
        for (let k = 0; k < w * h; k++) {
          grey[k] = rgbToGrey(rgba[k * 4], rgba[k * 4 + 1], rgba[k * 4 + 2]);
        }
        resolve({ data: grey, w, h });
      } catch (e) {
        reject(e);
      }
    };
    image.onerror = () => reject(new Error('Image failed to load'));
    image.src = dataUrl;
  });
}

/** The inverse of decodeImageToGrey: a processed greyscale buffer -> a PNG
 * data: URL, for embedding the EDITED preview or for any future "export the
 * processed photo" affordance. (Persistence itself saves the RAW decoded
 * source + the declared edit steps, not this -- see photo/state.js's own
 * header comment -- so this is not on the hot save/load path today.) */
export function encodeGreyToDataUrl(img) {
  const { data, w, h } = img;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(w, h);
  for (let k = 0; k < w * h; k++) {
    const v = Math.max(0, Math.min(255, Math.round(data[k] * 255)));
    imageData.data[k * 4] = v;
    imageData.data[k * 4 + 1] = v;
    imageData.data[k * 4 + 2] = v;
    imageData.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
