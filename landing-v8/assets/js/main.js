/* ============================================================
   CAMPUS DASHBOARD — Landing v7
   Deliberately small. antigravity.google runs on native scroll with
   zero sticky sections and no scroll library, and it works; the
   heavy lifting there is done by big product imagery and real
   components, not by scroll choreography. So this file does four
   things and nothing else:

     1. reveal on enter          (IntersectionObserver)
     2. the ONE pinned beat      (scraps pulled into the phone)
     3. the curtain              (kept from v1)
     4. the explorable phone   (tab bar over real app captures)

   No Lenis, no GSAP, no WebGL. Native scroll all the way.
   ============================================================ */
(() => {
'use strict';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/* ── 1 · reveal ───────────────────────────── */
const ups = $$('.up');
if (REDUCED) ups.forEach(el => el.classList.add('in'));
else {
  const io = new IntersectionObserver((es, obs) => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
  }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  ups.forEach(el => io.observe(el));
}

/* ── masthead + progress ──────────────────── */
const mast = $('#mast'), prog = $('#prog');
addEventListener('scroll', () => {
  mast.classList.toggle('stuck', scrollY > 20);
  const max = document.documentElement.scrollHeight - innerHeight;
  prog.style.width = (max > 0 ? clamp(scrollY / max) * 100 : 0) + '%';
}, { passive: true });

/* ── 2 · the beat: scraps get pulled into the phone ──
   Each scrap starts out at its own offset and rotation and is drawn
   to the centre of the device as the beat progresses; the matching
   row inside the phone fades up as it lands. The mess resolves INTO
   the product rather than beside it. ── */
const beat = $('#beat');
const beatPin = $('.beat-pin');
const beatDevice = $('.beat-stage .device');
const stage = $('.beat-stage');
/* how far the authored scatter has to be pulled in to clear the pin's clip;
   recomputed only when the width changes, since that is all it depends on */
let fitW = -1, fitK = 1;
const scraps = $$('.scrap').map(el => ({
  el, dx: +el.dataset.dx, dy: +el.dataset.dy, rot: +el.dataset.rot
}));
const rows = $$('[data-land]');

function paintBeat() {
  if (!beat || REDUCED) return;
  const span = beat.offsetHeight - innerHeight;
  const p = span > 0 ? clamp((scrollY - beat.offsetTop) / span) : 0;
  // scraps scale down with the viewport so they never fly off a phone
  const k = clamp(innerWidth / 1440, 0.4, 1);

  /* Narrow screens get a different scatter.

     The authored offsets are a wide 2D spread — roughly +/-240px each way. A
     phone is 390px across, so even floored at 0.4 that puts five 148px cards
     inside +/-95px of centre: measured six overlapping pairs mid-scroll, with
     all five sitting on top of the phone. Unreadable.

     There is no horizontal room for a scatter here (clearing the phone would
     need +/-190px on a 390px screen), so below the breakpoint they are dealt
     into distinct vertical bands instead. Same gesture — scattered, then
     pulled in — but they never cover each other. */
  const narrow = innerWidth <= 900;
  /* Bands are derived from the stage, not hard-coded. Fixed +/-250 offsets
     escaped the stage entirely: the top scrap landed on the copy's last line
     and the spread left a column of dead space. Measure the stage and the
     scrap, then deal them into the tallest ladder that still fits inside it. */
  /* .beat-pin clips (overflow:hidden) so scraps never spill into the sections
     either side of it — but nothing tied the authored +/-236px offsets to that
     edge. Measured at 1024/1280/1440/1728, the outermost card was cut by
     41-67px on the right at the start of the beat. Pull the whole scatter in
     by the tightest fit: the composition is preserved, just narrower. */
  if (!narrow && stage && beatPin && scraps.length && innerWidth !== fitW) {
    fitW = innerWidth;
    const pr = beatPin.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    const cx = sr.left + sr.width / 2 - pr.left;         // stage centre, within the pin
    fitK = 1;
    scraps.forEach(s => {
      if (!s.dx) return;
      const half = s.el.offsetWidth / 2 + 12;            // + slop for the rotation
      const room = s.dx > 0 ? pr.width - cx - half : cx - half;
      fitK = Math.min(fitK, Math.max(0, room) / Math.abs(s.dx * k));
    });
    fitK = Math.min(1, fitK);
  }

  let bands = null;
  if (narrow && stage && scraps.length) {
    const sh = stage.clientHeight;
    /* the TALLEST card, not the first — one of them runs to three lines, and
       sizing the ladder off a two-line card left that one overlapping */
    const ch = Math.max(...scraps.map(x => x.el.offsetHeight || 0), 46);
    const room = Math.max(0, sh / 2 - ch / 2 - 6);          // half the stage, minus the card
    const n = scraps.length;
    const step = n > 1 ? Math.min(room / ((n - 1) / 2), ch + 14) : 0;
    bands = scraps.map((_, i) => (i - (n - 1) / 2) * step);
  }

  scraps.forEach((s, i) => {
    // staggered: each scrap is pulled in slightly after the one before
    const start = i * 0.07;
    const t = clamp((p - start) / 0.5);
    const e = t * t * (3 - 2 * t);
    const x = (narrow ? (i % 2 ? 62 : -62) : s.dx * k * fitK) * (1 - e);
    const y = (narrow && bands ? bands[i] : s.dy * k) * (1 - e);
    const r = (narrow ? (i % 2 ? 5 : -5) : s.rot) * (1 - e);
    // it shrinks and fades only right at the end, as it enters the screen
    const shrink = 1 - 0.55 * clamp((e - 0.72) / 0.28);
    const fade = 1 - clamp((e - 0.78) / 0.22);
    s.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${r.toFixed(2)}deg) scale(${shrink.toFixed(3)})`;
    s.el.style.opacity = fade.toFixed(3);
  });

  /* On a phone the scraps cannot clear the device horizontally — both are
     centred and there is not enough width — so the device arrives WITH them
     instead of sitting under the pile: it fades up as they converge, which is
     the story anyway. On desktop it is either the 3D phone's stand-in or
     already visible, so leave it alone. */
  /* It fades UP as the scraps converge and then simply stays. There was an
     exit fade here for a while, to stop the mock being sliced by the masthead
     on its way out; it is gone because the phone leaving under its own steam
     reads better, and the curtain now overlaps enough that there is something
     behind it as it goes. */
  if (beatDevice) beatDevice.style.opacity = narrow ? clamp((p - 0.42) / 0.34).toFixed(3) : '';

  rows.forEach((row, i) => {
    const t = clamp((p - 0.18 - i * 0.11) / 0.2);
    row.style.opacity = t.toFixed(3);
    row.style.transform = `translate3d(0,${((1 - t) * 8).toFixed(1)}px,0)`;
  });
}

/* ── 3 · the curtain ──────────────────────── */
const curtain = $('#curtain'), cTag = $('#curtainTag'), cBody = $('#curtainBody');
const zone = curtain && curtain.closest('.curtain-zone');
function paintCurtain() {
  if (!curtain || REDUCED) return;
  const host = curtain.parentElement;
  const w = host.clientWidth, h = host.clientHeight;
  const span = zone.offsetHeight - innerHeight;
  const raw = span > 0 ? clamp((scrollY - zone.offsetTop) / span) : 0;
  const p = 1 - Math.pow(1 - raw, 2.2);
  const W = 172, H = 232;
  const cw = W + (w - W) * p, ch = H + (h - H) * p;
  curtain.style.clipPath = `inset(${(h - ch) / 2}px ${(w - cw) / 2}px ${(h - ch) / 2}px ${(w - cw) / 2}px)`;
  cTag.style.opacity = clamp(1 - raw / 0.24);
  const b = clamp((raw - 0.4) / 0.4);
  cBody.style.opacity = b;
  cBody.style.transform = `translate3d(0,${(1 - b) * 18}px,0)`;
}

/* one rAF, only while something pinned is on screen */
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { paintBeat(); paintCurtain(); ticking = false; });
}
if (!REDUCED) {
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  onScroll();
}

/* ── spotlight on the try-it phone ─────────
   Fires the moment the 3D phone has finished becoming the flat one — the same
   handover test guide.js uses — so the highlight lands on a phone that has
   stopped moving. It is NOT dismissed on scroll: that handover happens *while*
   the visitor is scrolling, so a scroll listener killed the mark on the very
   next event and it appeared and vanished inside one frame. ── */
const spot = $('#spot'), spotDev = $('#live');
if (spot && spotDev) {
  /* Two separate fades have to finish first, and they live on different
     elements: the 3D->2D handover drives .device's opacity, while the section's
     entrance reveal drives the .shot wrapper's. Checking only the device let
     the spotlight land on a phone that was still fading in, which read as the
     scrim covering it. */
  const spotShot = spotDev.closest('.shot');
  /* 0.85, not 0.98. The handover is damped, so opacity approaches 1
     asymptotically: the phone already reads as flat at 0.85 but does not cross
     0.98 for another ~68ms, and that wait was a third of the visible lag.
     Firing at 0.85 is safe because the phone finishes its own fade during the
     scrim's — measured, the device is at opacity 1.000 by the time the scrim
     reaches full, so it is never seen translucent under the dimming. */
  /* On a handset there is no 3D phone and so no handover to wait for, but the
     moment the spotlight is FOR is the same one: the phone has arrived and
     stopped. There it is the pin engaging. Without this the mark fired at 55%
     visibility — while the phone was still travelling up the screen — and the
     scrim swept up the page with it.
     `.shot` is the sticky box on mobile (top:0), so it is pinned exactly while
     its top sits at 0: above that it is still in flow, and once the section
     runs out it scrolls away negative. */
  const NARROW = matchMedia('(max-width: 900px)');
  const settled = () => {
    if (!NARROW.matches || !spotShot) return true;   // desktop: unchanged
    return Math.abs(spotShot.getBoundingClientRect().top) <= 1.5;
  };

  const ready = () =>
    (!document.body.classList.contains('webgl') ||
     parseFloat(getComputedStyle(spotDev).opacity || '1') > 0.85) &&
    (!spotShot || parseFloat(getComputedStyle(spotShot).opacity || '1') > 0.85) &&
    settled();

  let showing = false, spent = false, loop = 0, timer = 0;

  /* How far the label reaches above the phone: its own height plus the gap it
     sits at. Measured, not the old fixed 104 — on a handset the label is a
     smaller font at a tighter gap, and a constant flipped it to the wrong side
     on exactly the screens with the least room to spare. Cached: reading it
     forces layout, and it only changes with the viewport. */
  const say = $('.spot-say', spot);
  let reach = 0, reachAt = '';
  const labelReach = () => {
    const key = innerWidth + 'x' + innerHeight;
    if (key !== reachAt) {
      reachAt = key;
      const flipped = spot.classList.contains('below');
      if (flipped) spot.classList.remove('below');
      reach = spot.getBoundingClientRect().top - say.getBoundingClientRect().top;
      if (flipped) spot.classList.add('below');
    }
    return reach;
  };

  let sig = '';
  const place = () => {
    const r = spotDev.getBoundingClientRect();
    /* While the phone is pinned the rect is identical every frame, so writing
       the same four styles 60 times a second only makes the browser recompute
       style for nothing. Same trick as the screen player's signature: write
       when it actually moved. */
    const now = r.left + '|' + r.top + '|' + r.width + '|' + r.height;
    if (now === sig) return;
    sig = now;
    /* set the properties, do NOT append to cssText — `cssText +=` re-appends a
       full set of declarations every animation frame and the attribute grows
       without bound */
    spot.style.left = r.left + 'px';
    spot.style.top = r.top + 'px';
    spot.style.width = r.width + 'px';
    spot.style.height = r.height + 'px';
    // the masthead, plus everything the label needs above the phone
    spot.classList.toggle('below', r.top < (mast ? mast.offsetHeight : 58) + labelReach());
  };
  const clear = () => {
    spot.classList.remove('on');
    removeEventListener('pointerdown', clear);
    clearTimeout(timer);
    showing = false;
    spent = true;                       // don't re-show until the phone leaves
  };
  const show = () => {
    showing = true;
    sig = '';
    place();
    spot.classList.add('on');
    timer = setTimeout(clear, 3200);
    addEventListener('pointerdown', clear, { once: true });
  };

  /* One loop for as long as the phone is on screen, because the mark has to
     react to the phone leaving as well as arriving. Scrolling back UP runs the
     3D handover in reverse: the flat phone fades out and the 3D one tilts away,
     but the phone never leaves the viewport, so an IntersectionObserver alone
     never fired and the hole was left sitting over empty paper. Tracking
     ready() every frame means the mark goes the moment the phone stops being
     the flat, landed one — up or down, no wait. */
  /* The scrim has to track the phone frame by frame while it is up, but when
     it is not the loop is only watching for the phone to arrive or leave, and
     that does not need 60Hz. Testing every fourth frame (~15Hz, i.e. at most
     ~67ms late) cuts the idle cost to a quarter — and idle is most of the
     time, since the pin now keeps the phone on screen far longer. */
  let beatN = 0;
  const step = () => {
    loop = requestAnimationFrame(step);
    if (!showing && (beatN = (beatN + 1) & 3)) return;
    const ok = ready();
    if (ok) {
      if (showing) place();
      else if (!spent) show();
    } else {
      if (showing) clear();
      spent = false;                    // re-armed: it can greet you again
    }
  };

  new IntersectionObserver(([e]) => {
    if (REDUCED) return;
    if (e.isIntersecting) {
      if (!loop) loop = requestAnimationFrame(step);
    } else {
      cancelAnimationFrame(loop); loop = 0;
      if (showing) clear();
      spent = false;
    }
  }, { threshold: 0.55 }).observe(spotDev);
}

/* ── club rail: duplicate the row so the loop is seamless ── */
const railRow = $('#railRow');
if (railRow && !REDUCED) {
  const copy = railRow.cloneNode(true);
  copy.removeAttribute('id');
  copy.setAttribute('aria-hidden', 'true');
  railRow.parentElement.appendChild(copy);
}

/* ── 5 · the spine ───────────────────────────
   Marks where you are in the flow. Only meaningful once you're past
   the hero, so it fades in with the first section. ── */
const spine = $('#spine');
if (spine && !REDUCED) {
  const links = $$('a', spine);
  const targets = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const markSpine = () => {
    const mid = scrollY + innerHeight * 0.45;
    spine.classList.toggle('show', scrollY > innerHeight * 0.7);
    let active = -1;
    targets.forEach((t, i) => { if (mid >= t.offsetTop) active = i; });
    links.forEach((a, i) => a.classList.toggle('on', i === active));
  };
  addEventListener('scroll', markSpine, { passive: true });
  markSpine();
}

/* ── the explorable phone ──────────────────
   The tab bar crossfades between real captures of the running app. It is a
   real control over real screens rather than an imitation of either. */
const live = $('#live');
if (live) {
  const shots = $$('.live-shot', live);
  const tabs = $$('#tabbar button');
  tabs.forEach(b => b.addEventListener('click', () => {
    tabs.forEach(x => x.classList.toggle('on', x === b));
    shots.forEach(s => s.classList.toggle('on', s.dataset.s === b.dataset.go));
  }));
}

$('#yr') && ($('#yr').textContent = String(new Date().getFullYear()));
})();
