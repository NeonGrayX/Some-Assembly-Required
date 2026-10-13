import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORUM_KEY_HEADER, parseBuildFile, allBins } from '@sar/shared';
import type { ForumComment, ForumPage, ForumPost, ForumPostSummary } from '@sar/shared';
import { describe, expect, it } from 'vitest';
import { runServer } from './app.ts';
import type { RunningServer } from './app.ts';
import type { FileSource } from './files.ts';

const noFiles: FileSource = () => null;
const ADA = 'a'.repeat(40);
const BOB = 'b'.repeat(40);
const ADMIN = 'c'.repeat(40);
const builds = join(import.meta.dirname, '../../builds');
const diner = readFileSync(join(builds, 'diner.sarbuild.json'), 'utf8');
const pagoda = readFileSync(join(builds, 'pagoda.sarbuild.json'), 'utf8');
const treehouse = readFileSync(join(builds, 'treehouse.sarbuild.json'), 'utf8');

async function withServer(
  fn: (api: Api, server: RunningServer) => Promise<void>,
  forumDir: string | null = null,
): Promise<void> {
  const server = await runServer({ port: 0, files: noFiles, tls: null, forumDir, log: () => {} });
  try {
    await fn(api(`http://localhost:${server.port}/api/forum/posts`), server);
  } finally {
    await server.close();
  }
}

type Api = ReturnType<typeof api>;

function api(base: string) {
  const call = async (path: string, init: RequestInit & { key?: string; json?: unknown } = {}) => {
    const headers: Record<string, string> = {};
    if (init.key) headers[FORUM_KEY_HEADER] = init.key;
    if (init.json !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, body: text ? JSON.parse(text) : null };
  };
  return {
    call,
    share: (file: string, key = ADA, author = 'Ada') =>
      call(`?author=${encodeURIComponent(author)}`, { method: 'POST', key, body: file }),
    list: (query = '', key?: string) => call(query, { key }).then((r) => r.body as ForumPage),
    get: (id: string, key?: string) => call(`/${id}`, { key }).then((r) => r.body as ForumPost),
  };
}

describe('the community page', () => {
  it('shares a build file, lists it and hands the same build back', async () => {
    await withServer(async (forum) => {
      const r = await forum.share(diner);
      expect(r.status).toBe(201);
      const post = r.body as ForumPostSummary;
      expect(post).toMatchObject({ name: 'Neon Diner', author: 'Ada', likes: 0, mine: true });
      expect(post.pages).toBeGreaterThan(1);

      const page = await forum.list();
      expect(page.total).toBe(1);
      expect(page.posts[0]).toMatchObject({ id: post.id, mine: false, liked: false });
      expect((await forum.list('', ADA)).posts[0]!.mine).toBe(true);

      const file = await forum.call(`/${post.id}/file`);
      expect(file.status).toBe(200);
      expect(file.headers.get('content-disposition')).toBe(
        'attachment; filename="diner.sarbuild.json"',
      );
      const back = parseBuildFile(file.text, allBins());
      const original = parseBuildFile(diner, allBins());
      expect(back.ok && original.ok && back.build).toEqual(original.ok && original.build);
    });
  });

  it('refuses writes without a key, broken files, the same build twice and oversized ones', async () => {
    await withServer(async (forum) => {
      expect((await forum.call('', { method: 'POST', body: diner })).status).toBe(401);
      const broken = await forum.share('{"format": "nope"}');
      expect(broken.status).toBe(400);
      expect(broken.body.error).toMatch(/problems/);
      const first = await forum.share(diner);
      // Re-indented, it is still the same build.
      const again = await forum.share(JSON.stringify(JSON.parse(diner)), BOB);
      expect(again.status).toBe(409);
      expect(again.body.id).toBe(first.body.id);
      const big = await forum.share(`${diner}${' '.repeat(300 * 1024)}`);
      expect(big.status).toBe(413);
      expect((await forum.list()).total).toBe(1);
    });
  });

  it('counts one like per player and takes it back', async () => {
    await withServer(async (forum) => {
      const { id } = (await forum.share(diner)).body as ForumPostSummary;
      const like = (key: string, liked: boolean) =>
        forum.call(`/${id}/like`, { method: 'PUT', key, json: { liked } });
      expect((await like(BOB, true)).body).toEqual({ likes: 1, liked: true });
      expect((await like(BOB, true)).body).toEqual({ likes: 1, liked: true });
      expect((await like(ADA, true)).body).toEqual({ likes: 2, liked: true });
      expect((await like(BOB, false)).body).toEqual({ likes: 1, liked: false });
      expect((await forum.get(id, ADA)).liked).toBe(true);
      expect((await forum.get(id, BOB)).liked).toBe(false);
      expect(
        (await forum.call(`/${id}/like`, { method: 'PUT', json: { liked: true } })).status,
      ).toBe(401);
    });
  });

  it('keeps comments as plain text, and lets only their writers or the post owner delete them', async () => {
    await withServer(async (forum) => {
      const { id } = (await forum.share(diner)).body as ForumPostSummary;
      const comment = (key: string, text: string) =>
        forum.call(`/${id}/comments`, { method: 'POST', key, json: { author: 'Bob', text } });
      const r = await comment(BOB, '  <img src=x onerror=alert(1)>\u0000 nice\n\n\n\nbuild  ');
      expect(r.status).toBe(201);
      const c = r.body as ForumComment;
      // Stored as typed (the page shows it as text), minus control characters and extra lines.
      expect(c.text).toBe('<img src=x onerror=alert(1)> nice\n\nbuild');
      expect((await comment(BOB, '   ')).status).toBe(400);
      expect(((await comment(BOB, 'x'.repeat(1000))).body as ForumComment).text).toHaveLength(280);

      const post = await forum.get(id, BOB);
      expect(post.comments).toBe(2);
      expect(post.commentList.map((x) => x.mine)).toEqual([true, true]);
      expect((await forum.get(id)).commentList.every((x) => !x.mine)).toBe(true);

      const third = (await comment(ADA, 'thanks!')).body as ForumComment;
      expect(
        (await forum.call(`/${id}/comments/${third.id}`, { method: 'DELETE', key: BOB })).status,
      ).toBe(403);
      // Ada shared the build, so she may tidy its comments.
      expect(
        (await forum.call(`/${id}/comments/${c.id}`, { method: 'DELETE', key: ADA })).status,
      ).toBe(200);
      expect((await forum.get(id)).comments).toBe(2);
    });
  });

  it('lets only who shared a build take it down', async () => {
    await withServer(async (forum) => {
      const { id } = (await forum.share(diner)).body as ForumPostSummary;
      expect((await forum.call(`/${id}`, { method: 'DELETE', key: BOB })).status).toBe(403);
      expect((await forum.call(`/${id}`, { method: 'DELETE', key: ADA })).status).toBe(200);
      expect((await forum.call(`/${id}`)).status).toBe(404);
      expect((await forum.call(`/${id}/file`)).status).toBe(404);
    });
  });

  it('sorts by newest or most liked, searches, and keeps posts across restarts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sar-forum-'));
    let ids: string[] = [];
    await withServer(async (forum) => {
      for (const file of [diner, pagoda, treehouse]) {
        ids.push(((await forum.share(file)).body as ForumPostSummary).id);
        await new Promise((r) => setTimeout(r, 5));
      }
      await forum.call(`/${ids[0]}/like`, { method: 'PUT', key: BOB, json: { liked: true } });
      await forum.call(`/${ids[0]}/comments`, {
        method: 'POST',
        key: BOB,
        json: { author: 'Bob', text: 'Love the booths' },
      });
    }, dir);
    await withServer(async (forum) => {
      expect((await forum.list()).posts.map((p) => p.id)).toEqual([...ids].reverse());
      expect((await forum.list('?sort=top')).posts[0]!.id).toBe(ids[0]);
      expect((await forum.list('?q=PAGO')).posts.map((p) => p.id)).toEqual([ids[1]]);
      const post = await forum.get(ids[0]!, BOB);
      expect(post).toMatchObject({ likes: 1, liked: true });
      expect(post.commentList[0]).toMatchObject({
        author: 'Bob',
        text: 'Love the booths',
        mine: true,
      });
      expect((await forum.call(`/${ids[1]}/file`)).status).toBe(200);
    }, dir);
    ids = [];
  });

  it('limits how quickly one address shares builds', async () => {
    await withServer(async (forum) => {
      const statuses = [];
      const files = ['izakaya', 'diner', 'pagoda', 'treehouse', 'observatory', 'pirate-ship'];
      for (const name of files) {
        const file = readFileSync(join(builds, `${name}.sarbuild.json`), 'utf8');
        statuses.push((await forum.share(file)).status);
      }
      expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    });
  });

  it('answers only what it knows', async () => {
    await withServer(async (forum) => {
      expect((await forum.call('', { method: 'PATCH' })).status).toBe(405);
      expect((await forum.call('/../../etc')).status).toBe(404);
      expect((await forum.call('/nope/like', { method: 'PUT', key: ADA, json: {} })).status).toBe(
        404,
      );
      const { id } = (await forum.share(diner)).body as ForumPostSummary;
      const notJson = await forum.call(`/${id}/comments`, {
        method: 'POST',
        key: ADA,
        body: 'text=hi',
      });
      expect(notJson.status).toBe(415);
    });
  });
});

describe('the community page admin key', () => {
  it('may take down any post', async () => {
    process.env.SAR_FORUM_ADMIN_KEY = ADMIN;
    try {
      await withServer(async (forum) => {
        const { id } = (await forum.share(diner)).body as ForumPostSummary;
        expect((await forum.get(id, ADMIN)).mine).toBe(true);
        expect((await forum.call(`/${id}`, { method: 'DELETE', key: ADMIN })).status).toBe(200);
      });
    } finally {
      delete process.env.SAR_FORUM_ADMIN_KEY;
    }
  });
});
