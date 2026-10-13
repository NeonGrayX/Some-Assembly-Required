import { FORUM_KEY, FORUM_KEY_HEADER, FORUM_LIMITS, allBins, parseBuildFile } from '@sar/shared';
import type {
  ForumComment,
  ForumPage,
  ForumPost,
  ForumPostSummary,
  ForumSort,
  TargetBuild,
} from '@sar/shared';

/*
 * The community page, the menu's page for shared builds: a list of builds other players
 * shared (newest or most liked, with a search), and for each its picture, likes, comments, a
 * download and a button to play it in demo mode. Players share build files from the build
 * editor or demo mode's Export. Everything players wrote is shown as text, never as markup.
 */

const API = '/api/forum/posts';
const KEY = 'sar.forum.key';
/** Seconds a delete button waits for its second click. */
const ARM_MS = 3000;

/**
 * This browser's forum key (see FORUM_KEY), made the first time. With storage blocked it lasts
 * until the page is closed: likes and posts then cannot be changed after a reload.
 */
let memoryKey: string | null = null;
export function forumKey(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && FORUM_KEY.test(saved)) return saved;
  } catch {
    // Storage blocked: a key for this visit.
  }
  if (!memoryKey) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    memoryKey = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
  try {
    localStorage.setItem(KEY, memoryKey);
  } catch {
    // See above.
  }
  return memoryKey;
}

class ApiError extends Error {}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      cache: 'no-store',
      headers: { [FORUM_KEY_HEADER]: forumKey(), ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Could not reach the server for the community page.');
  }
  const isJson = (res.headers.get('content-type') ?? '').startsWith('application/json');
  // A server from before the community page answers with the game's page instead.
  if (!isJson) throw new ApiError('This server has no community page yet.');
  if (res.ok) return (await res.json()) as T;
  let message = `The server said no (${res.status}).`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') message = body.error;
  } catch {
    // An answer from something in between (a proxy), not the game.
  }
  throw new ApiError(message);
}

const json = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});

/** "3 days ago", or the date for anything older than a month. */
export function postedAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (s < 60) return 'just now';
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
  if (s < 30 * 86400) return rtf.format(-Math.floor(s / 86400), 'day');
  return new Date(at).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function button(text: string, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}

/** A button that asks for a second click within a few seconds before it acts. */
function armedButton(text: string, sure: string, act: () => void): HTMLButtonElement {
  const b = button(text);
  let timer: ReturnType<typeof setTimeout> | null = null;
  b.addEventListener('click', () => {
    if (!timer) {
      b.classList.add('armed');
      b.textContent = sure;
      timer = setTimeout(() => {
        timer = null;
        b.classList.remove('armed');
        b.textContent = text;
      }, ARM_MS);
      return;
    }
    clearTimeout(timer);
    timer = null;
    act();
  });
  return b;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export interface ForumHandlers {
  /** The name typed on the main menu. */
  name: () => string;
  /** The finished model, as on the front of its box. */
  art: (build: TargetBuild) => HTMLCanvasElement;
  /** Starts demo mode with this build, its manual pinned up; or says why it cannot. */
  play: (build: TargetBuild) => string | null;
}

/**
 * The community page. `open` shows the list; a post opens in the same card, and Back (or Esc)
 * goes from a post to the list and from the list to the cover.
 */
export class ForumBrowser {
  private readonly list: HTMLUListElement;
  private readonly status: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly sort: HTMLSelectElement;
  private readonly file: HTMLInputElement;
  private readonly message: HTMLElement;
  private readonly more: HTMLButtonElement;
  private readonly listView: HTMLElement;
  private readonly postView: HTMLElement;
  private posts: ForumPostSummary[] = [];
  private total = 0;
  private page = 0;
  private loaded = false;
  private problem: string | null = null;
  /** Each request's number, so a slow answer to an old search never replaces a newer one. */
  private asked = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Downloaded builds by post id, for pictures and Play. */
  private readonly builds = new Map<string, Promise<TargetBuild | null>>();
  private openPost: string | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly handlers: ForumHandlers,
  ) {
    const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T;
    this.listView = q('.forum-list-view');
    this.postView = q('.forum-post');
    this.list = q('.forum-list');
    this.status = q('.forum-status');
    this.search = q('#forum-search');
    this.sort = q('#forum-sort');
    this.file = q('#forum-file');
    this.message = q('.forum-message');
    this.more = q('.forum-more');
    try {
      if (localStorage.getItem('sar.forum.sort') === 'top') this.sort.value = 'top';
    } catch {
      // Storage blocked: newest first.
    }
    this.sort.addEventListener('change', () => {
      try {
        localStorage.setItem('sar.forum.sort', this.sort.value);
      } catch {
        // See above.
      }
      void this.refresh();
    });
    this.search.addEventListener('input', () => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => void this.refresh(), 300);
    });
    q('.forum-share').addEventListener('click', () => this.file.click());
    this.file.addEventListener('change', () => void this.share());
    this.more.addEventListener('click', () => void this.load(this.page + 1));
    this.list.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const li = target.closest<HTMLElement>('[data-post]');
      if (!li) return;
      if (target.closest('.like')) return;
      void this.show(li.dataset.post!);
    });
  }

  /** Starts showing the list. */
  open(): void {
    this.showList();
    this.search.focus();
    void this.refresh();
  }

  /** Back one step: from a post to the list. False when the list is showing already. */
  back(): boolean {
    if (!this.openPost) return false;
    this.showList();
    return true;
  }

  private showList(): void {
    this.openPost = null;
    this.postView.classList.add('hidden');
    this.postView.replaceChildren();
    this.listView.classList.remove('hidden');
  }

  private query(page: number): string {
    const p = new URLSearchParams({ sort: this.sort.value as ForumSort, page: String(page) });
    const q = this.search.value.trim();
    if (q) p.set('q', q);
    return `?${p}`;
  }

  async refresh(): Promise<void> {
    await this.load(0);
  }

  private async load(page: number): Promise<void> {
    const n = ++this.asked;
    this.more.disabled = true;
    try {
      const r = await api<ForumPage>(this.query(page));
      if (n !== this.asked) return;
      this.posts = page ? [...this.posts, ...r.posts] : r.posts;
      this.total = r.total;
      this.page = page;
      this.problem = null;
      this.loaded = true;
    } catch (err) {
      if (n !== this.asked) return;
      this.problem = (err as Error).message;
    }
    this.render(page === 0);
  }

  private render(fresh: boolean): void {
    if (fresh) this.list.replaceChildren(...this.posts.map((p) => this.card(p)));
    else {
      const have = new Set([...this.list.children].map((li) => (li as HTMLElement).dataset.post));
      this.list.append(...this.posts.filter((p) => !have.has(p.id)).map((p) => this.card(p)));
    }
    const searching = !!this.search.value.trim();
    this.status.textContent =
      this.problem ??
      (!this.loaded
        ? 'Looking for shared builds…'
        : !this.total
          ? searching
            ? 'No shared builds match. Try another word.'
            : 'Nobody has shared a build yet. Be the first!'
          : `${plural(this.total, 'shared build')}${searching ? ' match' : ''}`);
    this.more.classList.toggle('hidden', this.posts.length >= this.total);
    this.more.disabled = false;
  }

  /** The build of a post, downloaded once; null if it cannot be read. */
  private build(id: string): Promise<TargetBuild | null> {
    let b = this.builds.get(id);
    if (!b) {
      b = fetch(`${API}/${id}/file`, { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) return null;
          const r = parseBuildFile(await res.text(), allBins());
          return r.ok ? r.build : null;
        })
        .catch(() => null);
      this.builds.set(id, b);
      // A failure is tried again next time.
      void b.then((got) => {
        if (!got) this.builds.delete(id);
      });
    }
    return b;
  }

  /** The box picture, drawn once the build is in. */
  private picture(id: string, cls: string): HTMLElement {
    const frame = el('div', `forum-art ${cls}`);
    frame.setAttribute('aria-hidden', 'true');
    void this.build(id).then((b) => {
      if (!b) return frame.classList.add('missing');
      const c = this.handlers.art(b);
      const img = el('img');
      img.src = c.toDataURL();
      img.alt = '';
      frame.append(img);
    });
    return frame;
  }

  private likeButton(p: ForumPostSummary, onChange?: (p: ForumPostSummary) => void) {
    const b = button('', 'btn like');
    const show = () => {
      b.textContent = `♥ ${p.likes}`;
      b.setAttribute('aria-pressed', String(p.liked));
      b.setAttribute(
        'aria-label',
        `${p.liked ? 'Unlike' : 'Like'} ${p.name} (${plural(p.likes, 'like')})`,
      );
    };
    show();
    b.addEventListener('click', () => {
      const liked = !p.liked;
      // Shown at once, put back if the server says no.
      p.liked = liked;
      p.likes += liked ? 1 : -1;
      show();
      api<{ likes: number; liked: boolean }>(`/${p.id}/like`, { method: 'PUT', ...json({ liked }) })
        .then((r) => {
          p.likes = r.likes;
          p.liked = r.liked;
          show();
          onChange?.(p);
        })
        .catch((err: Error) => {
          p.liked = !liked;
          p.likes += liked ? -1 : 1;
          show();
          this.say(err.message, true);
        });
    });
    return b;
  }

  private card(p: ForumPostSummary): HTMLLIElement {
    const li = el('li');
    li.dataset.post = p.id;
    const open = button('', 'open');
    open.setAttribute('aria-label', `Open ${p.name} by ${p.author}`);
    const text = el('div', 'text');
    text.append(
      el('span', 'name', p.name),
      el('span', 'by', `by ${p.author} · ${postedAgo(p.createdAt)}`),
      el('span', 'size', `${plural(p.pages, 'page')} · ${plural(p.bricks, 'brick')}`),
    );
    if (p.description) text.append(el('span', 'about', p.description));
    const foot = el('div', 'foot');
    foot.append(this.likeButton(p), el('span', 'count', `💬 ${p.comments}`));
    li.append(this.picture(p.id, 'small'), open, text, foot);
    return li;
  }

  /** Opens one post: its picture, what it is, Play, Download, likes and comments. */
  private async show(id: string): Promise<void> {
    this.openPost = id;
    this.listView.classList.add('hidden');
    this.postView.classList.remove('hidden');
    this.postView.replaceChildren(el('p', 'forum-status', 'Opening…'));
    let post: ForumPost;
    try {
      post = await api<ForumPost>(`/${id}`);
    } catch (err) {
      if (this.openPost !== id) return;
      const back = button('Back to the list');
      back.addEventListener('click', () => this.back());
      this.postView.replaceChildren(el('p', 'forum-status', (err as Error).message), back);
      return;
    }
    if (this.openPost !== id) return;
    this.renderPost(post);
  }

  private renderPost(post: ForumPost): void {
    const v = this.postView;
    const head = el('div', 'post-head');
    const text = el('div', 'text');
    text.append(
      el('h3', 'name', post.name),
      el('span', 'by', `Shared by ${post.author} · ${postedAgo(post.createdAt)}`),
      el('span', 'size', `${plural(post.pages, 'page')} · ${plural(post.bricks, 'brick')}`),
    );
    if (post.description) text.append(el('p', 'about', post.description));
    head.append(this.picture(post.id, 'big'), text);

    const actions = el('div', 'post-actions');
    const play = button('Play it', 'btn btn-primary');
    play.title = 'Build it in demo mode, with its manual pinned up';
    play.addEventListener('click', () => {
      play.disabled = true;
      void this.build(post.id).then((b) => {
        play.disabled = false;
        if (!b) return this.say('Could not download that build. Try again.', true);
        const problem = this.handlers.play(b);
        if (problem) this.say(problem, true);
      });
    });
    const download = el('a', 'btn', 'Download');
    download.href = `${API}/${post.id}/file`;
    download.setAttribute('download', '');
    download.title = 'Save the build file, to import in demo mode or the build editor';
    actions.append(play, download, this.likeButton(post));
    if (post.mine) {
      actions.append(
        armedButton('Take down', 'Sure? Click again', () => {
          api(`/${post.id}`, { method: 'DELETE' })
            .then(() => {
              this.say(`${post.name} is no longer shared.`);
              this.showList();
              void this.refresh();
            })
            .catch((err: Error) => this.say(err.message, true));
        }),
      );
    }

    const comments = el('ul', 'comments');
    const heading = el('span', 'section', `Comments (${post.commentList.length})`);
    const renderComments = () => {
      heading.textContent = `Comments (${post.commentList.length})`;
      comments.replaceChildren(
        ...post.commentList.map((c) =>
          this.comment(post, c, () => {
            post.commentList = post.commentList.filter((x) => x !== c);
            renderComments();
          }),
        ),
      );
      if (!post.commentList.length) comments.append(el('li', 'empty', 'No comments yet.'));
    };
    renderComments();

    const form = el('form', 'comment-form');
    const box = el('textarea');
    box.maxLength = FORUM_LIMITS.commentLength;
    box.rows = 2;
    box.placeholder = 'Say something nice about it';
    box.setAttribute('aria-label', 'Your comment');
    const send = button('Post comment', 'btn btn-primary');
    send.type = 'submit';
    // In a field, so every theme draws the box like its other text boxes.
    const field = el('label', 'field');
    field.append(box);
    form.append(field, send);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = box.value.trim();
      if (!text) return;
      send.disabled = true;
      api<ForumComment>(`/${post.id}/comments`, {
        method: 'POST',
        ...json({ author: this.handlers.name(), text }),
      })
        .then((c) => {
          box.value = '';
          post.commentList.push(c);
          renderComments();
          comments.lastElementChild?.scrollIntoView({ block: 'nearest' });
        })
        .catch((err: Error) => this.say(err.message, true))
        .finally(() => {
          send.disabled = false;
        });
    });
    // Ctrl+Enter posts, as in most chat boxes.
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
    });

    v.replaceChildren(head, actions, heading, comments, form);
  }

  private comment(post: ForumPost, c: ForumComment, removed: () => void): HTMLLIElement {
    const li = el('li');
    const top = el('div', 'comment-head');
    top.append(el('span', 'author', c.author), el('span', 'when', postedAgo(c.createdAt)));
    if (c.mine) {
      top.append(
        armedButton('Delete', 'Sure?', () => {
          api(`/${post.id}/comments/${c.id}`, { method: 'DELETE' })
            .then(removed)
            .catch((err: Error) => this.say(err.message, true));
        }),
      );
    }
    // textContent, and CSS keeps the line breaks: a comment is never read as markup.
    li.append(top, el('p', 'comment-text', c.text));
    return li;
  }

  /** Shares the build file the player picked, after checking it here first. */
  private async share(): Promise<void> {
    const picked = this.file.files?.[0];
    this.file.value = '';
    if (!picked) return;
    if (picked.size > 256 * 1024) return this.say(`${picked.name} is too big to share.`, true);
    const text = await picked.text();
    const r = parseBuildFile(text, allBins());
    if (!r.ok) {
      const more = r.problems.length > 4 ? `\n…and ${r.problems.length - 4} more` : '';
      return this.say(
        `Could not share ${picked.name}:\n${r.problems.slice(0, 4).join('\n')}${more}`,
        true,
      );
    }
    this.say(`Sharing ${r.build.name}…`);
    try {
      const p = await api<ForumPostSummary>(`?author=${encodeURIComponent(this.handlers.name())}`, {
        method: 'POST',
        body: text,
        headers: { 'content-type': 'application/json' },
      });
      this.say(`Shared ${p.name}. Thanks!`);
      this.search.value = '';
      this.sort.value = 'new';
      await this.refresh();
    } catch (err) {
      this.say((err as Error).message, true);
    }
  }

  private say(text: string, error = false): void {
    this.message.textContent = text;
    this.message.classList.toggle('error', error);
  }

  clearMessage(): void {
    this.say('');
  }
}
