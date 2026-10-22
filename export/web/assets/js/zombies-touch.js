import { TouchControls } from './touch-controls.js';
import { GamepadInput, mergeInput, padSettings } from './gamepad.js';

// Shared BO2 pointer controls, with the actions needed by both Zombies maps.
export function createZombieTouch({ ctx = null, moon = false, minimal = false, menuSettings = true, onLook, onAction, onPause, onReset }) {
  const button = (kind, label, icon = '') => `<button type="button" class="touch-button touch-${kind}" data-touch="${kind}" aria-label="${label}">${icon}<span>${label}</span></button>`;
  const svg = content => `<svg viewBox="0 0 24 24" aria-hidden="true">${content}</svg>`;
  const root = document.createElement('div');
  root.id = 'touch-controls';
  root.hidden = true;
  root.setAttribute('aria-label', 'Touch game controls');
  root.innerHTML = `<div class="touch-look" data-touch="look"></div>
    <div class="touch-move" data-touch="move"><div class="touch-stick"><div class="touch-knob"></div><span>MOVE</span></div></div>
    ${button('fire', 'FIRE', svg('<circle cx="12" cy="12" r="7"/><path d="M12 1v6m0 10v6M1 12h6m10 0h6"/>'))}
    ${button('aim', 'AIM', svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/>'))}
    ${button('jump', 'JUMP', svg('<path d="m5 12 7-7 7 7M12 5v15"/>'))}
    ${button('crouch', 'CROUCH', svg('<path d="m5 12 7 7 7-7M12 19V4"/>'))}
    ${button('reload', 'RELOAD', svg('<path d="M19 8a8 8 0 1 0 0 9M19 3v6h-6"/>'))}
    ${button('use', 'USE', svg('<path d="M8 12V5a2 2 0 0 1 4 0v6l6 1v5l-4 4H9l-5-7 2-2 3 3"/>'))}
    ${button('melee', 'KNIFE', svg('<path d="m4 21 6-6m-3-3 6 6M9 14 20 3l-2 9-6 5"/>'))}
    <div class="touch-toolbar">
      ${button('weapon', 'WEAPON')}${button('grenade', 'GRENADE')}
      ${minimal ? '' : moon ? button('equipment', 'GERSH/QED') + button('suit', 'P.E.S.') + button('hack', 'HACK') + button('attachment', 'WAVE') + button('journal', 'OBJECTIVE') : button('claymore', 'CLAYMORE') + button('equipment', 'MONKEY') + button('attachment', 'ALT FIRE')}
    </div>
    <button type="button" class="touch-button touch-pause" id="touch-pause" aria-label="Pause">Ⅱ</button>`;
  document.body.append(root);
  const updateHints = () => {
    if (!moon) return;
    for (const selector of ['#menu .preview', '#journal p:last-child']) {
      const element = document.querySelector(selector);
      if (!element) continue;
      element.textContent = element.textContent.replace('Tab shows', 'OBJECTIVE shows').replace('Tab closes this panel.', 'Tap OBJECTIVE to close.');
    }
  };
  const controls = new TouchControls({ root, onLook, onAction, onReset, onModeChange: updateHints });
  // A controller feeds the same input object, look callback and action names as the touch
  // buttons, so every map that already supports touch supports a gamepad with no extra wiring.
  const pad = new GamepadInput({
    onLook: (x, y) => onLook(x, y, padSettings.sensitivity), onAction, onPause,
  });
  pad.attach(window);
  const readTouch = controls.input.read.bind(controls.input);
  controls.input.read = () => mergeInput(readTouch(), pad.read());
  const setEnabled = controls.setEnabled.bind(controls);
  controls.setEnabled = (enabled, visible = enabled) => { pad.setEnabled(enabled, visible); setEnabled(enabled, visible); };
  const reset = controls.reset.bind(controls);
  controls.reset = () => { pad.reset(); reset(); };
  const destroy = controls.destroy.bind(controls);
  controls.destroy = () => { pad.detach(); destroy(); };
  const getState = controls.getState.bind(controls);
  controls.getState = () => ({ ...getState(), pad: pad.getState() });
  controls.pad = pad;
  // The shell decides between pointer lock and tap-to-start from ctx.touch, so every map must hand it over.
  if (ctx) ctx.touch = controls;
  if (controls.mode) updateHints();
  if (menuSettings) {
    const settings = document.createElement('div');
    settings.className = 'touch-only touch-settings';
    settings.innerHTML = `<p>Left stick: move; push forward to sprint. Swipe right to look, or drag FIRE to aim while shooting. Tap AIM / CROUCH to toggle. Hold USE to repair${moon ? ', or HACK to hack' : ''}.</p>
      <label for="touch-sensitivity">Look sensitivity <input id="touch-sensitivity" type="range" min="0.4" max="2" step="0.1"><output id="touch-sensitivity-value" for="touch-sensitivity"></output></label>
      <p>Landscape gives you more room to aim.</p>
      <button type="button" id="touch-fullscreen" hidden>Full screen</button>`;
    document.querySelector(moon ? '#menu .panel' : '#menu .menu-content').append(settings);
    const slider = settings.querySelector('input');
    const value = settings.querySelector('output');
    slider.value = controls.sensitivity;
    value.textContent = `${controls.sensitivity.toFixed(1)}×`;
    slider.addEventListener('input', () => {
      controls.setSensitivity(slider.value);
      value.textContent = `${controls.sensitivity.toFixed(1)}×`;
    });
    const fullscreen = settings.querySelector('#touch-fullscreen');
    fullscreen.hidden = !document.fullscreenEnabled;
    fullscreen.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch { /* Full screen is optional. */ }
    });
  }
  // A third finger must be able to pause while move and fire are held.
  const pause = root.querySelector('#touch-pause');
  pause.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    event.preventDefault();
    event.stopPropagation();
    onPause();
  });
  pause.addEventListener('click', event => {
    if (event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents) return;
    onPause();
  });
  return controls;
}
