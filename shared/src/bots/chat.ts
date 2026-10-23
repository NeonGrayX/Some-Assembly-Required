import { levelBoards } from '../content/house.ts';
import { length, sub } from '../math.ts';
import type { Vec3 } from '../math.ts';
import type { Errand, Heard } from './talk.ts';
import type { Bot, Job } from './bot.ts';

/**
 * A bot in the chat: answering what people ask it (who it suspects, what it is doing, what a
 * page says, where something is), and running the errands they give it.
 */
export class BotChat {
  constructor(private readonly bot: Bot) {}

  /** Queues an answer to say after `seconds` (about the time it takes to type). */
  reply(text: string, seconds = 1.5 + text.length / 25): void {
    if (this.bot.replies.length >= 3 || !this.peopleHere()) return;
    this.bot.replies.push({ at: this.bot.squad.tick + Math.round(seconds * 60), text });
  }

  /** Whether anyone reads the chat (bots between themselves say nothing). */
  peopleHere(): boolean {
    return [...this.bot.squad.game.clients.values()].some((c) => c.connected && !c.bot);
  }

  /** Says the next queued answer when its time comes. */
  speak(): void {
    const next = this.bot.replies[0];
    if (!next || this.bot.squad.tick < next.at || this.bot.squad.tick - this.bot.lastSaid < 90)
      return;
    this.bot.replies.shift();
    if (!this.peopleHere()) return;
    this.bot.lastSaid = this.bot.squad.tick;
    this.bot.squad.trace?.(this.bot.id, `says: ${next.text}`);
    this.bot.squad.game.handle(this.bot.id, { t: 'chat', text: next.text });
  }

  /**
   * Something a person said that it heard (see `Squad.hear`, which has already weighed any claim
   * in it). `direct`: said to this bot by name.
   */
  answer(h: Heard, from: number, direct: boolean): void {
    const round = this.bot.squad.game.round;
    const who = this.bot.nameOf(from);
    switch (h.kind) {
      case 'greet':
        if (direct || this.bot.random() < 0.5) this.reply(`Hi ${who}!`);
        return;
      case 'accuse':
        if (h.target === this.bot.id) {
          const other = this.topSuspect(from);
          this.reply(
            other
              ? `Not me! If anyone, ${this.bot.nameOf(other)}.`
              : 'Not me! I was just building.',
          );
        } else if (this.bot.saboteur && round?.partners(this.bot.id).includes(h.target)) {
          // Covers for a fellow saboteur.
          this.reply(`${this.bot.nameOf(h.target)}? They were with me the whole time.`);
        } else if (direct || this.bot.random() < 0.4) {
          const sure = (this.bot.squad.suspicion.get(h.target) ?? 0) >= this.bot.skill.accuse;
          this.reply(
            sure
              ? `I think so too. Let's vote ${this.bot.nameOf(h.target)} off.`
              : `Noted, I'll keep an eye on ${this.bot.nameOf(h.target)}.`,
          );
        }
        return;
      case 'clear':
        if (direct) this.reply(`OK, if you say so.`);
        return;
      case 'vote':
      case 'skip':
        return;
      case 'ask':
        if (h.about === 'suspect') this.reply(this.suspectLine(from));
        else if (h.about === 'doing') this.reply(this.doingLine());
        else {
          const stamp = this.bot.team.realStamp;
          this.reply(
            stamp && !this.bot.saboteur
              ? `The real stamp is ${stamp}.`
              : 'Nobody has read the master index yet, so I am not sure.',
          );
        }
        return;
      case 'page':
        this.reply(this.pageLine(h.step, from));
        return;
      case 'errand':
        this.takeErrand(h.errand, from);
        return;
    }
  }

  /** The player it suspects most (other than `but`), if it suspects anyone at all. */
  private topSuspect(but: number): number | null {
    const round = this.bot.squad.game.round;
    if (!round) return null;
    let best: number | null = null;
    let top = 0.25;
    for (const id of round.onSite) {
      if (id === this.bot.id || id === but || round.partners(this.bot.id).includes(id)) continue;
      const s = this.bot.squad.suspicion.get(id) ?? 0;
      if (s > top) {
        top = s;
        best = id;
      }
    }
    return best;
  }

  private suspectLine(asker: number): string {
    const round = this.bot.squad.game.round!;
    if (this.bot.saboteur) {
      // Points at an innocent: whoever looks worst already, or now and then whoever hangs about
      // the build most.
      const blame = this.topSuspect(-1);
      if (blame !== null) return `I suspect ${this.bot.nameOf(blame)}.`;
      if (this.bot.random() < 0.5 * this.bot.skill.mischief) {
        const near = [...this.bot.squad.nearBuild]
          .filter(([id]) => id !== this.bot.id && id !== asker && round.onSite.includes(id))
          .filter(([id]) => !round.partners(this.bot.id).includes(id))
          .sort((a, b) => b[1] - a[1])[0];
        if (near) return `Maybe ${this.bot.nameOf(near[0])}? They keep hanging around the build.`;
      }
      return 'No idea yet.';
    }
    const top = this.topSuspect(-1);
    if (top === null) return 'No idea yet. Nobody has done anything I could see.';
    const s = this.bot.squad.suspicion.get(top) ?? 0;
    const why = this.bot.squad.why.get(top);
    return s >= 0.5
      ? `I suspect ${this.bot.nameOf(top)}${why ? `: ${why}` : ''}.`
      : `Maybe ${this.bot.nameOf(top)}${why ? ` (${why})` : ''}, but I am not sure.`;
  }

  private doingLine(): string {
    const doing = this.bot.jobName;
    const said: Record<string, string> = {
      build: 'Putting bricks on the build.',
      'fix a brick': 'Taking a wrong brick off the build.',
      'read the page': 'Reading a page and pinning it up.',
      'feed the dog': 'Feeding the dog.',
      'fix the panel': 'Fixing the power.',
      'ring the bell': 'Calling a meeting.',
      'press Done': 'Pressing Done, it is finished.',
      wait: 'Waiting for more pages to turn up.',
      'come over': 'Coming over.',
    };
    return said[doing] ?? 'Looking for pages.';
  }

  /** Where a page is, as far as it knows (a saboteur keeps the pages it hid to itself). */
  private pageLine(step: number, asker: number): string {
    const sim = this.bot.squad.game.sim;
    const name = step < 0 ? 'The master index' : `Page ${step + 1}`;
    const page = [...sim.pages.values()].find((pg) => pg.printed && pg.printed.step === step);
    if (!page) return `I have not seen ${name.toLowerCase()} anywhere.`;
    if (page.carriedBy === this.bot.id) return `I have it.`;
    if (page.carriedBy === asker) return `You have it!`;
    if (page.carriedBy !== null) return `${this.bot.nameOf(page.carriedBy)} has it.`;
    if (page.pinned !== null) return `${name} is pinned on the board.`;
    if (sim.dog.page === page.id) return `The dog has ${name.toLowerCase()}!`;
    const seen = this.bot.team.sightings.get(page.id);
    if (seen && !(this.bot.saboteur && this.bot.random() < 0.5))
      return `${name} is ${this.where(seen.pos)}.`;
    return step >= 0 && this.bot.team.notes.has(step)
      ? `I have not seen it, but someone read it already.`
      : `Not seen ${name.toLowerCase()} yet.`;
  }

  /** "near the silo", "up high near the board": where a spot is, by the nearest landmark. */
  private where(at: Vec3): string {
    const sim = this.bot.squad.game.sim;
    const marks: [string, Vec3][] = [
      ['the build', sim.buildCentre(sim.build(this.bot.site))],
      ['the dog bowl', sim.level.dog.treatJar],
    ];
    const kinds: Record<string, string> = {
      press: 'the moulding machines',
      silo: 'the silo',
      dispenser: 'the mould dispenser',
      printer: 'the printer',
    };
    for (const m of sim.machines.values())
      marks.push([kinds[m.def.kind] ?? 'the brick works', m.def.pos]);
    for (const b of levelBoards(sim.level)) marks.push(['the board', b.pos]);
    if (sim.panel) marks.push(['the power panel', sim.panel]);
    const flat = (v: Vec3) => Math.hypot(v.x - at.x, v.z - at.z);
    const [mark, pos] = marks.sort((a, b) => flat(a[1]) - flat(b[1]))[0]!;
    const d = flat(pos);
    const height = at.y > pos.y + 1.6 ? 'up high ' : at.y < pos.y - 1.6 ? 'down below ' : '';
    return d < 3 ? `${height}by ${mark}` : `${height}about ${Math.round(d)} m from ${mark}`;
  }

  private takeErrand(what: Errand, from: number): void {
    const sim = this.bot.squad.game.sim;
    if (what === 'dog' && sim.dog.leashed) return this.reply('The dog is on its leash already.');
    if (what === 'panel' && sim.power.on) return this.reply('The power is on.');
    if (what === 'bell' && !this.bot.saboteur && this.bot.accused() === null)
      return this.reply('I am not sure who it is yet.');
    // A saboteur goes along with it now and then, to look helpful.
    if (this.bot.saboteur && what !== 'come' && this.bot.random() < 0.5)
      return this.reply('In a moment.');
    this.bot.errand = { what, from, until: this.bot.squad.tick + 20 * 60 };
    // Drops what it was doing for it, unless it has a brick in hand to put on.
    if (!this.bot.me()?.holding) this.bot.stop();
    this.reply(
      {
        dog: 'On it, feeding the dog.',
        panel: 'On it.',
        search: 'OK, looking for pages.',
        come: 'Coming!',
        bell: 'Calling a meeting.',
      }[what],
      1,
    );
  }

  /** The job a person asked for, if one is waiting. */
  runErrand(): Job<unknown> | null {
    const e = this.bot.errand;
    this.bot.errand = null;
    if (!e || this.bot.squad.tick > e.until) return null;
    switch (e.what) {
      case 'dog':
        return this.bot.named('feed the dog', this.bot.onDuty('dogBy', this.bot.chores.feedDog()));
      case 'panel':
        if (!this.bot.squad.game.sim.panel) return null;
        return this.bot.named(
          'fix the panel',
          this.bot.onDuty('panelBy', this.bot.chores.fixPanel()),
        );
      case 'search':
        return this.bot.pageJobs.search();
      case 'bell':
        return this.bot.named('ring the bell', this.bot.onDuty('bellBy', this.bot.ringBell()));
      case 'come':
        return this.bot.named('come over', this.comeOver(e.from));
    }
  }

  /** Walks over to a player. */
  private *comeOver(id: number): Job {
    const p = this.bot.squad.game.sim.players.get(id);
    if (!p) return false;
    const at = p.body.translation();
    const goals = this.bot.squad.nav.around(at, 2, 2, 0.6);
    const close = () => {
      const q = this.bot.squad.game.sim.players.get(id)?.body.translation();
      return !!q && length(sub(q, this.bot.feet())) < 2.2;
    };
    const ok = yield* this.bot.walk(goals, close, 30);
    const q = this.bot.squad.game.sim.players.get(id)?.body.translation();
    if (q) {
      const f = this.bot.feet();
      this.bot.ctl.yaw = Math.atan2(-(q.x - f.x), -(q.z - f.z));
    }
    // Waits a little for whatever they wanted.
    for (let k = 0; k < 180; k++) yield;
    return ok;
  }
}
