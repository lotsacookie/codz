const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Pointer ownership is independent of DOM hit testing. A finger keeps its job
// until released, even when it crosses another control or leaves the screen.
export class TouchInput {
  constructor({ onLook = () => {}, onAction = () => {} } = {}) {
    this.onLook = onLook;
    this.onAction = onAction;
    this.pointers = new Map();
    this.reset();
  }

  reset() {
    this.pointers.clear();
    this.forward = this.strafe = this.stickX = this.stickY = 0;
    this.sprint = this.aim = this.crouch = this.fire = false;
    this.jumpQueued = this.fireQueued = false;
  }

  begin(id, kind, x, y, radius = 50) {
    if (this.pointers.has(id) || [...this.pointers.values()].some(p => p.kind === kind)) return false;
    this.pointers.set(id, { kind, x, y, originX: x, originY: y, radius });
    if (kind === 'fire') this.fire = this.fireQueued = true;
    if (kind === 'jump') this.jumpQueued = true;
    if (kind === 'aim') this.aim = !this.aim;
    if (kind === 'crouch') this.crouch = !this.crouch;
    if (!['move', 'look', 'fire', 'jump', 'aim', 'crouch'].includes(kind)) this.onAction(kind);
    return true;
  }

  move(id, x, y) {
    const p = this.pointers.get(id);
    if (!p) return;
    if (p.kind === 'move') {
      const dx = (x - p.originX) / p.radius;
      const dy = (y - p.originY) / p.radius;
      const length = Math.hypot(dx, dy);
      const magnitude = clamp((length - 0.12) / 0.88, 0, 1);
      this.strafe = length ? dx / length * magnitude : 0;
      this.forward = length ? -dy / length * magnitude : 0;
      this.stickX = dx / Math.max(1, length) * p.radius;
      this.stickY = dy / Math.max(1, length) * p.radius;
      // Hysteresis prevents sprint chatter around the outer ring. Sideways
      // and backwards movement remain a walk; aiming/firing override sprint.
      this.sprint = this.forward > (this.sprint ? 0.72 : 0.92);
    } else if (p.kind === 'look' || p.kind === 'fire') {
      // With two aiming fingers down, fire owns the camera to avoid doubling
      // the turn. Track both positions so releasing fire cannot cause a jump.
      if (p.kind === 'fire' || !this.fire) this.onLook(x - p.x, y - p.y);
    }
    p.x = x;
    p.y = y;
  }

  end(id, cancelled = false) {
    const p = this.pointers.get(id);
    if (!p) return;
    this.pointers.delete(id);
    if (p.kind === 'move') {
      this.forward = this.strafe = this.stickX = this.stickY = 0;
      this.sprint = false;
    }
    if (p.kind === 'fire') {
      this.fire = false;
      if (cancelled) this.fireQueued = false;
    }
    if (cancelled && p.kind === 'jump') this.jumpQueued = false;
  }

  read() {
    const fire = this.fire || this.fireQueued;
    const input = {
      forward: this.forward, strafe: this.strafe,
      sprint: this.sprint && !this.aim && !fire && !this.crouch,
      crouch: this.crouch, aim: this.aim, fire, firePressed: this.fireQueued, jump: this.jumpQueued,
      use: this.held('use'), hack: this.held('hack'),
    };
    this.fireQueued = this.jumpQueued = false;
    return input;
  }

  held(kind) {
    return [...this.pointers.values()].some(p => p.kind === kind);
  }

  getState() {
    return {
      pointers: this.pointers.size, forward: this.forward, strafe: this.strafe,
      sprint: this.sprint && !this.aim && !this.fire && !this.crouch,
      aim: this.aim, crouch: this.crouch, fire: this.fire, use: this.held('use'), hack: this.held('hack'),
    };
  }
}

export class TouchControls {
  constructor({ root, onLook, onAction, onModeChange = () => {}, onReset = () => {} }) {
    this.root = root;
    this.onReset = onReset;
    this.enabled = false;
    this.visible = false;
    this.mode = matchMedia('(pointer: coarse)').matches;
    this.sensitivity = 1;
    try {
      const saved = Number(localStorage.getItem('zombies.touchSensitivity'));
      if (saved > 0) this.sensitivity = clamp(saved, 0.4, 2);
    } catch { /* Storage is optional in private browsing and embedded games. */ }
    this.input = new TouchInput({
      onLook: (x, y) => onLook(x, y, this.sensitivity), onAction,
    });
    this.stick = root.querySelector('.touch-stick');
    this.knob = root.querySelector('.touch-knob');
    this.moveZone = root.querySelector('[data-touch="move"]');
    this.captures = new Map();
    const activate = (event) => {
      if (event.pointerType !== 'touch' || this.mode) return;
      this.mode = true;
      document.body.classList.add('touch-mode');
      onModeChange();
    };
    document.body.classList.toggle('touch-mode', this.mode);
    this.activate = activate;
    document.addEventListener('pointerdown', activate, { capture: true, passive: true });
    root.addEventListener('pointerdown', (event) => {
      const target = event.target.closest('[data-touch]');
      if (!this.enabled || event.pointerType !== 'touch' || !target) return;
      event.preventDefault();
      const kind = target.dataset.touch;
      const radius = this.stick.offsetWidth * 0.36;
      if (!this.input.begin(event.pointerId, kind, event.clientX, event.clientY, radius)) return;
      target.setPointerCapture(event.pointerId);
      this.captures.set(event.pointerId, target);
      if (kind === 'move') {
        const bounds = this.moveZone.getBoundingClientRect();
        this.stick.style.left = `${event.clientX - bounds.left}px`;
        this.stick.style.top = `${event.clientY - bounds.top}px`;
        this.stick.style.bottom = 'auto';
      }
      this.render();
    });
    root.addEventListener('pointermove', (event) => {
      if (!this.input.pointers.has(event.pointerId)) return;
      event.preventDefault();
      this.input.move(event.pointerId, event.clientX, event.clientY);
      this.render();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      root.addEventListener(type, (event) => {
        if(type !== 'pointerup' && this.input.pointers.has(event.pointerId)) this.onReset();
        this.input.end(event.pointerId, type !== 'pointerup');
        this.captures.delete(event.pointerId);
        this.render();
      });
    }
    root.addEventListener('contextmenu', event => event.preventDefault());
    // Rotation/browser chrome changes invalidate the stick origin and pointer
    // coordinates. Never carry movement or a held trigger into a new layout.
    this.onResize = () => this.reset();
    addEventListener('resize', this.onResize);
    globalThis.visualViewport?.addEventListener('resize', this.onResize);
  }

  destroy() {
    document.removeEventListener('pointerdown', this.activate, { capture: true });
    removeEventListener('resize', this.onResize);
    globalThis.visualViewport?.removeEventListener('resize', this.onResize);
    this.input.reset();
    this.root.remove();
  }

  setSensitivity(value) {
    if (!Number.isFinite(Number(value))) return;
    this.sensitivity = clamp(Number(value), 0.4, 2);
    try { localStorage.setItem('zombies.touchSensitivity', String(this.sensitivity)); } catch {}
  }

  setEnabled(enabled, visible = enabled) {
    enabled = Boolean(enabled && this.mode);
    visible = Boolean(visible && this.mode);
    if (this.enabled && !enabled) this.reset();
    this.enabled = enabled;
    if (this.visible !== visible) {
      this.visible = visible;
      this.root.hidden = !visible;
    }
    this.root.classList.toggle('touch-disabled', !enabled);
  }

  reset() {
    this.input.reset();
    this.onReset();
    for (const [id, target] of this.captures) {
      if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
    }
    this.captures.clear();
    this.render();
  }

  render() {
    const state = this.input.getState();
    this.knob.style.transform = `translate(${this.input.stickX}px, ${this.input.stickY}px)`;
    const moving = [...this.input.pointers.values()].some(p => p.kind === 'move');
    if (!moving) {
      this.stick.style.left = this.stick.style.top = this.stick.style.bottom = '';
    }
    this.stick.classList.toggle('engaged', moving);
    this.stick.classList.toggle('sprinting', state.sprint);
    this.stick.querySelector('span').textContent = state.sprint ? 'SPRINT' : 'MOVE';
    for (const button of this.root.querySelectorAll('button[data-touch]')) {
      const kind = button.dataset.touch;
      const pressed = kind === 'aim' || kind === 'crouch' ? state[kind]
        : [...this.input.pointers.values()].some(p => p.kind === kind);
      button.classList.toggle('pressed', pressed);
      if (kind === 'aim' || kind === 'crouch') button.setAttribute('aria-pressed', String(pressed));
    }
  }

  getState() {
    return { mode: this.mode, enabled: this.enabled, visible: this.visible,
      sensitivity: this.sensitivity, ...this.input.getState() };
  }
}
