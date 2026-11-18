// Runs looks and Beauty off the main thread so the camera stays responsive while a photo is processed.
import { renderPixels } from './film.js';

self.onmessage = (e) => {
  const { id, buf, w, h, look, opts } = e.data || {};
  try {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength !== w * h * 4) throw new Error('bad frame');
    renderPixels(new Uint8ClampedArray(buf), w, h, look, opts || {});
    self.postMessage({ id, buf }, [buf]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
