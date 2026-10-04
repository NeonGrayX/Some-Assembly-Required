import type { SabotageTool } from '@sar/shared';
import type { ClientGame } from '../net/game.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** How long the role reveal stays on screen, in ms. */
const REVEAL_MS = 5000;
/** Chat lines fade out after this long, unless the chat box is open, in ms. */
const CHAT_FADE_MS = 20000;

const TOOLS: [SabotageTool, string, string][] = [
  ['swap', '1', 'Swap the brick you aim at for a look-alike'],
  ['forge', '2', 'Forge the page in your pocket'],
  ['hide', '3', 'Hide the page in your pocket far away'],
];

/**
 * Everything about who is who: the role reveal and badge, the saboteur's tools, Brick
 * Meetings with voting, the chat, and the note shown to players sent home.
 */
export class SocialUI {
  private readonly role = $('role');
  private readonly reveal = $('reveal');
  private readonly tools = $('tools');
  private readonly meeting = $('meeting');
  private readonly chatLog = $('chat');
  private readonly chatInput = $<HTMLInputElement>('chat-input');
  private readonly spectating = $('spectating');
  private shownMeeting = '';
  private shownChat = '';
  private hadMeeting = false;

  constructor(
    private readonly game: () => ClientGame | null,
    private readonly relock: () => void,
  ) {
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.chatInput.value.trim();
        if (text) this.game()?.say(text);
        this.closeChat(true);
      } else if (e.key === 'Escape') {
        this.closeChat(true);
      }
    });
    this.meeting.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest('button');
      const g = this.game();
      if (!button || !g || button.disabled) return;
      g.vote(Number(button.dataset.vote ?? 0));
    });
  }

  get chatOpen(): boolean {
    return !this.chatInput.classList.contains('hidden');
  }

  openChat(): void {
    document.exitPointerLock();
    this.chatInput.classList.remove('hidden');
    this.chatInput.value = '';
    this.chatInput.focus();
    this.shownChat = '';
  }

  private closeChat(relock: boolean): void {
    this.chatInput.blur();
    this.chatInput.classList.add('hidden');
    this.shownChat = '';
    // Back into the game, unless a meeting needs the mouse for voting.
    if (relock && !this.game()?.meeting) this.relock();
  }

  update(now: number): void {
    const g = this.game();
    const playing = !!g && g.phase === 'building';
    this.updateRole(g, playing, now);
    this.updateTools(g, playing, now);
    this.updateMeeting(g);
    this.updateChat(g, now);
    this.spectating.classList.toggle('hidden', !(playing && g?.sentHome && !g.meeting));
  }

  private updateRole(g: ClientGame | null, playing: boolean, now: number): void {
    const role = playing ? g?.role : null;
    this.role.classList.toggle('hidden', !role);
    if (!g || !role) {
      this.reveal.classList.add('hidden');
      return;
    }
    const partners = g.partners.map((id) => g.nameOf(id)).join(', ');
    this.role.className = role;
    this.role.textContent =
      role === 'saboteur'
        ? `Saboteur${partners ? ` · with ${partners}` : ''}`
        : g.saboteurCount
          ? `Builder · ${g.saboteurCount === 1 ? 'one saboteur' : `${g.saboteurCount} saboteurs`} among you`
          : 'Builder · no saboteurs this round';
    const showReveal = now - g.roleShownAt < REVEAL_MS;
    this.reveal.classList.toggle('hidden', !showReveal);
    if (!showReveal) return;
    this.reveal.className = role;
    this.reveal.querySelector('h1')!.textContent =
      role === 'saboteur' ? 'You are the SABOTEUR' : 'You are a BUILDER';
    this.reveal.querySelector('p')!.textContent =
      role === 'saboteur'
        ? `Make the build fail without getting caught.${partners ? ` Your partner: ${partners}.` : ''} ` +
          '1: swap a brick · 2: forge your page · 3: hide your page. People nearby may notice.'
        : g.saboteurCount
          ? 'Build the model before time runs out. Someone is sabotaging: check pages against ' +
            'the master index and ring the bell if you catch them.'
          : 'Nobody is sabotaging this round. Find the pages and build the model together.';
  }

  private updateTools(g: ClientGame | null, playing: boolean, now: number): void {
    const show = playing && g?.role === 'saboteur' && !g.sentHome;
    this.tools.classList.toggle('hidden', !show);
    if (!show || !g) return;
    this.tools.innerHTML =
      '<b>Saboteur tools</b><br />' +
      TOOLS.map(([tool, key, label]) => {
        const wait = Math.ceil(((g.toolReadyAt.get(tool) ?? 0) - now) / 1000);
        return `<div class="${wait > 0 ? 'wait' : ''}">${key}: ${label}${wait > 0 ? ` (${wait} s)` : ''}</div>`;
      }).join('');
  }

  private updateMeeting(g: ClientGame | null): void {
    const m = g?.meeting ?? null;
    this.meeting.classList.toggle('hidden', !m);
    document.body.classList.toggle('meeting', !!m);
    if (!g || !m) {
      this.hadMeeting = false;
      return;
    }
    if (!this.hadMeeting) {
      // A meeting just started: free the mouse so people can vote.
      this.hadMeeting = true;
      document.exitPointerLock();
    }
    const secs = Math.ceil(g.meetingLeft);
    const key = JSON.stringify([m, g.myVote, secs, g.lobby.players]);
    if (key === this.shownMeeting) return;
    this.shownMeeting = key;
    const canVote = m.onSite.includes(g.myId) && !m.outcome;
    this.meeting.querySelector('h2')!.textContent =
      `Brick Meeting called by ${g.nameOf(m.calledBy)}`;
    this.meeting.querySelector('.sub')!.textContent = m.outcome
      ? 'The votes are in.'
      : `${secs} s to talk and vote · ${m.voted.length} of ${m.onSite.length} have voted`;
    const tally = new Map(m.outcome?.tally ?? []);
    this.meeting.querySelector('.votes')!.innerHTML = m.onSite
      .map((id) => {
        const p = g.lobby.players.find((x) => x.id === id);
        const chosen = g.myVote === id ? 'chosen' : '';
        const votes = m.outcome
          ? `${tally.get(id) ?? 0} votes`
          : m.voted.includes(id)
            ? 'voted'
            : '';
        const button =
          id === g.myId
            ? ''
            : `<button type="button" class="${chosen}" data-vote="${id}" ${canVote ? '' : 'disabled'}>Vote</button>`;
        return `<li><span class="dot" style="background:${hex(p?.colour ?? 0x7f8c8d)}"></span>
          ${esc(p?.name ?? '?')}${id === g.myId ? ' (you)' : ''} ${button}<span class="voted">${votes}</span></li>`;
      })
      .join('');
    const skip = this.meeting.querySelector<HTMLButtonElement>('.skip')!;
    skip.disabled = !canVote;
    skip.classList.toggle('chosen', g.myVote === 0);
    this.meeting.querySelector('.outcome')!.textContent = m.outcome
      ? m.outcome.sentHome
        ? `${g.nameOf(m.outcome.sentHome)} was sent home.`
        : 'Nobody was sent home.'
      : '';
  }

  private updateChat(g: ClientGame | null, now: number): void {
    const open = this.chatOpen || !!g?.meeting;
    const lines = (g?.chat ?? []).filter((c) => open || now - c.at < CHAT_FADE_MS).slice(-8);
    const key = `${lines.length}:${lines.at(-1)?.at ?? 0}:${lines[0]?.at ?? 0}:${open}`;
    if (key === this.shownChat) return;
    this.shownChat = key;
    this.chatLog.innerHTML = lines
      .map((l) => {
        const p = g!.lobby.players.find((x) => x.id === l.from);
        const scope =
          l.scope === 'near'
            ? ' <span class="scope">(nearby)</span>'
            : l.scope === 'home'
              ? ' <span class="scope">(sent home)</span>'
              : '';
        return `<div><b style="color:${hex(p?.colour ?? 0xffffff)}">${esc(p?.name ?? '?')}</b>${scope}: ${esc(l.text)}</div>`;
      })
      .join('');
  }
}
