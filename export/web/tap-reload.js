// Controller X is "use or reload". Next to a window the use is a hold (repair), so a quick tap used to do
// nothing at all. A tap that is released within `window` seconds now reloads; holding on keeps repairing.
export class TapReload {
  constructor(window = 0.25) {
    this.window = window;
    this.waiting = false;
    this.held = 0;
  }
  press() { this.waiting = true; this.held = 0; }
  cancel() { this.waiting = false; }
  // Call every simulation step with the time passed and whether the use button is still down.
  // Returns true on the step the button was released inside the window: reload now.
  update(dt, down) {
    if (!this.waiting) return false;
    if (down) {
      this.held += dt;
      if (this.held >= this.window) this.waiting = false;
      return false;
    }
    this.waiting = false;
    return true;
  }
}
