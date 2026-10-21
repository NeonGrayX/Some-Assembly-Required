# 09: Bots

Bots are computer players. The host adds them in the lobby to fill places nobody is in, and they play the round like anyone: they get a role, walk the map, hunt for pages, run the brick works, build, feed the dog, ring the bell and vote. They play in the room itself (`shared/src/bots/`), on the server or in a solo tab, and they move and act through the same inputs and actions a client sends, under the same rules and rate limits.

## In the lobby

The host's settings have:

- **All bots**: how well the room's bots play: Easy, Normal, Hard or Expert. Changing it sets every bot already in the room, and bots added after it play at that level.
- **Bots play as** (saboteur and blind modes): either side (roles dealt as usual), the saboteurs (bots are dealt the saboteur roles before people are, so the people build against them) or the builders (people are dealt the saboteur roles first).
- **Add a bot** and **Fill with bots**. Each bot in the player list has a ✕ to take it out, and a **Level** list under its name to set that one bot apart from the rest.
- In a solo game (saboteur and blind modes), every player in the list, the host included, has a **Role** list: Random (dealt as usual), Saboteur or Builder. A chosen role always holds, ahead of **Bots play as**: the saboteur count grows to fit everyone chosen as a saboteur and shrinks to leave everyone chosen as a builder building, and the blind build's reader is drawn from the players left to chance where there are any. A bot starts on the side **Bots play as** names: Builder when people are the saboteurs; Saboteur when the bots are, until the saboteur places (the Saboteurs setting, or the usual number for the group) are taken, then Builder; Random for either side. Changing **Bots play as** sets every bot's role afresh. Online rooms have no role lists, since they would tell the host who the saboteurs are.

Bots are always ready. A room of only bots counts as empty (it is not listed and closes like any empty room), and in the lobby the last bot added makes way for anyone who joins a full room.

## Levels

| Level  | Builders                                                                                                   | Saboteurs                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Easy   | Walk everywhere, think a second and a half between jobs, look the build over once a minute, slow to accuse | Half as many tricks, only wait until nobody is in seeing range (6 m)                                                     |
| Normal | Sprint, half a second between jobs, look the build over every 20 s                                         | The usual tricks, wait until nobody is within 7 m                                                                        |
| Hard   | Quick, look the build over every 6 s, accuse sooner                                                        | More tricks but wait until nobody is within 9 m, swap bricks low in the build, trip into a tall build in front of anyone |
| Expert | As hard, think and look the build over all the time, and ring the bell sooner                              | As hard with more tricks, and against people they trip into the build far more often                                     |

Bots only know what a person in their place could know: what they read and saw themselves, shared with the other bots as a team that talks to each other would. They build only steps one of them has read, and never forget a page once read. No bot, at any level, knows where a page lies before it sees it, or who the saboteurs are. Builders suspect someone who was seen using a tool with a tell (within the 6 m anyone sees it), who put a page from their pocket into a hiding place, or who was about the build when a swap turns up.

## In the chat

Bots read the text chat the way it reaches anyone (within shouting distance while building, everyone in a meeting) and answer in it, without a language model: `shared/src/bots/talk.ts` picks out what players say most, in English and a little German. A line that starts with a bot's name ("Bolt, …") or has `@Bolt` in it is for that bot; anything else is answered by the nearest bot that heard it.

| Someone says                                                                    | What the bots do                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| "I saw Bob swap a brick", "it's Bob", "Bob is sus"                              | Suspect Bob, as much as they trust whoever said it (less, the more they suspect the speaker). A named tell counts most.                    |
| "Bob is fine", "trust Bob"                                                      | Suspect Bob less, by the same trust.                                                                                                       |
| "vote Bob"                                                                      | Suspect Bob a little.                                                                                                                      |
| "who do you think it is?"                                                       | Name the player they suspect most and why ("Maybe Bob (Ada saw them swap a brick), but I am not sure"), or say they have no idea yet.      |
| "where is page 5?", "wo ist Seite 3?"                                           | Say who has it, that it is on the board or with the dog, or where they saw it ("about 6 m from the silo"), or that nobody has seen it.     |
| "which stamp is real?", "what are you doing?"                                   | Answer.                                                                                                                                    |
| "feed the dog", "fix the power", "find the pages", "come here", "ring the bell" | Do it (one bot; "ring the bell" only if it is sure enough of someone).                                                                     |
| "Bolt, you swapped that!"                                                       | Bolt says it was not it, and points at whoever it suspects. Every bot does this, saboteur or not, and the bots doubt the accuser a little. |

Bots also say who they saw use a tool with a tell, and in a meeting how they vote and why. Saboteur bots lie: they deny, cover for a fellow saboteur, point at an innocent who hangs about the build when asked who it is, now and then ask whether anyone saw an innocent "fiddling with the build" after a swap, and keep quiet about pages they hid. Bots never talk to each other in the chat (they share what they know anyway) and say nothing when no person is in the room, so bot-only games are not affected.

## How they build

Every tick a bot runs one job (a generator) and sends one input. Jobs: put away a tool, read a page, fix the panel, feed the dog, ring the bell, press Done, take off a wrong brick, search for pages, build a brick, or wait.

- **Walking**: a walking map of the level (`nav.ts`), A\* with costs for other players, loose bricks and the baseplate, cutting corners where the way is clear, getting off pushed crates. The searches run in WebAssembly (`shared/assembly/nav.ts`, AssemblyScript, built into `navcore.wasm.ts` by `npm run build:wasm -w @sar/shared`), which works them out exactly as the JavaScript in `nav.ts` does; the JavaScript runs until the module is loaded, or where there is no WebAssembly.
- **Sloped ground** (the island): the walking map stands on any ground no steeper than a player can climb, and a step through the sea costs several times a step on land, so bots wade only where it is much shorter.
- **A build carried off its job site** (to the inspector, say) is loose, and one knock breaks it: bots walk carefully within a couple of metres of it and go on building it where it stands.
- **Knocked-off bricks** lying on the baseplate get in the way of everything: up to two builders at a time pick them up, put them on if they go on now, and otherwise throw them clear of the build (turning away slowly first, so they do not fly into it).
- **Pages**: the bots share what they read (a forger tells its forgery). They search the spots pages lie in and the hiding places, oldest first, jumping to see onto high shelves, and take pages off the dog.
- **Bricks**: a bot claims a brick of the earliest steps it can put on now (bottom up), gets it from the floor or a moulding machine (setting up the mould, colour and press with the fewest trips), and places it the way a player does: standing still and clear of the build, aiming at the snap preview, holding Shift to lock the layer for bricks that bridge a gap, flipping a part with E when the step has it on by its back or top, jumping to reach high ones, and turning slowly with a brick in hand so it does not swing into the build.
- **The brick works**: the mould dispenser, the pellet silo and the moulding machines leave what they make in their output areas (the hatch, the grate under the tap, the tray under the mould), and a bot takes it out from there with a click, as a player does. It orders at the machine and waits there for it, or takes one lying there already if it is just what it wants, no other bot is waiting for it and nobody else ordered it in the last 20 seconds. A machine makes one thing at a time and nothing while its output area is full: a bot waits its turn, and after a few seconds takes out of the way what nobody comes for (a mould or a bucket put away, a part set down on the floor for anyone to use; one just like what it wants it keeps). The bots see who orders what, and leave what a person ordered there for them for 20 seconds. At a machine that cannot make what it wants (jammed, without power, or a moulding machine not set up for it), it takes nothing out of the way and gives up. If someone else takes what it had made first, it gives up and tries again later; if another bot clicked for the same thing at the same moment, the one whose click the machine took waits for it and the other has its own made after.

## Balance

`npm run bot-games -w @sar/server -- --games 40 --players 6 --level normal` plays rounds between bots only, headless and in parallel, and prints who won. `--people N --as LEVEL --side saboteurs|builders` makes N of the players stand-ins for people.

Measured (40 games each, 6 players, every map and build in turn, 10 minute rounds):

| Level                                                   | Builders win | Saboteurs win | Saboteurs voted off |
| ------------------------------------------------------- | -----------: | ------------: | ------------------: |
| Easy                                                    |           23 |            17 |                   3 |
| Normal                                                  |           23 |            17 |                   8 |
| Hard                                                    |           22 |            18 |                   5 |
| Expert                                                  |           23 |            17 |                  14 |
| One expert saboteur against five hard stand-in builders |           21 |            19 |                  10 |
| Five expert builders against one hard stand-in saboteur |           31 |             9 |                  17 |

Builders win by finishing the build; saboteurs win when time runs out first. Nobody innocent was voted off in any of these games.

What this does not show: how bots do against real people. The stand-ins are bots too, and people are better than hard bots at reading what others do and at building fast, and worse at being in two places at once. Expert builders win by building fast and catching a saboteur in the act; expert saboteurs win by keeping the build from finishing, and lose when they are caught.

## Known gaps

- The chat is pattern matching, not conversation: anything outside the table above (a joke, an argument, a question put another way) gets no answer.
- They build one brick at a time; they never carry the build to the inspector or build sub-assemblies off the baseplate.
- A big piece knocked off whole is thrown clear, not put back on: its bricks get built again from new.
- Big builds (a castle, a train station) take most of a ten-minute round even for expert builders.
