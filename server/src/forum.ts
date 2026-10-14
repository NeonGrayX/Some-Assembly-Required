import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  BUILD_FILE_EXTENSION,
  BUILD_FILE_LIMITS,
  FORUM_ID,
  FORUM_KEY,
  FORUM_KEY_HEADER,
  FORUM_LIMITS,
  allBins,
  forumText,
  parseBuildFile,
  stringifyBuildFile,
} from '@sar/shared';
import type {
  TargetBuild,
  ForumComment,
  ForumPage,
  ForumPost,
  ForumPostSummary,
  ForumSort,
} from '@sar/shared';
import { RateLimiter, clientAddress } from './limits.ts';
import type { ClientIpHeader } from './limits.ts';

/*
 * The community page's server side: shared builds, their likes and comments, kept in a folder
 * (`index.json` plus one build file per post) so they survive restarts. Players have no
 * accounts: their browser makes a random key (FORUM_KEY) and sends it with every request, and
 * the server keeps only its hash. That is what marks a post or comment as theirs to delete and
 * keeps their likes to one per post. Whoever runs the server can delete anything with the key
 * in SAR_FORUM_ADMIN_KEY.
 */

/** Posts the server keeps at most, and their build files' total size. */
const MAX_POSTS = Number(process.env.SAR_FORUM_MAX_POSTS) || 2000;
const MAX_BYTES = 200 * 1024 * 1024;
/** Posts one player may have up at once. */
const MAX_POSTS_PER_PLAYER = 100;
/** Requests one address may make, by kind: reading is cheap, sharing a build is not. */
const RATES = {
  read: { perSecond: 5, burst: 30 },
  share: { perSecond: 1 / 60, burst: 5 },
  comment: { perSecond: 1 / 10, burst: 5 },
  like: { perSecond: 2, burst: 20 },
  delete: { perSecond: 2, burst: 20 },
};
type RateKind = keyof typeof RATES;
/** How long an address stays remembered for rate limiting once it stops asking. */
const QUIET_MS = 10 * 60_000;
/** Request bodies other than a build file. */
const MAX_JSON_BYTES = 4 * 1024;
/** How long after a change the index is written, so a burst of likes is one write. */
const SAVE_DELAY_MS = 500;

interface StoredComment {
  id: string;
  author: string;
  text: string;
  createdAt: number;
  owner: string;
}

interface StoredPost {
  id: string;
  /** The build's own id, for the downloaded file's name. */
  buildId: string;
  name: string;
  description: string;
  author: string;
  pages: number;
  bricks: number;
  createdAt: number;
  owner: string;
  /** Hash of the stored file, so the same build is not shared twice. */
  hash: string;
  bytes: number;
  likes: string[];
  comments: StoredComment[];
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isStoredComment(v: unknown): v is StoredComment {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    isString(c.id) &&
    isString(c.author) &&
    isString(c.text) &&
    isNumber(c.createdAt) &&
    isString(c.owner)
  );
}

/** Whether an entry read back from `index.json` is a whole post, as `ForumStore` writes them. */
function isStoredPost(v: unknown): v is StoredPost {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    isString(p.id) &&
    FORUM_ID.test(p.id) &&
    isString(p.buildId) &&
    isString(p.name) &&
    isString(p.description) &&
    isString(p.author) &&
    isNumber(p.pages) &&
    isNumber(p.bricks) &&
    isNumber(p.createdAt) &&
    isString(p.owner) &&
    isString(p.hash) &&
    isNumber(p.bytes) &&
    Array.isArray(p.likes) &&
    p.likes.every(isString) &&
    Array.isArray(p.comments) &&
    p.comments.every(isStoredComment)
  );
}

/** Where the posts' build files are kept, by post id. */
interface BuildFiles {
  has(id: string): boolean;
  read(id: string): string;
  write(id: string, text: string): void;
  remove(id: string): void;
}

/** Build files on disk, in `dir`/builds. */
function diskFiles(dir: string): BuildFiles {
  mkdirSync(join(dir, 'builds'), { recursive: true });
  const path = (id: string) => join(dir, 'builds', `${id}${BUILD_FILE_EXTENSION}`);
  return {
    has: (id) => existsSync(path(id)),
    read: (id) => readFileSync(path(id), 'utf8'),
    write: (id, text) => writeFileSync(path(id), text),
    remove: (id) => rmSync(path(id), { force: true }),
  };
}

/** Build files kept in memory, until the server stops. */
function memoryFiles(): BuildFiles {
  const files = new Map<string, string>();
  return {
    has: (id) => files.has(id),
    read: (id) => {
      const text = files.get(id);
      if (text === undefined) throw new ForumError(404, 'That build is no longer shared.');
      return text;
    },
    write: (id, text) => void files.set(id, text),
    remove: (id) => void files.delete(id),
  };
}

export interface ForumStoreOptions {
  /** The folder to keep posts in; in memory only (until the server stops) when null. */
  dir: string | null;
  log?: (line: string) => void;
  /** The key that may delete anything (SAR_FORUM_ADMIN_KEY on a real server). */
  adminKey?: string;
  /** The clock posts and comments are dated by. */
  now?: () => number;
  /** The game's own builds, put up once each (BUILDS on a real server). */
  builtIn?: readonly TargetBuild[];
}

export class ForumError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/**
 * Owns the game's own builds on the page. No key hashes to it, so only the admin key can take
 * them down.
 */
const GAME_OWNER = 'game';
const GAME_AUTHOR = 'Some Assembly Required';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const newId = () => {
  const bytes = randomBytes(10);
  return [...bytes].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
};

/**
 * The posts, in memory, written to `dir` after each change. With no folder (tests, or a server
 * that cannot write one) they last until the server stops.
 */
export class ForumStore {
  private readonly posts = new Map<string, StoredPost>();
  private readonly dir: string | null;
  private readonly files: BuildFiles;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly admin: string | null;
  /** Ids of the game's builds put up already, so one taken down stays down. */
  private readonly seeded = new Set<string>();

  constructor(opts: ForumStoreOptions) {
    const { dir, adminKey, builtIn = [] } = opts;
    this.dir = dir;
    this.log = opts.log ?? console.log;
    this.now = opts.now ?? Date.now;
    this.admin = adminKey && FORUM_KEY.test(adminKey) ? ForumStore.owner(adminKey) : null;
    if (adminKey && !this.admin)
      this.log('SAR_FORUM_ADMIN_KEY must be 32 to 64 letters, digits, - or _');
    this.files = dir ? diskFiles(dir) : memoryFiles();
    if (dir) this.load(dir);
    this.seed(builtIn);
  }

  /**
   * Shares each of the game's builds that was never shared before, under the game's name. The
   * first in the list comes out newest, so the list starts the way the game's build list does.
   */
  private seed(builds: readonly TargetBuild[]): void {
    const t = this.now();
    let added = 0;
    builds.forEach((b, i) => {
      if (this.seeded.has(b.id)) return;
      this.seeded.add(b.id);
      const text = stringifyBuildFile(b);
      const h = hash(text);
      if ([...this.posts.values()].some((p) => p.hash === h)) return;
      try {
        this.insert(b, text, h, GAME_AUTHOR, GAME_OWNER, t - i);
        added++;
      } catch (err) {
        this.log(`community page: could not share ${b.id}: ${(err as Error).message}`);
      }
    });
    if (added) {
      this.log(`community page: shared ${added} of the game's builds`);
      this.save();
    }
  }

  /** The owner id of a key: its hash, so the keys themselves are never stored. */
  static owner(key: string): string {
    return hash(`sar-forum:${key}`);
  }

  /**
   * Reads the posts back from `index.json`. One that cannot be read as JSON (cut short by a full
   * disk, say) is moved aside for whoever runs the server to look at, and the page starts empty
   * in the same folder; entries that are not whole posts are skipped.
   */
  private load(dir: string): void {
    const index = join(dir, 'index.json');
    if (!existsSync(index)) return;
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(index, 'utf8'));
    } catch (err) {
      const aside = `${index}.corrupt-${this.now()}`;
      renameSync(index, aside);
      this.log(
        `community page: could not read ${index} (${(err as Error).message}); moved it to ${aside} and started afresh`,
      );
      return;
    }
    const { posts, seeded } = (data && typeof data === 'object' ? data : {}) as Record<
      string,
      unknown
    >;
    if (Array.isArray(seeded)) for (const id of seeded) if (isString(id)) this.seeded.add(id);
    let skipped = 0;
    for (const p of Array.isArray(posts) ? posts : []) {
      if (isStoredPost(p) && this.files.has(p.id)) this.posts.set(p.id, p);
      else skipped++;
    }
    this.log(
      `community page: ${this.posts.size} shared builds` +
        (skipped ? ` (${skipped} unreadable or missing their file, skipped)` : ''),
    );
  }

  private save(): void {
    if (!this.dir || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  /** Writes the index now. A new file then a rename, so a crash never leaves half of one. */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.dir) return;
    const path = join(this.dir, 'index.json');
    try {
      writeFileSync(
        `${path}.tmp`,
        JSON.stringify({
          version: 1,
          posts: [...this.posts.values()],
          seeded: [...this.seeded],
        }),
      );
      renameSync(`${path}.tmp`, path);
    } catch (err) {
      this.log(`community page: could not save: ${(err as Error).message}`);
    }
  }

  private isAdmin(owner: string): boolean {
    return owner === this.admin;
  }

  private summary(p: StoredPost, viewer: string | null): ForumPostSummary {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      author: p.author,
      pages: p.pages,
      bricks: p.bricks,
      likes: p.likes.length,
      comments: p.comments.length,
      createdAt: p.createdAt,
      liked: !!viewer && p.likes.includes(viewer),
      mine: !!viewer && (p.owner === viewer || this.isAdmin(viewer)),
    };
  }

  private get(id: string): StoredPost {
    const p = FORUM_ID.test(id) ? this.posts.get(id) : undefined;
    if (!p) throw new ForumError(404, 'That build is no longer shared.');
    return p;
  }

  list(opts: { sort: ForumSort; search: string; page: number }, viewer: string | null): ForumPage {
    const q = opts.search.trim().toLowerCase();
    let posts = [...this.posts.values()];
    if (q) {
      posts = posts.filter((p) =>
        [p.name, p.author, p.description].some((t) => t.toLowerCase().includes(q)),
      );
    }
    posts.sort((a, b) =>
      opts.sort === 'top'
        ? b.likes.length - a.likes.length || b.createdAt - a.createdAt
        : b.createdAt - a.createdAt,
    );
    const start = opts.page * FORUM_LIMITS.pageSize;
    return {
      posts: posts.slice(start, start + FORUM_LIMITS.pageSize).map((p) => this.summary(p, viewer)),
      total: posts.length,
    };
  }

  post(id: string, viewer: string | null): ForumPost {
    const p = this.get(id);
    const mayDelete = (c: StoredComment) =>
      !!viewer && (c.owner === viewer || p.owner === viewer || this.isAdmin(viewer));
    return {
      ...this.summary(p, viewer),
      commentList: p.comments.map((c): ForumComment => ({
        id: c.id,
        author: c.author,
        text: c.text,
        createdAt: c.createdAt,
        mine: mayDelete(c),
      })),
    };
  }

  /** The post's build file, and the name to save it under. */
  file(id: string): { name: string; text: string } {
    const p = this.get(id);
    return { name: `${p.buildId}${BUILD_FILE_EXTENSION}`, text: this.files.read(id) };
  }

  /**
   * Shares a build file. It is checked the way the build editor imports one and stored as the
   * editor would export it, so nothing but the documented fields is ever kept or handed out.
   */
  share(fileText: string, author: string, owner: string): ForumPostSummary {
    const r = parseBuildFile(fileText, allBins());
    if (!r.ok) {
      throw new ForumError(
        400,
        `That build file has problems: ${r.problems.slice(0, 3).join('; ')}`,
        {
          problems: r.problems.slice(0, 20),
        },
      );
    }
    const text = stringifyBuildFile(r.build);
    const h = hash(text);
    const same = [...this.posts.values()].find((p) => p.hash === h);
    if (same) throw new ForumError(409, 'That build is already shared.', { id: same.id });
    const mine = [...this.posts.values()].filter((p) => p.owner === owner).length;
    if (mine >= MAX_POSTS_PER_PLAYER) {
      throw new ForumError(403, 'You have shared a lot of builds. Delete an old one first.');
    }
    const name = forumText(author, FORUM_LIMITS.nameLength) || 'Someone';
    const post = this.insert(r.build, text, h, name, owner, this.now());
    this.save();
    return this.summary(post, owner);
  }

  /** Stores a checked build file (`text`, hashed to `h`) as a new post. */
  private insert(
    b: TargetBuild,
    text: string,
    h: string,
    author: string,
    owner: string,
    createdAt: number,
  ): StoredPost {
    const bytes = Buffer.byteLength(text);
    const total = [...this.posts.values()].reduce((n, p) => n + p.bytes, 0);
    if (this.posts.size >= MAX_POSTS || total + bytes > MAX_BYTES) {
      throw new ForumError(507, 'The community page is full right now.');
    }
    let id = newId();
    while (this.posts.has(id)) id = newId();
    const post: StoredPost = {
      id,
      buildId: b.id,
      name: b.name,
      description: b.description ?? '',
      author,
      pages: b.steps.length,
      bricks: b.steps.reduce((n, s) => n + s.bricks.length, 0),
      createdAt,
      owner,
      hash: h,
      bytes,
      likes: [],
      comments: [],
    };
    this.files.write(id, text);
    this.posts.set(id, post);
    return post;
  }

  remove(id: string, owner: string): void {
    const p = this.get(id);
    if (p.owner !== owner && !this.isAdmin(owner)) {
      throw new ForumError(403, 'Only who shared a build can take it down.');
    }
    this.posts.delete(id);
    this.files.remove(id);
    this.save();
  }

  like(id: string, owner: string, liked: boolean): { likes: number; liked: boolean } {
    const p = this.get(id);
    const i = p.likes.indexOf(owner);
    if (liked && i < 0) p.likes.push(owner);
    if (!liked && i >= 0) p.likes.splice(i, 1);
    this.save();
    return { likes: p.likes.length, liked };
  }

  comment(id: string, author: string, text: string, owner: string): ForumComment {
    const p = this.get(id);
    const body = forumText(text, FORUM_LIMITS.commentLength, true);
    if (!body) throw new ForumError(400, 'Write something first.');
    if (p.comments.length >= FORUM_LIMITS.commentsPerPost) {
      throw new ForumError(403, 'This build has all the comments it can take.');
    }
    let cid = newId();
    while (p.comments.some((c) => c.id === cid)) cid = newId();
    const c: StoredComment = {
      id: cid,
      author: forumText(author, FORUM_LIMITS.nameLength) || 'Someone',
      text: body,
      createdAt: this.now(),
      owner,
    };
    p.comments.push(c);
    this.save();
    return { id: c.id, author: c.author, text: c.text, createdAt: c.createdAt, mine: true };
  }

  removeComment(id: string, commentId: string, owner: string): void {
    const p = this.get(id);
    const i = p.comments.findIndex((c) => c.id === commentId);
    if (i < 0) throw new ForumError(404, 'That comment is gone.');
    if (p.comments[i]!.owner !== owner && p.owner !== owner && !this.isAdmin(owner)) {
      throw new ForumError(403, 'That comment is not yours to delete.');
    }
    p.comments.splice(i, 1);
    this.save();
  }
}

/** Reads a request body up to `max` bytes; longer ones are refused with 413. */
function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((done, fail) => {
    const declared = Number(req.headers['content-length']);
    if (declared > max) return fail(new ForumError(413, 'That is too big to share.'));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        // The rest is read and dropped, so the answer still reaches the browser.
        req.removeAllListeners('data');
        req.resume();
        fail(new ForumError(413, 'That is too big to share.'));
      } else chunks.push(chunk);
    });
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new ForumError(415, 'Send JSON.');
  }
  try {
    const v: unknown = JSON.parse(await readBody(req, MAX_JSON_BYTES));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ForumError) throw err;
  }
  throw new ForumError(400, 'Send a JSON object.');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res
    .writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    .end(JSON.stringify(body));
}

const PREFIX = '/api/forum/posts';

/**
 * Answers the community page's requests under /api/forum/:
 *
 *   GET    posts?sort=new|top&q=&page=     a page of posts
 *   POST   posts?author=                   share the build file in the body
 *   GET    posts/<id>                      one post with its comments
 *   DELETE posts/<id>                      take your post down
 *   GET    posts/<id>/file                 download its build file
 *   PUT    posts/<id>/like                 {"liked": true|false}
 *   POST   posts/<id>/comments             {"author", "text"}
 *   DELETE posts/<id>/comments/<cid>       delete your comment, or one on your post
 *
 * Everything but reading needs the player's key in the FORUM_KEY_HEADER header. A custom header
 * also means another site's page cannot send these for a player: browsers ask first, and this
 * server never says yes. Returns false for any other request.
 */
export function forumHandler(
  store: ForumStore,
  log: (line: string) => void,
  clientIpHeader: ClientIpHeader | null = null,
  now: () => number = () => performance.now(),
): (req: IncomingMessage, res: ServerResponse) => boolean {
  const limits = new RateLimiter(RATES, QUIET_MS, now);
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) {
      return url.pathname.startsWith('/api/')
        ? (send(res, 404, { error: 'Not found.' }), true)
        : false;
    }
    void route(req, res, url).catch((err: unknown) => {
      if (err instanceof ForumError)
        return send(res, err.status, { error: err.message, ...err.extra });
      log(`community page: error on ${req.method} ${url.pathname}: ${(err as Error).stack}`);
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong. Try again.' });
      else res.end();
    });
    return true;
  };

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const parts = url.pathname.slice(PREFIX.length).split('/').filter(Boolean);
    const method = req.method ?? 'GET';
    const header = req.headers[FORUM_KEY_HEADER];
    const key = typeof header === 'string' && FORUM_KEY.test(header) ? header : null;
    const viewer = key ? ForumStore.owner(key) : null;
    const address = clientAddress(req, clientIpHeader);
    const limit = (kind: RateKind) => {
      if (!limits.take(address, kind)) {
        res.setHeader('retry-after', kind === 'share' ? '60' : '10');
        throw new ForumError(
          429,
          kind === 'share'
            ? 'You are sharing builds very quickly. Wait a minute.'
            : 'Slow down a little, then try again.',
        );
      }
    };
    const player = () => {
      if (!viewer) throw new ForumError(401, 'Reload the page and try again.');
      return viewer;
    };
    const not = (allow: string) => {
      res.setHeader('allow', allow);
      throw new ForumError(405, 'Not allowed.');
    };
    const [id, sub, commentId] = parts;

    if (!id) {
      if (method === 'GET') {
        limit('read');
        const sort: ForumSort = url.searchParams.get('sort') === 'top' ? 'top' : 'new';
        const page = Math.max(0, Math.min(10_000, Number(url.searchParams.get('page')) || 0));
        const search = forumText(url.searchParams.get('q'), FORUM_LIMITS.searchLength);
        return send(res, 200, store.list({ sort, search, page }, viewer));
      }
      if (method === 'POST') {
        const owner = player();
        limit('share');
        const text = await readBody(req, BUILD_FILE_LIMITS.bytes);
        return send(res, 201, store.share(text, url.searchParams.get('author') ?? '', owner));
      }
      return not('GET, POST');
    }
    if (!sub) {
      if (method === 'GET') {
        limit('read');
        return send(res, 200, store.post(id, viewer));
      }
      if (method === 'DELETE') {
        const owner = player();
        limit('delete');
        store.remove(id, owner);
        return send(res, 200, { ok: true });
      }
      return not('GET, DELETE');
    }
    if (sub === 'file' && !commentId) {
      if (method !== 'GET') return not('GET');
      limit('read');
      const f = store.file(id);
      res
        .writeHead(200, {
          'content-type': 'application/json',
          // Build ids are a-z, 0-9 and "-", so the name needs no quoting beyond this.
          'content-disposition': `attachment; filename="${f.name}"`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        .end(f.text);
      return;
    }
    if (sub === 'like' && !commentId) {
      if (method !== 'PUT') return not('PUT');
      const owner = player();
      limit('like');
      const body = await readJson(req);
      return send(res, 200, store.like(id, owner, body.liked === true));
    }
    if (sub === 'comments') {
      if (!commentId) {
        if (method !== 'POST') return not('POST');
        const owner = player();
        limit('comment');
        const body = await readJson(req);
        return send(
          res,
          201,
          store.comment(id, String(body.author ?? ''), String(body.text ?? ''), owner),
        );
      }
      if (method !== 'DELETE') return not('DELETE');
      const owner = player();
      limit('delete');
      store.removeComment(id, commentId, owner);
      return send(res, 200, { ok: true });
    }
    throw new ForumError(404, 'Not found.');
  }
}
