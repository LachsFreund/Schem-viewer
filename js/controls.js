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
      if (document.pointerLockElement === this.dom) document.exitPointerLock();
    }
    this.onFlyChange(this.fly);
  }

  /* ---------- events ---------- */
  _bind() {
    const d = this.dom;

    d.addEventListener('contextmenu', e => e.preventDefault());

    d.addEventListener('pointerdown', e => {
      if (this.fly) {
        if (document.pointerLockElement !== d) { d.requestPointerLock(); return; }
        if (e.altKey || this.measureMode) { e.preventDefault(); this.onPick(e.button, e, true); }
        return;
      }
      if (e.altKey) { e.preventDefault(); this.onPick(e.button, e, false); return; } // Alt+Klick: sofort messen
      d.setPointerCapture(e.pointerId);
      const pan = e.button === 2 || e.button === 1 || e.shiftKey;
      this._drag = { pan, button: e.button, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
      document.body.classList.add('dragging');
    });

    d.addEventListener('pointermove', e => {
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
      if (this.fly) {
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

    if (this.fly) {
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
