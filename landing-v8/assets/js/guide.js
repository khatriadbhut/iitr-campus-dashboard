/* ============================================================
   CAMPUS DASHBOARD — the guided exploration

   A line of text sits in the space beside the phone with an arrow
   running from it to the control it is talking about. Touch that
   control and the arrow moves on to the next one. Touch anything
   else and nothing stops you — the arrow simply waits.

   Why it is built this way:

   · ACTION-DRIVEN, no Next button. A tooltip with Next produces a
     passive walkthrough — read, nod, click Next, forget. The step
     only advances when the real action happens, in the real
     product, with the visitor's own hands.

   · NOTHING IS BLOCKED. No scrim and no dimming; the whole layer
     is pointer-events:none, so every click lands on the app. The
     section promises "everything works", and holding someone to a
     single path would contradict it.

   · IT POINTS FROM OUTSIDE. Nothing is drawn over the screen. The
     app is the thing being demonstrated, so the annotation stays
     off it and reaches in with an arrow.

   · FOUR STEPS. Three-step tours complete around 72% of the time
     and seven-step tours collapse to about 16%, so four, each with
     one short line — people give a tour roughly twelve seconds.

   Two facts make it possible, both verified: the app is
   same-origin, so its live DOM is readable and its clicks
   observable; and the iframe is laid out at 412px then CSS-scaled,
   so every rectangle read from inside must be multiplied by that
   scale before it means anything out here.
   ============================================================ */
const HOST = document.getElementById('demoFrame');
const SECTION = document.querySelector('.duo.explore');
const DEVICE = SECTION && SECTION.querySelector('.device');
/* Desktop only. The arrows live in the gap beside the phone, and a stacked
   layout has no such gap — the same reason the 3D phone is desktop-only.

   Watched live rather than sampled once: a window dragged across the
   breakpoint used to keep whatever it loaded with, so the arrows either
   lingered over a stacked layout or never appeared at all. */
const WIDE = matchMedia('(min-width: 901px)');
if (HOST && SECTION && DEVICE) start();

/* Every step points at something this build actually has content for, and the
   order is a real path through the app — each target is reachable from where
   the last one left you.

   The Notices tab is deliberately absent: the embedded build ships that
   endpoint empty, so a step there would land on "No notices right now".

   Six is past the three-to-five sweet spot (three-step tours complete around
   72%, seven collapse to about 16%), so each label is kept to a headline and
   one supporting clause, and nothing blocks a visitor who wants out. */
const STEPS = [
  /* Points at the whole category row, not one chip, and any chip in it counts
     as doing the step. Singling out "Tech" implied that was the answer; the
     point is that you pick whichever of them is yours. */
  { sel: '.home-chips-wrap', on: '.home-chip',
    say: 'Narrow it to your kind of thing.',
    sub: 'Tap any category in the row. They stack.' },
  /* Labelled from the RIGHT. The bell sits on the card's right edge, so an
     arrow from the left has to cross the entire screen to reach it and gets
     drawn straight over the event cards. */
  { sel: '.event-reminder-btn', nth: 1, side: 'right',
    say: 'Tell it when to warn you.',
    sub: 'The bell arms a reminder for this one event.' },
  { sel: '.header-icon-btn', nth: 1,
    say: 'Then pick your own timing.',
    sub: 'Five minutes before, or an hour. Several at once.' },
  /* Matched on the href's TAIL, not the whole path. These used to be
     a[href="/app/calendar"] — the basename the real app mounts under — but the
     demo in the iframe is its own build and mounts under "/demo/", so the nav
     renders /demo/calendar and the selector matched nothing. target() came back
     null, place() stripped the .on class, and the tour went invisible after
     step 3 rather than finishing. A tail match survives whatever basename the
     demo is next built with; .bottom-nav-item keeps it to the nav. */
  { sel: '.bottom-nav-item[href$="/calendar"]',
    say: 'See it against the academic calendar.',
    sub: 'Holidays and exam weeks share one grid with the fests.' },
  /* A day that actually HAS something on it. Pointing at a fixed index landed
     on an empty square — the step said "tap any day" and the payoff was "No
     events on this day". :has() picks the first day carrying an event dot, so
     it stays right whatever month the demo data falls in. */
  { sel: '.cal-grid-day:has(.cal-grid-dot)', nth: 0,
    say: 'Tap a day with something on it.',
    sub: 'A clash shows itself before you commit to anything.' },
  { sel: '.bottom-nav-item[href$="/todo"]',
    say: 'Keep your own list beside it.',
    sub: 'Private. Not shared, not visible to anyone running events.' },
  { sel: '.bottom-nav-item[href$="/profile"]',
    say: 'Choose whose events reach you.',
    sub: 'Every club is on by default. Mute the rest.' },
];

const NS = 'http://www.w3.org/2000/svg';

function start() {
  const ui = document.createElement('div');
  ui.className = 'guide';
  ui.innerHTML =
    '<svg class="guide-arrow" aria-hidden="true">' +
      '<path class="guide-line" fill="none"/>' +
      '<polygon class="guide-head"/>' +
    '</svg>' +
    '<p class="guide-say" role="status" aria-live="polite">' +
      '<b class="guide-n"></b><span class="guide-t"></span>' +
      '<span class="guide-sub"></span></p>' +
    '<span class="guide-ring" aria-hidden="true"></span>' +
    '<button class="guide-skip" type="button">Skip</button>';
  SECTION.appendChild(ui);

  const svg  = ui.querySelector('.guide-arrow');
  const line = ui.querySelector('.guide-line');
  const head = ui.querySelector('.guide-head');
  const say  = ui.querySelector('.guide-say');
  const num  = ui.querySelector('.guide-n');
  const txt  = ui.querySelector('.guide-t');
  const sub  = ui.querySelector('.guide-sub');
  const skip = ui.querySelector('.guide-skip');
  const ring = ui.querySelector('.guide-ring');

  let i = -1, live = false, raf = 0, doc = null, done = false;

  const frameDoc = () => { try { return HOST.contentDocument; } catch { return null; } };
  const target = () => {
    const d = frameDoc(); if (!d) return null;
    const s = STEPS[i];  if (!s) return null;
    return d.querySelectorAll(s.sel)[s.nth || 0] || null;
  };

  function place() {
    const el = target();
    if (!el) { ui.classList.remove('on'); return; }
    const r = el.getBoundingClientRect();
    if (!r.width) { ui.classList.remove('on'); return; }

    const sec = SECTION.getBoundingClientRect();
    const host = HOST.getBoundingClientRect();
    const dev = DEVICE.getBoundingClientRect();
    /* the CSS scale the iframe is rendered at — miss it and every arrow lands
       in the wrong place */
    const k = host.width / (HOST.offsetWidth || 1);

    svg.setAttribute('width', sec.width);
    svg.setAttribute('height', sec.height);
    svg.setAttribute('viewBox', `0 0 ${sec.width} ${sec.height}`);

    /* The control's box, in section coordinates. */
    const bx = host.left - sec.left + r.left * k;
    const by = host.top - sec.top + r.top * k;
    const bw = r.width * k, bh = r.height * k;
    const cxT = bx + bw / 2, cyT = by + bh / 2;

    /* The label sits in the gap beside the phone and ABOVE the control, which
       is what gives the arrow an arc to travel rather than a flat dash. */
    /* Which side of the phone the label sits on. Left by default; a step asks
       for the right when its control is on the phone's right edge. */
    const onRight = STEPS[i].side === 'right';
    const gapL = dev.left - sec.left;
    const devR = gapL + dev.width;
    const gap = onRight ? sec.width - devR : gapL;
    say.classList.toggle('from-right', onRight);
    say.style.maxWidth = Math.min(280, Math.max(170, gap - 100)) + 'px';
    const sw = say.offsetWidth || 180, sh = say.offsetHeight || 34;
    const lx = onRight
      ? Math.min(sec.width - sw - 12, devR + 110)
      : Math.max(12, gapL - 110 - sw);

    /* Stay beside the phone. Sitting above the target is the default, because
       that is what gives the arrow an arc, but near the top of the screen there
       is no room above — and clamping to the section instead put the label
       behind the fixed masthead. So fall below the target when it will not fit,
       and never leave the phone's own vertical span. */
    const top = dev.top - sec.top, bot = dev.top - sec.top + dev.height;
    let ly = cyT - sh - 54;
    if (ly < top + 4) ly = cyT + 34;
    ly = Math.max(top + 4, Math.min(bot - sh - 4, ly));
    say.style.left = lx + 'px';
    say.style.top  = ly + 'px';

    /* Where to stop.

       Aiming at a fixed edge left the head sitting off to one side whenever the
       arrow came in at an angle, or at a control that is not on the near side
       of the screen. So: aim at the control's CENTRE, then walk back along the
       approach until the boundary of its box, and stop a few pixels short of
       that. The head then touches whichever edge it actually arrives at. */
    const x0 = onRight ? lx - 12 : lx + sw + 12, y0 = ly + sh / 2;
    let vx = cxT - x0, vy = cyT - y0;
    const vlen = Math.hypot(vx, vy) || 1;
    vx /= vlen; vy /= vlen;
    let tipX, tipY;
    if (bw > bh * 2.5) {
      /* A wide, short target — a row or a bar. Walking back from its centre
         exits through the TOP edge, because the box is far wider than it is
         tall, which left the head hovering above the row instead of on it.
         For these, come in on the near side at the row's own middle: the arrow
         indicates the whole row from the left, which is what it is for. */
      tipX = onRight ? bx + bw + 5 : bx - 5;
      tipY = cyT;
    } else {
      const hx = bw / 2 + 4, hy = bh / 2 + 4;        // half-box, with a little air
      const tEdge = Math.min(
        Math.abs(vx) > 1e-4 ? hx / Math.abs(vx) : Infinity,
        Math.abs(vy) > 1e-4 ? hy / Math.abs(vy) : Infinity);
      tipX = cxT - vx * tEdge;
      tipY = cyT - vy * tEdge;
    }

    /* One arc, bowed off the straight line so it reads as drawn rather than
       plotted. Long runs get proportionally less bow, or the curve swings out
       across the whole screen on its way to a far control. */
    const dx = tipX - x0, dy = tipY - y0;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(64, Math.max(22, len * (len > 260 ? 0.14 : 0.26)));
    const cx = x0 + dx * 0.5 - (dy / len) * bow;
    const cy = y0 + dy * 0.5 + (dx / len) * bow;
    line.setAttribute('d', `M ${x0} ${y0} Q ${cx} ${cy} ${tipX} ${tipY}`);

    /* the head follows the tangent where the curve actually arrives */
    const ang = Math.atan2(tipY - cy, tipX - cx), L = 11, W = 5.5;
    const ax = tipX - Math.cos(ang) * L, ay = tipY - Math.sin(ang) * L;
    head.setAttribute('points',
      `${tipX},${tipY} ${ax - Math.sin(ang) * W},${ay + Math.cos(ang) * W} ` +
      `${ax + Math.sin(ang) * W},${ay - Math.cos(ang) * W}`);

    /* A ring sitting ON the control the arrow points at. The arrow says where
       to look; this says the thing under it is live. Without it the phone
       still reads as a screenshot with annotations drawn over it — which is
       exactly what the five mockups above it are. Radius from the box's short
       side, so a round icon button gets a circle and the category row a pill. */
    ring.style.left = bx + 'px';
    ring.style.top = by + 'px';
    ring.style.width = bw + 'px';
    ring.style.height = bh + 'px';
    ring.style.borderRadius = Math.min(bw, bh) / 2 + 'px';

    ui.classList.add('on');
  }

  function go(n) {
    i = n;
    if (i >= STEPS.length) { finish(); return; }
    /* A numbered badge beside the arrow. This is the convention for annotated
       product shots — a number paired with an arrow to its target — and it also
       tells the visitor how far through they are. */
    num.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(STEPS.length).padStart(2, '0');
    txt.textContent = STEPS[i].say;
    sub.textContent = STEPS[i].sub || '';
    place();
  }

  function finish() {
    done = true;
    ui.classList.add('done');
    num.textContent = '';
    txt.textContent = 'That is the whole thing.';
    sub.textContent = 'Carry on — everything here works.';
    setTimeout(() => ui.classList.remove('on'), 3400);
    stop();
  }

  /* Advance only on the real action. Any other click belongs to the visitor.

     A step may point at one thing and accept another: `on` is what counts as
     having done it, `sel` is only what the arrow aims at. The category row uses
     that — the arrow indicates the row, and any chip inside it completes the
     step. When there is no `on`, the click has to land on the very element the
     arrow is pointing at. */
  function onClick(ev) {
    if (done || i < 0) return;
    const s = STEPS[i];
    const accept = s.on || s.sel;
    const hit = ev.target && ev.target.closest && ev.target.closest(accept);
    if (!hit) return;
    if (!s.on) {
      const el = target();
      if (el && hit !== el && !el.contains(hit)) return;
    }
    setTimeout(() => go(i + 1), 260);          // let the app react first
  }

  function attach() {
    const d = frameDoc();
    if (!d || d === doc) return;
    doc = d;
    d.addEventListener('click', onClick, true);
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    attach();                                   // the app re-renders and re-routes
    if (!done) place();
  }

  const run  = () => { if (!live && !done && WIDE.matches) { live = true; go(0); loop(); } };
  const stop = () => { live = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } };

  skip.addEventListener('click', () => { done = true; ui.classList.remove('on'); stop(); });

  /* The arrows wait for the phone to have actually become the flat, touchable
     one. Being on screen is not enough: for most of the approach the thing you
     are looking at is still the 3D phone, and an arrow pointing into a
     CanvasTexture is pointing at a picture of a button.

     `scene.js` drives the DOM phone's opacity from 0 to 1 across the handover,
     so that opacity IS the signal. When WebGL never ran — reduced motion, no
     context — there is no handover and the phone is simply there, so the check
     passes immediately. */
  const handedOver = () =>
    !document.body.classList.contains('webgl') ||
    parseFloat(getComputedStyle(DEVICE).opacity || '1') > 0.98;

  let waiting = 0;
  function whenReady() {
    if (done) return;
    if (handedOver()) { waiting = 0; run(); return; }
    waiting = requestAnimationFrame(whenReady);   // cheap: one read per frame
  }
  function hold() {
    if (waiting) { cancelAnimationFrame(waiting); waiting = 0; }
    stop();
  }

  /* Watch the DEVICE, not the section: the section is nearly two screens tall
     now that it is pinned, so a fraction-of-the-section threshold can never be
     met and the guide would never start at all. */
  let seen = false;
  new IntersectionObserver(([e]) => { seen = e.isIntersecting; seen ? whenReady() : hold(); },
    { threshold: 0.5 }).observe(DEVICE);

  WIDE.addEventListener('change', () => {
    if (WIDE.matches) { if (seen) whenReady(); }
    else { hold(); ui.classList.remove('on'); }
  });
}
