/**
 * Shared pause/resume/setActive logic for maps that run the combat loop (Moon and every survival map).
 * The pause menu itself lives in shell.js; this only stops/starts the map's own input, player and combat.
 *
 * Everything the map owns is passed as a getter or callback so the map keeps its own `let` state.
 */
export function createPauseControl({ keys, touch, player, combat, ready, gameOver, setActive: onActive, clearInput, onPause }) {
  function pause() {
    onActive(false);
    keys.clear();
    clearInput?.();
    touch.reset();
    touch.setEnabled(false);
    player()?.setEnabled(false);
    combat()?.pause();
    onPause?.();
  }
  function resume() {
    if (!ready() || gameOver()) return;
    touch.reset();
    touch.setEnabled(true);
    onActive(true);
    player().setEnabled(true);
    combat().resume();
  }
  function setActive(value) { if (value) resume(); else pause(); }
  return { pause, resume, setActive };
}
