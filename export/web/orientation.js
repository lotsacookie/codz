(() => {
  const coarse = matchMedia('(pointer: coarse)');
  const root = document.documentElement;
  const widthGetter = Object.getOwnPropertyDescriptor(window, 'innerWidth').get;
  const heightGetter = Object.getOwnPropertyDescriptor(window, 'innerHeight').get;
  const realWidth = () => widthGetter.call(window);
  const realHeight = () => heightGetter.call(window);
  const rotated = () => coarse.matches && realHeight() > realWidth();

  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => (rotated() ? realHeight() : realWidth()) });
  Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => (rotated() ? realWidth() : realHeight()) });

  const toContent = (x, y) => [y, realWidth() - x];

  const patchPair = (proto, a, b) => {
    const da = Object.getOwnPropertyDescriptor(proto, a);
    const db = Object.getOwnPropertyDescriptor(proto, b);
    if (!da?.get || !db?.get) return;
    Object.defineProperty(proto, a, { configurable: true, enumerable: true, get() { return rotated() ? toContent(da.get.call(this), db.get.call(this))[0] : da.get.call(this); } });
    Object.defineProperty(proto, b, { configurable: true, enumerable: true, get() { return rotated() ? toContent(da.get.call(this), db.get.call(this))[1] : db.get.call(this); } });
  };
  for (const [a, b] of [['clientX', 'clientY'], ['pageX', 'pageY'], ['x', 'y']]) patchPair(MouseEvent.prototype, a, b);
  if (typeof Touch !== 'undefined') for (const [a, b] of [['clientX', 'clientY'], ['pageX', 'pageY']]) patchPair(Touch.prototype, a, b);

  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    const r = rect.call(this);
    return rotated() ? new DOMRect(r.top, realWidth() - r.right, r.height, r.width) : r;
  };
  const pick = document.elementFromPoint;
  Document.prototype.elementFromPoint = function (x, y) {
    return rotated() ? pick.call(this, realWidth() - y, x) : pick.call(this, x, y);
  };

  let was = false;
  const apply = () => {
    const on = rotated();
    root.classList.toggle('force-landscape', on);
    if (on) {
      const w = realWidth(), h = realHeight();
      root.style.setProperty('--rot-w', `${h}px`);
      root.style.setProperty('--rot-h', `${w}px`);
      root.style.setProperty('--rot-shift', `${w}px`);
      root.style.setProperty('--vh1', `${w / 100}px`);
      root.style.setProperty('--vw1', `${h / 100}px`);
    } else {
      for (const name of ['--rot-w', '--rot-h', '--rot-shift', '--vh1', '--vw1']) root.style.removeProperty(name);
    }
    if (on !== was) {
      was = on;
      setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
    }
  };
  // A swipe along the screen's long axis has to scroll a menu vertically, but browsers do not turn that into a
  // native scroll of a container that is rotated with CSS. While rotated, scroll menus by hand from the touch
  // coordinates above (already mapped into the rotated page), with a little momentum, and swallow the tap that
  // would otherwise follow a drag.
  const scrollerOf = node => {
    for (let el = node instanceof Element ? node : node?.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const overflow = getComputedStyle(el).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
    }
    return null;
  };
  const drag = { el: null, id: null, y: 0, last: 0, velocity: 0, moved: false, frame: 0 };
  let ignoreClickUntil = 0;
  const stopMomentum = () => { cancelAnimationFrame(drag.frame); drag.frame = 0; };
  // TouchList is not iterable on phones, so walk it by index.
  const touchById = (list, id) => { for (let i = 0; i < (list?.length ?? 0); i++) if (list[i].identifier === id) return list[i]; return null; };
  addEventListener('touchstart', event => {
    stopMomentum();
    if (!rotated() || event.touches.length !== 1) { drag.el = null; return; }
    const el = scrollerOf(event.target);
    if (!el) { drag.el = null; return; }
    const t = event.touches[0];
    Object.assign(drag, { el, id: t.identifier, y: t.clientY, last: event.timeStamp, velocity: 0, moved: false });
  }, { capture: true, passive: true });
  addEventListener('touchmove', event => {
    if (!drag.el) return;
    const t = touchById(event.touches, drag.id);
    if (!t) return;
    const dy = drag.y - t.clientY;
    if (!drag.moved && Math.abs(dy) < 6) return;
    drag.moved = true;
    const before = drag.el.scrollTop;
    drag.el.scrollTop += dy;
    const dt = Math.max(1, event.timeStamp - drag.last);
    drag.velocity = drag.velocity * .6 + (drag.el.scrollTop - before) / dt * .4;
    drag.y = t.clientY;
    drag.last = event.timeStamp;
    if (event.cancelable) event.preventDefault();
  }, { capture: true, passive: false });
  const release = event => {
    if (!drag.el) return;
    if (touchById(event.changedTouches, drag.id) === null) return;
    const el = drag.el, moved = drag.moved;
    drag.el = null;
    if (!moved) return;
    ignoreClickUntil = performance.now() + 350;
    let velocity = performance.now() - drag.last > 80 ? 0 : drag.velocity;
    let previous = performance.now();
    const step = now => {
      const dt = Math.min(48, now - previous);
      previous = now;
      const before = el.scrollTop;
      el.scrollTop += velocity * dt;
      velocity *= Math.pow(.95, dt / 8);
      if (Math.abs(velocity) < .02 || el.scrollTop === before) { drag.frame = 0; return; }
      drag.frame = requestAnimationFrame(step);
    };
    if (Math.abs(velocity) > .05) drag.frame = requestAnimationFrame(step);
  };
  addEventListener('touchend', release, true);
  addEventListener('touchcancel', release, true);
  addEventListener('click', event => {
    if (performance.now() < ignoreClickUntil) { event.preventDefault(); event.stopPropagation(); }
  }, true);

  addEventListener('resize', apply, true);
  addEventListener('orientationchange', apply);
  coarse.addEventListener?.('change', apply);
  apply();
})();
