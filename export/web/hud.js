// Black Ops 1 zombies HUD behaviour for the browser build.
//
// Every position, colour and timing below comes from the decompiled scripts in
// the Jo-Milk/Black-Ops dump:
//   maps/_zombiemode.gsc          create_chalk_hud / chalk_one_up / chalk_round_over
//   maps/_zombiemode_perks.gsc    perk_hud_create (24x24 icons, 30 apart, 70 above the bottom)
//   maps/_zombiemode_powerups.gsc Power_up_hud (32x32 icons, centred, blink under 10s / 5s)
//   maps/_zombiemode_score.gsc    create_highlight_hud / score_highlight (+points popups)
// Script HUD coordinates are in a 640x480 space; the CSS uses --u (1/480 of the
// viewport height) as that unit.

// (0.21, 0, 0) in the scripts: the resting colour of the chalk tally.
export const CHALK_DARK = '#360000';
export const CHALK_WHITE = '#ffffff';
// Fallback for zombie_between_round_time (the scripts use 10 by default).
const BETWEEN_ROUND_TIME = 10;

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms * 1000));

// Hand-drawn chalk strokes standing in for hud_chalk_1..5 (those shaders are not
// part of the extracted texture set). Slight per-stroke jitter keeps it uneven.
const STROKE_X = [12, 24, 36, 48];
const STROKE_TOP = [6, 8, 5, 7];
const STROKE_BOTTOM = [58, 56, 59, 57];
const STROKE_LEAN = [1.2, -1.4, 0.8, -1];

function tallySvg(count) {
  let paths = '';
  for (let i = 0; i < Math.min(count, 4); i++) {
    paths += `<path d="M${STROKE_X[i] + STROKE_LEAN[i]} ${STROKE_TOP[i]} L${STROKE_X[i] - STROKE_LEAN[i]} ${STROKE_BOTTOM[i]}"/>`;
  }
  if (count >= 5) paths += '<path d="M4 47 L60 15"/>';
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" filter="url(#chalk-rough)">${paths}</g></svg>`;
}

export function chalkMarkup(round) {
  if (round > 10) return [`<span class="chalk-num">${round}</span>`, ''];
  if (round > 5) return [tallySvg(5), tallySvg(round - 5)];
  return [tallySvg(Math.max(1, round)), ''];
}

function setFade(el, seconds, props) {
  el.style.transition = seconds > 0
    ? `opacity ${seconds}s linear, color ${seconds}s linear, left ${seconds}s linear, bottom ${seconds}s linear`
    : 'none';
  if (seconds <= 0) void el.offsetWidth;
  Object.assign(el.style, props);
}

export class ChalkHud {
  constructor() {
    this.root = $('chalk');
    this.groups = [$('chalk1'), $('chalk2')];
    this.label = $('chalk-label');
    this.token = 0;
    this.reset();
  }

  reset() {
    this.token++;
    this.shown = 0;
    this.introDone = false;
    this.overDone = false;
    for (const g of this.groups) { g.innerHTML = ''; setFade(g, 0, { opacity: '0', color: CHALK_DARK }); }
    this.dockGroups();
    setFade(this.label, 0, { opacity: '0', color: CHALK_WHITE });
  }

  // Resting place after the intro: bottom-left, user_left x=-5 / y=-4 (hud 2 at x=64).
  dockGroups() {
    setFade(this.groups[0], 0, { left: 'calc(var(--u) * -5)', bottom: 'calc(var(--u) * 4)' });
    setFade(this.groups[1], 0, { left: 'calc(var(--u) * 64)', bottom: 'calc(var(--u) * 4)' });
  }

  render(round) {
    const [a, b] = chalkMarkup(round);
    this.groups[0].innerHTML = a;
    this.groups[1].innerHTML = b;
    this.shown = round;
  }

  // Called once per frame with the session state; kicks off the scripted sequences.
  update(session, started) {
    if (!started) return;
    if (session.phase === 'gameover') { this.hide(); return; }
    if (!this.introDone && session.round === 1) {
      this.introDone = true;
      this.runIntro(session.round);
      return;
    }
    if (!this.introDone) return;
    if (session.phase === 'preparing' && session.round > 1 && this.shown === session.round - 1 && !this.overDone) {
      this.overDone = true;
      this.runRoundOver(session.countdown);
    } else if (session.phase === 'fighting' && this.shown !== session.round) {
      this.overDone = false;
      this.runRoundStart(session.round);
    }
  }

  hide() {
    this.token++;
    for (const g of this.groups) setFade(g, 0.5, { opacity: '0' });
    setFade(this.label, 0.5, { opacity: '0' });
  }

  // chalk_one_up(), first-round branch.
  async runIntro(round) {
    const token = ++this.token;
    const [g1, g2] = this.groups;
    this.render(round);
    setFade(g2, 0, { opacity: '0' });
    // Centre of the screen: x=-5 from user_center, 200 above the bottom; "Round" 265 above.
    setFade(g1, 0, { left: 'calc(50% - var(--u) * 5)', bottom: 'calc(var(--u) * 200)', opacity: '0', color: CHALK_WHITE });
    setFade(this.label, 0, { opacity: '0', color: CHALK_WHITE });
    await sleep(0.05); if (token !== this.token) return;
    setFade(this.label, 1, { opacity: '1' });
    setFade(g1, 1, { opacity: '1' });
    await sleep(1); if (token !== this.token) return;
    setFade(this.label, 2, { color: CHALK_DARK });
    setFade(g1, 2, { color: CHALK_DARK });
    await sleep(2 + 3); if (token !== this.token) return;
    setFade(this.label, 1, { opacity: '0' });
    await sleep(1.25); if (token !== this.token) return;
    setFade(g1, 1.75, { left: 'calc(var(--u) * -5)', bottom: 'calc(var(--u) * 4)' });
    await sleep(2); if (token !== this.token) return;
    setFade(g2, 0, { opacity: this.shown > 5 && this.shown <= 10 ? '1' : '0', color: CHALK_DARK });
  }

  // chalk_one_up(), later rounds: fade out, swap marks, fade in white, settle to dark red.
  async runRoundStart(round) {
    const token = ++this.token;
    const [g1, g2] = this.groups;
    this.dockGroups();
    for (const g of this.groups) setFade(g, 0.5, { opacity: '0' });
    await sleep(0.5); if (token !== this.token) return;
    this.render(round);
    for (const g of this.groups) setFade(g, 0, { color: CHALK_WHITE });
    for (const g of this.groups) setFade(g, 2, { opacity: g === g2 && !(round > 5 && round <= 10) ? '0' : '1' });
    await sleep(2 + 2); if (token !== this.token) return;
    for (const g of this.groups) setFade(g, 1, { color: CHALK_DARK });
  }

  // chalk_round_over(): turn white, flicker, then fade away until the next round.
  async runRoundOver(countdown) {
    const token = ++this.token;
    let time = Math.max(BETWEEN_ROUND_TIME, countdown || 0);
    if (time > 3) time -= 2;
    const visible = this.groups.filter(g => g.innerHTML);
    for (const g of visible) setFade(g, time * 0.25, { color: CHALK_WHITE });
    await sleep(time * 0.25); if (token !== this.token) return;
    const steps = (time * 0.5) / 0.5;
    for (let i = 0; i < steps; i++) {
      for (const g of visible) setFade(g, 0.5, { opacity: '0' });
      await sleep(0.5); if (token !== this.token) return;
      for (const g of visible) setFade(g, 0.5, { opacity: '1' });
      await sleep(0.5); if (token !== this.token) return;
    }
    for (const g of visible) setFade(g, time * 0.25, { color: CHALK_DARK, opacity: '0' });
  }
}

// Power_up_hud(): under 10s the icon flickers, under 5s it flickers faster.
export function powerupVisible(remaining, now) {
  if (remaining < 5) return (now % 0.35) < 0.15;
  if (remaining < 10) return (now % 0.43) < 0.25;
  return true;
}

// Score popups: score_highlight() floats a value 20-60 left and up to 15 up/down, fading in 0.5s.
export function spawnScorePopup(container, value) {
  if (!container || !value) return;
  const el = document.createElement('span');
  el.className = 'score-popup ' + (value > 0 ? 'gain' : 'loss');
  el.textContent = value > 0 ? '+' + value : String(value);
  container.appendChild(el);
  const dx = -(20 + Math.random() * 40), dy = -15 + Math.random() * 30;
  el.animate([
    { transform: 'translate(0,0)', opacity: 1 },
    { transform: `translate(calc(var(--u) * ${dx}), calc(var(--u) * ${dy}))`, opacity: 1, offset: 0.5 },
    { transform: `translate(calc(var(--u) * ${dx}), calc(var(--u) * ${dy}))`, opacity: 0 }
  ], { duration: 1000, easing: 'linear' }).finished.then(() => el.remove(), () => el.remove());
}

// The extractor stores prompts as short phrases; Black Ops shows "Hold F to ..." hint strings.
export function bo1Prompt(text, touch = false) {
  if (!text) return '';
  const key = touch ? 'USE' : 'F';
  let m;
  let out = text;
  if (/^Hold (F|USE) /.test(text)) out = text.replace(/^Hold (F|USE)/, 'Hold ' + key);
  else if ((m = text.match(/^Open door · (\d+)$/))) out = `Hold ${key} to open the door [Cost: ${m[1]}]`;
  else if ((m = text.match(/^Mystery Box · (\d+)$/))) out = `Hold ${key} for Mystery Box [Cost: ${m[1]}]`;
  else if ((m = text.match(/^Bowie Knife · (\d+)$/))) out = `Hold ${key} to buy Bowie Knife [Cost: ${m[1]}]`;
  else if ((m = text.match(/^(.+) ammo · (\d+)$/))) out = `Hold ${key} to buy ammo for ${m[1]} [Cost: ${m[2]}]`;
  else if ((m = text.match(/^Pack-a-Punch(?: · (\d+))?$/))) out = `Hold ${key} to Pack-a-Punch${m[1] ? ` [Cost: ${m[1]}]` : ''}`;
  else if ((m = text.match(/^Take (.+) · (\d+)s$/))) out = `Hold ${key} to take ${m[1]}`;
  else if ((m = text.match(/^Take (.+)$/))) out = `Hold ${key} to take ${m[1]}`;
  else if ((m = text.match(/^(.+) · (\d+)$/))) out = `Hold ${key} to buy ${m[1]} [Cost: ${m[2]}]`;
  else if (/^Activate electric trap/.test(text)) out = text.replace(/^Activate electric trap · (\d+)$/, `Hold ${key} to activate the trap [Cost: $1]`);
  return out;
}
