import { useEffect, useState } from 'react';

// Animación de inicio: un libro que se abre, pasan las hojas y aparece "Oílo".
export default function Splash({ tagline, onDone }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t1 = setTimeout(() => setLeaving(true), reduce ? 400 : 2300);
    const t2 = setTimeout(onDone, reduce ? 700 : 2800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  const skip = () => {
    setLeaving(true);
    setTimeout(onDone, 300);
  };
  return (
    <div className={`splash ${leaving ? 'out' : ''}`} onClick={skip} aria-label="Oílo">
      <div className="sp-book">
        <div className="sp-page right" />
        <div className="sp-leaf l3" />
        <div className="sp-leaf l2" />
        <div className="sp-leaf l1" />
        <div className="sp-cover">
          <div className="sp-cover-front">
            <span>Oílo</span>
          </div>
          <div className="sp-cover-back" />
        </div>
      </div>
      <div className="sp-title">
        <h1>Oílo</h1>
        <span>{tagline}</span>
      </div>
    </div>
  );
}
