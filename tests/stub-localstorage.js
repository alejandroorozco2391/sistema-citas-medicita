/* Stub mínimo de localStorage para correr el store en node.
   Se instala como global ANTES de requerir conversaciones-store.js. */

function instalarLocalStorage() {
  const datos = new Map();
  const ls = {
    getItem: k => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: k => datos.delete(k),
    clear: () => datos.clear(),
    get length() {
      return datos.size;
    },
  };
  globalThis.localStorage = ls;
  return ls;
}

module.exports = { instalarLocalStorage };
