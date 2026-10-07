# 02: Game Design

Working title: **Some Assembly Required**. Genre: cooperative building plus social deduction ("friendslop"). Players: 4–8 (one saboteur), or 7–10 with two saboteurs.

## Pillars

1. **Building is slapstick.** Physics makes moving things a gamble, and everyone ragdolls.
2. **Fumbling gives the saboteur cover.** Every sabotage action should also look like an honest mistake.
3. **Information is the real resource.** Pages, the index and the inspector are all about knowing what is true.
4. **The ending is funny.** Every round ends with the build next to the target model.

## Round flow

```
Lobby -> Role reveal (5 s) -> Build phase (8-12 min) -> Final check -> Results screen -> Lobby
                                    ^           |
                                    +- Brick Meeting (discussion + vote, ~90 s, timer paused or slowed)
```

1. **Lobby:** the host picks the target build, the map, the round length and the variant.
2. **Role reveal:** each player privately sees "Builder" or "Saboteur". Saboteurs see each other.
3. **Build phase:**
   - A **baseplate** stands at the job site in the middle of the map. The model is built on it.
   - **Instruction pages** (one per step) are hidden in spots around the map.
   - **Brick bins** hand out bricks by type and colour. Bins never run out, so players can use as many bricks as they like. Rare colours come from only one or two bins.
   - The **master index** (one per map, in a random spot) lists each real page's stamp, page number and a small thumbnail.
   - The **quality inspector station** is somewhere away from the job site. Carry the build there and, after a short scan, it prints a report: how many bricks are correct per step and overall, and a line for every problem in the steps the team has started ("dark red 2x4 brick, should be red 2x4 brick", "missing: white 2x2 brick", "extra: green 1x1 brick"). It also sticks marks on the build itself: red on wrong or stray bricks, orange on look-alikes, ghosts where bricks are missing. The marks stay until the brick is fixed, so the trip pays off even after the build is carried back. Steps nobody has started only say "not started", so the inspector never replaces the page hunt.
4. **Brick Meeting:** any player can call one by ringing the job-site bell (limited uses per player). Everyone is teleported to the break room to discuss and vote. The player with a majority is "sent home" and becomes a spectator. Their role is not revealed, so the team doesn't know right away whether they got it right.
5. **End:** the round ends when the team presses "Done" at the job site (majority vote), when the timer runs out, or when a win condition triggers.
6. **Results:** the build and the target are shown side by side on a turntable. Wrong bricks are highlighted, with a score, the roles revealed, and a short replay of funny moments if we get that far.

## Win conditions

| Side     | Wins when                                                                                    |
| -------- | -------------------------------------------------------------------------------------------- |
| Builders | The final build matches the target, within a tolerance (see "Matching") before time runs out |
| Saboteur | Time runs out, **or** the final build is wrong, **or** the team sent home two innocents      |

Sending the saboteur home does not win the round on its own. The team still has to finish the build, just without interference. This keeps building central.

Penalty for sending an innocent home: −60 s on the timer (to be decided in playtests).

## Matching

A target build is a list of bricks: `(type, colour, stud position, rotation)` relative to the baseplate. The final build is compared brick by brick.

- **Correct:** same type, colour, position and rotation.
- **Close:** right position, but the colour is a near miss (dark grey vs light grey) or the type is a near miss (2x3 vs 2x4).
- **Wrong or missing/extra.**

Builders win if, for example, at least 95% of bricks are correct and no structural brick is missing. We tune this in playtests. Being lenient makes subtle brick swaps more interesting: one wrong brick may be survivable, three won't be.

## Instruction pages

- One page = one step = 2–8 bricks added to the build. A page shows an isometric picture of the build so far, with the new bricks highlighted, and a parts list.
- Each real page carries a **page number**, a **stamp** (a small icon unique to this round) and a **watermark pattern**.
- **Paired pages:** some steps are split over two half-pages (A shows positions, B shows colours). Two players have to compare them, which is a natural spot for the saboteur to lie.
- Pages are physical items. Players carry one at a time, can **show** it to nearby players (they see it for as long as they stand close), or **post** it on the job-site board, where everyone can read it.

### Hiding spots (examples)

Drawers, under rugs, on the roof (needs the ladder), in the fridge, in the dog's mouth (the dog wanders around and must be chased or given a treat), inside a bin under the bricks, behind a painting, in the mailbox.

Each map has 25–40 hiding spots. A round fills only as many as it has pages, plus forged copies.

### The map

A house next to the yard. The yard has the job site, the bins, the quality inspector behind a short wall, and a ramp up to a ledge with the rarest bin. The house has a kitchen, a living room and the break room where Brick Meetings are held, and a flat roof reached by a ladder on its south wall. About half of the pages start in closed hiding places (fridge, drawers, lockers, sofa cushion, TV cabinet, rugs, mailbox, toolbox, chest) and the rest lie on open surfaces (tables, crates, the bookshelf, the roof, yard corners). A corkboard at the job site holds up to eight pinned pages for everyone to read.

### Colours change every round

Each round plays a recoloured variant of the model: whole groups of bricks switch to a look-alike colour (all the red stripes turn dark red or orange, say) and about a quarter of single bricks get a look-alike accent. Shapes and positions never change, and only colours the bins hand out are used. The box art shows the standard colours with a note that they vary; the pages and the master index show this round's. That way a look-alike colour on a page is normal, and only the master index (or the stamp) tells a real page from a forgery.

## Saboteur tools

All tools have cooldowns. Most can be seen if someone is watching closely.

| Tool              | Effect                                                                                                                          | Tell                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Forged page**   | Swap a page the saboteur is holding (or one in a hiding spot) for a near-copy with one wrong detail                             | The stamp or watermark is slightly off, which shows when checked against the master index |
| **Brick swap**    | Swap a brick in the build for a near-miss variant of the same shape                                                             | Short animation. A nearby player can notice it                                            |
| **Hide page**     | Pocket a page (it disappears from the world) or bury it in a new spot                                                           | The page is missing from where someone saw it                                             |
| **Clumsy mode**   | Trip on purpose and ragdoll into whatever is in front of them, knocking loose what the build's weaker joints hold (2 per round) | Looks exactly like a real trip. Limited charges, and trips happen to everyone anyway      |
| **Barefoot trap** | Drop 3 loose bricks on the floor. Anyone who steps on a loose brick (anyone's) screams and limps for 10 s; sprinting, they fall | Someone has to have dropped them, and builders drop bricks too                            |

Ideas for later: fake "inspector OK" stickers, a stolen bell (blocks meetings for 60 s), relabelling a brick bin.

## How the team fights back

- **Master index:** shows the real stamp and number of each page. Checking a page means bringing it there, or memorising and comparing.
- **Inspector station:** gives a true, detailed report and marks problem bricks on the build, but someone has to carry the (fragile) build across the map.
- **Brick Meeting:** talk and vote.
- **Witnessing:** saboteur actions have short visible animations, so watching each other matters.

## Physics comedy

- Snapped assemblies are rigid bodies. When dropped or hit hard enough, they break apart at weak joints. A tall tower being carried across the map is a disaster.
- Players ragdoll when they trip, get hit by a heavy assembly, or step on a brick while running.
- After a round, unlocked **joke builds** (a catapult that launches players, a swing, a ramp) can be played with in the lobby between rounds.

## Variants (after the MVP)

- **Two saboteurs** for 7+ players.
- **Rival teams:** two job sites and the same target. The saboteur is a spy from the other team.
- **Blind build:** one "reader" can see pages but cannot touch bricks. Builders cannot see pages.

## MVP scope (vertical slice)

Build only this first and playtest it before adding anything else:

- 1 map (a house with a yard), 1 target build (a small lighthouse, about 40 bricks, 8 steps).
- 4–8 players, 1 saboteur.
- Pages, master index, brick bins with rare colours, the inspector station, Brick Meeting and voting.
- Saboteur tools: **forged page, brick swap, hide page**. (Clumsy mode and the barefoot trap need ragdolls, so they come right after.)
- Results screen with the side-by-side comparison.
- Text chat. Proximity voice comes after the MVP.

The MVP answers one question: is finding pages, building and catching the saboteur fun?
