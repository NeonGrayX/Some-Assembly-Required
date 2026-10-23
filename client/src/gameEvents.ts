import { GEAR_IDS, VACUUM_CAPACITY, gearName, length, sub } from '@sar/shared';
import type { SimEvent, Vec3 } from '@sar/shared';
import type { Sfx } from './audio.ts';
import { hearing } from './carscene/gadgets.ts';
import { inline } from './hints.ts';
import type { Hint } from './hints.ts';
import type { ClientGame } from './net/game.ts';
import { HIDEOUT_TRAVEL } from './render/furniture.ts';
import type { VoiceChat } from './voiceChat.ts';
import { view } from './worldView.ts';

/** Each player screams in their own voice. */
const voicePitch = (id: number | undefined) => 0.85 + (((id ?? 0) * 37) % 30) / 100;

/**
 * What the player hears of the game, from where they are: what happened (with the effects and
 * notices that go with it), the vacuum's motor, and the scenery's own noises.
 */
export class GameEvents {
  /** Where the player hears from, this frame. */
  private listener: Vec3 = { x: 0, y: 0, z: 0 };
  /** Whether the vacuum's motor was still last frame, so the switch clicks as it starts. */
  private vacuumStill = true;

  constructor(
    private readonly sfx: Sfx,
    private readonly game: () => ClientGame | null,
    private readonly notice: (text: string | Hint) => void,
    private readonly voiceChat: VoiceChat,
  ) {
    // The scenery's lamps, taps and the rest, heard from where each is, as the game's own
    // sounds are.
    hearing.play = (noise, at) => sfx.play(noise, 1 / (1 + length(sub(at, this.listener)) / 4));
  }

  /** Plays what happened since last frame, and the sounds that go on, heard from `listener`. */
  update(events: SimEvent[], listener: Vec3): void {
    this.listener = listener;
    this.play(events, listener);
    this.playVacuum(listener);
    for (const at of view.ratchets) this.sfx.ratchet(1 / (1 + length(sub(at, listener)) / 4));
  }

  /** The vacuum's motor, heard from wherever the vacuum is. */
  private playVacuum(listener: Vec3): void {
    const v = view.vacuum;
    const volume = 1 / (1 + length(sub(v.group.position, listener)) / 4);
    if (v.speed > 0 && this.vacuumStill) this.sfx.vacuumSwitch(volume);
    this.vacuumStill = v.speed === 0;
    this.sfx.vacuumMotor(v.speed, volume, v.full);
  }

  private play(events: SimEvent[], listener: Vec3): void {
    const { sfx, notice, voiceChat } = this;
    const game = this.game();
    const mine = (e: SimEvent) => e.playerId !== undefined && e.playerId === game?.myId;
    // What a player's hands are to bring about at a machine waits for them, shown and heard when
    // they do (the machine shows it already then), or when they never get there.
    const due = events.filter((e) => !view.holdEvent(e));
    const shown = new Set<SimEvent>();
    for (const { e, handled } of view.heldEvents()) {
      due.push(e);
      if (handled) shown.add(e);
    }
    for (const e of due) {
      if (!shown.has(e)) view.machineAt(e);
      const volume = 1 / (1 + length(sub(e.pos, listener)) / 4);
      if (e.kind === 'trip') {
        sfx.oof(volume, voicePitch(e.playerId));
        if (mine(e)) notice('Down you go!');
      } else if (e.kind === 'ouch') {
        sfx.scream(volume, voicePitch(e.playerId));
        // Whatever they yell into their microphone now carries further.
        if (e.playerId !== undefined) voiceChat.scream(e.playerId);
        if (mine(e)) notice('Ouch! You stepped on a brick. Limping for a while.');
      } else if (e.kind === 'catapult') {
        sfx.catapult(volume);
        view.fireCatapult();
        if (mine(e)) notice('Wheee!');
      } else if (e.kind === 'bark') sfx.bark(volume);
      else if (e.kind === 'pat') sfx.whine(volume);
      else if (e.kind === 'yelp') {
        sfx.yelp(volume);
        if (mine(e)) notice('You grabbed its collar: the dog let go of the page.');
      } else if (e.kind === 'crunch') {
        sfx.crunch(volume);
        if (mine(e)) notice('The dog loves you. It follows you for a while.');
      } else if (e.kind === 'treat') {
        sfx.treats(volume);
        if (mine(e)) notice('You took a dog treat. The dog will come for it.');
      } else if (
        e.kind === 'swap' ||
        e.kind === 'forge' ||
        e.kind === 'hide' ||
        e.kind === 'tamper'
      ) {
        // A saboteur tell: only sent to players close enough to notice.
        view.puff(e.pos);
        sfx.rustle(volume);
      } else if (e.kind === 'powerOut') {
        // The whole house goes dark: everyone hears it, wherever they are.
        sfx.powerOut();
        notice(
          game?.mode === 'gear'
            ? 'The power is out for good. Find the headlamp to read inside the house.'
            : 'The power is out, and the machines with it! Fix the electrical panel in the basement.',
        );
      } else if (e.kind === 'gearOn') {
        sfx.pickUp(volume);
        if (mine(e) && e.gear) {
          const n = GEAR_IDS.indexOf(e.gear) + 1;
          notice([
            inline(
              `You put on the ${gearName(e.gear).toLowerCase()}. `,
              { gear: n },
              ': take it off for someone else.',
            ),
          ]);
        }
      } else if (e.kind === 'gearOff') sfx.drop(volume, 1, 2);
      else if (e.kind === 'locked') {
        sfx.click(volume);
        if (mine(e)) notice('Padlocked. The key ring opens it.');
      } else if (e.kind === 'unlock') sfx.pin(volume);
      else if (e.kind === 'leash') {
        // The dog barks on its own as the leash goes on.
        notice('The dog is on its leash: no more stolen pages or wrecked builds.');
      } else if (e.kind === 'tug') {
        sfx.thump(volume * 0.6);
        if (e.fromId === game?.myId)
          notice(`${game?.nameOf(e.playerId ?? 0)} is tugging at the build you carry!`);
      } else if (e.kind === 'tugged') {
        sfx.pickUp(volume, 2);
        if (mine(e)) notice(`You tugged the build out of ${game?.nameOf(e.fromId ?? 0)}'s hands.`);
        else if (e.fromId === game?.myId)
          notice(`${game?.nameOf(e.playerId ?? 0)} tugged the build out of your hands!`);
      } else if (e.kind === 'pick') {
        sfx.page(volume * 0.5);
        if (e.fromId === game?.myId)
          notice(`${game?.nameOf(e.playerId ?? 0)} is going for the page in your pocket!`);
      } else if (e.kind === 'picked') {
        sfx.page(volume);
        if (mine(e)) notice(`You picked the page out of ${game?.nameOf(e.fromId ?? 0)}'s pocket.`);
        else if (e.fromId === game?.myId)
          notice(`${game?.nameOf(e.playerId ?? 0)} picked the page out of your pocket!`);
      } else if (e.kind === 'tired') {
        sfx.oof(volume * 0.6, voicePitch(e.playerId));
        if (mine(e)) notice('Your arms are too tired to carry a build. Rest a while first.');
      } else if (e.kind === 'heavy') {
        sfx.oof(volume, voicePitch(e.playerId));
        if (mine(e)) {
          notice([
            inline('Too heavy! ', 'careful', ' to lift it carefully, or find the back brace.'),
          ]);
        }
      } else if (e.kind === 'fixing') sfx.thump(volume * 0.7);
      else if (e.kind === 'breakdown') {
        sfx.breakdown(volume);
        if (length(sub(e.pos, listener)) < 12)
          notice([inline('A machine broke down! ', 'use', ' it and stay there to clear the jam.')]);
      } else if (e.kind === 'unjammed') {
        sfx.button(volume);
        if (mine(e)) notice('You cleared the jam: the machine works again.');
      } else if (e.kind === 'powerOn') {
        sfx.powerOn();
        notice(
          mine(e) ? 'You fixed the panel: the lights are back on.' : 'The lights are back on.',
        );
      } else if (e.kind === 'meeting') sfx.bell();
      else if (e.kind === 'sentHome') sfx.sentHome();
      else if (e.kind === 'open' || e.kind === 'close') {
        const def = game?.sim.level.hideouts.find((h) => h.id === e.hideoutId);
        if (def) sfx.hideout(def.kind, e.kind === 'open', HIDEOUT_TRAVEL, volume);
        else sfx.thump(volume * 0.8);
      } else if (e.kind === 'pin') sfx.pin(volume);
      else if (e.kind === 'snap') sfx.snap(volume);
      else if (e.kind === 'page') sfx.page(volume);
      else if (e.kind === 'button') sfx.button(volume);
      else if (e.kind === 'grab') sfx.pickUp(volume, e.count);
      else if (e.kind === 'break') sfx.crash(volume, e.count);
      else if (e.kind === 'anchor') sfx.anchor(volume, e.count);
      else if (e.kind === 'handIn') sfx.anchor(volume);
      else if (e.kind === 'vacuumUp') {
        sfx.vacuumUp(volume);
        if (mine(e)) {
          notice([
            inline(
              'You took the vacuum. ',
              'holdTheClick',
              ` to suck up loose bricks where you aim; it holds ${VACUUM_CAPACITY}, then empty it at a rubbish bin.`,
            ),
          ]);
        }
      } else if (e.kind === 'vacuumDown') sfx.vacuumDown(volume);
      else if (e.kind === 'suck') {
        view.vacuum.sucked();
        sfx.suck(volume, e.count);
      } else if (e.kind === 'vacuumFull') {
        sfx.vacuumFull(volume);
        if (mine(e)) notice('The vacuum is full. Empty it at a rubbish bin.');
      } else if (e.kind === 'drop') sfx.drop(volume, e.count, e.speed);
      else if (e.kind === 'toolUp') sfx.pickUp(volume, 2);
      else if (e.kind === 'dispense') sfx.dispense(volume);
      else if (e.kind === 'ready') sfx.ready(volume);
      else if (e.kind === 'toolDown') sfx.binDrop(volume);
      else if (e.kind === 'mouldIn') sfx.mouldIn(volume);
      else if (e.kind === 'pour' || e.kind === 'fill') sfx.pour(volume);
      else if (e.kind === 'moulded') sfx.moulded(volume);
      else if (e.kind === 'printerIn') sfx.snap(volume);
      else if (e.kind === 'print') sfx.print(volume);
      else if (e.kind === 'binned') {
        sfx.binDrop(volume);
        view.furniture.binned(e);
      }
    }
  }
}
