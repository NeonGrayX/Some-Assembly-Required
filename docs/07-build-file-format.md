# 07: Build File Format

A build file holds one model and its instruction manual, so a build can be exported from the game or the editor, shared as a single file, and imported into another copy of the game. The manual is not stored as pictures. It is stored as data, and the game prints every page itself, the same way it prints the built-in builds today (`client/src/render/pages.ts`). A build file is all a game needs to play a round with that model.

This document is the format, version 1. A [JSON Schema](build-file.schema.json) checks the shape of a file; the rules in [Validation](#validation) that need the brick grid are checked by the game.

## The file

- **Encoding:** UTF-8 JSON, one object at the top level.
- **Extension:** `.sarbuild.json`, for example `tiny-tower.sarbuild.json`. The `.json` ending keeps the file easy to open and edit.
- **Size:** at most 256 KB. The castle, the biggest built-in build, is about 11 KB, and the 32-page Manga Shop in `builds/`, with its six pictures, about 22 KB.

```jsonc
{
  "format": "some-assembly-required/build",
  "version": 1,
  "build": {
    "id": "tiny-tower",
    "name": "Tiny Tower",
    "author": "Daniel",
    "description": "A two-page tower for testing.",
  },
  "manual": {
    "cover": { "view": { "turn": 0, "zoom": 1 } },
    "pages": [
      {
        "bricks": [
          { "type": "2x4", "colour": "white", "x": 6, "y": 1, "z": 6, "rot": 0 },
          { "type": "2x4", "colour": "white", "x": 6, "y": 1, "z": 8, "rot": 0 },
        ],
      },
      {
        "note": "Lay these across the bricks below.",
        "view": { "turn": 1 },
        "bricks": [
          { "type": "2x4", "colour": "red", "x": 6, "y": 4, "z": 6, "rot": 1 },
          {
            "type": "2x4",
            "colour": "red",
            "x": 8,
            "y": 4,
            "z": 6,
            "rot": 1,
            "prints": { "front": "star" },
          },
        ],
      },
    ],
  },
  "svgs": {
    "star": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 10'><path d='M10 1 12 7 7 3H13L8 7Z' fill='gold'/></svg>",
  },
}
```

## Top level

| Field     | Type   | Required | Meaning                                                                     |
| --------- | ------ | -------- | --------------------------------------------------------------------------- |
| `format`  | string | yes      | Always `"some-assembly-required/build"`. Tells a build file from other JSON |
| `version` | int    | yes      | Format version. This document is `1`                                        |
| `build`   | object | yes      | Who the model is: [Build](#build)                                           |
| `manual`  | object | yes      | The model, page by page: [Manual](#manual)                                  |
| `svgs`    | object | no       | The pictures bricks print, by name: [Prints](#prints)                       |

## Build

| Field         | Type   | Required | Rules                                                                                                            |
| ------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`          | string | yes      | 1 to 32 characters of `a-z`, `0-9` and `-`, starting with a letter. Names the build in the lobby and on the wire |
| `name`        | string | yes      | 1 to 20 characters. Printed in capitals at the top of every page, so it has to fit next to "Step 32 of 32"       |
| `author`      | string | no       | Up to 40 characters. Shown in the lobby's build picker                                                           |
| `description` | string | no       | Up to 200 characters. Shown in the lobby's build picker                                                          |

There is no separate list of bricks for the model. The model is every brick of every page, in page order, which is how `TargetBuild` works today (one `BuildStep` per printed page).

## Manual

| Field   | Type   | Required | Meaning                                                       |
| ------- | ------ | -------- | ------------------------------------------------------------- |
| `cover` | object | no       | How the box art (the finished model) is shown: `{ "view" }`   |
| `pages` | array  | yes      | 1 to 32 [pages](#page), in building order. Page 1 comes first |

The game hides one paper page per entry in `pages`, plus the master index, so 32 is the limit the house and its two two-sided corkboards (32 slots) are made for.

### Page

| Field    | Type   | Required | Meaning                                                                                                                                  |
| -------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `bricks` | array  | yes      | The [bricks](#brick) this page adds, 1 or more, at most 20 kinds (a kind is a type and colour)                                           |
| `view`   | object | no       | How the page's picture is shot: [View](#view)                                                                                            |
| `note`   | string | no       | Up to 60 characters, printed on one line under the picture. A hint, not a parts list. Don't name colours: each round recolours the model |

Bricks are listed in the order they go on. The order matters: a brick may only rest on the baseplate or on bricks listed before it, on this page or an earlier one.

### Brick

The same fields as `TargetBrick` in `shared/src/builds/types.ts`, so the existing code can read a brick as it is.

| Field    | Type   | Rules                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`   | string | A part from `BRICK_TYPES` that is not a fixture; see [Parts](#parts)                                                                                                                                                                                                                                                                                                                                 |
| `colour` | string | A colour from `COLOURS`: `white`, `light-grey`, `dark-grey`, `black`, `red`, `dark-red`, `yellow`, `orange`, `blue`, `dark-blue`, `green`, `gold`, `dark-brown`, `sand-green`, `brown`, `tan`, `teal`, `pink`, `purple`, `light-blue`, `lime`, and the see-through `trans-clear`, `trans-light-blue`, `trans-blue`, `trans-red`, `trans-orange`, `trans-black`, `trans-green`. Not `baseplate-green` |
| `x`      | int    | Stud column of the brick's corner with the lowest x and z, 0 to 15                                                                                                                                                                                                                                                                                                                                   |
| `y`      | int    | Plate layer of the brick's bottom. The baseplate top is `1`. A full brick is 3 plates tall                                                                                                                                                                                                                                                                                                           |
| `z`      | int    | Stud row of that same corner, 0 to 15                                                                                                                                                                                                                                                                                                                                                                |
| `rot`    | int    | Quarter turns around the vertical axis, 0 to 3. Odd turns swap the footprint's width and depth. For a sideways part, quarter turns about the way it faces                                                                                                                                                                                                                                            |
| `face`   | string | Optional. `+x`, `-x`, `+z` or `-z`: the part is clipped sideways onto side studs, its top pointing that way. See [Sideways parts](#sideways-parts)                                                                                                                                                                                                                                                   |
| `prints` | object | Optional. A picture on any of the part's sides, by side: `top`, `bottom`, `front`, `back`, `left`, `right`. Each names one of the file's `svgs`. See [Prints](#prints)                                                                                                                                                                                                                               |

Coordinates are the baseplate grid from `shared/src/bricks.ts`: x and z count studs on the 16x16 baseplate, y counts plates. Every cell a part covers must stay on the plate: `x + width <= 16` and `z + depth <= 16`.

### Parts

| Kind       | Ids                                                                                                                                                                | Notes                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Bricks     | `1x1`, `1x2`, `1x3`, `1x4`, `1x6`, `2x2`, `2x3`, `2x4`, `1x2x2`                                                                                                    | Studs on every cell                                                                          |
| Plates     | `plate1x1`, `plate1x2`, `plate1x3`, `plate1x4`, `plate1x6`, `plate1x8`, `plate2x2`, `plate2x3`, `plate2x4`, `plate2x6`, `plate2x8`, `plate4x4`, `plate8x8`         | One plate high                                                                               |
| Tiles      | `tile1x1`, `tile1x2`, `tile1x3`, `tile1x4`, `tile1x6`, `tile2x2`, `tile2x4`, `grille1x2`, `roundtile1x1`, `roundtile2x2`                                           | No studs: nothing clutches on top                                                            |
| Round      | `round1x1`, `round2x2`, `roundplate1x1`, `roundplate2x2`, `dish2x2`, `cone1x1`, `roundcorner3x3` (studs only inside its curve), `arc3x3` (a curved band, no studs) |                                                                                              |
| Slopes     | `slope1x2`, `slope2x2`, `slope2x3` (studs on the back row only), `cheese1x1`, `curve1x2` (no studs)                                                                | They slope down toward their own +z; `rot` turns that way round                              |
| Windows    | `window1x2x2` (glass), `lattice1x2x2` (paper lattice)                                                                                                              | A frame two bricks high                                                                      |
| Side studs | `headlight1x1`, `sidestuds1x2`, `sidestuds1x4`, `sidestuds1x2x2`, `bracket1x1`, `bracket1x2`, `bracket2x4`                                                         | Studs on their +z side for sideways parts; the inverted `bracket2x4` holds them below itself |
| Other      | `plant1x1`, `flower2x2`, `spire2x2`                                                                                                                                | A fern, a flower, a spire                                                                    |

### Sideways parts

A thin part (a tile, a plate, a cheese slope) can be clipped onto side studs instead of stacked. Its `face` says which way its top points. It covers the one cell next to the side studs, its back flat against them, with its width along that side and its height going up: `rot` 0 lays its x (the first number in its size) along the side, `rot` 1 stands it on end. A stud is 2.5 plates, so a part one stud high covers three layers but is drawn 2.5 plates high from `y`. It holds if a side stud pointing the same way, on the cell behind it, is within its height. Nothing stacks on a sideways part. In the game, aiming a held tile or plate at a side with side studs clips it on there.

### Prints

There are no printed parts. Any part can carry a picture on any of its sides: `prints` names an SVG for each side that has one, and the file's top-level `svgs` holds the SVGs by name. Several bricks can print the same SVG.

```jsonc
{
  "type": "tile1x4",
  "colour": "black",
  "x": 6,
  "y": 2,
  "z": 12,
  "rot": 0,
  "face": "+z",
  "prints": { "top": "manga-shop" },
}
```

- **Sides** are the part's own, before `rot` and `face` turn it: `top` is the side with the studs, `bottom` the one under it, `front` faces the part's +z, `back` its -z, `right` its +x and `left` its -x. A print turns and clips on with its part.
- **Which way up:** on `front`, `back`, `left` and `right` the picture stands upright, its top toward the part's top. On `top` and `bottom` its top points toward the part's `front`. A tile clipped on sideways at `rot` 0 shows its `top` print upright; at `rot` 1 it stands on end, and the picture is turned a quarter with it.
- **Fit:** the picture is drawn over the whole side, sized as the SVG's own `preserveAspectRatio` says: whole and centred by default, `preserveAspectRatio="none"` to stretch it. A `viewBox` with the side's proportions (4 by 1 for the top of a 1x4 tile) fills it exactly. Transparent parts of the SVG show the part underneath. Round parts take their `top` and `bottom` print as a disc and wrap side prints a quarter of the way round. Other shapes print on the sides of their box.
- **SVGs:** up to 32 per file, named like ids (`a-z`, `0-9`, `-`, up to 32 characters, starting with a letter). Each is the text of one SVG image, up to 32 KB: an optional `<?xml ...?>` line and comments, then `<svg ...>...</svg>`. They are drawn as images, so scripts, links and outside files in them do nothing. Single quotes in the SVG save escaping them in the JSON.
- **The clean version:** a file without `svgs` is the same build with plain parts. Its `prints` are ignored, so deleting the `svgs` section is all it takes to drop every picture. With `svgs` present, every name a print uses has to be in it.

Prints don't change what kind of part it is: a printed 1x4 black tile is a 1x4 black tile in the parts list and when a file is checked, and the level's bins only have to hand out plain 1x4 black tiles.

In the game, the **specialty parts** shelf beside the job site is stocked each round with the printed parts of that round's model: one drawer for each different type, colour and prints, in the round's colours, in the order they come up in the manual, up to 15. A part taken from it keeps its prints wherever it goes. The inspector wants the print too: the right part in the right place without its print, or with another one, is a near miss ("close"), like a look-alike colour.

### View

| Field  | Type   | Default | Meaning                                                                                                                |
| ------ | ------ | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `turn` | int    | `0`     | Quarter turns of the model, 0 to 3, before the picture is taken. `0` is today's camera, looking from the +x, +z corner |
| `zoom` | number | `1`     | 0.5 to 2. Above 1 the model fills more of the picture                                                                  |

With no `view`, a page looks exactly like the pages of the built-in builds. `turn` lets a page show a side that would otherwise be hidden, like the snowman's face or the back wall of the castle. The camera stays isometric and always frames the whole model so far.

## What a page shows, and where it comes from

Everything printed on a page is in the file or worked out from it. Apart from the bricks' prints, nothing is a picture.

| On the page                           | Where it comes from                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title                                 | `build.name`, in capitals                                                                                                                                                                         |
| "Step n of N"                         | The page's place in `manual.pages`, and how many pages there are                                                                                                                                  |
| Picture: baseplate and earlier bricks | Every brick of the pages before this one, drawn faded                                                                                                                                             |
| Picture: this page's bricks           | `bricks` of this page, in full colour with outlines                                                                                                                                               |
| Picture: camera                       | `view` of this page, or the default                                                                                                                                                               |
| Note                                  | `note` of this page, if any                                                                                                                                                                       |
| "Add these bricks" parts list         | `bricks` of this page, counted per type and colour, in order of first appearance. Up to 4 kinds get big icons in a row; more get a compact grid of smaller icons, so the list always fits its box |
| Part icons                            | Rendered from `type` and `colour`                                                                                                                                                                 |
| Pictures on bricks                    | `prints` of each brick, drawn from `svgs`. On earlier bricks they are faded too                                                                                                                   |
| Big page number                       | The page's place in `manual.pages`                                                                                                                                                                |
| Ink stamp                             | Not in the file. The round picks it (see below)                                                                                                                                                   |
| Watermark, paper colour, fonts        | Not in the file. Every page uses the game's own                                                                                                                                                   |

The **master index** lists each page's parts, and is worked out from `manual.pages` the same way. It prints in the biggest type that fits the sheet, in up to three columns, so 32 pages fit as long as they average about 8 kinds each. Past that the last pages are left off the index. The **box art** in the lobby is the whole model shot with `manual.cover.view`.

## What the round adds, not the file

A file holds the design. These are picked fresh each round and are never exported:

- **Colours:** the round recolours the model with look-alike colours (`colourVariant` in `shared/src/builds/variant.ts`). The file holds the design colours.
- **Stamp:** the real and forged stamp symbols (`STAMPS` in `shared/src/builds/forgery.ts`).
- **Forgeries:** the saboteur's forged pages are made from the real pages during the round.

Because of this, a manual exported in the middle of a round is the clean design, not what the players see on the pages that round.

## Validation

An importer reads the file, then checks the rules below in order and stops at the first group that fails. It reports problems as `page N, brick M: message` (1-based), the way `validateBuild` reports them, so the player can fix the file.

1. **Shape:** `format` matches, `version` is one this game can read, and every field has the type and range listed above. Every print names an SVG in `svgs`, when the file has them. The [schema](build-file.schema.json) covers this group, all but the print names.
2. **Pages fit a page:** every page has at least one brick and at most 20 kinds of brick (type and colour; prints don't count), so its parts list stays readable.
3. **Size:** at most 32 pages and 400 bricks in all (the castle has 118), and no brick's top above plate 48 (the pyramid tops out at 43).
4. **Buildable in order** (`validateBuild`): every brick stays on the baseplate, overlaps nothing, and clutches something already there when its page comes up.
5. **Rests on something:** every upright brick sits on the baseplate or on top of an earlier brick. A brick held only from above can't be snapped on in the game, because nothing can be pushed on from underneath. Sideways parts are clipped on from the side, so they only need their side studs.
6. **Can be found in the bins:** every type and colour pair is one the level's bins hand out (`binColours(level)`). With today's house that is:

   black 1x1, 2x2, 2x4, plate2x2 · blue 2x2, plate2x4 · dark-blue 2x2, plate2x4 · dark-grey 1x1, 2x4, plate2x2, plate2x4 · dark-red 1x2, 2x2, 2x4 · green 1x1, 2x2, 2x4 · light-grey 1x1, 1x2, 1x4, 2x2, 2x4, plate2x2, plate2x4 · orange 1x4, 2x2, 2x4 · red 1x2, 2x2, 2x3, 2x4 · white 1x2, 2x2, 2x4 · yellow 1x1, 1x2, 1x4, 2x2, 2x4

   Two racks of small parts drawers, on every map beside the big bins' racks, add every part and colour the Manga Shop and the Izakaya use. The list changes when bins are added, so the importer checks against the level, not this copy. The build editor has no bins, so it checks every rule but this one.

Unknown fields are ignored, so a newer game can add optional fields without breaking older ones. A file with a higher `version` than the game knows is refused with "made with a newer version of the game".

## Ids and names

- An imported build can't take the id of a built-in build. The importer offers to import it as `custom-<id>` instead.
- Importing a file with the id of a build imported earlier replaces that build, so a fixed file can be imported again.
- Two builds can't share a `name` in the build picker. The importer adds " (2)" and so on to the name if it has to.

## Exporting

An exporter writes the fields in the order shown above, with 2-space indents, and writes each brick on one line, so files are easy to read and diff. It leaves out optional fields that hold their default. Exporting a built-in build gives a file that imports back to the same build.

## Files from the editor

The build editor (`/editor.html`) imports and exports version 1 files. It keeps `author`, `description`, `cover`, `svgs`, each page's `view` and `note` and each brick's `face` and `prints` from the file it loaded, and drops the page extras if steps were added or emptied since. Bricks placed in the editor have no prints. Unticking **prints** hides them and exports the clean version. Older copies of the editor exported a bare `TargetBuild`: `{ "id", "name", "steps": [{ "bricks": [...] }] }`. An importer reads that as version 0: each step becomes a page with the same bricks, and `author`, `description`, `view` and `note` are left out.

## Not in version 1

- A baseplate other than 16x16, or no baseplate.
- Brick types or colours that are not in the game. The file names them by id, so new ones need a game update first.
- Sub-assemblies built off the baseplate and attached later.
- Arrows, call-outs or more than one picture on a page.
- Translated names and notes.

## Implementation notes

These describe how the game reads and writes the format, and are not part of it.

- **Code:** `parseBuildFile` and `stringifyBuildFile` in `shared/src/builds/file.ts` read and write files and check every rule above. A page's `view` and `note` live on `TargetBuild.pages`, beside `steps`; `author`, `description`, `cover` and `svgs` live on `TargetBuild` too, and `prints` on `TargetBrick`. `withoutPrints` gives the clean version. `client/src/render/prints.ts` draws the prints.
- **Demo mode:** the demo panel has Import build and Export build buttons. Export saves the build picked in the panel. Import adds the build to the panel's list, keeps the file in the browser (local storage) so it is still there after a reload, and starts a round with it, its manual pinned to the corkboards (the index too, if a slot is left). Imported builds are found by `buildById` next to the built-in ones (`addImportedBuild` in `shared/src/builds/catalog.ts`), which only the in-tab solo room uses.
- **Online play (not built yet):** the lobby setting `build` only accepts ids a server knows. The host needs a new message to send an imported build to the server, which validates it again, and that is a protocol change (`PROTOCOL_VERSION` goes up). Players don't need the file: the `world` message already carries this round's full model in `target`, so every client can print the pages.
