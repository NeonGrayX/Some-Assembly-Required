/*
 * The community page: players share build files, like them, comment on them and download them.
 * The server keeps the posts (server/src/forum.ts); these are the shapes both sides agree on.
 */

/** A shared build as the list shows it. */
export interface ForumPostSummary {
  /** The post's own id, in its links; not the build's id. */
  id: string;
  /** The build's name and description, from its file. */
  name: string;
  description: string;
  /** Who shared it, by the name they play under. */
  author: string;
  pages: number;
  bricks: number;
  likes: number;
  comments: number;
  /** Milliseconds since 1970. */
  createdAt: number;
  /** Whether the player asking has liked it, and whether they shared it. */
  liked: boolean;
  mine: boolean;
}

export interface ForumComment {
  id: string;
  author: string;
  text: string;
  createdAt: number;
  /** Whether the player asking may delete it: their own, or on a post of theirs. */
  mine: boolean;
}

/** One post with its comments, oldest first. */
export interface ForumPost extends ForumPostSummary {
  commentList: ForumComment[];
}

export interface ForumPage {
  posts: ForumPostSummary[];
  /** Posts that match, of which `posts` is one page. */
  total: number;
}

export type ForumSort = 'new' | 'top';

export const FORUM_LIMITS = {
  /** Same as the name on the main menu. */
  nameLength: 20,
  commentLength: 280,
  commentsPerPost: 200,
  pageSize: 12,
  searchLength: 40,
};

/** Posts' and comments' ids. */
export const FORUM_ID = /^[a-z0-9]{10}$/;
/**
 * A player's forum key: random, made by their browser and kept there. It is how the server
 * knows who liked what and whose posts are whose, the way a room's token knows a player.
 */
export const FORUM_KEY = /^[A-Za-z0-9_-]{32,64}$/;
/** The header the key travels in. */
export const FORUM_KEY_HEADER = 'x-sar-player';

/** A name or comment as the forum keeps it: no control characters, spaces tidied. */
export function forumText(v: unknown, max: number, multiline = false): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let t = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, '');
  t = multiline
    ? t
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : t.replace(/\s+/g, ' ').trim();
  return [...t].slice(0, max).join('');
}
