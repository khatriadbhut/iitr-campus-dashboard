/* ============================================================
   CAMPUS DASHBOARD — the 3D phone

   Back, with the motion you liked: it crosses from one side to the
   other as the layout alternates, turning as it goes. The turn is
   not decoration — it masks the crossing and it hands you the next
   screen face-on.

   The difference from before: the display is no longer a still
   image. It is a live CanvasTexture fed by the same ScreenPlayer
   that paints the DOM phones, so the feed genuinely scrolls, the
   calendar genuinely changes day, and clubs genuinely toggle —
   on the 3D screen, while it moves.

   Desktop only. A fixed object cannot follow a stacked mobile
   layout, so narrow screens use the DOM phones instead.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader }      from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader }     from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadShots, ScreenPlayer } from './screen.js?v=5';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Live, not a snapshot. Reading .matches once meant a window resized across the
   breakpoint kept whatever mode it happened to load in: the CSS reflowed but
   the 3D phone carried on running over a stacked mobile layout, and the phone
   never appeared for anyone who started narrow and widened. */
const WIDE    = matchMedia('(min-width: 901px)');
const canvas  = document.getElementById('stage');

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

let started = false, live = null;          // live = the running scene's controls

function applyMode() {
  const on = WIDE.matches && canvas && webglOK() && !REDUCED;
  if (on) {
    document.body.classList.add('webgl');
    if (!started) {
      started = true;
      boot().then(api => { live = api; })
            .catch(e => { console.warn('[scene]', e); document.body.classList.remove('webgl'); });
    } else if (live) live.resume();
  } else {
    document.body.classList.remove('webgl');
    if (live) live.pause();
  }
}
applyMode();
WIDE.addEventListener('change', applyMode);

async function boot() {
  /* Capped below 2: on a Retina display a full-DPR buffer quadruples the
     fragment work for a phone-sized object, and 1.75 is indistinguishable. */
  const dpr = Math.min(devicePixelRatio || 1, 1.75);
  const shots = await loadShots();
  const player = new ScreenPlayer(shots, 560, 1215, 62);   // clear of the model's island
  player.tick(0.001);

  const screenTex = new THREE.CanvasTexture(player.canvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.flipY = true;                 // this model's display UVs run bottom-up
  screenTex.anisotropy = 4;

  const draco = new DRACOLoader();
  draco.setDecoderPath('/assets/vendor/three/draco/');   // self-hosted: no third-party CDN in the render path
  const gl = new GLTFLoader();
  gl.setDRACOLoader(draco);
  const gltf = await gl.loadAsync('assets/model/scene.glb');
  draco.dispose();

  const src = gltf.scene;
  const box = new THREE.Box3().setFromObject(src);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const fit = 5.2 / Math.max(size.x, size.y, size.z);

  /* the display is found by geometry — every mesh in this Sketchfab
     model is named with a random hash */
  const NAME = 'xXDHkMplTIDAXLN';
  let screenMesh = null, facesPosZ = false, best = -Infinity;
  src.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const bb = new THREE.Box3().setFromObject(o);
    const s = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    const d = [s.x, s.y, s.z], thin = Math.min(...d);
    const face = d.filter(v => v !== thin).sort((m, n) => n - m);
    const flat = thin <= face[1] * 0.02;
    const emis = o.material?.emissive && o.material.emissive.getHex() > 0x111111;
    const score = (o.name === NAME ? 1e6 : 0) + (flat ? 1e3 : 0) + (emis ? 1e3 : 0) + face[0] * face[1] * 100;
    if (score > best) { best = score; screenMesh = o; facesPosZ = c.z > 0; }
  });
  const FACE = facesPosZ ? 0 : Math.PI;

  src.traverse(o => {
    if (o.isMesh && o === screenMesh) {
      o.material = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
      o.renderOrder = 1;
    }
  });
  const applyFit = k => {
    src.scale.setScalar(k);
    src.position.set(-centre.x * k, -centre.y * k, -centre.z * k);
  };
  applyFit(fit);
  const phone = new THREE.Group();
  phone.add(src);
  phone.rotation.y = FACE;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;

  const scene = new THREE.Scene();
  scene.add(phone);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 14);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.add(new THREE.AmbientLight(0xffffff, 1.45));
  const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(4, 7, 6); scene.add(key);
  const fill = new THREE.DirectionalLight(0xf6f2ea, 1.05); fill.position.set(-6, -2, 4); scene.add(fill);

  /* ── where it parks ──────────────────────
     Measured from the DOM column it stands in for, so it tracks the
     alternating layout at any width. ── */
  const heroShot = document.querySelector('.hero .shot');
  const feats = Array.from(document.querySelectorAll('.duo:not(.hero)'));   // includes .explore
  const MODES = ['feed', 'cal', 'clubs', 'alerts', 'feed'];
  const exploreSec = document.querySelector('.duo.explore');
  const exploreDevice = exploreSec && exploreSec.querySelector('.device');

  function worldX(el) {
    if (!el) return 3;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const visW = 2 * camera.position.z * Math.tan((camera.fov * Math.PI / 180) / 2) * camera.aspect;
    return ((cx / innerWidth) * 2 - 1) * (visW / 2);
  }
  function featurePos() {
    if (!feats.length) return 0;
    const mid = scrollY + innerHeight / 2;
    const c = feats.map(f => f.offsetTop + f.offsetHeight / 2);
    if (mid <= c[0]) return 0;
    for (let i = 0; i < c.length - 1; i++) if (mid <= c[i + 1]) return i + (mid - c[i]) / (c[i + 1] - c[i]);
    return c.length - 1;
  }

  const TURN = 0.82;                       // ~47°: masks the crossing, still readable
  let mx = 0, my = 0, cmx = 0, cmy = 0;
  addEventListener('mousemove', e => {
    mx = (e.clientX / innerWidth) * 2 - 1;
    my = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  let curX = worldX(heroShot), curY = 0, curTurn = 0, raf = null, last = performance.now();

  const visH = () => 2 * camera.position.z * Math.tan((camera.fov * Math.PI / 180) / 2);

  /* Where an element's centre falls, in world units. Rotation about Y doesn't
     change vertical extent, so these stay valid whatever the phone is doing. */
  function worldY(el) {
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    return -(((cy / innerHeight) * 2 - 1) * (visH() / 2));
  }

  /* Where the phone actually lands on screen.
     Flat world-unit maths would do if the model were a plane at z = 0, but it
     has depth, and perspective makes the near face render larger — enough to
     leave the two phones visibly out of register at the swap. So project the
     real bounding box through the camera and measure it. */
  const _v = new THREE.Vector3();
  function projBox() {
    /* project() reads camera.matrixWorldInverse, which the renderer only
       refreshes during render(). Called before the first frame it returns
       nonsense — which is how boot-time sizing was scaling the phone into
       oblivion for every section except the one the feedback loop repaired. */
    camera.updateMatrixWorld(true);
    phone.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(phone);
    let top = Infinity, bot = -Infinity;
    for (const x of [b.min.x, b.max.x])
      for (const y of [b.min.y, b.max.y])
        for (const z of [b.min.z, b.max.z]) {
          const py = (1 - _v.set(x, y, z).project(camera).y) / 2 * innerHeight;
          if (py < top) top = py;
          if (py > bot) bot = py;
        }
    return { h: bot - top, mid: (top + bot) / 2 };
  }

  /* Size the model to the exact pixel height of the DOM phone it becomes.
     Measured, not derived: the GLB's bounding box is not the visible body. */
  let k = fit, sized = false;
  function matchDomSize() {
    const ref = exploreDevice || document.querySelector('.duo .device');
    if (!ref) return;
    const domH = ref.getBoundingClientRect().height;
    if (!domH) return;
    for (let i = 0; i < 6; i++) {
      const px = projBox().h;
      if (!px || Math.abs(px - domH) < 0.3) break;
      applyFit(k *= domH / px);
    }
  }

  function resize() {
    const w = innerWidth, h = innerHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      matchDomSize();
    }
  }
  matchDomSize();
  resize();
  addEventListener('resize', () => { resize(); matchDomSize(); }, { passive: true });

  /* The handover.
     The 3D phone travels right one last time into the explore column, and as
     it settles there the real interactive phone cross-fades up underneath it
     in exactly the same place at exactly the same size — so the object you
     have been following becomes the one you can use. */
  if (exploreDevice) exploreDevice.style.opacity = '0';
  const clamp01 = v => Math.max(0, Math.min(1, v));

  /* The arrival, measured off the real phone rather than off section
     progress. Section progress starts moving while the explore phone is still
     a screen and a half below the fold, and anything keyed to it drags the 3D
     phone off the bottom of the window long before the handover should begin.

     `rel` is how far the real phone still is from where it comes to rest.

     The phone does not perform an arrival. It crosses and parks exactly the
     way it parks in every other section, comes to rest, sits there — and only
     then flips to the real app. Earlier versions choreographed the last leg
     (damping the turn, riding 150px down onto the still-moving DOM phone) and
     every one of those extra movements read as a snap right at the end.

     What is left is deliberately small:
       park    420 -> 100  the on-screen feed eases back to the top, so the
                           frozen screen matches what the real app will show
       line    100 ->  55  nudges the screen into exact register with the real
                           app. Held back until the last moment on purpose: the
                           GLB's aperture sits lower than the DOM phone's, so
                           this correction tucks the app header under the
                           model's notch, and that should not be on show for
                           the whole time the phone is resting
       settle  110 ->   0  kills the resting tilt and pointer parallax, and
                           closes the last ~25px onto the real phone
       fade     55 ->   0  a quick flip, once it is already sitting still */
  const smooth = t => t * t * (3 - 2 * t);
  function approach() {
    if (!exploreDevice) return { park: 0, line: 0, settle: 0, fade: 0 };
    const r = exploreDevice.getBoundingClientRect();
    const rel = (r.top + r.height / 2) - innerHeight / 2;
    if (rel <= 0) return { park: 1, line: 1, settle: 1, fade: 1 };
    return {
      park:   smooth(clamp01((420 - rel) / 320)),
      line:   smooth(clamp01((100 - rel) / 45)),
      /* square and still by rel 30, well before the flip */
      settle: smooth(clamp01((140 - rel) / 110)),
      /* The flip happens AT the parked position, not on the way to it.
         rel is how far the real phone still is from resting; it is zero at the
         exact moment the DOM phone's centre reaches the centre of the window —
         which is where the 3D phone has been sitting all along. So run the
         crossfade over the last few pixels and finish it at rel 0, where the
         two are coincident. A wider window would fade while they are still
         apart, and the phone would appear to sink onto the flat one. */
      fade:         clamp01((14 - rel) / 14)
    };
  }

  /* Cost control. Left to itself this loop re-uploaded a 560x1215 texture and
     redrew the scene 60 times a second for as long as the tab was open, which
     is a lot of CPU for a phone that is usually sitting still.
       · nothing at all while the tab is in the background
       · the screen animation repaints at 20fps, not 60 — the feed creeps at
         52px/s, so the extra frames were buying nothing
       · the scene is only redrawn when something actually moved */
  const SCREEN_FPS = 20;
  let lastPaint = -1, pX = NaN, pY = NaN, pTurn = NaN, pMx = NaN, pMy = NaN;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    resize();

    const { park, line, settle, fade } = approach();
    canvas.classList.toggle('handing', fade > 0);
    canvas.style.opacity = String(1 - fade);
    if (exploreDevice) {
      exploreDevice.style.opacity = String(fade);
      exploreDevice.style.pointerEvents = fade > 0.9 ? 'auto' : 'none';
    }
    if (fade >= 1) return;                  // fully handed over; stop drawing

    const f = featurePos();
    const i = Math.floor(f), frac = f - i;
    const facing = frac < 0.5 ? i : Math.min(i + 1, feats.length - 1);

    /* The screen shows whatever the section it is facing is about. The swap
       happens at frac 0.5 — the instant the turn has the phone edge-on, so the
       change is masked by the crossing rather than seen as a cut.

       That only holds if the new screen is uploaded on the same frame. The
       repaint is otherwise throttled to SCREEN_FPS, which can hold the old
       picture for up to another 50ms — long enough, on a fast scroll, to bring
       the previous section's screen back round into view. So a mode change
       forces the throttle open for one frame. */
    const wantMode = MODES[Math.min(facing, MODES.length - 1)];
    if (wantMode !== player.mode) lastPaint = -Infinity;
    player.setMode(wantMode);
    player.settle = park;               // ease the feed back to the top
    player.register = line;             // line the screen up with the real app
    let painted = false;
    if (now - lastPaint >= 1000 / SCREEN_FPS) {
      player.tick(Math.min(0.08, (now - Math.max(lastPaint, now - 100)) / 1000));
      lastPaint = now;
      if (player.changed) { screenTex.needsUpdate = true; painted = true; }
    }

    /* The last leg is the one that hands over, and it needs to behave a little
       differently from the others.

       Everywhere else the phone parks in a column and the X target *steps* at
       the midpoint — the phone effectively teleports across, and the turn is
       what hides it. That is fine while the turn is at full strength. On the
       last leg the turn has to be gone before the dissolve, so damping it
       exposed the teleport and the whole arrival read as a snap.

       So on the last leg: glide X with the scroll instead of stepping, and
       finish the turn's own sine early (at 85% of the crossing) rather than
       multiplying it down. Same shape, same rate as every other crossing —
       it just lands square a little sooner. */
    const lastLeg = i === feats.length - 2;
    const beforeFeatures = scrollY + innerHeight / 2 < (feats[0]?.offsetTop ?? Infinity);

    const turnFrac = lastLeg ? Math.min(1, frac / 0.85) : frac;
    const turn = Math.sin(turnFrac * Math.PI) * TURN * (i % 2 === 0 ? 1 : -1);

    let targetX;
    if (beforeFeatures) {
      targetX = worldX(heroShot);
    } else if (lastLeg) {
      const xa = worldX(feats[i].querySelector('.shot'));
      const xb = worldX(feats[i + 1].querySelector('.shot'));
      targetX = xa + (xb - xa) * smooth(clamp01((frac - 0.25) / 0.5));
    } else {
      targetX = worldX(feats[facing].querySelector('.shot'));
    }

    /* The phone does not move to meet the flat one. It parks at the centre of
       the window and stays there; the DOM phone scrolls up to it, and the flip
       happens at the instant they coincide. Riding down onto a still-moving
       target is what made the phone visibly sink just before the handover. */
    const wantY = 0;

    curTurn += (turn - curTurn) * 0.14;
    curX += (targetX - curX) * (0.14 + 0.82 * settle);
    cmx += (mx - cmx) * 0.06;
    cmy += (my - cmy) * 0.06;

    /* Tighten the chase as the lock closes — a lerp that still lags by a few
       pixels at the dissolve is exactly what makes it read as two objects. */
    curY += (wantY - curY) * (0.18 + 0.78 * settle);
    phone.position.x = curX;
    phone.position.y = curY;

    /* Close the last few pixels by measurement rather than by trusting the
       maths: compare where the phone actually projects against where the real
       one sits, and correct. A closed loop settles in a handful of frames and
       stays right at any viewport. */
    /* Size still gets corrected by measurement, but NOT position: chasing the
       DOM phone's centre pulled the 3D one downward as the page scrolled, which
       is exactly the sink we are removing. The two line up on their own,
       because the flip is timed for the moment they do. */
    if (settle > 0.8 && exploreDevice) {        // only once it is really there
      phone.updateMatrixWorld(true);
      const pb = projBox();
      const dr = exploreDevice.getBoundingClientRect();
      if (Math.abs(pb.h - dr.height) > 1) matchDomSize();
    }
    /* The turn lands square on its own compressed sine — multiplying it down
       as well was what made the last leg snap. This only takes out the resting
       tilt and the pointer parallax, which the real phone has neither of. */
    const sq = 1 - settle;
    phone.rotation.y = FACE + curTurn + cmx * 0.14 * sq;
    phone.rotation.x = (-0.03 + cmy * 0.08) * sq;

    /* Redraw only if the screen repainted or the phone actually moved. With
       the page still and the feed parked this settles to zero draw calls. */
    const moved = painted
      || Math.abs(phone.position.x - pX) > 1e-4
      || Math.abs(phone.position.y - pY) > 1e-4
      || Math.abs(phone.rotation.y - pTurn) > 1e-4
      || Math.abs(cmx - pMx) > 1e-4 || Math.abs(cmy - pMy) > 1e-4;
    if (!moved) return;
    pX = phone.position.x; pY = phone.position.y; pTurn = phone.rotation.y;
    pMx = cmx; pMy = cmy;

    renderer.render(scene, camera);
    if (!sized) { sized = true; matchDomSize(); }
    canvas.classList.add('lit');
  }
  frame(performance.now());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
    else if (!raf) { last = performance.now(); frame(last); }
  });

  /* Handed back so the breakpoint can stop and restart the scene without
     tearing down the WebGL context and reloading the model. */
  return {
    pause() {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      canvas.classList.remove('lit');
      canvas.style.opacity = '0';
    },
    resume() {
      resize();
      matchDomSize();                 // the column it parks against has moved
      if (!raf) { last = performance.now(); frame(last); }
    },
  };
}
