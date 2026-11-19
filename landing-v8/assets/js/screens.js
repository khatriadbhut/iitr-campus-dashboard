/* ============================================================
   Paints every DOM phone with the animated screen player, and
   wires the explorable phone's real scrolling and click-through.

   Only screens actually on the page get ticked, so an idle tab
   does no work.
   ============================================================ */
import { loadShots, ScreenPlayer, SHOTS } from './screen.js?v=5';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

(async () => {
  const shots = await loadShots();

  /* ── the animated phones ───────────────── */
  const screens = $$('canvas.app-shot[data-mode]').map(canvas => {
    const p = new ScreenPlayer(shots, canvas.width, canvas.height);
    p.setMode(canvas.dataset.mode);
    p.tick(0);
    return { canvas, ctx: canvas.getContext('2d'), player: p, live: false };
  });

  if (screens.length) {
    const io = new IntersectionObserver(
      es => es.forEach(e => {
        const s = screens.find(x => x.canvas === e.target);
        if (s) s.live = e.isIntersecting;
      }),
      { rootMargin: '10% 0px' }
    );
    screens.forEach(s => io.observe(s.canvas));

    /* 20fps is plenty for a feed that creeps at 52px/s, and it is a third of
       the canvas work of repainting on every animation frame. */
    const FPS = 20;
    let last = performance.now();
    const frame = now => {
      requestAnimationFrame(frame);
      if (document.hidden || REDUCED) { last = now; return; }
      if (now - last < 1000 / FPS) return;
      const dt = Math.min(0.08, (now - last) / 1000);
      last = now;
      for (const s of screens) {
        if (!s.live) continue;
        s.player.tick(dt);
        if (s.player.changed) s.ctx.drawImage(s.player.canvas, 0, 0);
      }
    };
    requestAnimationFrame(frame);

    // paint one frame immediately so nothing is blank before scroll
    screens.forEach(s => { s.player.tick(0.001); s.ctx.drawImage(s.player.canvas, 0, 0); });
  }

  /* ── the embedded app ─────────────────────
     The iframe is laid out at 412px — the width the app is built for — and
     scaled to fit the phone, so its own responsive breakpoints behave exactly
     as they do on a real handset. */
  const frame = document.getElementById('demoFrame');
  if (!frame) return;
  const fit = () => {
    const box = frame.parentElement.getBoundingClientRect();
    if (!box.width) return;
    const k = box.width / 412;
    frame.style.transform = `scale(${k})`;
    frame.style.height = (box.height / k) + 'px';
  };
  fit();
  addEventListener('resize', fit, { passive: true });
  new ResizeObserver(fit).observe(frame.parentElement);
})();
