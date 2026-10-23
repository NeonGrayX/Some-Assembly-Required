import * as THREE from 'three';
import { EYE_OFFSET, add, length, sub, v3 } from '@sar/shared';
import type { Vec3 } from '@sar/shared';
import type { Sfx } from './audio.ts';
import { gameNow } from './clock.ts';
import type { ClientGame } from './net/game.ts';
import type { Settings } from './settings.ts';
import { typing } from './ui/dom.ts';
import type { SettingsPanel } from './ui/settings.ts';
import { Voice } from './voice.ts';
import type { Listener, Speaker } from './voice.ts';
import { SCREAM_MS, reaches, voiceMix } from './voice-mix.ts';
import { view } from './worldView.ts';

/**
 * Voice chat in a room: started for each room joined (never in solo play), every voice placed
 * where its player is each frame, and push to talk.
 */
export class VoiceChat {
  /** The voice chat running, if one is. */
  voice: Voice | null = null;
  private voiceGame: ClientGame | null = null;
  /** Until when each player's voice counts as a scream (they just stepped on a brick). */
  private readonly screams = new Map<number, number>();

  constructor(
    private readonly micEl: HTMLElement,
    private readonly sfx: Sfx,
    private readonly settings: Settings,
    private readonly settingsPanel: SettingsPanel,
    /** Whether the game is played solo, in this tab. */
    private readonly solo: () => boolean,
  ) {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' && !e.repeat && !typing(e)) this.talk(true);
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'KeyC') this.talk(false);
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 3 || e.button === 4) this.talk(true);
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button !== 3 && e.button !== 4) return;
      // Side buttons would otherwise go back and forward in the browser's history.
      e.preventDefault();
      this.talk(false);
    });
    window.addEventListener('blur', () => this.talk(false));
  }

  /** Whatever `id` yells into their microphone now carries further, for a while. */
  scream(id: number): void {
    this.screams.set(id, gameNow() + SCREAM_MS);
  }

  /** Stops voice chat, out of any game. */
  stop(): void {
    this.voiceFor(null);
    this.micEl.classList.add('hidden');
  }

  /** Starts voice chat for a newly joined room (never in solo play), or stops it. */
  private voiceFor(g: ClientGame | null): Voice | null {
    const wanted = g && !this.solo() && g.myId >= 0 ? g : null;
    if (this.voiceGame === wanted) return this.voice;
    this.voice?.close();
    this.voice = null;
    this.voiceGame = wanted;
    if (!wanted) return null;
    const v = new Voice(
      wanted.myId,
      wanted.ice,
      (to, data) => wanted.send({ t: 'signal', to, data }),
      () => this.sfx.output(),
    );
    this.voice = v;
    wanted.onSignal = (from, data) => void v.signal(from, data);
    for (const m of wanted.signals.splice(0)) void v.signal(m.from, m.data);
    void v.setMode(this.settings.mic).then(() => this.settingsPanel.setMicProblem(v.micError));
    return v;
  }

  /** Places every voice for this frame and shows who is talking. */
  update(g: ClientGame, eye: Vec3, alpha: number): void {
    const { micEl, screams, settings } = this;
    const v = this.voiceFor(g);
    micEl.classList.toggle('hidden', !v);
    if (!v) return;
    v.sync(g.lobby.players.filter((p) => p.connected).map((p) => p.id));
    const cam = view.camera;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const listener: Listener = { pos: cam.position.clone(), forward, up };
    const together = g.phase !== 'building' || !!g.meeting;
    const listenerHome = g.sentHome;
    const now = gameNow();
    const speakers = new Map<number, Speaker>();
    const audience = new Set<number>();
    const screaming = (screams.get(g.myId) ?? 0) > now;
    for (const lp of g.lobby.players) {
      if (lp.id === g.myId) continue;
      const p = g.sim.players.get(lp.id);
      const pos = p ? add(g.pose(p.body, alpha).pos, v3(0, EYE_OFFSET, 0)) : listener.pos;
      const distance = length(sub(pos, eye));
      const near = !together && p && !listenerHome;
      const mix = voiceMix({
        together,
        distance,
        walls: near ? g.sim.wallsBetween(eye, pos) : 0,
        speakerHome: lp.home,
        listenerHome,
        screaming: (screams.get(lp.id) ?? 0) > now,
      });
      speakers.set(lp.id, { pos, mix });
      // The other way round: whether they would hear us, and so get our voice at all.
      if (
        reaches({ together, distance, speakerHome: listenerHome, listenerHome: lp.home, screaming })
      ) {
        audience.add(lp.id);
      }
    }
    v.setAudience(audience);
    v.update(listener, speakers, settings.muted ? 0 : settings.voiceVolume);
    view.showSpeaking((id) => v.speaking(id));

    const mode = v.micMode;
    micEl.textContent = !Voice.micAvailable
      ? '🎤 listen only (talking needs https://)'
      : v.micError
        ? '🎤 unavailable (see Settings)'
        : mode === 'off'
          ? '🎤 off'
          : v.sending
            ? '🎤 on air'
            : mode === 'push'
              ? '🎤 hold C to talk'
              : '🎤 …';
    micEl.classList.toggle('live', v.sending);
    micEl.classList.toggle('speaking', v.ownSpeaking);
  }

  /** Push to talk: hold C, or a mouse side button, wherever focus is (but not while typing). */
  talk(down: boolean): void {
    if (this.settings.mic !== 'push' || !this.voice) return;
    const v = this.voice;
    void v.pushToTalk(down).then(() => this.settingsPanel.setMicProblem(v.micError));
  }
}
