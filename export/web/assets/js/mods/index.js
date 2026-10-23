import { preloadInstalled, enabledMods } from './mod-store.js';
import { createModMenu } from './menu-ui.js';

// Called once by the shell: re-downloads installed mods from their repos, then wires the in-game menu.
export function initMods({ pauseAnchor } = {}) {
  const ready = preloadInstalled();
  const menu = createModMenu();
  if (menu && pauseAnchor?.before) {
    const button = pauseAnchor.cloneNode(false);
    button.id = 'pause-mods';
    button.textContent = 'MOD MENU';
    button.hidden = false;
    button.addEventListener('click', () => { ready.then(() => { if (!menu.open()) button.textContent = 'NO MODS ENABLED'; }); });
    pauseAnchor.before(button);
  }
  return { ready, menu, enabledMods };
}
