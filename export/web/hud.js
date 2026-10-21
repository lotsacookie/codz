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

// The scripts tint the chalk shader (0.21, 0, 0), which is #360000 on a flat white mark.
// In the reference capture the settled marks read as saturated blood red, thick and softly
// edged, so the flat vector marks use that on-screen colour instead of the literal tint.
export const CHALK_DARK = '#b0141b';
export const CHALK_WHITE = '#ffffff';
// Fallback for zombie_between_round_time (the scripts use 10 by default).
const BETWEEN_ROUND_TIME = 10;

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms * 1000));

function tallyMark(count) {
  const n = Math.min(5, Math.max(1, count));
  return `<i class="chalk-mark" style="--mark:url(textures/chalkmarks_${n}.png)"></i>`;
}

export function chalkMarkup(round) {
  if (round > 10) return [`<span class="chalk-num">${round}</span>`, ''];
  if (round > 5) return [tallyMark(5), tallyMark(round - 5)];
  return [tallyMark(round), ''];
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
    if ((session.corePhase ?? session.phase) === 'preparing' && session.round > 1 && this.shown === session.round - 1 && !this.overDone) {
      this.overDone = true;
      this.runRoundOver(session.countdown);
    } else if ((session.corePhase ?? session.phase) === 'fighting' && this.shown !== session.round) {
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
    // Centre of the screen (the 64-wide mark box is centred under "Round"), 200 above the bottom; "Round" 265 above.
    setFade(g1, 0, { left: 'calc(50% - var(--u) * 32)', bottom: 'calc(var(--u) * 200)', opacity: '0', color: CHALK_WHITE });
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

  // chalk_round_over(): turn white, flicker, then settle back to blood red and stay until the next round.
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
    for (const g of visible) setFade(g, time * 0.25, { color: CHALK_DARK, opacity: '1' });
  }
}

const AMMO_ICONS = {
  pistol: { url: 'textures/ammo_counter_bullet.png', w: 4, h: 8, scale: 2.5, perRow: 15 },
  rifle: { url: 'textures/ammo_counter_riflebullet.png', w: 32, h: 8, scale: 0.5, perRow: 10 },
  belt: { url: 'textures/ammo_counter_beltbullet.png', w: 8, h: 4, scale: 1, perRow: 20 },
  shell: { url: 'textures/ammo_counter_shotgunshell.png', w: 16, h: 8, scale: 1.25, perRow: 8 },
  rocket: { url: 'textures/ammo_counter_rocket.png', w: 64, h: 16, scale: 0.6, perRow: 3 }
};

export function ammoIconKind(def) {
  if (!def) return 'pistol';
  if ((def.projectileSpeed || 0) > 0 && (def.explosionRadius || 0) > 0) return 'rocket';
  if ((def.pellets || 0) > 1) return 'shell';
  const clip = def.clipSize || 0;
  if (clip >= 60) return 'belt';
  if (clip >= 20 || /burst/i.test(def.fireType || '')) return 'rifle';
  return 'pistol';
}

export function renderAmmoIcons(el, def, mag) {
  if (!el) return;
  const kind = ammoIconKind(def);
  const count = Math.max(0, Math.min(Math.floor(mag) || 0, 150));
  const key = kind + ':' + count;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  const icon = AMMO_ICONS[kind];
  const iw = icon.w * icon.scale, ih = icon.h * icon.scale;
  el.replaceChildren();
  for (let left = count; left > 0; left -= icon.perRow) {
    const n = Math.min(left, icon.perRow);
    const row = document.createElement('i');
    row.style.cssText = `width:calc(var(--u) * ${n * iw});height:calc(var(--u) * ${ih});background-image:url(${icon.url});background-size:calc(var(--u) * ${iw}) calc(var(--u) * ${ih})`;
    el.appendChild(row);
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
export function bo1Prompt(text, touch = false, pad = false) {
  if (!text) return '';
  const key = touch ? 'USE' : pad ? 'X' : 'F';
  let m;
  let out = text;
  if (/^Hold (F|USE|X) /.test(text)) out = text.replace(/^Hold (F|USE|X)/, 'Hold ' + key);
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
