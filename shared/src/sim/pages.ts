import type { StealTarget } from './dog.ts';
import type { PrintedPage } from '../builds/forgery.ts';
import { BOARD_FACE_SLOTS, BOARD_SIZE, BOARD_SLOTS, levelBoards } from '../content/house.ts';
import { add, conj, length, mulQuat, rotate, scale, sub, v3, yawQuat } from '../math.ts';
import type { Quat, Vec3 } from '../math.ts';
import { PAGE_SIZE, restingOn } from './body.ts';
import type { Sim, Player, PageItem } from './sim.ts';

/**
 * The round's pages: printed and dropped, picked up and carried in a pocket, tucked into hiding
 * places, and pinned to the corkboards (and stolen off them by the dog). Their state stays on the
 * `Sim` (`Sim.pages`). Part of the `Sim`.
 */
export class Pages {
  /** Every corkboard, site by site (see `levelBoards`): slots run board by board. */
  readonly boards: { site: number; pos: Vec3; facing: number }[];

  constructor(private readonly sim: Sim) {
    this.boards = levelBoards(sim.level);
  }

  /**
   * Where a page pinned to `slot` hangs: two rows of four on each face of a board, the front
   * (the side its `facing` looks toward) first, board after board.
   */
  slotPose(slot: number): { pos: Vec3; rot: Quat } {
    const b = this.boards[Math.floor(slot / BOARD_SLOTS)]!;
    const face = Math.floor(slot / BOARD_FACE_SLOTS) % 2;
    // Turned around for the back face, so that face is laid out just like the front.
    const rot = mulQuat(yawQuat(b.facing), yawQuat(face * Math.PI));
    const col = slot % 4;
    const row = Math.floor((slot % BOARD_FACE_SLOTS) / 4);
    const local = v3((col - 1.5) * 0.38, row === 0 ? 0.24 : -0.24, -(BOARD_SIZE.z / 2 + 0.01));
    // The page's printed face (+y) turned to face out of the board, with the top of the print
    // (the page's -z edge) up: turned end for end, then stood up.
    const standUp = { x: -Math.sin(Math.PI / 4), y: 0, z: 0, w: Math.cos(Math.PI / 4) };
    const faceOut = mulQuat(mulQuat(rot, standUp), yawQuat(Math.PI));
    return { pos: add(b.pos, rotate(rot, local)), rot: faceOut };
  }

  /**
   * Pages the dog can jump up and take: those in the bottom row of either face (the top row is
   * out of its reach), with the spot on the floor in front of each where it stands to jump.
   */
  stealTargets(): StealTarget[] {
    const targets: StealTarget[] = [];
    for (const page of this.sim.pages.values()) {
      const slot = page.pinned;
      if (slot === null || !page.body || slot % BOARD_FACE_SLOTS < 4) continue;
      const b = this.boards[Math.floor(slot / BOARD_SLOTS)]!;
      const face = Math.floor(slot / BOARD_FACE_SLOTS) % 2;
      const out = rotate(yawQuat(b.facing + face * Math.PI), v3(0, 0, -1));
      const at = this.slotPose(slot).pos;
      const stand = v3(at.x + out.x * 0.45, 0, at.z + out.z * 0.45);
      targets.push({ page, stand: this.sim.aboveGround(stand, 0) });
    }
    return targets;
  }

  /** Which face of a board a point is on: 0 for the front, 1 for the back. */
  private boardFace(board: number, at: Vec3): number {
    const b = this.boards[board]!;
    const local = rotate(conj(yawQuat(b.facing)), sub(at, b.pos));
    return local.z < 0 ? 0 : 1;
  }

  /**
   * Pins the page in the player's pocket to the free slot closest to where they clicked, on the
   * board and face they clicked.
   */
  pinPocketPage(p: Player, board: number, at: Vec3): void {
    const page = p.page === null ? undefined : this.sim.pages.get(p.page);
    if (!page) return;
    const face = this.boardFace(board, at);
    const taken = new Set([...this.sim.pages.values()].map((x) => x.pinned));
    const first = board * BOARD_SLOTS + face * BOARD_FACE_SLOTS;
    const free = Array.from({ length: BOARD_FACE_SLOTS }, (_, i) => first + i).filter(
      (i) => !taken.has(i),
    );
    if (!free.length) return;
    const slot = free.sort(
      (a, b) => length(sub(this.slotPose(a).pos, at)) - length(sub(this.slotPose(b).pos, at)),
    )[0]!;
    p.page = null;
    this.pinPage(page, slot);
    this.sim.events.push({ kind: 'pin', pos: at, playerId: p.id });
  }

  /**
   * Demo mode: pins a page straight to a corkboard slot, wherever it is (lying about, in a
   * pocket or shut in a hiding place). Whatever already hangs in that slot is left where it is.
   */
  pinToBoard(page: PageItem, slot: number): void {
    if (slot < 0 || slot >= this.boards.length * BOARD_SLOTS) return;
    if (page.hideout !== null) {
      const h = this.sim.hideouts.get(page.hideout);
      if (h) h.contents = h.contents.filter((id) => id !== page.id);
    }
    page.hidden = false;
    page.hideout = null;
    this.pinPage(page, slot);
  }

  pinPage(page: PageItem, slot: number): void {
    this.detachPage(page);
    const { pos, rot } = this.slotPose(slot);
    const body = this.sim.world.createRigidBody(
      this.sim.R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(rot),
    );
    const c = this.sim.world.createCollider(
      this.sim.R.ColliderDesc.cuboid(PAGE_SIZE.x / 2, PAGE_SIZE.y / 2, PAGE_SIZE.z / 2),
      body,
    );
    this.sim.owners.set(c.handle, { kind: 'page', pageId: page.id });
    page.body = body;
    page.pinned = slot;
    page.version++;
  }

  /** Takes a page out of the world (or off the board) without putting it anywhere yet. */
  detachPage(page: PageItem): void {
    if (page.body) {
      this.sim.owners.delete(page.body.collider(0).handle);
      this.sim.world.removeRigidBody(page.body);
      page.body = null;
    }
    if (page.carriedBy !== null) {
      const holder = this.sim.players.get(page.carriedBy);
      if (holder?.page === page.id) holder.page = null;
    }
    page.carriedBy = null;
    page.pinned = null;
  }

  /** Puts a printed page (step -1 is the master index) into the world, lying at `pos`. */
  spawnPage(printed: PrintedPage | null, pos: Vec3, yaw = 0, id = this.sim.newId()): PageItem {
    const page = this.newPage(printed, id);
    this.placePage(page, restingOn(pos, PAGE_SIZE), yawQuat(yaw));
    return page;
  }

  /** Puts a printed page straight into a hiding place, shut. */
  spawnPageInHideout(printed: PrintedPage | null, hideoutId: number): PageItem {
    const page = this.newPage(printed, this.sim.newId());
    this.sim.hiding.hideInHideout(page, hideoutId);
    return page;
  }

  /** A page that is nowhere yet. */
  newPage(printed: PrintedPage | null, id: number): PageItem {
    const page: PageItem = {
      id,
      step: printed?.step ?? -1,
      printed,
      body: null,
      carriedBy: null,
      hidden: false,
      hideout: null,
      pinned: null,
      version: 0,
    };
    this.sim.pages.set(page.id, page);
    return page;
  }

  /** Puts a page into the world with its middle at `centre`. */
  placePage(page: PageItem, at: Vec3, rot: Quat, linvel: Vec3 = v3()): void {
    const { R } = this.sim;
    const centre = this.sim.aboveGround(at, PAGE_SIZE.y / 2 + 0.01, PAGE_SIZE.z / 2);
    const body = this.sim.world.createRigidBody(
      (this.sim.replica ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.dynamic())
        .setTranslation(centre.x, centre.y, centre.z)
        .setRotation(rot)
        .setLinvel(linvel.x, linvel.y, linvel.z)
        .setLinearDamping(1.5)
        .setAngularDamping(3),
    );
    const c = this.sim.world.createCollider(
      R.ColliderDesc.cuboid(PAGE_SIZE.x / 2, PAGE_SIZE.y / 2, PAGE_SIZE.z / 2)
        .setDensity(60)
        .setFriction(1),
      body,
    );
    this.sim.owners.set(c.handle, { kind: 'page', pageId: page.id });
    page.body = body;
    page.carriedBy = null;
    page.pinned = null;
  }

  takePage(p: Player, page: PageItem): void {
    if (!page.body) return;
    if (p.page !== null) this.dropPage(p);
    const pos = page.body.translation();
    this.detachPage(page);
    page.carriedBy = p.id;
    page.version++;
    p.page = page.id;
    this.sim.events.push({ kind: 'page', pos, playerId: p.id });
  }

  dropPage(p: Player): void {
    const page = p.page === null ? undefined : this.sim.pages.get(p.page);
    p.page = null;
    if (!page) return;
    const yaw = p.input.yaw;
    const f = v3(-Math.sin(yaw), 0, -Math.cos(yaw));
    // Let go of a little below the hands.
    const pos = add(this.sim.eye(p), add(scale(f, 0.5), v3(0, -0.4, 0)));
    this.placePage(page, restingOn(pos, PAGE_SIZE), yawQuat(yaw), scale(f, 1));
    page.version++;
  }
}
