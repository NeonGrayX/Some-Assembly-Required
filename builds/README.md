# Build files

Models with their instruction manuals, in the [build file format](../docs/07-build-file-format.md). To look at one, open the build editor at `/editor.html`, paste the file into the box under the buttons and click **Import build file**. The step buttons and "show up to this step" walk through the manual.

Every file here is checked by `shared/src/builds/community.test.ts` the way the editor imports it, so a file that breaks a rule fails `npm test`.

| File                       | Parts | Pages | What it is                                                                                                 |
| -------------------------- | ----- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `manga-shop.sarbuild.json` | 139   | 32    | A two-storey izakaya and manga shop on a paved corner, after the Lumibricks 17016 manual                   |
| `izakaya.sarbuild.json`    | 142   | 28    | The Manga Shop's neighbour: a corner izakaya with a street stall, after the second Lumibricks 17016 manual |

## Manga Shop

The shop is also a built-in build (`shared/src/builds/mangashop.ts` loads this file), so it can be picked in the lobby and played. On every map, the two racks of small parts drawers hand out all 79 of its parts and colours, as plain parts. In a round of the Manga Shop, the specialty parts shelf beside the job site hands out its six printed tiles.

It keeps the original's footprint on its 8x8 base, stud for stud: the building is 6 studs along the sign side and 5 along the door side, with pavement on three sides. Its 90 steps are grouped into 32 pages in the manual's order. The floor under the roof comes after the upper walls, so nothing has to be slid in under it, and no page hides a part it adds under another part it adds: the base's two layers of plates and the 8x8 plate over them each get a page. Pages that build the door side are shown from there, as in the manual's first half, except the back column's, which can only be seen from the sign side. The rest are shown from the sign side, as in its second half and on the box.

### The parts

Most parts are the manual's own: tiles, grille tiles, slopes, cheese and curved slopes, round bricks and plates, cones, a dish, window frames, a fern, headlight bricks, bricks with studs on their side, an inverted bracket, and see-through red, orange, blue, black and clear parts. The printed tiles are plain tiles with a print on top, drawn from the six SVGs in the file's `svgs` section: the MANGA SHOP sign (`manga-shop`), the poster, the billboard, the vertical MANGA sign (`manga`), the cat's face (`cat-face`, on a 2x2 round tile) and the neon sign (`neon`). Delete the `svgs` section for a clean version with plain tiles. The thin parts clip on sideways where the manual clips them:

- The MANGA SHOP sign hangs under the inverted bracket at the front of the base.
- The poster clips onto a 1x2x2 brick with studs on its side.
- The blue lamp, the light-blue tile, the pink window and the gold lamp sit on headlight bricks.
- The orange neon grille and the neon shop sign stand on bricks with side studs.
- The MANGA sign stands on end on the corner.
- The billboard and the cat's face hang on bricks with side studs.

### What is different

The game has no hinges, clips, bars or angled parts, so these become the nearest parts that stack:

| In the original                                    | In the file                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Base built upside down                             | The same plates, stacked from the bottom                                     |
| Red bars hanging on clips (pipes)                  | See-through red round bricks, holding up the porch roof                      |
| Trans-orange 4x4 roof panels on hinges             | A gable of black slopes with see-through orange bricks and cheese slopes     |
| Billboard hung on clips                            | The billboard tile clipped onto a brick with side studs on the porch roof    |
| Cat on a hinge, with a curved tail and a bar torch | Black bricks with the face tile on side studs, cone ears and a gold cone     |
| Lantern of round parts on a bar                    | Round bricks and plates stacked                                              |
| 2x2 corner plate under the side window             | A 1x2 plate                                                                  |
| Profile and clip bricks                            | Plain bricks of the same size                                                |
| Dish centred on the roof's front stud              | The dish on that one stud, off centre by half a stud: the grid has no halves |

Left out: the noren over the door, the tail and the bars that only hold other parts.

## Izakaya

The Izakaya is the other half of the Lumibricks 17016 set, built from its second manual (bag 3 and 4). It is a built-in build too (`shared/src/builds/izakaya.ts` loads this file). The small parts drawers hand out its parts on every map: a fifth shelf on each drawer rack holds the 20 parts and colours it needs on top of the Manga Shop's. In a round of the Izakaya, the specialty parts shelf hands out its five printed parts.

It stands on the same 8x8 base as the Manga Shop, the IZAKAYA sign clipped under a bracket at the front. The izakaya itself takes 5 by 7 studs on the west side; the street stall, the torii and a little teal shop share the 3 studs to the east. Its 28 pages follow the manual's order: the ground floor, the upper floor, the teal shop, the torii, the stall and its crab, then the roof. As in the Manga Shop, no page hides a part it adds: the base is built in three pages, and the solar panels go on a page after their boxes. Pages are shown from the front and the stall side, as in the manual, except the two that build the west side and the teal shop's, shown from behind so its windows show.

### The parts

New parts for it: a 2x2 round brick (the water tank and the crab's body), a 3x3 round corner plate (the rounded corner over the door and under the roof), a 3x3 quarter arc tile (the black edge of the roof), a flower and a spire, in two new colours, lime and see-through green. The prints are plain parts with an SVG from the file's `svgs`: the IZAKAYA sign (`izakaya`), the sliding door with its blue noren (`door`, on the front of a 1x2x2 brick), the 酒 sign over the door (`sake`), the tall 居酒屋 sign on the west side (`izakaya-kanji`, a clear 1x3 tile standing on end) and two solar panels (`solar`). The kanji are drawn as strokes, so they show without a Japanese font.

### What is different

| In the original                                        | In the file                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Base built upside down, the sign on the base's edge    | The same plates, stacked from the bottom, the sign under an inverted bracket |
| Bar counter, stools and screens inside                 | Left out: the door is closed                                                 |
| Door and 2nd-floor window facing the corner diagonally | Facing the front                                                             |
| Torii set diagonally, with a bar beam                  | Square to the base: two stacks of round bricks, a plate and a tile on top    |
| Crab of robot arms, clips and a frying pan             | A round body under two curved slopes, one claw of round bricks and a curve   |
| The dish held up on an arm                             | A 2x2 round plate on two round bricks at the stall's corner                  |
| Solar panels on hinges                                 | Printed 2x2 tiles lying on black bricks                                      |
| Flowers and leaves on clips and bars                   | A flower on a plate sticking out of the wall; ferns on the roof              |
| Antenna of bars, a dish and round plates               | One spire part on a 2x2 round plate                                          |
| Fences, macaroni tiles and wedge plates                | Left out, or plain plates                                                    |
