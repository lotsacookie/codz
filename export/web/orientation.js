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
  addEventListener('resize', apply, true);
  addEventListener('orientationchange', apply);
  coarse.addEventListener?.('change', apply);
  apply();
})();
