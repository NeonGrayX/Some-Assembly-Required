import { levelBoards } from '../content/house.ts';
import { add, length, rotate, sub, v3, yawQuat } from '../math.ts';
import type { Vec3 } from '../math.ts';
import type { Bot, Job } from './bot.ts';

/**
 * A bot after the pages: searching the hiding places for them (and the dog's mouth), taking
 * them to the corkboard, and reading a step's page there or wherever one lies.
 */
export class PageJobs {
  constructor(private readonly bot: Bot) {}

  /** The next thing to do about pages nobody has read: one lying about, or a hiding place to open. */
  search(): Job | null {
    const sim = this.bot.squad.game.sim;
    const round = this.bot.squad.game.round!;
    const team = this.bot.team;
    const me = this.bot.feet();
    const claimed = new Set(
      [...this.bot.squad.bots.values()]
        .filter((b) => b !== this.bot)
        .map((b) => b.pageJobs.searching),
    );
    // A page lying where someone saw it, nearest first.
    const pages = [...team.sightings]
      .map(([id, s]) => ({ id, s, page: sim.pages.get(id) }))
      .filter(
        ({ id, page }) =>
          page &&
          page.carriedBy === null &&
          !claimed.has(`page|${id}`) &&
          !this.bot.avoided(`page|${id}`) &&
          page.body !== null &&
          page.pinned === null &&
          this.unread(page.printed?.step ?? -2, page.hidden),
      )
      .sort((a, b) => length(sub(a.s.pos, me)) - length(sub(b.s.pos, me)));
    const next = pages[0];
    if (next) {
      const page = next.page!;
      if (page.hideout !== null)
        return this.bot.named('open a hiding place', this.openHideout(page.hideout));
      return this.bot.named('take a page', this.takePage(page.id));
    }
    // A page in the dog's mouth, seen lately: get it to drop it.
    const dogPage = sim.dog.page === null ? undefined : sim.pages.get(sim.dog.page);
    if (
      dogPage &&
      !claimed.has('dog') &&
      !this.bot.me()?.holding &&
      !this.bot.me()?.treat &&
      this.bot.squad.tick - team.dogSeen < 10 * 60 &&
      this.unread(dogPage.printed?.step ?? -2, true)
    ) {
      return this.bot.named('take a page off the dog', this.takeFromDog());
    }
    // Pinned pages someone else put up that nobody here has read: go and read them.
    if (round.canRead(this.bot.id) && !this.bot.saboteur) {
      const unreadPinned = [...sim.pages.values()].find(
        (pg) => pg.pinned !== null && pg.printed && this.unread(pg.printed.step),
      );
      if (unreadPinned && !claimed.has('board'))
        return this.bot.named('read the board', this.readBoard());
    }
    // A hiding place nobody has opened lately, nearest first.
    const hideouts = [...sim.hideouts.values()]
      .filter(
        (h) =>
          !h.locked &&
          !team.wasSearched(h.def.id) &&
          !claimed.has(`hideout|${h.def.id}`) &&
          !this.bot.avoided(`hideout|${h.def.id}`) &&
          (sim.sideOf(h.def.pos) === null || sim.sideOf(h.def.pos) === this.bot.site),
      )
      .sort((a, b) => length(sub(a.def.pos, me)) - length(sub(b.def.pos, me)));
    const h = hideouts[0];
    if (h) return this.bot.named('open a hiding place', this.openHideout(h.def.id));
    // Nothing left to open: go round the places pages lie, the one looked at longest ago first.
    let best: { i: number; score: number } | null = null;
    const spots = this.spots();
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      if (sim.sideOf(s) !== null && sim.sideOf(s) !== this.bot.site) continue;
      if (claimed.has(`spot|${i}`) || this.bot.avoided(`spot|${i}`)) continue;
      const ago = this.bot.squad.tick - (team.looked.get(i) ?? -1e6);
      const score = Math.min(ago, 1e5) - 60 * length(sub(s, me));
      if (!best || score > best.score) best = { i, score };
    }
    if (best) return this.bot.named('look around', this.lookAt(best.i));
    return null;
  }

  /** Where pages lie about: the level's places for them, and where the dog drops them. */
  spots(): Vec3[] {
    const level = this.bot.squad.game.sim.level;
    return [...level.pageSpots, ...level.dog.points];
  }

  /** Grabs the dog's collar, so it drops the page in its mouth. */
  private *takeFromDog(): Job {
    const sim = this.bot.squad.game.sim;
    const ok = yield* this.bot.searchingFor(
      'dog',
      this.bot.use(
        {
          key: 'dog',
          point: () => add(sim.dog.body.translation(), v3(0, 0.1, 0)),
          ok: (o) => o.kind === 'dog',
        },
        { kind: 'grab' },
        0.9,
      ),
    );
    for (let k = 0; k < 20; k++) yield;
    this.bot.look();
    return ok;
  }

  /** What this bot is busy finding, so the others pick something else. */
  get searching(): string {
    return this.bot.searchKey;
  }

  /**
   * Whether the team still needs to read this step's page, or, `hidden` away, to get it back
   * on the board to read there again.
   */
  private unread(step: number, hidden = false): boolean {
    // A page it cannot read could be any: worth taking to the board.
    if (step === -2) return true;
    if (step < 0) return this.bot.team.realStamp === null;
    if (hidden && !this.bot.readablePages(step).length) return true;
    return !this.bot.team.notes.has(step);
  }

  private *takePage(id: number): Job {
    const sim = this.bot.squad.game.sim;
    const ok = yield* this.bot.searchingFor(
      `page|${id}`,
      this.bot.use(
        {
          key: `page|${id}`,
          point: () => {
            const page = sim.pages.get(id);
            return page?.body && page.carriedBy === null && page.pinned === null
              ? page.body.translation()
              : null;
          },
          ok: (o) => o.kind === 'page' && o.pageId === id,
        },
        { kind: 'grab' },
        0.9,
      ),
    );
    if (!ok || this.bot.me()?.page !== id) {
      this.bot.team.sightings.delete(id);
      return false;
    }
    return true;
  }

  private openHideout(id: number): Job {
    return this.bot.searchingFor(`hideout|${id}`, this.openHideoutNow(id));
  }

  private *openHideoutNow(id: number): Job {
    const sim = this.bot.squad.game.sim;
    const h = sim.hideouts.get(id)!;
    const team = this.bot.team;
    if (!h.open) {
      const centre = add(h.def.pos, v3(0, h.def.kind === 'rug' ? 0.02 : 0, 0));
      const ok = yield* this.bot.use(
        {
          key: `hideout|${id}`,
          point: () => centre,
          ok: (o) => o.kind === 'hideout' && o.hideoutId === id,
        },
        { kind: 'grab' },
      );
      if (!ok) return false;
      // Pages spill out in front: take a look.
      for (let k = 0; k < 20; k++) yield;
      this.bot.look();
    }
    team.searched.set(id, this.bot.squad.tick);
    return true;
  }

  private readBoard(): Job {
    return this.bot.searchingFor('board', this.readBoardNow());
  }

  private *readBoardNow(): Job {
    const sim = this.bot.squad.game.sim;
    for (const b of levelBoards(sim.level).filter((x) => x.site === this.bot.site)) {
      for (const side of [1, -1]) {
        const out = rotate(yawQuat(b.facing), v3(0, 0, -side * 1.3));
        const spot = add(b.pos, out);
        const n = this.bot.squad.nav.closest(v3(spot.x, b.pos.y - 1.3, spot.z), 1, 1.5);
        if (n === null) continue;
        yield* this.bot.walk([n], undefined, 20);
        this.bot.ctl.yaw = Math.atan2(-(b.pos.x - spot.x), -(b.pos.z - spot.z));
        for (let k = 0; k < 20; k++) yield;
        this.bot.look();
      }
    }
    return true;
  }

  /**
   * Goes to the board and reads a step's page, which it then
   * remembers in place of the page it had in mind. Someone who cannot read asks the reader.
   */
  *readStep(step: number): Job {
    // Not this one again for a while if it comes to nothing (taken down, or nothing to do).
    this.bot.failed(`read|${step}`, 25);
    const round = this.bot.squad.game.round!;
    if (!round.canRead(this.bot.id)) {
      const note = this.bot.team.notes.get(step);
      if (note) this.bot.remember(note);
      return this.bot.memory?.step === step;
    }
    this.bot.wantStep = step;
    try {
      const sim = this.bot.squad.game.sim;
      const boards = levelBoards(sim.level).filter((b) => b.site === this.bot.site);
      const nav = this.bot.squad.nav;
      for (const pg of this.bot.readablePages(step)) {
        // Someone may have taken it while the bot went to an earlier one.
        if (!pg.body) continue;
        const at = pg.body.translation();
        // In front of the board or behind it (pages hang on both faces); else by it on the floor.
        const b = boards.sort((x, y) => length(sub(x.pos, at)) - length(sub(y.pos, at)))[0];
        const spots =
          pg.pinned !== null && b
            ? [1, -1].map((side) => {
                const spot = add(at, rotate(yawQuat(b.facing), v3(0, 0, -side * 1.3)));
                return nav.closest(v3(spot.x, b.pos.y - 1.3, spot.z), 1, 1.5);
              })
            : nav.around(at, 1.4, 2.6, 0.6).slice(0, 1);
        for (const n of spots) {
          if (this.bot.memory?.step === step) break;
          if (n === null) continue;
          yield* this.bot.walk([n], undefined, 20);
          const from = nav.pos(n);
          this.bot.ctl.yaw = Math.atan2(-(at.x - from.x), -(at.z - from.z));
          for (let k = 0; k < 20; k++) yield;
          this.bot.look();
        }
      }
    } finally {
      this.bot.wantStep = null;
    }
    return this.bot.memory?.step === step;
  }

  private lookAt(i: number): Job {
    return this.bot.searchingFor(`spot|${i}`, this.lookAtNow(i));
  }

  private *lookAtNow(i: number): Job {
    const s = this.spots()[i]!;
    this.bot.failed(`spot|${i}`, 30);
    const nav = this.bot.squad.nav;
    // Stand where it can be seen: from eye height first, else with a jump (onto a tall shelf).
    const top = add(s, v3(0, 0.1, 0));
    const seen = (n: number, h: number) => this.bot.visible(add(nav.pos(n), v3(0, h, 0)), top, -1);
    const n = nav
      .around(s, 1.2, 2.6, 0.6)
      .map((n) => ({ n, rank: seen(n, 1.6) ? 0 : seen(n, 2.3) ? 1 : 2 }))
      .sort((a, b) => a.rank - b.rank)
      .map((o) => o.n);
    const there = n.length ? yield* this.bot.walk(n.slice(0, 4), undefined, 25) : false;
    // Turn round once there, in case it lies behind something.
    for (let k = 0; k < 4; k++) {
      this.bot.ctl.yaw += Math.PI / 2;
      for (let t = 0; t < 6; t++) yield;
      this.bot.look();
    }
    // Up on a shelf above its eyes: jump to see over the edge.
    if (s.y > this.bot.eye().y - 0.3) {
      const f = this.bot.feet();
      this.bot.ctl.yaw = Math.atan2(-(s.x - f.x), -(s.z - f.z));
      this.bot.ctl.jump = true;
      for (let t = 0; t < 30; t++) {
        yield;
        if (t % 5 === 4) this.bot.look();
      }
    }
    if (there) this.bot.team.looked.set(i, this.bot.squad.tick);
    return true;
  }
}
