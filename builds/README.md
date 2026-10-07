# Build files

Models with their instruction manuals, in the [build file format](../docs/07-build-file-format.md). To play one: open the demo panel, click **Import build**, pick the file, and the round starts with its manual pinned to the corkboard. To look at one or change it, paste the `manual.pages` as `steps` into the build editor at `/editor.html`.

Every file here is checked by `shared/src/builds/community.test.ts`, so a file that breaks the rules fails `npm test`.

| File                       | Bricks | Pages | What it is                                                                                             |
| -------------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------ |
| `manga-shop.sarbuild.json` | 92     | 13    | A two-storey izakaya and manga shop on a paved corner, after the Lumibricks Neoncity 17016 micro build |

## Manga Shop: how the original's parts were replaced

The original is 388 parts, most of them specialty pieces the game does not have (tiles, slopes, brackets, clips, bars, transparent and printed parts, minifigure accessories). The game only knows nine brick types and eleven colours, and a manual can hold at most 16 pages and 160 bricks, so the file keeps the silhouette and the colour blocks, not the part-for-part build.

| In the original                                                | In the file                                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Grey 8x8 base plate with a raised rim, 1x4 shop tile           | Light-grey plates, 12x10, a kerb along the front and right, a black 2x4 out front |
| Reddish-brown shop walls, lattice window, doorway              | Dark-red bricks (no brown), a yellow window, a black doorway                      |
| Black counter with pink and cyan bottles                       | A dark-blue 2x2 "display" next to the door                                        |
| Red bars (pipes) with clips                                    | Two stacks of red 1x2 against the right wall                                      |
| Teal vase, orange drum                                         | A blue 2x2 on the kerb, an orange 2x2 at the front corner                         |
| Dark-brown plates and black slope awning                       | Dark-grey plates and a black 2x4 awning hanging out one stud                      |
| White 1x5 walls, pink and trans-clear window bricks            | White bricks with blue 2x2 windows                                                |
| Black 2x3 roof slopes                                          | Black bricks stepped in, red 2x2 ridge                                            |
| Green fern on a slope                                          | Green 2x2 and 1x1 on the awning                                                   |
| Vertical "izakaya" neon sign on clips                          | Four yellow 1x1 stacked beside the terrace                                        |
| Red and teal billboard with a printed tile                     | Blue plate, red 2x4, blue plate on the right terrace                              |
| 6x6 orange lantern panel on a bracket, cat mascot on a bar arm | Two orange 2x4 overhanging the roof, a black 2x2 with two yellow 1x1 ears         |
