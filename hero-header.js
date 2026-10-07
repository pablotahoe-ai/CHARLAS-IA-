/* Portada: presentadores (Euge y Pablo, en turnos) + botón central que abre el video de introducción. */
(() => {
  const hero = document.getElementById('hero');
  const inner = hero?.querySelector('.inner');
  const main = hero?.querySelector('.hero-main');
  if (!hero || !inner || !main || hero.classList.contains('hero-with-presenters')) return;

  let introOpen = false;

  function makePresenter(side, name, role, file) {
    const figure = document.createElement('figure');
    figure.className = `hero-presenter hero-presenter--${side}`;
    figure.setAttribute('aria-label', `Video de ${name}`);

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
    if (role) {
      const r = document.createElement('span');
      r.className = 'hero-presenter__role';
      r.textContent = role;
      label.append(r);
    }
    figure.append(video, label);
    return { figure, video };
  }

  const txt = (sel) => hero.querySelector(sel)?.textContent?.trim() || '';
  const euge = makePresenter('euge', txt('.speaker:not(.alt) .name') || 'María Eugenia Dicándilo', 'Fundadora y directora de Modo Comunicación', 'Euge se mueve.mp4');
  const peli = makePresenter('peli', txt('.speaker.alt .name') || 'Pablo Pellizzoni', 'Diseñador industrial. Cofundador de Outcomy, KrovaLab y Kexen. Docente investigador de la Universidad Nacional de Mar del Plata.', 'Peli saludando.mp4');
  hero.insertBefore(euge.figure, inner);
  hero.insertBefore(peli.figure, inner);
  hero.classList.add('hero-with-presenters');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  let inView = true;
  function stopPresenters() {
    euge.video.pause(); peli.video.pause();
    euge.figure.classList.remove('is-moving');
    peli.figure.classList.remove('is-moving');
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      inView = entries[0]?.isIntersecting ?? true;
      if (!inView) stopPresenters();
    }, { threshold: 0.05 }).observe(hero);
  }
  const idle = () => document.hidden || !inView || introOpen || reducedMotion.matches;

  async function playOnce(presenter) {
    const { figure, video } = presenter;
    if (idle()) return;
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
      if (idle()) { await sleep(1000); continue; }
      await playOnce(euge);
      await sleep(450);
      await playOnce(peli);
      await sleep(10000);
    }
  }

  reducedMotion.addEventListener?.('change', () => { if (reducedMotion.matches) stopPresenters(); });
  cycle();

  /* ---------- botón "Comenzar" + video de introducción ---------- */
  const cta = document.getElementById('heroCta');
  const intro = document.getElementById('intro');
  const iv = document.getElementById('introVideo');
  const skip = document.getElementById('introSkip');
  if (!cta || !intro || !iv) return;

  const SRC = { es: 'media/intro-es.mp4', en: 'media/intro-en.mp4', pt: 'media/intro-pt.mp4' };
  const PEOPLE_OUT_AT = 1.0;   /* segundo del video en que Pablo y Euge empiezan a desvanecerse (tardan ~1,2 s) */
  const html = document.documentElement;
  let open = false, closing = null, fadeTimer = null, peopleOut = false;

  function say(m) { try { Live.say(m); } catch (_) { /* sin aviso */ } }

  function showVideo() { if (open) intro.classList.add('on'); }

  function openIntro() {
    if (open) return;
    open = true; introOpen = true; peopleOut = false;
    window.clearTimeout(closing);
    stopPresenters();
    try { window.CharlaMusic && CharlaMusic.duck(); } catch (_) { /* sin música */ }
    iv.src = SRC[html.getAttribute('data-lang')] || SRC.es;
    iv.muted = false;
    try { iv.currentTime = 0; } catch (_) { /* empieza desde el principio */ }
    html.classList.add('intro-open');
    hero.classList.add('intro-run');                 /* los textos se desvanecen */
    intro.setAttribute('aria-hidden', 'false');
    iv.addEventListener('playing', showVideo, { once: true });   /* el video aparece cuando ya corre */
    fadeTimer = window.setTimeout(showVideo, 1800);
    const p = iv.play();
    if (p && p.catch) p.catch(() => { if (open) { closeIntro(); say('No se pudo reproducir el video de introducción.'); } });
  }

  function closeIntro() {
    if (!open) return;
    open = false;
    window.clearTimeout(fadeTimer);
    intro.classList.remove('on');
    intro.setAttribute('aria-hidden', 'true');
    hero.classList.remove('intro-run');              /* vuelven los textos */
    euge.figure.classList.remove('out'); peli.figure.classList.remove('out');   /* y los presentadores */
    closing = window.setTimeout(() => {
      iv.pause();
      iv.removeAttribute('src');
      try { iv.load(); } catch (_) { /* nada */ }
      html.classList.remove('intro-open');
      introOpen = false;
      try { window.CharlaMusic && CharlaMusic.restore(); } catch (_) { /* sin música */ }
    }, 1000);
  }

  iv.addEventListener('timeupdate', () => {
    if (open && !peopleOut && iv.currentTime >= PEOPLE_OUT_AT) {
      peopleOut = true;
      euge.figure.classList.add('out'); peli.figure.classList.add('out');
    }
  });
  iv.addEventListener('ended', closeIntro);
  iv.addEventListener('error', () => { if (open) { closeIntro(); say('Falta el video de introducción de este idioma (' + (SRC[html.getAttribute('data-lang')] || SRC.es) + ').'); } });
  skip?.addEventListener('click', closeIntro);
  const block = e => { if (open) e.preventDefault(); };
  document.addEventListener('wheel', block, { passive: false });
  document.addEventListener('touchmove', block, { passive: false });
  document.addEventListener('keydown', e => {
    if (!open || e.ctrlKey || e.metaKey || e.altKey || /^F\d/.test(e.key)) return;
    if (e.key === 'Escape') closeIntro();
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);

  cta.addEventListener('click', () => { cta.blur(); openIntro(); });
})();
