// Libros de muestra (cuentos originales, cortitos) para probar la app al instante.
import { saveBook, getSetting, setSetting } from './db.js';

const SAMPLES = [
  {
    id: 'sample-es',
    title: 'El cuentero de Corrientes',
    author: 'Cuento de muestra',
    lang: 'es',
    chapters: [
      ['La valija', [
        'Martín llegó a Buenos Aires una mañana de otoño, con una valija gastada y la dirección de su tía anotada en un papel arrugado.',
        'La ciudad lo recibió con ruido de colectivos y olor a café recién hecho. Caminó por la avenida sin saber bien hacia dónde iba, pero con la certeza de que algo nuevo empezaba.',
        'Su tía Rosa vivía en San Telmo, en una casa antigua con un patio lleno de malvones. Lo esperaba con el mate listo, unas medialunas y una lista de consejos que Martín escuchó con paciencia.',
        'Esa noche, desde la ventana de su cuarto, miró las luces de la ciudad y pensó que en algún lugar, entre tantas calles, lo estaba esperando su historia.',
      ]],
      ['La librería', [
        'Los primeros días fueron difíciles. Martín buscó trabajo en bares, talleres y kioscos, pero nadie parecía necesitar a un muchacho del interior.',
        'Una tarde de lluvia se refugió en una librería de la calle Corrientes. Adentro olía a papel viejo y a madera. Detrás del mostrador, un hombre de barba blanca leía con una lupa.',
        'Se llamaba Ernesto, y hacía cuarenta años que atendía ese local. Le ofreció a Martín ordenar los estantes a cambio de unos pesos y de todos los libros que quisiera leer.',
        'Así empezó una amistad extraña y hermosa. Entre cliente y cliente, Ernesto contaba historias de escritores, de viajes y de amores perdidos. Martín lo escuchaba como quien escucha la radio en una noche larga.',
      ]],
      ['La carta', [
        'Un día, acomodando una caja olvidada, Martín encontró un sobre amarillento. Estaba cerrado, con una dirección de Montevideo escrita a mano.',
        'Ernesto se quedó en silencio un buen rato. Después le confesó que era una carta para Elena, la mujer que había amado de joven, y que nunca se había animado a mandar.',
        'Martín no lo dudó. Al domingo siguiente compró dos pasajes en el barco que cruza el Río de la Plata. Ernesto protestó, dijo que era una locura, pero igual se puso su mejor saco.',
        'Mientras el barco se alejaba del puerto, el viejo apretó la carta contra el pecho y sonrió como no lo hacía desde hacía años. Esa, le dijo a Martín, iba a ser la mejor historia de todas.',
      ]],
    ],
  },
  {
    id: 'sample-en',
    title: 'The Keeper of the Light',
    author: 'Sample story',
    lang: 'en',
    chapters: [
      ['The Lighthouse', [
        'Anna lived alone in the old lighthouse at the edge of the bay. Every night she climbed the hundred and twelve steps to light the lamp.',
        'Ships passing by never knew her name, but they trusted her light more than any map.',
      ]],
      ['The Storm', [
        'One winter night a terrible storm arrived from the north. The waves rose higher than the rocks, and the wind howled through the windows.',
        'Through the rain, Anna saw a small fishing boat fighting the sea. She knew that if the light went out, the sailors would be lost.',
      ]],
      ['The Morning', [
        'She kept the lamp burning until dawn, feeding the fire with every piece of wood in the house, even her favourite chair.',
        'In the morning, three tired fishermen knocked at her door to thank her. From that day on, the whole village knew her name.',
      ]],
    ],
  },
];

function toBook(s) {
  const paras = [];
  const chapters = s.chapters.map(([title, ps]) => {
    const start = paras.length;
    ps.forEach((p) => paras.push(p));
    return { title, start, end: paras.length };
  });
  return {
    book: { id: s.id, title: s.title, author: s.author, lang: s.lang, cover: null, coverUrl: null, format: 'demo', chapters, totalChars: paras.join('').length, addedAt: Date.now() - (s.lang === 'es' ? 0 : 1000) },
    paras,
  };
}

// Se agregan una sola vez (si el usuario los borra, no vuelven a aparecer solos).
export async function ensureSamples() {
  if (await getSetting('samplesAdded', false)) return false;
  for (const s of SAMPLES) {
    const { book, paras } = toBook(s);
    await saveBook(book, paras);
  }
  await setSetting('samplesAdded', true);
  return true;
}

export async function addSample(lang = 'es') {
  const s = SAMPLES.find((x) => x.lang === lang) || SAMPLES[0];
  const { book, paras } = toBook(s);
  await saveBook(book, paras);
  return book.id;
}
