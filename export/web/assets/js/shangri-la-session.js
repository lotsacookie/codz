import { Session, roundPopulation } from './rules.js';
import { MoonSession } from './moon-session.js';

export class ShangriSession extends MoonSession {
  reset() {
    super.reset();
    this.area = 'moon';
    this.moonStarted = true;
    this.phase = 'preparing';
    this.countdown = 6;
    this.total = roundPopulation(1, this.data.rules);
    this.nextDogRound = 5 + Math.floor(this.random() * 3);
    this.dogRound = false;
    this.dogRounds = 0;
    this.power = false;
  }

  nextRound() { Session.prototype.nextRound.call(this); }
}
