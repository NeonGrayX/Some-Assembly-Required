import type { IceServer, SignalData } from '@sar/shared';
import type { MicMode } from './settings.ts';
import type { Mix } from './voice-mix.ts';
import { VOICE_REF_DISTANCE } from './voice-mix.ts';

/** Where a voice comes from, and how it should sound, for one frame. */
export interface Speaker {
  pos: { x: number; y: number; z: number };
  mix: Mix;
}

export interface Listener {
  pos: { x: number; y: number; z: number };
  forward: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
}

const NEEDS_HTTPS =
  'Browsers only allow a microphone over https:// (or on localhost), so you can listen but ' +
  'not talk. The host app serves https unless started with --http.';

/** Level (RMS) above which someone counts as talking. */
const SPEAKING_LEVEL = 0.02;

/** One other player: the connection to them and how their voice is played. */
interface Peer {
  pc: RTCPeerConnection;
  /** Whether we make the offers: the player with the lower id does, so offers never cross. */
  polite: boolean;
  sender: RTCRtpSender | null;
  stream: MediaStream | null;
  /** Chrome only plays a remote WebRTC stream through Web Audio if an element also holds it. */
  element: HTMLAudioElement | null;
  nodes: {
    source: MediaStreamAudioSourceNode;
    filter: BiquadFilterNode;
    gain: GainNode;
    panner: PannerNode;
    analyser: AnalyserNode;
  } | null;
  pendingIce: RTCIceCandidateInit[];
  level: number;
}

/**
 * Proximity voice chat: a WebRTC audio connection to every other player in the room (a mesh;
 * the server only passes the handshakes on and never carries audio), each voice played through
 * a panner at the speaker's head, with a low-pass filter for walls in between.
 *
 * Every connection carries one audio channel both ways from the start. Turning the microphone
 * on or off only swaps the track on it, which needs no new handshake.
 */
export class Voice {
  private readonly peers = new Map<number, Peer>();
  private mic: MediaStream | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private micLevel: AnalyserNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private mode: MicMode = 'off';
  private talking = false;
  private output: GainNode | null = null;
  private wanting: Promise<void> | null = null;
  private readonly buffer = new Float32Array(512);
  /** Why the microphone could not be used, for the settings panel and HUD. */
  micError = '';
  ownLevel = 0;

  constructor(
    private readonly myId: number,
    private readonly ice: IceServer[],
    private readonly send: (to: number, data: SignalData) => void,
    /** The page's audio context and where voices go (after master volume), once audio is on. */
    private readonly audio: () => { ctx: AudioContext; out: AudioNode } | null,
  ) {}

  /** Whether this page may use a microphone at all (only over HTTPS or on localhost). */
  static get micAvailable(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
  }

  // ---------------------------------------------------------------- peers

  /** Connects to everyone in `ids` not yet connected, and hangs up on anyone gone. */
  sync(ids: Iterable<number>): void {
    const want = new Set(ids);
    want.delete(this.myId);
    for (const [id, p] of this.peers) {
      if (!want.has(id)) {
        this.hangUp(p);
        this.peers.delete(id);
      }
    }
    for (const id of want) if (!this.peers.has(id)) this.peer(id);
  }

  private peer(id: number): Peer {
    let p = this.peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    p = {
      pc,
      polite: this.myId > id,
      sender: null,
      stream: null,
      element: null,
      nodes: null,
      pendingIce: [],
      level: 0,
    };
    const peer = p;
    this.peers.set(id, p);
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const c = e.candidate.toJSON();
      this.send(id, {
        ice: {
          candidate: c.candidate ?? '',
          sdpMid: c.sdpMid ?? null,
          sdpMLineIndex: c.sdpMLineIndex ?? null,
        },
      });
    };
    pc.ontrack = (e) => {
      peer.stream = e.streams[0] ?? new MediaStream([e.track]);
      this.dropNodes(peer);
    };
    pc.onconnectionstatechange = () => {
      // A connection that broke (a network change, a sleeping laptop) is tried again.
      if (pc.connectionState === 'failed' && !peer.polite) pc.restartIce();
    };
    if (!p.polite) {
      // The offerer opens the audio channel; the other side's appears with the offer.
      const t = pc.addTransceiver('audio', { direction: 'sendrecv' });
      p.sender = t.sender;
      void t.sender.replaceTrack(this.sendingTrack());
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription(await pc.createOffer());
          const d = pc.localDescription!;
          this.send(id, { sdp: { type: 'offer', sdp: d.sdp } });
        } catch {
          // The connection was closed meanwhile.
        }
      };
    }
    return p;
  }

  /** A handshake message from another player. */
  async signal(from: number, data: SignalData): Promise<void> {
    if (from === this.myId) return;
    const p = this.peer(from);
    const { pc } = p;
    try {
      if ('sdp' in data) {
        if (data.sdp.type === 'offer') {
          // Only the polite side takes offers; the offerer never gets one back.
          if (!p.polite) return;
          await pc.setRemoteDescription(data.sdp);
          const t = pc.getTransceivers().find((x) => x.receiver.track.kind === 'audio');
          if (t) {
            t.direction = 'sendrecv';
            p.sender = t.sender;
            await t.sender.replaceTrack(this.sendingTrack());
          }
          await pc.setLocalDescription(await pc.createAnswer());
          this.send(from, { sdp: { type: 'answer', sdp: pc.localDescription!.sdp } });
        } else {
          if (p.polite || pc.signalingState !== 'have-local-offer') return;
          await pc.setRemoteDescription(data.sdp);
        }
        for (const c of p.pendingIce.splice(0)) await pc.addIceCandidate(c);
      } else if (pc.remoteDescription) {
        await pc.addIceCandidate(data.ice);
      } else {
        p.pendingIce.push(data.ice);
      }
    } catch {
      // A handshake that went wrong (a closed connection, a stale answer) is simply dropped;
      // the connection restarts if it fails for good.
    }
  }

  private hangUp(p: Peer): void {
    this.dropNodes(p);
    p.pc.close();
  }

  // ---------------------------------------------------------------- microphone

  /** Sets how the microphone is used. Asking for it may show the browser's permission prompt. */
  async setMode(mode: MicMode): Promise<void> {
    this.mode = mode;
    this.micError = mode !== 'off' && !Voice.micAvailable ? NEEDS_HTTPS : '';
    if (mode === 'off') {
      this.releaseMic();
      this.updateSending();
      return;
    }
    // Push to talk asks for the microphone on the first press; open mic right away.
    if (mode === 'open') await this.wantMic();
    this.updateSending();
  }

  /** The talk key went down or up (push to talk). */
  async pushToTalk(down: boolean): Promise<void> {
    this.talking = down;
    if (down && this.mode === 'push' && !this.mic) await this.wantMic();
    this.updateSending();
  }

  /** Whether your voice is going out right now. */
  get sending(): boolean {
    return !!this.micTrack && (this.mode === 'open' || (this.mode === 'push' && this.talking));
  }

  get micMode(): MicMode {
    return this.mode;
  }

  private wantMic(): Promise<void> {
    if (this.mic) return Promise.resolve();
    this.wanting ??= (async () => {
      if (!Voice.micAvailable) {
        this.micError = NEEDS_HTTPS;
        return;
      }
      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (this.mode === 'off') {
          for (const t of mic.getTracks()) t.stop();
          return;
        }
        this.mic = mic;
        this.micTrack = mic.getAudioTracks()[0] ?? null;
        this.micError = '';
        for (const p of this.peers.values()) void p.sender?.replaceTrack(this.sendingTrack());
      } catch (err) {
        this.micError =
          (err as DOMException).name === 'NotAllowedError'
            ? 'The browser was not allowed to use your microphone.'
            : 'No microphone found.';
      }
    })().finally(() => (this.wanting = null));
    return this.wanting;
  }

  private releaseMic(): void {
    this.micSource?.disconnect();
    this.micSource = null;
    this.micLevel = null;
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    this.mic = null;
    this.micTrack = null;
  }

  /** The track every connection sends: the microphone, unless it is off. */
  private sendingTrack(): MediaStreamTrack | null {
    return this.micTrack;
  }

  private updateSending(): void {
    // Muting the track sends silence (a few bytes) without a new handshake.
    if (this.micTrack) this.micTrack.enabled = this.sending;
    for (const p of this.peers.values()) {
      if (p.sender && p.sender.track !== this.micTrack) void p.sender.replaceTrack(this.micTrack);
    }
  }

  // ---------------------------------------------------------------- playing

  /**
   * Places the listener and every voice for this frame. Voices without an entry in `speakers`
   * are silent.
   */
  update(listener: Listener, speakers: Map<number, Speaker>, volume: number): void {
    const audio = this.audio();
    if (!audio) return;
    const { ctx } = audio;
    if (!this.output) {
      this.output = ctx.createGain();
      this.output.connect(audio.out);
    }
    this.output.gain.value = volume;
    const t = ctx.currentTime;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.setValueAtTime(listener.pos.x, t);
      l.positionY.setValueAtTime(listener.pos.y, t);
      l.positionZ.setValueAtTime(listener.pos.z, t);
      l.forwardX.setValueAtTime(listener.forward.x, t);
      l.forwardY.setValueAtTime(listener.forward.y, t);
      l.forwardZ.setValueAtTime(listener.forward.z, t);
      l.upX.setValueAtTime(listener.up.x, t);
      l.upY.setValueAtTime(listener.up.y, t);
      l.upZ.setValueAtTime(listener.up.z, t);
    } else {
      // Firefox before 2023.
      l.setPosition(listener.pos.x, listener.pos.y, listener.pos.z);
      l.setOrientation(
        listener.forward.x,
        listener.forward.y,
        listener.forward.z,
        listener.up.x,
        listener.up.y,
        listener.up.z,
      );
    }
    for (const [id, p] of this.peers) {
      if (!p.stream) continue;
      const n = (p.nodes ??= this.nodesFor(ctx, p));
      const s = speakers.get(id);
      const mix = s?.mix ?? { gain: 0, cutoff: 20_000, spatial: false };
      // Short ramps, so walking around a corner does not click.
      n.gain.gain.setTargetAtTime(mix.gain, t, 0.05);
      n.filter.frequency.setTargetAtTime(mix.cutoff, t, 0.05);
      const at = mix.spatial && s ? s.pos : listener.pos;
      n.panner.positionX.setTargetAtTime(at.x, t, 0.03);
      n.panner.positionY.setTargetAtTime(at.y, t, 0.03);
      n.panner.positionZ.setTargetAtTime(at.z, t, 0.03);
      p.level = rms(n.analyser, this.buffer) * (mix.gain > 0 ? 1 : 0);
    }
    if (this.micTrack && !this.micLevel) {
      this.micSource = ctx.createMediaStreamSource(new MediaStream([this.micTrack]));
      this.micLevel = ctx.createAnalyser();
      this.micLevel.fftSize = 512;
      this.micSource.connect(this.micLevel);
    }
    this.ownLevel = this.micLevel && this.sending ? rms(this.micLevel, this.buffer) : 0;
  }

  private nodesFor(ctx: AudioContext, p: Peer): NonNullable<Peer['nodes']> {
    const element = new Audio();
    element.srcObject = p.stream;
    element.muted = true;
    void element.play().catch(() => {});
    p.element = element;
    const source = ctx.createMediaStreamSource(p.stream!);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 20_000;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = VOICE_REF_DISTANCE;
    panner.rolloffFactor = 1;
    panner.maxDistance = 100;
    source.connect(analyser);
    source.connect(filter).connect(gain).connect(panner).connect(this.output!);
    return { source, filter, gain, panner, analyser };
  }

  private dropNodes(p: Peer): void {
    if (p.nodes) {
      p.nodes.source.disconnect();
      p.nodes.panner.disconnect();
    }
    p.nodes = null;
    if (p.element) {
      p.element.pause();
      p.element.srcObject = null;
    }
    p.element = null;
  }

  /** Whether another player is talking right now (and can be heard). */
  speaking(id: number): boolean {
    return (this.peers.get(id)?.level ?? 0) > SPEAKING_LEVEL;
  }

  get ownSpeaking(): boolean {
    return this.ownLevel > SPEAKING_LEVEL;
  }

  /** For tests and the debug console: each connection's state. */
  states(): Record<number, string> {
    return Object.fromEntries([...this.peers].map(([id, p]) => [id, p.pc.connectionState]));
  }

  close(): void {
    for (const p of this.peers.values()) this.hangUp(p);
    this.peers.clear();
    this.releaseMic();
    this.output?.disconnect();
    this.output = null;
  }
}

function rms(a: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  a.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  return Math.sqrt(sum / buf.length);
}
