/* Presentadores de la portada: Euge, Pablo y una pausa de diez segundos. */
(() => {
  const hero = document.getElementById('hero');
  const inner = hero?.querySelector('.inner');
  const main = hero?.querySelector('.hero-main');
  if (!hero || !inner || !main || hero.classList.contains('hero-with-presenters')) return;

  function makePresenter(side, name, file) {
    const figure = document.createElement('figure');
    figure.className = `hero-presenter hero-presenter--${side}`;
    figure.setAttribute('aria-label', `Video de ${name}`);
    figure.style.margin = '0';

    const video = document.createElement('video');
    video.src = file;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('disablepictureinpicture', '');
    video.addEventListener('loadedmetadata', () => {
      if (video.paused && video.currentTime === 0) {
        try { video.currentTime = Math.min(0.08, video.duration / 10); } catch (_) { /* Primer fotograma disponible. */ }
      }
    }, { once: true });

    const label = document.createElement('figcaption');
    label.className = 'hero-presenter__name';
    label.textContent = name;
    figure.append(video, label);
    return { figure, video };
  }

  const eugeName = hero.querySelector('.speaker:not(.alt) .name')?.textContent?.trim() || 'María Eugenia Dicándilo';
  const peliName = hero.querySelector('.speaker.alt .name')?.textContent?.trim() || 'Pablo Pelizzoni';
  const euge = makePresenter('euge', eugeName, 'Euge se mueve.mp4');
  const peli = makePresenter('peli', peliName, 'Peli saludando.mp4');
  inner.insertBefore(euge.figure, main);
  main.after(peli.figure);
  hero.classList.add('hero-with-presenters');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  let inView = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      inView = entries[0]?.isIntersecting ?? true;
      if (!inView) {
        euge.video.pause(); peli.video.pause();
        euge.figure.classList.remove('is-moving');
        peli.figure.classList.remove('is-moving');
      }
    }, { threshold: 0.05 }).observe(hero);
  }

  async function playOnce(presenter) {
    const { figure, video } = presenter;
    if (document.hidden || !inView || reducedMotion.matches) return;
    try { video.currentTime = 0; } catch (_) { /* La reproducción seguirá desde el fotograma disponible. */ }
    figure.classList.add('is-moving');
    try {
      await video.play();
      await new Promise(resolve => {
        if (video.ended) { resolve(); return; }
        const finish = () => { window.clearTimeout(limit); video.removeEventListener('ended', finish); resolve(); };
        const limit = window.setTimeout(finish, 6500);
        video.addEventListener('ended', finish, { once: true });
      });
    } catch (_) { /* Un navegador puede impedir autoplay; queda visible el fotograma quieto. */ }
    video.pause();
    figure.classList.remove('is-moving');
  }

  async function cycle() {
    while (hero.isConnected) {
      if (document.hidden || !inView || reducedMotion.matches) { await sleep(1000); continue; }
      await playOnce(euge);
      await sleep(450);
      await playOnce(peli);
      await sleep(10000);
    }
  }

  reducedMotion.addEventListener?.('change', () => {
    if (reducedMotion.matches) {
      euge.video.pause(); peli.video.pause();
      euge.figure.classList.remove('is-moving');
      peli.figure.classList.remove('is-moving');
    }
  });
  cycle();
})();
