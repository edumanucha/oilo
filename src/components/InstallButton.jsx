import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';

// Guardamos el aviso de instalación apenas llega (puede llegar antes de que se dibuje la pantalla).
let deferred = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Botón "Instalar Oílo": en Android/Chrome instala con un toque; en iPhone muestra los pasos.
export default function InstallButton({ t }) {
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);

  if (isStandalone()) return null;
  const ios = isIOS();
  const ua = navigator.userAgent;
  // Navegadores que abren las apps de mensajería (WhatsApp, Instagram, Facebook) no permiten instalar.
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|wv\)/i.test(ua);
  const samsung = /SamsungBrowser/i.test(ua);
  const steps = ios
    ? [t('iosStep1'), t('iosStep2'), t('iosStep3')]
    : inApp
      ? [t('inAppStep1'), t('inAppStep2')]
      : samsung
        ? [t('samsungStep1'), t('samsungStep2')]
        : [t('androidStep1'), t('androidStep2')];

  const install = async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
      force((n) => n + 1);
    } else setHelp(true);
  };

  return (
    <>
      <button className="install-btn" onClick={install}>
        <Icon name="download" /> {t('installApp')}
      </button>
      {help && (
        <div className="sheet-bg" onClick={() => setHelp(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{ios ? t('installTitle') : t('installTitleGeneric')}</h3>
            <ol className="recap">
              {steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            <span className="postit">{t('installNote')}</span>
            <button className="btn primary block" onClick={() => setHelp(false)}>{t('gotIt')}</button>
          </div>
        </div>
      )}
    </>
  );
}
