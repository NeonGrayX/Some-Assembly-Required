// The walking map's searches in WebAssembly. Every sum and product is done in the same order
// as in nav.ts and bot.ts, so a search comes out the same to the last bit either way.

const NAV_CELL: f64 = 0.25;
const STEP: f64 = 0.32;
const INF: f64 = Infinity;

// The map.
let n: i32 = 0;
let xs: usize = 0; // f32[n]
let ys: usize = 0;
let zs: usize = 0;
let part: usize = 0; // i32[n]
let main: i32 = 0;
let linkStart: usize = 0; // i32[n + 1]
let linkTo: usize = 0; // i32[m]
let linkCost: usize = 0; // f64[m]
let colStart: usize = 0; // i32[cols + 1]
let colNodes: usize = 0; // i32[n]
let x0: f64 = 0;
let z0: f64 = 0;
let nx: i32 = 0;
let nz: i32 = 0;
// Scratch.
let gs: usize = 0; // f64[n]
let seen: usize = 0; // u32[n]
let shut: usize = 0;
let goalMark: usize = 0;
let blockMark: usize = 0;
let cameFrom: usize = 0; // i32[n]
let cameLink: usize = 0;
let heapIds: usize = 0; // i32[m + 16]
let heapPri: usize = 0; // f64[m + 16]
let heapSize: i32 = 0;
let search: u32 = 0;
// Inputs: goals, blocked nodes, other players, plates, loose bricks.
let goals: usize = 0; // i32[n]
let gx: usize = 0; // f64[n]
let gz: usize = 0;
let blocked: usize = 0; // i32[n]
let others: usize = 0; // f64[3 * 64]
let plates: usize = 0; // f64[9 * 16]
let nPlates: i32 = 0;
let loose: usize = 0; // f64[3 * 4096]
// Loose bricks by half-metre cell: the first in each, and the next after each.
let cellHead: usize = 0; // i32[cells]
let cellNext: usize = 0; // i32[4096]
let cx0: i32 = 0;
let cz0: i32 = 0;
let cnx: i32 = 0;
let cnz: i32 = 0;

let top: usize = 0;
function grab(bytes: usize): usize {
  const at = (top + 7) & ~(<usize>7);
  top = at + bytes;
  const need = <i32>((top + 0xffff) >> 16);
  const have = memory.size();
  if (need > have) memory.grow(need - have);
  return at;
}

export const MAX_OTHERS: i32 = 64;
export const MAX_PLATES: i32 = 16;
export const MAX_LOOSE: i32 = 4096;

/** Room for a map of `nodes` nodes, `links` links and `cols` columns; returns where the arrays are. */
export function setup(
  nodes: i32,
  links: i32,
  cols: i32,
  gridX0: f64,
  gridZ0: f64,
  gridNx: i32,
  gridNz: i32,
): usize {
  top = __heap_base;
  n = nodes;
  x0 = gridX0;
  z0 = gridZ0;
  nx = gridNx;
  nz = gridNz;
  const table = grab(4 * 16);
  xs = grab(4 * n);
  ys = grab(4 * n);
  zs = grab(4 * n);
  part = grab(4 * n);
  linkStart = grab(4 * (n + 1));
  linkTo = grab(4 * links);
  linkCost = grab(8 * links);
  colStart = grab(4 * (cols + 1));
  colNodes = grab(4 * n);
  gs = grab(8 * n);
  seen = grab(4 * n);
  shut = grab(4 * n);
  goalMark = grab(4 * n);
  blockMark = grab(4 * n);
  cameFrom = grab(4 * n);
  cameLink = grab(4 * n);
  heapIds = grab(4 * (links + 16));
  heapPri = grab(8 * (links + 16));
  goals = grab(4 * n);
  gx = grab(8 * n);
  gz = grab(8 * n);
  blocked = grab(4 * n);
  others = grab(8 * 3 * MAX_OTHERS);
  plates = grab(8 * 9 * MAX_PLATES);
  loose = grab(8 * 3 * MAX_LOOSE);
  // Half-metre cells over the map, with one spare all round.
  cx0 = <i32>Math.floor(x0 / 0.5) - 2;
  cz0 = <i32>Math.floor(z0 / 0.5) - 2;
  cnx = <i32>Math.ceil((<f64>nx * NAV_CELL) / 0.5) + 5;
  cnz = <i32>Math.ceil((<f64>nz * NAV_CELL) / 0.5) + 5;
  cellHead = grab(4 * cnx * cnz);
  cellNext = grab(4 * MAX_LOOSE);
  memory.fill(seen, 0, 4 * n);
  memory.fill(shut, 0, 4 * n);
  memory.fill(goalMark, 0, 4 * n);
  memory.fill(blockMark, 0, 4 * n);
  memory.fill(cellHead, 0xff, 4 * cnx * cnz);
  search = 0;
  const t = [
    xs,
    ys,
    zs,
    part,
    linkStart,
    linkTo,
    linkCost,
    colStart,
    colNodes,
    cameFrom,
    cameLink,
    goals,
    blocked,
    others,
    plates,
    loose,
  ];
  for (let i = 0; i < 16; i++) store<u32>(table + 4 * i, <u32>t[i]);
  return table;
}

export function setMain(m: i32): void {
  main = m;
}

// Math.hypot as V8 works it out for two numbers: the squares over the larger summed with
// Kahan's correction.
function hypot2(a: f64, b: f64): f64 {
  a = Math.abs(a);
  b = Math.abs(b);
  const max = a > b ? a : b;
  if (max == INF) return INF;
  if (isNaN(a) || isNaN(b)) return NaN;
  if (max == 0) return 0;
  let sum: f64 = 0;
  let comp: f64 = 0;
  let k = a / max;
  let summand = k * k - comp;
  let pre = sum + summand;
  comp = pre - sum - summand;
  sum = pre;
  k = b / max;
  summand = k * k - comp;
  pre = sum + summand;
  sum = pre;
  return Math.sqrt(sum) * max;
}

function fx(i: i32): f64 {
  return <f64>load<f32>(xs + ((<usize>i) << 2));
}
function fy(i: i32): f64 {
  return <f64>load<f32>(ys + ((<usize>i) << 2));
}
function fz(i: i32): f64 {
  return <f64>load<f32>(zs + ((<usize>i) << 2));
}
function i32At(p: usize, i: i32): i32 {
  return load<i32>(p + ((<usize>i) << 2));
}
function u32At(p: usize, i: i32): u32 {
  return load<u32>(p + ((<usize>i) << 2));
}
function f64At(p: usize, i: i32): f64 {
  return load<f64>(p + ((<usize>i) << 3));
}

/** The plates for `overPlate`: `count` of them written at `plates`. */
export function setPlates(count: i32): void {
  nPlates = count;
}

/** Whether a spot is on (or right by) a job site's baseplate, as `Bot.overPlate`. */
function overPlate(x: f64, y: f64, z: f64): bool {
  for (let i = 0; i < nPlates; i++) {
    const p = plates + <usize>(i * 72);
    const cx = load<f64>(p);
    const cy = load<f64>(p, 8);
    const cz = load<f64>(p, 16);
    if (Math.abs(y - cy) > 0.8) continue;
    const qx = load<f64>(p, 24);
    const qy = load<f64>(p, 32);
    const qz = load<f64>(p, 40);
    const qw = load<f64>(p, 48);
    // rotate(q, (x - cx, 0, z - cz)), term for term.
    const vx = x - cx;
    const vy: f64 = 0;
    const vz = z - cz;
    const vw: f64 = 0;
    const tx = qw * vx + qx * vw + qy * vz - qz * vy;
    const ty = qw * vy - qx * vz + qy * vw + qz * vx;
    const tz = qw * vz + qx * vy - qy * vx + qz * vw;
    const tw = qw * vw - qx * vx - qy * vy - qz * vz;
    const ncx = -qx;
    const ncy = -qy;
    const ncz = -qz;
    const lx = tw * ncx + tx * qw + ty * ncz - tz * ncy;
    const lz = tw * ncz + tx * ncy - ty * ncx + tz * qw;
    if (Math.abs(lx) < load<f64>(p, 56) && Math.abs(lz) < load<f64>(p, 64)) return true;
  }
  return false;
}

export function overPlateAt(x: f64, y: f64, z: f64): bool {
  return overPlate(x, y, z);
}

/** Whether walking straight from a to b goes over a baseplate (when a is not on it). */
export function crossesPlate(ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64): bool {
  if (overPlate(ax, ay, az)) return false;
  const steps = <i32>Math.ceil(hypot2(bx - ax, bz - az) / 0.2);
  for (let k = 1; k <= steps; k++) {
    const t = <f64>k / <f64>steps;
    if (overPlate(ax + (bx - ax) * t, by, az + (bz - az) * t)) return true;
  }
  return false;
}

/** Whether a straight walk from a to b stays on the map on one floor, as `NavGrid.straight`. */
export function straight(ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64): bool {
  if (Math.abs(ay - by) > 3) return false;
  const d = hypot2(bx - ax, bz - az);
  const steps = <i32>Math.max(1, Math.ceil(d / (NAV_CELL * 0.5)));
  let y = ay;
  for (let s = 1; s <= steps; s++) {
    const t = <f64>s / <f64>steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const expect = ay + (by - ay) * t;
    const i = <i32>Math.floor((x - x0) / NAV_CELL);
    const k = <i32>Math.floor((z - z0) / NAV_CELL);
    if (i < 0 || k < 0 || i >= nx || k >= nz) return false;
    let next: f64 = NaN;
    let found = false;
    const col = i * nz + k;
    for (let c = i32At(colStart, col), end = i32At(colStart, col + 1); c < end; c++) {
      const nn = i32At(colNodes, c);
      const h = fy(nn);
      if (Math.abs(h - y) <= STEP && Math.abs(h - expect) <= 0.45 && i32At(part, nn) == main) {
        next = h;
        found = true;
      }
    }
    if (!found) return false;
    y = next;
  }
  return Math.abs(y - by) <= 0.35;
}

function push(id: i32, p: f64): void {
  let i = heapSize++;
  while (i > 0) {
    const up = (i - 1) >> 1;
    const upP = f64At(heapPri, up);
    if (upP <= p) break;
    store<i32>(heapIds + ((<usize>i) << 2), i32At(heapIds, up));
    store<f64>(heapPri + ((<usize>i) << 3), upP);
    i = up;
  }
  store<i32>(heapIds + ((<usize>i) << 2), id);
  store<f64>(heapPri + ((<usize>i) << 3), p);
}

function pop(): i32 {
  const topId = i32At(heapIds, 0);
  heapSize--;
  const lastId = i32At(heapIds, heapSize);
  const lastP = f64At(heapPri, heapSize);
  if (heapSize) {
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= heapSize) break;
      const r = l + 1;
      const c = r < heapSize && f64At(heapPri, r) < f64At(heapPri, l) ? r : l;
      const cP = f64At(heapPri, c);
      if (cP >= lastP) break;
      store<i32>(heapIds + ((<usize>i) << 2), i32At(heapIds, c));
      store<f64>(heapPri + ((<usize>i) << 3), cP);
      i = c;
    }
    store<i32>(heapIds + ((<usize>i) << 2), lastId);
    store<f64>(heapPri + ((<usize>i) << 3), lastP);
  }
  return topId;
}

let nGoals: i32 = 0;
function heuristic(node: i32): f64 {
  let best = INF;
  const x = fx(node);
  const z = fz(node);
  for (let i = 0; i < nGoals; i++) {
    best = Math.min(best, hypot2(x - f64At(gx, i), z - f64At(gz, i)));
  }
  return best;
}

let nOthers: i32 = 0;
let nLoose: i32 = 0;
let tripCost: f64 = 0;
let feet: f64 = 0;

/** Whether a loose brick lies where a player standing at (x, y, z) would trip on it. */
function trips(x: f64, y: f64, z: f64): bool {
  const ci = <i32>Math.floor(x / 0.5) - cx0;
  const ck = <i32>Math.floor(z / 0.5) - cz0;
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let k = ck - 1; k <= ck + 1; k++) {
      if (i < 0 || k < 0 || i >= cnx || k >= cnz) continue;
      for (let b = i32At(cellHead, i * cnz + k); b >= 0; b = i32At(cellNext, b)) {
        const p = loose + <usize>(b * 24);
        if (
          Math.abs(load<f64>(p, 8) - y) < 0.3 &&
          hypot2(load<f64>(p) - x, load<f64>(p, 16) - z) < 0.4
        )
          return true;
      }
    }
  }
  return false;
}

/** Extra cost of stepping on a node, as `Bot.costs` works it out. */
function cost(node: i32, mark: u32): f64 {
  let c: f64 = u32At(blockMark, node) == mark ? 25 : 0;
  const x = fx(node);
  const y = fy(node);
  const z = fz(node);
  for (let i = 0; i < nOthers; i++) {
    const p = others + <usize>(i * 24);
    if (
      hypot2(load<f64>(p) - x, load<f64>(p, 16) - z) < 0.5 &&
      Math.abs(load<f64>(p, 8) - feet - y) < 1
    )
      c += 1.5;
  }
  if (overPlate(x, y, z)) c += 40;
  if (nLoose && trips(x, y, z)) c += tripCost;
  return c;
}

/**
 * The cheapest way from `from` to the nearest of `goalCount` goals (written at `goals`), with
 * the costs of other players, blocked nodes, plates and loose bricks when `withCosts`. Returns
 * the goal reached, or -1; the way back is in `cameFrom` and `cameLink`.
 */
export function path(
  from: i32,
  goalCount: i32,
  withCosts: bool,
  blockedCount: i32,
  otherCount: i32,
  looseCount: i32,
  trip: f64,
  feetHeight: f64,
): i32 {
  if (++search == 0xffffffff) {
    memory.fill(seen, 0, 4 * n);
    memory.fill(shut, 0, 4 * n);
    memory.fill(goalMark, 0, 4 * n);
    memory.fill(blockMark, 0, 4 * n);
    search = 1;
  }
  const mark = search;
  nGoals = goalCount;
  for (let i = 0; i < goalCount; i++) {
    const g = i32At(goals, i);
    store<u32>(goalMark + ((<usize>g) << 2), mark);
    store<f64>(gx + ((<usize>i) << 3), fx(g));
    store<f64>(gz + ((<usize>i) << 3), fz(g));
  }
  for (let i = 0; i < blockedCount; i++)
    store<u32>(blockMark + ((<usize>i32At(blocked, i)) << 2), mark);
  nOthers = otherCount;
  tripCost = trip;
  feet = feetHeight;
  nLoose = looseCount;
  for (let b = 0; b < looseCount; b++) {
    const p = loose + <usize>(b * 24);
    const ci = <i32>Math.floor(load<f64>(p) / 0.5) - cx0;
    const ck = <i32>Math.floor(load<f64>(p, 16) / 0.5) - cz0;
    // Off the map: too far from anywhere to trip on.
    if (ci < 0 || ck < 0 || ci >= cnx || ck >= cnz) {
      store<i32>(cellNext + ((<usize>b) << 2), -2);
      continue;
    }
    // Kept in the order they came, as the JavaScript lists keep them.
    store<i32>(cellNext + ((<usize>b) << 2), -1);
    const head = cellHead + ((<usize>(ci * cnz + ck)) << 2);
    let at = load<i32>(head);
    if (at < 0) store<i32>(head, b);
    else {
      while (i32At(cellNext, at) >= 0) at = i32At(cellNext, at);
      store<i32>(cellNext + ((<usize>at) << 2), b);
    }
  }
  store<f64>(gs + ((<usize>from) << 3), 0);
  store<u32>(seen + ((<usize>from) << 2), mark);
  heapSize = 0;
  push(from, heuristic(from));
  let found = -1;
  let expanded = 0;
  while (heapSize) {
    const node = pop();
    if (u32At(shut, node) == mark) continue;
    if (u32At(goalMark, node) == mark) {
      found = node;
      break;
    }
    store<u32>(shut + ((<usize>node) << 2), mark);
    if (++expanded > 60000) break;
    const gn = f64At(gs, node);
    const first = i32At(linkStart, node);
    const end = i32At(linkStart, node + 1);
    for (let li = first; li < end; li++) {
      const to = i32At(linkTo, li);
      if (u32At(shut, to) == mark) continue;
      const c = gn + f64At(linkCost, li) + (withCosts ? cost(to, mark) : 0);
      if (c < (u32At(seen, to) == mark ? f64At(gs, to) : INF)) {
        store<f64>(gs + ((<usize>to) << 3), c);
        store<u32>(seen + ((<usize>to) << 2), mark);
        store<i32>(cameFrom + ((<usize>to) << 2), node);
        store<i32>(cameLink + ((<usize>to) << 2), li - first);
        push(to, c + heuristic(to));
      }
    }
  }
  // Empty the cells again for the next search.
  for (let b = 0; b < looseCount; b++) {
    const p = loose + <usize>(b * 24);
    const ci = <i32>Math.floor(load<f64>(p) / 0.5) - cx0;
    const ck = <i32>Math.floor(load<f64>(p, 16) / 0.5) - cz0;
    if (ci < 0 || ck < 0 || ci >= cnx || ck >= cnz) continue;
    store<i32>(cellHead + ((<usize>(ci * cnz + ck)) << 2), -1);
  }
  return found;
}
