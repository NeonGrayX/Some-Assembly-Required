# Build files

Models with their instruction manuals, in the [build file format](../docs/07-build-file-format.md). To look at one, open the build editor at `/editor.html`, paste the file into the box under the buttons and click **Import build file**. The step buttons and "show up to this step" walk through the manual.

Every file here is checked by `shared/src/builds/community.test.ts` the way the editor imports it, so a file that breaks a rule fails `npm test`.

| File                       | Bricks | Pages | What it is                                                                                             |
| -------------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------ |
| `manga-shop.sarbuild.json` | 144    | 32    | A two-storey izakaya and manga shop on a paved corner, stud for stud after the Lumibricks 17016 manual |

## Manga Shop

The model keeps the original's footprint on its 8x8 base, stud for stud. The building is 6 studs along the sign side and 5 along the door side. Pavement runs along three sides. Its 90 steps are grouped into 32 pages in the manual's order, except that the floor under the roof comes after the upper walls, so nothing has to be slid in under it. Pages that build the door side are shown from there, as in the manual's first half. The rest are shown from the sign side, as in its second half and on the box.

It can be built and printed, but not played in the house yet. No bin hands out the new plates or anything in brown, tan, teal, pink, purple or light blue, so the demo panel's import refuses it. Adding bins for its parts would make it playable.

### What the specialty parts became

The game has bricks and plates only, so every other part is the brick or plate that takes its place on the grid.

| In the original                                   | In the file                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| Reddish-brown walls, plates and brackets          | Brown bricks and plates                                            |
| 8x8 plate on a frame of 2x8, 1x8, 1x6, 1x4 plates | The same plates, stacked bottom up instead of built upside down    |
| MANGA SHOP tile on a bracket plate                | A black 1x4 brick and plate standing against the base              |
| Tiles                                             | Plates of the same size                                            |
| Slopes and curved slopes                          | Plates or bricks of the same footprint                             |
| Window frames with lattice panes                  | Tan bricks for the lit lattice windows, light blue for glass       |
| Printed poster                                    | A stack of tan, orange, black and teal plates                      |
| Red bars on clips (pipes)                         | Columns of red 1x1 bricks, holding up the porch roof               |
| Teal cone, orange lantern, light-blue lamp tile   | 1x1 bricks and plates in those colours                             |
| Vertical MANGA neon sign                          | A white and a pink 1x1 brick on the corner                         |
| Fern, dark-red parts, clear neon tile on awning   | Green, dark-red and white plates on the awning                     |
| Billboard with printed purple tile                | Red, purple, pink and teal bricks and plates on the porch roof     |
| Trans-orange roof panels with black grille tiles  | Orange and black 1x4 bricks, stepped into a gable with a white end |
| Gold round plate in the gable                     | A yellow 1x1 brick                                                 |
| Satellite dish                                    | A light-grey 2x2 plate and a teal 1x1 plate                        |
| Cat mascot with printed face, tail and torch      | Black, dark-grey, white and yellow pieces on the roof              |

Left out: the noren over the door, the skylight's clear slopes, and the clips and bars that only hold other parts. Hinges become plain stacking. Small parts hidden inside, like the vents, keep a 1x1 plate each.
