// Actualizaciones de la app: busca versión nueva al abrir, al volver a la app y cada 30 minutos.
// Si hay una nueva, recarga sola; si en ese momento está leyendo, espera a que se ponga pausa.
import { registerSW } from 'virtual:pwa-register';
import { player } from './player.js';

let applyUpdate = null;
let pending = false;
let reg = null;
const listeners = new Set();
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

function tryApply() {
  if (!pending || !applyUpdate) return;
  if (player.playing) return; // no cortar la lectura
  applyUpdate(true); // activa la versión nueva y recarga
}

export function initUpdater() {
  if (!('serviceWorker' in navigator)) return;
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true;
      listeners.forEach((fn) => fn(true));
      tryApply();
    },
    onRegisteredSW(_url, r) {
      reg = r;
      if (!r) return;
      setInterval(() => r.update().catch(() => {}), 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') r.update().catch(() => {});
      });
    },
  });
  // Si había una actualización esperando, se aplica apenas se pone pausa.
  player.subscribe((s) => {
    if (pending && !s.playing) tryApply();
  });
}

export async function checkForUpdate() {
  if (!reg) return false;
  await reg.update().catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  if (pending) {
    applyUpdate?.(true);
    return true;
  }
  return false;
}

export function onUpdateAvailable(fn) {
  listeners.add(fn);
  if (pending) fn(true);
  return () => listeners.delete(fn);
}
