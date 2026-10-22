/*
 * Camera controls.
 *  Orbit mode (Blockbench-like): left-drag rotate, right/middle/shift-drag pan, wheel zoom, WASD/QE move view.
 *  Fly mode: pointer-lock mouse look, WASD + Space/Shift, wheel = speed.
 */
class ViewControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;

    this.target = new THREE.Vector3(0, 0, 0);
    this.yaw = -0.7;
    this.pitch = 0.5;
    this.dist = 30;
    this.pos = new THREE.Vector3();   // used in fly mode
    this.fly = false;
    this.flySpeed = 12;
    this.keys = Object.create(null);

    this.onFlyChange = () => {};
    this.onPick = () => {};     // (button, event, fromCenter)
    this.onHover = () => {};    // (event | null, fromCenter)
    this.onInteract = () => {}; // (event, fromCenter) – Rechtsklick auf Tür/Falltür
    this.onWalkChange = () => {};
    this.onSpeedChange = () => {};

    // Gehmodus (Schwerkraft)
    this.walk = false;
    this.vy = 0; this.vx = 0; this.vz = 0;
    this.onGround = false;
    this.walkSpeed = 4.317;     // Blöcke/s wie in Minecraft
    this.collides = null;       // (min[3], max[3]) => boolean, wird von main.js gesetzt
    this._lastSpace = 0;
    this.measureMode = false;
    this.sensitivity = 0.005;   // rad pro Pixel im Orbit-Modus
    this._drag = null;
    this._bind();
    this.update(0);
  }

  /* ---------- helpers ---------- */
  forwardVec() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, -Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  focus(center, size) {
    this.target.copy(center);
    this.dist = Math.max(4, size * 1.7);
    this.yaw = -0.7;
    this.pitch = 0.5;
    if (this.fly) this.setFly(false);
    this.update(0);
  }

  setFly(on) {
    if (on === this.fly) return;
    if (on) {
      this.pos.copy(this.camera.position);
      this.fly = true;
      this.dom.requestPointerLock && this.dom.requestPointerLock();
    } else {
      this.target.copy(this.pos).addScaledVector(this.forwardVec(), this.dist);
      this.fly = false;
      if (this.walk) { this.walk = false; this._cur = null; this.onWalkChange(false); }
      if (document.pointerLockElement === this.dom) document.exitPointerLock();
    }
    this.onFlyChange(this.fly);
  }

  setWalk(on) {
    if (!this.fly || on === this.walk) return;
    this.walk = on;
    this.vy = 0; this.vx = 0; this.vz = 0;
    this.onGround = false;
    this._cur = null;
    this.onWalkChange(on);
  }

  /** Tippen (nur Touch): Messmodus: 1× = Punkt A, 2× schnell = Punkt B; Flugmodus (ohne Messmodus): benutzen. */
  _tap(e) {
    const fromCenter = this.fly;
    const pos = { clientX: e.clientX, clientY: e.clientY };
    if (this.measureMode) {
      const now = performance.now(), L = this._lastTap;
      if (L && now - L.t < 280 && Math.hypot(L.x - e.clientX, L.y - e.clientY) < 40) {
        clearTimeout(this._tapTimer);
        this._lastTap = null;
        this.onPick(2, pos, fromCenter);                  // Doppeltippen = Punkt B
      } else {
        this._lastTap = { t: now, x: e.clientX, y: e.clientY };
        clearTimeout(this._tapTimer);
        // Einfachtippen = Punkt A (kurz warten, ob noch ein zweites Tippen folgt)
        this._tapTimer = setTimeout(() => { this._lastTap = null; this.onPick(0, pos, fromCenter); }, 300);
      }
    } else if (this.fly) {
      this.onInteract(pos, true);
    }
  }

  /* ---------- events ---------- */
  _bind() {
    const d = this.dom;

    d.addEventListener('contextmenu', e => e.preventDefault());

    // ---------- Touch (iPad): 1 Finger drehen, 2 Finger zoomen + verschieben, Tippen / Doppeltippen ----------
    this._touches = new Map();
    this._gest = null;
    this._tapBad = false;
    this._tapTimer = null;
    this._lastTap = null;
    const pair = () => {
      const [p, q] = [...this._touches.values()];
      return { dist: Math.hypot(p.x - q.x, p.y - q.y), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 };
    };
    const newDrag = (x, y, moved) => ({ pan: false, button: 0, x, y, sx: x, sy: y, moved, t: performance.now(), touch: true });

    d.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') {
        e.preventDefault();
        if (d.setPointerCapture) d.setPointerCapture(e.pointerId);
        this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this._touches.size === 1) {
          this._tapBad = false;
          this._drag = newDrag(e.clientX, e.clientY, false);
        } else if (this._touches.size === 2) {
          this._tapBad = true;
          this._drag = null;
          this._gest = pair();
        }
        return;
      }

      if (this.fly) {
        if (document.pointerLockElement !== d) { d.requestPointerLock && d.requestPointerLock(); return; }
        if (e.altKey || this.measureMode) { e.preventDefault(); this.onPick(e.button, e, true); }
        else if (e.button === 2) this.onInteract(e, true);   // Rechtsklick = benutzen (Tür, Falltür ...)
        return;
      }
      if (e.altKey) { e.preventDefault(); this.onPick(e.button, e, false); return; } // Alt+Klick: sofort messen
      d.setPointerCapture(e.pointerId);
      const pan = e.button === 2 || e.button === 1 || e.shiftKey;
      this._drag = { pan, button: e.button, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
      document.body.classList.add('dragging');
    });

    d.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') {
        if (!this._touches.has(e.pointerId)) return;
        this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this._touches.size === 2 && this._gest) {
          const g = pair(), o = this._gest;
          if (this.fly) {
            // Flugmodus: Pinch = vor / zurück
            if (!this.walk) this.pos.addScaledVector(this.forwardVec(), (g.dist - o.dist) * this.flySpeed * 0.01);
          } else {
            this.dist = THREE.MathUtils.clamp(this.dist * o.dist / Math.max(1, g.dist), 0.5, 5000); // Pinch = Zoom
            this._pan(g.mx - o.mx, g.my - o.my);                                                    // 2 Finger schieben = verschieben
          }
          this._gest = g;
        } else if (this._touches.size === 1 && this._drag) {
          const dr = this._drag;
          if (Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) > 8) dr.moved = true;
          const dx = e.clientX - dr.x, dy = e.clientY - dr.y;
          dr.x = e.clientX; dr.y = e.clientY;
          this._rotate(dx, dy);                                                                      // 1 Finger = drehen / umsehen
        }
        return;
      }

      if (this.fly) return; // handled by 'mousemove' under pointer lock
      if (!this._drag) {
        this.onHover(e.altKey || this.measureMode ? e : null, false);
        return;
      }
      if (Math.hypot(e.clientX - this._drag.sx, e.clientY - this._drag.sy) > 4) this._drag.moved = true;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX; this._drag.y = e.clientY;
      if (this._drag.pan) this._pan(dx, dy);
      else this._rotate(dx, dy);
    });

    const end = e => {
      if (e.pointerType === 'touch') {
        const had = this._touches.delete(e.pointerId);
        if (d.hasPointerCapture && d.hasPointerCapture(e.pointerId)) d.releasePointerCapture(e.pointerId);
        if (!had) return;
        if (this._touches.size === 0) {
          const dr = this._drag;
          this._drag = null; this._gest = null;
          if (dr && !dr.moved && !this._tapBad && e.type === 'pointerup' && performance.now() - dr.t < 500) this._tap(e);
          this._tapBad = false;
        } else if (this._touches.size === 1) {
          const p = [...this._touches.values()][0];
          this._gest = null;
          this._drag = newDrag(p.x, p.y, true);   // verbleibender Finger dreht weiter, ohne Sprung
        }
        return;
      }

      const drag = this._drag;
      this._drag = null;
      document.body.classList.remove('dragging');
      if (d.hasPointerCapture && d.hasPointerCapture(e.pointerId)) d.releasePointerCapture(e.pointerId);
      // Messmodus: einfacher Klick (ohne Ziehen) setzt A (links) bzw. B (rechts)
      if (drag && !drag.moved && this.measureMode && e.type === 'pointerup' && (drag.button === 0 || drag.button === 2)) {
        this.onPick(drag.button, e, false);
      }
    };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);

    // Safari: Seiten-Zoom per Pinch verhindern
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(ev, e => e.preventDefault());
    }

    document.addEventListener('mousemove', e => {
      if (this.fly && document.pointerLockElement === d) this._rotate(e.movementX, e.movementY);
    });

    document.addEventListener('pointerlockchange', () => {
      if (this.fly && document.pointerLockElement !== d) {
        // user pressed Esc → leave fly mode
        this.setFly(false);
      }
    });

    d.addEventListener('wheel', e => {
      e.preventDefault();
      if (this.fly && this.walk) {
        this.walkSpeed = THREE.MathUtils.clamp(this.walkSpeed * Math.exp(-e.deltaY * 0.001), 1, 40);
        this.onSpeedChange(this.walkSpeed);
      } else if (this.fly) {
        this.flySpeed = THREE.MathUtils.clamp(this.flySpeed * Math.exp(-e.deltaY * 0.001), 1, 400);
      } else {
        this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * 0.0012), 0.5, 5000);
      }
    }, { passive: false });

    // Alt-Menüleiste des Browsers komplett deaktivieren: solange Alt gehalten wird, löst keine Taste
    // mehr Browser-Shortcuts aus (Alt+A, Alt+D, Alt+Pfeil, Alt+Home ...). Capture-Phase = vor dem Browser.
    const killAlt = e => { if (e.altKey || e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault(); };
    window.addEventListener('keydown', killAlt, true);
    window.addEventListener('keypress', killAlt, true);
    window.addEventListener('keyup', killAlt, true);

    window.addEventListener('keydown', e => {
      if (/input|textarea/i.test(e.target.tagName)) return;
      this.keys[e.code] = true;
      // Doppel-Leertaste im Flugmodus: Schwerkraft / Gehen  <->  Fliegen (wie Minecraft Creative)
      if (e.code === 'Space' && !e.repeat && this.fly) {
        const now = performance.now();
        if (now - this._lastSpace < 320) { this.setWalk(!this.walk); this._lastSpace = 0; }
        else this._lastSpace = now;
      }
      if (e.code === 'Space' || e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault(); // kein Menü-Fokus im Browser
    });
    window.addEventListener('blur', () => { this.keys = Object.create(null); });
  }

  _rotate(dx, dy) {
    const k = this.sensitivity * (this.fly ? 0.5 : 1); // Flugmodus ist halb so empfindlich
    this.yaw -= dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * k, -1.55, 1.55);
  }

  _pan(dx, dy) {
    const fwd = this.forwardVec();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const s = this.dist * 0.0016;
    this.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
  }

  /* ---------- Gehmodus: Minecraft-Physik (Java Edition, 20 Ticks/s) ----------
   *  Einheiten: Blöcke pro Tick.
   *  Gehen 0,1 (Sprint 0,13) · Luft-Beschleunigung 0,02 · Reibung Boden 0,6*0,91 = 0,546, Luft 0,91
   *  Schwerkraft: v = (v - 0,08) * 0,98 · Sprung: v = 0,42 · Eingabe 0,98 · Stufenhöhe 0,6
   *  Das Lauftempo-Rad skaliert Boden UND Luft gleich (Sprungweite wächst nur mit dem Tempo mit).
   */
  _walk(dt, f, r, flat, right) {
    const TICK = 0.05;
    if (!this._cur) { this._cur = this.pos.clone(); this._prev = this.pos.clone(); this._acc = 0; this._jumpCd = 0; }
    this._acc += Math.min(dt, 0.25);
    while (this._acc >= TICK) {
      this._acc -= TICK;
      this._prev.copy(this._cur);
      this._walkTick(f, r, flat, right);
    }
    // zwischen den Ticks weich interpolieren (sonst ruckelt es mit 20 Hz)
    this.pos.lerpVectors(this._prev, this._cur, this._acc / TICK);
  }

  _walkTick(f, r, flat, right) {
    const HW = 0.3, H = 1.8, EYE = 1.62, STEP = 0.6;
    const s = this.walkSpeed / 4.317;                       // Tempo-Faktor (1 = Minecraft)
    const sprint = this.keys.ShiftLeft || this.keys.ShiftRight;
    const attr = 0.1 * (sprint ? 1.3 : 1) * s;

    const feet = this._cur.clone(); feet.y -= EYE;
    const blocked = p => p.y < -1e-9 ||
      (this.collides ? this.collides([p.x - HW, p.y, p.z - HW], [p.x + HW, p.y + H, p.z + HW]) : false);

    // steckt im Block (z. B. Ebene wurde eingeblendet) -> hochschieben
    for (let g = 0; blocked(feet) && feet.y >= 0 && g < 80; g++) feet.y += 0.25;
    if (feet.y < 0) feet.y = 0;

    const onGround = this.onGround;

    // Sprung (Halten = alle 10 Ticks wieder)
    if (this._jumpCd > 0) this._jumpCd--;
    if (this.keys.Space && onGround && this._jumpCd === 0) { this.vy = 0.42; this._jumpCd = 10; }

    // Eingabe -> Beschleunigung
    const wish = new THREE.Vector3(flat.x * f * 0.98 + right.x * r * 0.98, 0, flat.z * f * 0.98 + right.z * r * 0.98);
    if (wish.lengthSq() > 1) wish.normalize();
    const acc = onGround ? attr : 0.02 * (sprint ? 1.3 : 1) * s;
    if (wish.lengthSq() > 1e-7) { this.vx += wish.x * acc; this.vz += wish.z * acc; }

    // Bewegung mit Kollision (erst Y, dann X/Z), Aufstieg bis 0,6
    const moveAxis = (p, axis, d) => {
      if (!d) return 0;
      const o = p[axis];
      p[axis] = o + d;
      if (!blocked(p)) return d;
      let lo = 0, hi = 1;
      for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; p[axis] = o + d * mid; if (blocked(p)) hi = mid; else lo = mid; }
      p[axis] = o + d * lo;
      return d * lo;
    };
    const horizontal = (p, dx, dz) => {
      let cx = false, cz = false;
      const order = Math.abs(dx) >= Math.abs(dz) ? ['x', 'z'] : ['z', 'x'];
      for (const ax of order) {
        const want = ax === 'x' ? dx : dz;
        const got = moveAxis(p, ax, want);
        if (Math.abs(got - want) > 1e-9) { if (ax === 'x') cx = true; else cz = true; }
      }
      return { cx, cz };
    };

    const dx = this.vx, dz = this.vz, dy = this.vy;
    const yGot = moveAxis(feet, 'y', dy);
    const collY = Math.abs(yGot - dy) > 1e-9;
    const grounded = collY && dy < 0;
    if (collY) this.vy = 0;

    const before = feet.clone();
    let { cx, cz } = horizontal(feet, dx, dz);

    if ((cx || cz) && (onGround || grounded)) {
      // Stufe versuchen: hoch (max 0,6), horizontal, wieder runter
      const alt = before.clone();
      const up = moveAxis(alt, 'y', STEP);
      const res = horizontal(alt, dx, dz);
      moveAxis(alt, 'y', -up);
      const d0 = (feet.x - before.x) ** 2 + (feet.z - before.z) ** 2;
      const d1 = (alt.x - before.x) ** 2 + (alt.z - before.z) ** 2;
      if (d1 > d0 + 1e-9 && alt.y >= before.y - 1e-6) { feet.copy(alt); cx = res.cx; cz = res.cz; }
    }
    if (cx) this.vx = 0;
    if (cz) this.vz = 0;

    this.onGround = grounded || feet.y <= 0;
    if (feet.y <= 0) { feet.y = 0; if (this.vy < 0) this.vy = 0; }

    // Reibung (vor-Bewegung-Zustand wie in Minecraft) + Schwerkraft
    const fr = onGround ? 0.546 : 0.91;
    this.vx *= fr; this.vz *= fr;
    this.vy = (this.vy - 0.08) * 0.98;

    this._cur.set(feet.x, feet.y + EYE, feet.z);
  }

  /* ---------- per-frame ---------- */
  update(dt) {
    const k = this.keys;
    const fwd = this.forwardVec();
    const flat = new THREE.Vector3(fwd.x, 0, fwd.z);
    if (flat.lengthSq() < 1e-6) flat.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    flat.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

    const f = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    const r = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);

    if (this.fly && this.walk) {
      this._walk(dt, f, r, flat, right);
      this.camera.position.copy(this.pos);
    } else if (this.fly) {
      const u = (k.Space ? 1 : 0) - ((k.ShiftLeft || k.ShiftRight) ? 1 : 0);
      const speed = this.flySpeed * dt; // Tempo nur per Mausrad 
      this.pos.addScaledVector(fwd, f * speed)
              .addScaledVector(right, r * speed)
              .addScaledVector(new THREE.Vector3(0, 1, 0), u * speed);
      this.camera.position.copy(this.pos);
    } else {
      const u = (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0);
      const speed = this.dist * 0.9 * ((k.ShiftLeft || k.ShiftRight) ? 2.5 : 1) * dt;
      this.target.addScaledVector(flat, f * speed)
                 .addScaledVector(right, r * speed)
                 .addScaledVector(new THREE.Vector3(0, 1, 0), u * speed);
      this.camera.position.copy(this.target).addScaledVector(fwd, -this.dist);
    }
    this.camera.lookAt(this.camera.position.clone().add(fwd));
  }
}
