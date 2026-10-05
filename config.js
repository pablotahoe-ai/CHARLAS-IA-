/* CONFIGURACIÓN DE LA CHARLA — el único archivo que hay que tocar.
   api: URL del Apps Script publicado (termina en /exec). Pegarla entre las comillas.
   Vacío = las partes "en vivo" (imágenes, flyer, nube de palabras) quedan apagadas; el resto funciona igual.
   musica: temas del botón de música (arriba, al lado de día/noche). Cada uno: título, archivo mp3 y tapa. Suenan en este orden y en loop. */
window.CHARLA_CONFIG = {
  api: 'https://script.google.com/macros/s/AKfycbzZiKQB_WgYKxyuoy1IUf-JzE2Zc9EIng0Q70BuV4T_RAiBV9qOcUOYlxDeSAnPQAhY/exec',
  bot: 'http://127.0.0.1:3777',
  musica: [
    { titulo: 'Formal Arrival',    archivo: 'media/musica/formal-arrival.mp3',    tapa: 'media/musica/formal-arrival.jpg' },
    { titulo: 'Linen and Sand',    archivo: 'media/musica/linen-and-sand.mp3',    tapa: 'media/musica/linen-and-sand.jpg' },
    { titulo: 'Glassware at Dusk', archivo: 'media/musica/glassware-at-dusk.mp3', tapa: 'media/musica/glassware-at-dusk.jpg' }
  ]
};
