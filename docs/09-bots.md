# 09: Bots

Bots are computer players. The host adds them in the lobby to fill places nobody is in, and they play the round like anyone: they get a role, walk the map, hunt for pages, run the brick works, build, feed the dog, ring the bell and vote. They play in the room itself (`shared/src/bots/`), on the server or in a solo tab, and they move and act through the same inputs and actions a client sends, under the same rules and rate limits.

## In the lobby

The host's settings have:

- **Bots**: how well the room's bots play (all of them at once): Easy, Normal, Hard or Expert.
- **Bots play as** (saboteur and blind modes): either side (roles dealt as usual), the saboteurs (bots are dealt the saboteur roles before people are, so the people build against them) or the builders (people are dealt the saboteur roles first).
- **Add a bot** and **Fill with bots**. Each bot in the player list has a ✕ to take it out.

Bots are always ready. A room of only bots counts as empty (it is not listed and closes like any empty room), and in the lobby the last bot added makes way for anyone who joins a full room.

## Levels

| Level  | Builders                                                                                                                      | Saboteurs                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Easy   | Walk everywhere, think a second and a half between jobs, look the build over once a minute, slow to accuse                    | Half as many tricks, only wait until nobody is in seeing range (6 m)                                                     |
| Normal | Sprint, half a second between jobs, look the build over every 20 s                                                            | The usual tricks, wait until nobody is within 7 m                                                                        |
| Hard   | Quick, look the build over every 6 s, accuse sooner                                                                           | More tricks but wait until nobody is within 9 m, swap bricks low in the build, trip into a tall build in front of anyone |
| Expert | As hard, and know what a player cannot: every page, and which people are saboteurs (never which bots, so bot games stay fair) | As hard with more tricks, and against people they trip into the build far more often                                     |

Below Expert, and at Expert about other bots, bots only know what a person in their place could know: what they read and saw themselves, shared with the other bots as a team that talks to each other would. Builders suspect someone who was seen using a tool with a tell (within the 6 m anyone sees it), who put a page from their pocket into a hiding place, or who was about the build when a swap turns up.

## How they build

Every tick a bot runs one job (a generator) and sends one input. Jobs: put away a tool, read a page, fix the panel, feed the dog, ring the bell, press Done, take off a wrong brick, search for pages, build a brick, or wait.

- **Walking**: a walking map of the level (`nav.ts`), A\* with costs for other players, loose bricks and the baseplate, cutting corners where the way is clear, getting off pushed crates.
- **Pages**: the bots share what they read (a forger tells its forgery). They search the spots pages lie in and the hiding places, oldest first, jumping to see onto high shelves, and take pages off the dog.
- **Bricks**: a bot claims a brick of the earliest steps it can put on now (bottom up), gets it from the floor or a moulding machine (setting up the mould, colour and press with the fewest trips), and places it the way a player does: standing still and clear of the build, aiming at the snap preview, holding Shift to lock the layer for bricks that bridge a gap, jumping to reach high ones, and turning slowly with a brick in hand so it does not swing into the build.

## Balance

`npm run bot-games -w @sar/server -- --games 40 --players 6 --level normal` plays rounds between bots only, headless and in parallel, and prints who won. `--people N --as LEVEL --side saboteurs|builders` makes N of the players stand-ins for people.

Measured (40 games each, 6 players, every map and build in turn, 10 minute rounds):

| Level                                                   | Builders win | Saboteurs win | Saboteurs voted off |
| ------------------------------------------------------- | -----------: | ------------: | ------------------: |
| Easy                                                    |           22 |            18 |                   1 |
| Normal                                                  |           22 |            18 |                   3 |
| Hard (80 games, two sets of seeds)                      |           34 |            46 |                  16 |
| Expert                                                  |           20 |            20 |                   2 |
| One expert saboteur against five hard stand-in builders |            9 |            31 |                   9 |
| Five expert builders against one hard stand-in saboteur |           36 |             4 |                  40 |

Builders win by finishing the build; saboteurs win when time runs out first. Nobody innocent was voted off in any of these games. In plain co-op, four normal bots finish 19 of 22 builds (every model once) in about six minutes on average.

What this does not show: how bots do against real people. The stand-ins are bots too, and people are better than hard bots at reading what others do and at building fast, and worse at being in two places at once. Against people, expert builders vote a saboteur off at once (they know), so a person playing the saboteur loses unless the build runs out of time; expert saboteurs win by keeping the build from finishing, and lose when they are caught in the act.

## Known gaps

- Bots read the pages but do not argue: they say what they saw and who they suspect, but do not answer questions in the chat or follow a person's lead.
- They build one brick at a time; they never carry the build to the inspector or build sub-assemblies off the baseplate.
- Big builds (a castle, a train station) take most of a ten-minute round even for expert builders.
