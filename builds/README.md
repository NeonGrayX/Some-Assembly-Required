# Build files

Models with their instruction manuals, in the [build file format](../docs/07-build-file-format.md). To look at one, open the build editor at `/editor.html`, paste the file into the box under the buttons and click **Import build file**. The step buttons and "show up to this step" walk through the manual.

Every file here is checked by `shared/src/builds/community.test.ts` the way the editor imports it, so a file that breaks a rule fails `npm test`.

| File                       | Parts | Pages | What it is                                                                               |
| -------------------------- | ----- | ----- | ---------------------------------------------------------------------------------------- |
| `manga-shop.sarbuild.json` | 140   | 31    | A two-storey izakaya and manga shop on a paved corner, after the Lumibricks 17016 manual |

## Manga Shop

The shop is also a built-in build (`shared/src/builds/mangashop.ts` loads this file), so it can be picked in the lobby and played. Two racks of parts drawers along the yard's south fence hand out all 79 of its parts and colours.

It keeps the original's footprint on its 8x8 base, stud for stud: the building is 6 studs along the sign side and 5 along the door side, with pavement on three sides. Its 90 steps are grouped into 31 pages in the manual's order. The floor under the roof comes after the upper walls, so nothing has to be slid in under it. Pages that build the door side are shown from there, as in the manual's first half. The rest are shown from the sign side, as in its second half and on the box.

### The parts

Most parts are the manual's own: tiles, grille tiles, slopes, cheese and curved slopes, round bricks and plates, cones, a dish, window frames, a fern, headlight bricks, bricks with studs on their side, an inverted bracket, and see-through red, orange, blue, black and clear parts. The printed tiles are the MANGA SHOP sign, the poster, the billboard, the vertical MANGA sign, the cat's face and the neon sign. The thin parts clip on sideways where the manual clips them:

- The MANGA SHOP sign hangs under the inverted bracket at the front of the base.
- The poster clips onto a 1x2x2 brick with studs on its side.
- The blue lamp, the light-blue tile, the pink window and the gold lamp sit on headlight bricks.
- The orange neon grille and the neon shop sign stand on bricks with side studs.
- The MANGA sign stands on end on the corner.
- The billboard and the cat's face hang on bricks with side studs.

### What is different

The game has no hinges, clips, bars or angled parts, so these become the nearest parts that stack:

| In the original                                    | In the file                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| Base built upside down                             | The same plates, stacked from the bottom                                  |
| Red bars hanging on clips (pipes)                  | See-through red round bricks, holding up the porch roof                   |
| Trans-orange 4x4 roof panels on hinges             | A gable of black slopes with see-through orange bricks and cheese slopes  |
| Billboard hung on clips                            | The billboard tile clipped onto a brick with side studs on the porch roof |
| Cat on a hinge, with a curved tail and a bar torch | Black bricks with the face tile on side studs, cone ears and a gold cone  |
| Lantern of round parts on a bar                    | Round bricks and plates stacked                                           |
| 2x2 corner plate under the side window             | A 1x2 plate                                                               |
| Profile and clip bricks                            | Plain bricks of the same size                                             |

Left out: the noren over the door, the tail and the bars that only hold other parts.
