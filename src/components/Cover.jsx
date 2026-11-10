import { useEffect, useState } from 'react';
import { placeholderColors } from '../lib/covers.js';

export function useObjectUrl(blob) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export default function Cover({ book, showFormat }) {
  const blobUrl = useObjectUrl(book.cover);
  const [broken, setBroken] = useState(false);
  const src = blobUrl || (!broken && book.coverUrl) || null;
  const [fg, bg] = placeholderColors(book.title);
  return (
    <div className="cover">
      {src ? (
        <img src={src} alt="" onError={() => setBroken(true)} loading="lazy" />
      ) : (
        <div className="ph" style={{ background: bg, color: fg }}>
          <b>{book.title}</b>
          <span>{book.author}</span>
        </div>
      )}
      {showFormat && book.format && book.format !== 'demo' && <span className="fmt">{book.format}</span>}
    </div>
  );
}
