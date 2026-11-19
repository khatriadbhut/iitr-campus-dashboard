/* ============================================================
   CAMPUS DASHBOARD — the phone screen, animated

   Every frame drawn here comes from a real capture of src/ running.
   Nothing is redrawn or imitated:

     feed    a full-height capture of the scrollable list, panned —
             so this is literally the real feed scrolling
     cal     four captures of the calendar with different days
             chosen, crossfaded — the real date selection
     clubs   four captures of the preferences list as clubs are
             actually unchecked (they strike through and reorder)
     alerts  the reminder hub with a reminder switched off

   The output is a plain <canvas>, so the same player can paint a
   DOM phone or be handed to three.js as a CanvasTexture.
   ============================================================ */
export const SHOTS = {
  feedBody:  'assets/img/app-feed-body.webp',      // the scrolling list, chrome removed
  alertsBody:'assets/img/app-alerts-body.webp',
  chromeTop: 'assets/img/app-chrome-top.webp',     // sticky header, drawn over the scroll
  chromeNav: 'assets/img/app-chrome-nav.webp',     // fixed bottom bar, drawn under it
  cal:      ['assets/img/app-cal-13.webp','assets/img/app-cal-15.webp','assets/img/app-cal-18.webp','assets/img/app-cal-22.webp'],
  clubs:    ['assets/img/app-clubs-0.webp?v=2','assets/img/app-clubs-1.webp?v=2','assets/img/app-clubs-2.webp?v=2','assets/img/app-clubs-3.webp?v=2'],
  alerts:   ['assets/img/app-alerts-0.webp','assets/img/app-alerts-1.webp'],
};

const load = src => new Promise(res => {
  const i = new Image();
  i.decoding = 'async';
  i.onload = () => res(i);
  i.onerror = () => res(null);
  i.src = src;
});

let cache = null;
export async function loadShots() {
  if (cache) return cache;
  const [feedBody, alertsBody, chromeTop, chromeNav, cal, clubs, alerts] = await Promise.all([
    load(SHOTS.feedBody), load(SHOTS.alertsBody),
    load(SHOTS.chromeTop), load(SHOTS.chromeNav),
    Promise.all(SHOTS.cal.map(load)),
    Promise.all(SHOTS.clubs.map(load)),
    Promise.all(SHOTS.alerts.map(load))
  ]);
  cache = { feedBody, alertsBody, chromeTop, chromeNav,
            cal: cal.filter(Boolean), clubs: clubs.filter(Boolean), alerts: alerts.filter(Boolean) };
  return cache;
}

const easeIO = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/* Playback rate for everything happening ON the screen: the feed's pan, and
   the dwell/crossfade of the cycling states. 0.8 = 20% slower. The phone's
   travel is not set here — that is scroll-driven, and lives in the section
   heights in main.css. 0.8 slowed the whole page down together; this is the
   on-screen half nudged back up on its own, so the phone still travels and
   turns at the slower rate while what plays on it moves at a normal pace. */
const SPEED = 1.45;

/* The GLB's display aperture is very nearly a 1:1 map of the app's screen — it
   just sits a touch low. Measured against the embedded app with each phone
   properly isolated: scale is right to within about a percent, and the content
   sits 39px low. Correcting for that lands header and cards within 3px.
   (An earlier 7% "correction" here was an artefact of a broken measurement —
   the rAF loop rewrites inline opacity every frame, wiping the !important used
   to hide one of the two phones, so both were still on screen.) */
const REG_SCALE = 0;
const REG_SHIFT = -0.0617;      // × canvas height

export class ScreenPlayer {
  /* topInset leaves a strip of the app's own header colour at the top so the
     phone model's dynamic island sits over chrome rather than over the title. */
  constructor(shots, w = 560, h = 1215, topInset = 0) {
    this.shots = shots;
    this.topInset = topInset;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.mode = 'feed';
    this.t = 0;            // seconds inside the current mode
    this.settle = 0;       // 1 = parked at the top of the list, for the handover
    this.register = 0;     // 0-1, dials in the DOM-registration correction
    this.fade = 0;         // crossfade progress between two states
    this.idx = 0;
    this.dirty = true;
    this.ctx.fillStyle = '#f9f4f8';
    this.ctx.fillRect(0, 0, w, h);
  }

  setMode(m) {
    if (m === this.mode) return;
    this.mode = m; this.t = 0; this.idx = 0; this.dirty = true;
    /* Invalidate the change signature.

       This is what used to leave the 3D phone showing the previous section's
       screen. `sig` described the state *within* a mode ('c' + index + blend +
       register) but never the mode itself, so cal -> clubs and clubs -> alerts
       both restarted at index 0 with blend 0 and produced a byte-identical
       signature. tick() then reported changed === false, the caller skipped
       `needsUpdate`, and the GPU kept the old picture until the cycle happened
       to advance — which is why it only stuck on two of the four crossings,
       and only when you scrolled through faster than the dwell.

       Clearing it here guarantees the first tick after any mode change reports
       a change and uploads. The mode is also folded into the signature below,
       so the two cannot collide again. */
    this.sig = null;
  }

  /* cover-draw an image at a vertical offset, like object-fit: cover */
  _draw(img, offsetY = 0, alpha = 1) {
    if (!img) return;
    const { ctx, canvas } = this;
    const scale = canvas.width / img.width;
    const h = img.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.topInset, canvas.width, canvas.height - this.topInset);
    ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, 0, this.topInset - offsetY, canvas.width, h);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* Hold each state, then crossfade to the next. Returns nothing; paints. */
  _cycle(list, hold = 1.7, xf = 0.45) {
    if (!list || !list.length) return;
    hold /= SPEED; xf /= SPEED;
    const span = hold + xf;
    const total = this.t % (span * list.length);
    const i = Math.floor(total / span);
    const within = total - i * span;
    const a = list[i % list.length];
    this._draw(a, 0, 1);
    let blend = 0;
    if (within > hold) {
      const b = list[(i + 1) % list.length];
      blend = easeIO((within - hold) / xf);
      this._draw(b, 0, blend);
    }
    this.dirty = true;
    this.sig = this.mode + '|c' + i + ':' + Math.round(blend * 60) + ':' + Math.round(this.register * 100);
  }

  /* Scroll the list the way the app actually scrolls.

     The first version panned a full-page capture, which baked the sticky
     header and the FIXED bottom nav into the scrolling image — the nav slid
     up through the middle of the screen. Here the body is captured with the
     chrome hidden, then the header is painted over the top of the scroll and
     the nav under the bottom, so both stay put. */
  _scrollList(body, hold = 1.1) {
    const { ctx, canvas, shots } = this;
    if (!body) return;
    const top = shots.chromeTop, nav = shots.chromeNav;
    const navH  = nav ? nav.height : 0;
    const bandTop = this.topInset;
    const bandBot = canvas.height - navH;
    const bandH = bandBot - bandTop;
    const full = body.height * (canvas.width / body.width);
    const travel = Math.max(0, full - bandH);

    const speed = 52 * SPEED, back = 1.0 / SPEED;
    hold /= SPEED;
    const down = travel / speed;
    const loop = down + hold + back + hold;
    const t = this.t % loop;
    let y;
    if (t < down)                    y = easeIO(t / down) * travel;
    else if (t < down + hold)        y = travel;
    else if (t < down + hold + back) y = travel * (1 - easeIO((t - down - hold) / back));
    else                             y = 0;

    /* `settle` (0-1) eases the list back to the top. The 3D phone uses it on
       its way into the explore section so that, at the moment it dissolves
       into the real embedded app, both are showing the same first screen. */
    y *= 1 - this.settle;
    this.sig = this.mode + '|f' + Math.round(y) + ':' + Math.round(this.register * 100);

    /* The registration nudge lifts the body, so the clip has to grow by the
       same amount or a strip of bare paper shows through above the nav. */
    const lift = Math.abs(REG_SHIFT) * canvas.height * this.register;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, bandTop, canvas.width, bandH + lift); ctx.clip();
    ctx.drawImage(body, 0, bandTop - y, canvas.width, full);
    ctx.restore();

    if (top) ctx.drawImage(top, 0, bandTop, canvas.width, top.height);

    /* The nav is anchored to the bottom of the app's screen, and the bottom of
       the GLB's aperture is already where that lands — so it is the one thing
       the registration nudge must NOT move, or it ends up 40px high. */
    if (nav) {
      const t = ctx.getTransform();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(nav, 0, bandBot, canvas.width, navH);
      ctx.setTransform(t);
    }
    this.dirty = true;
  }

  tick(dt) {
    this.t += dt;
    const { ctx, canvas, shots } = this;
    const wasSig = this.sig;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f9f4f8';                 // the app's own paper
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    /* The GLB's display aperture is not a clean map of the app's screen: it
       renders the UI about 7% short and about 7% of a screen too low. Aligning
       the header alone still left the bottom nav 40px out, so this is a proper
       two-point fit rather than a shift. `register` dials it in for the
       handover, where the 3D screen has to match the embedded app exactly. */
    if (this.register) {
      const r = this.register;
      ctx.setTransform(1, 0, 0, 1 + r * REG_SCALE, 0, r * REG_SHIFT * canvas.height);
    }
    switch (this.mode) {
      case 'cal':    this._cycle(shots.cal, 1.9, 0.5); break;
      case 'clubs':  this._cycle(shots.clubs, 1.5, 0.4); break;
      case 'alerts': this._cycle(shots.alerts, 2.2, 0.55); break;
      default:       this._scrollList(shots.feedBody); break;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    /* The bottom nav, on the crossfading screens too.
       `_draw` cover-fits each capture from `topInset` down, so a
       full-height screenshot ends up 62px lower than the canvas and its
       own bottom bar — which IS in the capture — falls off the end. The
       feed path never had this problem because it composites the nav
       separately. Painting it here puts Feed / Calendar / Personal /
       Profile back on the calendar, the club preferences and the
       reminder hub, where the real app has them at all times.
       Un-transformed on purpose: the nav is anchored to the bottom of
       the aperture, which is the one thing the registration nudge must
       not move. */
    if (this.mode !== 'feed' && shots.chromeNav) {
      const nav = shots.chromeNav;
      ctx.drawImage(nav, 0, canvas.height - nav.height, canvas.width, nav.height);
    }

    /* Both the scrolling feed and the crossfading states spend a good part of
       each loop holding perfectly still. Reporting that lets the callers skip
       a texture upload and a scene redraw instead of pushing identical pixels. */
    this.changed = this.sig !== wasSig;
  }
}
