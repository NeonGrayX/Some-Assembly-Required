import { CHARGES, GEAR, GEAR_IDS, TEAM_NAMES, gearName } from '@sar/shared';
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
  ['clumsy', '3', 'Trip on purpose, into whatever is in front'],
  ['trap', '4', 'Drop a few bricks to step on'],
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

  /** Closes the chat box, unsent; back into the game with relock (unless in a meeting). */
  closeChat(relock: boolean): void {
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
    if (g.mode === 'gear') return this.updateGearReveal(g, now);
    const partners = g.partners.map((id) => g.nameOf(id)).join(', ');
    const reader = g.reader !== null ? g.nameOf(g.reader) : null;
    const among = g.saboteurCount
      ? `${g.saboteurCount === 1 ? 'one saboteur' : `${g.saboteurCount} saboteurs`} among you`
      : 'no saboteurs this round';
    const team = g.team;
    const teamClass = team === null ? null : (['red', 'blue'][team] ?? null);
    const other = team === null ? '' : (TEAM_NAMES[team ? 0 : 1] ?? 'the other');
    this.role.className = teamClass ?? role;
    this.role.textContent =
      teamClass !== null
        ? `${TEAM_NAMES[team!] ?? ''} team · race ${other} for the best build`
        : role === 'saboteur'
          ? `Saboteur${partners ? ` · with ${partners}` : ''}`
          : role === 'reader'
            ? `Reader · only you can read the pages · ${among}`
            : reader
              ? `Builder · ${reader} reads the pages · ${among}`
              : `Builder · ${among}`;
    const showReveal = now - g.roleShownAt < REVEAL_MS;
    this.reveal.classList.toggle('hidden', !showReveal);
    if (!showReveal) return;
    this.reveal.className = teamClass ?? role;
    this.reveal.querySelector('h1')!.textContent =
      teamClass !== null
        ? `You are on the ${(TEAM_NAMES[team!] ?? '').toUpperCase()} TEAM`
        : role === 'saboteur'
          ? 'You are the SABOTEUR'
          : role === 'reader'
            ? 'You are the READER'
            : 'You are a BUILDER';
    const sabotage = g.saboteurCount
      ? 'Someone is sabotaging: ring the bell if you catch them.'
      : 'Nobody is sabotaging this round.';
    this.reveal.querySelector('p')!.textContent =
      teamClass !== null
        ? `Rival teams: build the model on your own job site, better and faster than the ${other} ` +
          'team. Accuracy counts first, then speed. You may visit their yard, but can only touch ' +
          'things on your own side. Press Done twice to hand in: your build is judged and locked ' +
          'as it stands.'
        : role === 'saboteur'
          ? `Make the build fail without getting caught.${partners ? ` Your partner: ${partners}.` : ''} ` +
            '1: swap a brick · 2: forge your page · click a hiding place: hide your page in it ' +
            '(people nearby may notice) · 3: trip into the build · 4: drop bricks to step on ' +
            '(these look like accidents).'
          : role === 'reader'
            ? 'Blind build: only you can read the pages and the master index, and you cannot touch ' +
              `bricks. Find the pages and tell the builders what to build. ${sabotage}`
            : reader
              ? `Blind build: you cannot read the pages. ${reader} is the reader and tells you what ` +
                `they say; build the model before time runs out. ${sabotage}`
              : g.saboteurCount
                ? 'Build the model before time runs out. Someone is sabotaging: check pages against ' +
                  'the master index and ring the bell if you catch them.'
                : 'Nobody is sabotaging this round. Find the pages and build the model together.';
  }

  /** A gear hunt's badge and reveal: no roles, just the troubles and the gear for them. */
  private updateGearReveal(g: ClientGame, now: number): void {
    this.role.className = 'builder';
    const worn = g.worn.size;
    this.role.textContent = `Gear Hunt · wearing ${worn} of ${GEAR_IDS.length} pieces of gear`;
    const showReveal = now - g.roleShownAt < REVEAL_MS * 1.6;
    this.reveal.classList.toggle('hidden', !showReveal);
    if (!showReveal) return;
    this.reveal.className = 'builder';
    this.reveal.querySelector('h1')!.textContent = 'GEAR HUNT';
    this.reveal.querySelector('p')!.textContent =
      'No saboteur this time, but the job site is in trouble. Each piece of gear hidden in ' +
      'the map fixes one thing for whoever wears it, and you can wear it all at once: ' +
      GEAR.map((x) => `${x.name.toLowerCase()} (${x.trouble.replace(/\.$/, '')})`).join(' · ') +
      '. Number keys take a piece off for someone else.';
  }

  /** A gear hunt's HUD row: every piece of gear, who has it, and the key to take it off. */
  private updateGear(g: ClientGame, playing: boolean): void {
    const show = playing && g.mode === 'gear';
    this.tools.classList.toggle('hidden', !show);
    if (!show) return;
    const rows = GEAR_IDS.map((kind, i) => {
      const item = [...g.sim.gear.values()].find((x) => x.kind === kind);
      const mine = g.worn.has(kind);
      const where = !item
        ? ''
        : mine
          ? 'worn'
          : item.wornBy !== null
            ? g.nameOf(item.wornBy)
            : item.placed
              ? 'on the pole'
              : item.hideout !== null
                ? 'hidden'
                : 'lying about';
      return `<div class="${mine ? 'worn' : item?.wornBy !== null || item?.placed ? 'wait' : ''}"><kbd>${i + 1}</kbd><span>${gearName(kind)}</span><small>${where}</small></div>`;
    });
    const html = `<h4>Gear</h4>${rows.join('')}`;
    if (this.tools.innerHTML !== html) this.tools.innerHTML = html;
  }

  private updateTools(g: ClientGame | null, playing: boolean, now: number): void {
    if (g?.mode === 'gear') return this.updateGear(g, playing);
    const show = playing && g?.role === 'saboteur' && !g.sentHome;
    this.tools.classList.toggle('hidden', !show);
    if (!show || !g) return;
    this.tools.innerHTML =
      '<h4>Saboteur tools</h4>' +
      TOOLS.map(([tool, key, label]) => {
        const wait = Math.ceil(((g.toolReadyAt.get(tool) ?? 0) - now) / 1000);
        const left = tool in CHARGES ? (g.toolCharges.get(tool) ?? CHARGES[tool]!) : null;
        const used = left === 0;
        const note = used
          ? 'used up'
          : wait > 0
            ? `${wait} s`
            : left !== null
              ? `${left} left`
              : '';
        return `<div class="${wait > 0 || used ? 'wait' : ''}"><kbd>${key}</kbd><span>${label}</span><small>${note}</small></div>`;
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
