# 08: Map themes

Three more maps to follow the house and yard. Each is a theme first: what the place is, where the stations go, where pages hide, and which part of it gets rearranged every round so that nobody can learn the map by heart. The engine work each one needs is listed at the end of its section, and the shared pieces at the end of the document.

The order suggested is the builders' merchant, then the sleeper train, then the lakeside camp: the first fits the systems we have almost as they are, the second needs the layout generator to shuffle a structure's parts rather than furniture, and the third needs water.

---

## What every map provides

The house sets the pattern. A map is a `LevelDef` (see `shared/src/content/house.ts`) plus a layout function that furnishes it from a seed, and the checks in `layout.test.ts` and `house.test.ts` say what it must have:

- **A 32 × 32 m square** with a straight fence or wall along its south edge. Rival teams mode doubles a map by turning a copy half round about the middle of that edge, so the south edge is where the two yards meet (`rivalLevel`).
- **The stations:** a job site (the baseplate, with the Done button and the bell beside it), a quality inspector pad with its screen, a two-sided corkboard near the job site, and bins for every brick type and colour the builds use. Bins never run out, so they are the map's bricks; they can be whatever the theme makes them.
- **A spawn** for up to ten players with room to spread out.
- **At least 25 places for pages**, split between open surfaces (`pageSpots`) and closed hiding places (`hideouts`). The house has 39. Closed hiding places are the ones a page can be hidden in by the saboteur and sniffed out by the dog's nose for pages on the floor; the kinds the client can draw are drawer, fridge, locker, cabinet, cushion, rug, mailbox, toolbox and chest. A new kind means a new model and an opening animation in `furniture.ts` and `interiors.ts`, and a sound in `audio.ts`.
- **Ten meeting seats** around something people can stand round, where Brick Meetings teleport everyone.
- **The dog's network:** points on the ground joined by clear, straight walks, covering everywhere pages can lie, with a start point and a treat jar. A test sweeps the dog's body along every link.
- **Lamps** for night (ceiling lamps indoors, lamp posts outside), and roofed rooms (walls plus a floor decal) so the sun stays out of them.
- **Somewhere high:** the house has a roof reached by a ladder, an upper floor and a basement. Every map should have at least one climb, because pages up high are the ones people forget to look for.
- **A broom spot and a catapult spot.** The broom leans somewhere out of the way; the catapult stands where it can throw across the open middle of the map.
- **Optionally the electrical panel,** which cuts the lights mid-round until someone fixes it. Maps without one simply never go dark.

### What rearranges

The house's layout generator (`shared/src/content/layout.ts`) keeps the walls, doorways, lamps and yard and moves everything else from a seed: each piece of furniture (with the hiding places and page spots on it) goes to a new spot in its own room, the stairs go along a different wall, windows move to where the outside walls are free, doors swing to either side, the broom leans somewhere new. Every client builds the same house from the seed the server sends.

Each new map keeps that (its own pieces, in its own rooms) and adds one rearrangement that is bigger than furniture: a structure made of parts that are laid out differently every round. That is the thing players walk into on the first night of a round and have to learn again.

---

## Map 2: Brick & Mortar (the builders' merchant)

### The place

A small builders' merchant: a steel-framed warehouse hall with shelving aisles, a staff room and an office along one side, a mezzanine over them, and a yard with a loading dock, pallets of bricks and a skip. It is where the bricks come from, so the bins are the shop's own stock: pallets of bricks under the racking and the picking bins along the aisles. Bright, dusty, a radio playing somewhere. Everything is yellow and black hazard tape and hand-written price tags.

### Layout

- **The hall** (roughly 20 × 14 m) fills the north half: four aisles of racking, a packing bench, the picking bins. Big roller-shutter doors open onto the yard on the south side, one on the west.
- **Staff room and office** along the east wall: lockers, a fridge, a kettle, the meeting table in the staff room (the meeting seats); a desk with drawers, a filing cabinet and a safe in the office.
- **The mezzanine** over the staff room and office, reached by a steel stair: the returns and quality desk is up here, and the **inspector pad** stands on it, so every inspection means carrying the build up a flight of stairs and down again (clumsy mode on the stairs is a disaster).
- **The yard** fills the south half: the **job site** is the loading dock, a low concrete platform with the Done button and the bell at its edge; the corkboard is the notice board by the dock office. Stacks of pallets, a forklift, timber racks, a skip, a portaloo. The south fence is a chain-link fence with a gate (the rival line).
- **Up top:** a ladder from the yard onto the hall's flat roof, where the air-conditioning units are, and from the mezzanine a hatch onto the same roof.

### Hiding places

Existing kinds: the staff room lockers (locker), the fridge, the office desk and filing cabinet (drawer, cabinet), the toolboxes on the packing bench and the forklift (toolbox), the mailbox on the dock office, rugs: the doormat at the staff room door and the anti-fatigue mat at the packing bench.

New kinds: **the skip** (a lid you lift; the page lies on the rubble), **the safe** in the office (a chest with a door that swings; the same mechanics as the chest, a different model), **the forklift cab** (a door; the page is on the seat), **paint tins** on the paint shelf (a lid, like a small chest, several on one shelf), **the portaloo** (a door, like a locker, and a laugh).

Open surfaces: on top of the racking (reached by climbing the pallet stacks), in the picking bins among the bricks, on the pallets, on the AC units up on the roof, under the dock, on the office desk, in the window of the dock office, on the forklift's forks.

### What rearranges every round

- **The aisles.** The racking is the structure with rearrangeable parts: each round the hall's four aisles are laid out in one of several patterns (four straight runs; two long and two short staggered; an L round the packing bench; three runs with a cross-aisle), and the racks' end caps, where the promotional displays and the paint shelf stand, face different ways. The picking bins go along whichever aisles exist, so where a colour is found changes with the pattern. The dog's network through the hall is generated from the pattern.
- **The roller shutters.** Which of the three shutters stands open changes, so the way from the yard into the hall changes, and a shutter can be shut by hand (it is a hideout-like thing with no inside: click to roll it up or down, slowly and loudly, which is a way to slow the other team or to cut off the dog).
- **The yard's pallet stacks** take new spots, which changes where the roof ladder is reached from and which racks can be climbed onto.
- Furniture in the staff room and office moves as in the house; the stair to the mezzanine goes along the east or the south wall of the office.

### Routes and climbing

The pallet stacks are stepping stones: one pallet is a step, two is a climb, three reaches the racking's top shelf. The mezzanine looks over the whole hall, so a builder up at the inspector sees where everyone is. The roof is reached from the yard ladder or the mezzanine hatch and has the AC units to hide pages behind.

### The dog, the broom, the catapult

The shop dog sleeps in the dock office and has the run of the hall and the yard; its treat jar is on the staff room counter. The broom leans in the hall by the packing bench (brooms belong here). The catapult stands in the south-west corner of the yard and throws across the yard onto the dock.

### Day and night

Strip lights on the hall's ceiling, a desk lamp in the office, floodlights on the yard's poles. The electrical panel is on the hall's back wall by the staff room, as in the house's basement, and cutting the power also stops the roller shutters.

### Saboteur angles

Shutting a roller shutter between the job site and the bins. Hiding a page in the skip, where nobody wants to look. Tripping into the build on the mezzanine stairs. Dropping bricks in the aisles, where the floor is already covered in them.

### Rival teams

The south fence is the dividing line; the loading docks of the two yards face each other across it and the teams see each other build, which is the point.

### Engine work

- New hideout kinds: skip, safe, forklift cab, paint tin, portaloo (five models, their openings and sounds).
- A "shutter" prop that players toggle, with the collider following (the hideout machinery does most of this).
- The layout generator picks an **aisle pattern** and lays racks, picking bins, end caps and the dog's hall network from it, instead of only moving pieces within rooms.
- Climbable pallet stacks as `step` boxes.
- The inspector on a raised floor: the pad already works at any `y`, but the HUD's "near the inspector" check and the dog's wreck path need the height.

### Open questions

Whether the picking bins should be the only bins (the bricks come from the aisles) or whether the yard keeps a few, so a team is never stuck behind a shut shutter. How many patterns before the hall feels random rather than like a shop.

---

## Map 3: Platform 9 (the sleeper train)

### The place

A small country station at the end of the day: two platforms, a footbridge, a ticket hall, a signal box, and a sleeper train standing at platform 1 with its doors open and nobody aboard. The train is the map's main structure: an engine and four carriages, each a room of its own, and the order of the carriages changes every round. Warm light from the carriage windows, the station clock, the smell of diesel.

### Layout

- **Platform 1** (the north half of the map, along the x axis): the train stands along it, engine at the east end. The **job site** is on the platform by the station building, under the canopy, with the Done button and the bell on a luggage trolley beside it. The **corkboard is the departures board** on the platform wall, two-sided as before.
- **The station building** behind platform 1: the ticket hall with the ticket office (drawers, a cash tray), the lost-property cupboard, a vending machine, benches, and the waiting room with its stove and the table the meeting seats stand round. The parcels office at the east end has the **inspector pad**: builds are weighed and checked like parcels.
- **The tracks and platform 2** (the middle): two tracks, a crossing at each end of the platforms to walk over, and the **footbridge** from platform 1 to platform 2 (an upper floor with a view of everything).
- **The yard** (the south half): a goods shed, the coal stage, a water tower, a weed-grown siding with an old wagon, the station master's garden with the dog's kennel. The south fence is the yard wall with a gate (the rival line).
- **Up top:** the **signal box** at the west end, up a wooden stair, with its levers and a view down the line; the footbridge; the goods shed's loft by ladder.

### The train

Each carriage is a piece with its own interior, doors at both ends and along the platform side, and a corridor:

- **Sleeper car:** four compartments, each with two berths, a fold-down table and a small cupboard under the window. A page can be under a berth's blanket (a new kind, like the cushion), in the cupboard, or on the luggage rack.
- **Dining car:** tables for four with cloths, a bar counter with drawers and a fridge, a kitchen at one end with a cooker and a cabinet.
- **Lounge car:** two sofas with cushions, armchairs, a bookshelf, a rug.
- **Guard's van:** lockers, a parcels cage (a chest with a mesh door), mail sacks (a new soft kind: open the neck), a desk with drawers, and the brake wheel.
- **The engine:** no interior, but a cab a player can climb into by its steps (the cab is a hideout: open the door, the page is on the driver's seat).

### Hiding places

Existing kinds: lockers in the guard's van and the staff cupboard in the ticket hall, the dining car's fridge and drawers, the ticket office drawers, the lost-property cabinet, the lounge sofa's cushion and its rug, the mailbox on the station wall, the toolbox in the goods shed, the parcels cage as a chest.

New kinds: **berth** (lift the blanket; the cushion's mechanics on a bed), **mail sack** (open its neck; a soft bag that slumps when opened), **engine cab** (a door, like the forklift's), **the station clock** (a door at the back of the case, reached from the footbridge: the one everyone forgets).

Open surfaces: the luggage racks in every compartment, the dining tables, the footbridge's steps, the signal box's lever frame, the water tower's platform, the coal stage, the old wagon, the bench by the kennel, the vending machine's top.

### What rearranges every round

- **The carriage order.** The four carriages are laid out along the platform in a new order every round, and each is turned end for end or not. Where the dining car is, where the guard's van is, which end of the train the lounge is at: the thing players ask each other on the platform. The compartments inside the sleeper car keep their furniture but which berth is which (upper or lower) and which cupboards exist changes. Carriage doors along the platform stand open or shut, and a shut door is a way in only through the next carriage's corridor.
- **Furniture in the station building** moves as in the house. The signal box's stair goes up the north or the south side.
- **The footbridge** stands at the east or the west end of the platforms, which changes the way round to platform 2 and the yard.
- **The yard's wagon** stands on a different stretch of the siding, with the trolleys and sacks around it.

### Routes and climbing

The train is a corridor the whole length of the platform: through the carriages, out onto platform 2 on the far side, or out onto the tracks. The crossings at the platform ends and the footbridge are the ways over. The signal box, the footbridge and the goods shed loft are the high places; the water tower's ladder is the long climb with a page on top.

### The dog, the broom, the catapult

The station dog has a kennel in the station master's garden and a treat jar in the dining car's kitchen; its network runs the platforms, the crossings, the yard and the corridors of whichever carriages stand open (generated with the carriage order). The broom leans in the goods shed. The catapult stands in the yard and throws over the goods shed onto platform 1.

### Day and night

Carriage windows glow at night and the platform lamps come on; the signal box has its lamp; the station clock is lit. The electrical panel is in the goods shed, and a power cut puts the train's lights out as well as the platform's.

### Saboteur angles

Shutting a carriage door so the dining car is a dead end. Hiding a page in a mail sack or under a berth's blanket. The footbridge is the place to be clumsy with a build. Pages on the tracks can be swept by the broom under the train, where only the dog goes.

### Rival teams

The yard wall is the dividing line; the two yards meet there and each team's platform and train are on its own side of them, so the race is heard more than seen until someone climbs the footbridge.

### Engine work

- **Pieces that are rooms:** the layout generator treats each carriage as a piece with its own floor decal, walls, doors, lamps, hideouts and page spots, placed along a line in a shuffled order and turned end for end. The house generator places pieces inside rooms; this places rooms along a track.
- Carriage doors as toggles like the roller shutters, and the generator deciding which stand open.
- New hideout kinds: berth, mail sack, engine cab, the clock case.
- The footbridge as an upper floor in two positions, with its stairs.
- An optional **goods train** on the far track that passes once or twice a round and knocks over anyone standing on that track (the knock-down exists; the train is a kinematic box on a timer, announced by its horn).

### Open questions

Whether the train should shunt at all (it is more fun if the engine moves the train two carriage lengths once a round, but it moves the hideouts with pages in them and the dog). How many compartments the sleeper car needs before it feels like a train and not a corridor.

---

## Map 4: Lakeside Camp

### The place

A campsite on a lake shore at the height of summer: a fire pit clearing in a ring of pitches with tents and caravans, a jetty out onto the water with a diving platform at its end, a camp shop and a toilet block, a lifeguard tower, canoes upturned on the shore, and woods along the edges. Everything is canvas, pine and rope, and the water is the hazard.

### Layout

- **The fire pit clearing** in the middle of the land: the **job site** is the fire ring's paved circle (the fire is out while people build), with the Done button and the bell on the logs round it; the logs are the meeting seats. The corkboard is the campsite notice board.
- **The pitches** in a ring round the clearing, numbered: each holds a tent or a caravan, with a picnic table, a cool box and a lantern.
- **The lake** fills the north third. The **jetty** runs out from the shore to the diving platform. Canoes lie upturned on the shore; a rowing boat is tied to the jetty.
- **The camp shop** (a kiosk with a counter and shelves, the treat jar on the counter) and **the toilet block** (cubicles and showers) stand at the south-west; the **inspector pad** is the shop's veranda, where the warden "inspects your kit".
- **The woods** along the east and west edges: a woodpile, a rope swing, a hammock, the bins. The south edge is a fence with the campsite gate (the rival line).
- **Up top:** the **lifeguard tower** by the shore (a ladder up, a chair and a view of the whole site), the diving platform, the climbing net up to a treehouse platform in the eastern woods.

### Hiding places

Existing kinds: the caravans' drawers and cupboards (drawer, cabinet), the shop's fridge and drawers, the toilet block's cubicles (locker doors), the toolbox at the woodpile, the mailbox at the gate, the chest in the warden's store, cushions on the caravans' seats, the doormats at caravan doors (rug).

New kinds: **tent** (unzip the flap; the page lies on the sleeping bag), **cool box** (a lid, like a small chest), **canoe** (lift one end like a rug; the page is under it), **hammock** (lift the blanket, like the berth), **the lifeguard's chair** (a lid in the seat).

Open surfaces: picnic tables, the jetty's planks, the diving platform, the lifeguard tower, the treehouse, the woodpile, the rowing boat, the shop's counter, the toilet block's roof (reached from the climbing net), on the shore under the canoes' prows.

### What rearranges every round

- **The pitches.** Which pitch holds a tent and which a caravan, and which way each faces, changes every round, and the tents come in two sizes. Each pitch's picnic table, cool box and lantern go with it. The dog's network round the ring is generated from the pitches.
- **The jetty.** The jetty is built of sections, straight and turning, and is laid out anew each round from the shore to the platform: straight out, a dog-leg, a T with the rowing boat at one arm. Its planks are page spots and the water either side is the hazard. The diving platform at the end is where the catapult lands you if you aim well.
- **The canoes** lie in new places along the shore; the rope swing hangs from a different tree; the climbing net goes up the treehouse's north or south side.
- Furniture in the shop and the caravans moves as in the house.

### The water

New to the game: the lake is a zone. Walking in up to the knees slows a player to careful speed; past the drop-off at the jetty's end you are swimming, which is slow and drops whatever you carry (a build dropped in the lake sinks to the bottom and can be fished out from the jetty with a grab, upside down and wet). Falling off the diving platform is the way in. The dog does not swim and will not fetch a page from the water, but a page thrown in floats to the shore in a minute.

### Routes and climbing

The ring path round the clearing, the paths through the woods, the jetty out and back. The lifeguard tower and the treehouse are the high places; the diving platform is the far place.

### The dog, the broom, the catapult

The camp dog lives under the shop's veranda, with the treat jar on the counter. Its network is the ring, the paths, the shore and the jetty. The broom is a rake leaning on the woodpile (the same mechanics, a different model). The catapult stands by the gate and throws across the clearing towards the lake.

### Day and night

Lanterns on every pitch, the campfire's glow when it is lit at night, fairy lights on the shop. No electrical panel: the camp's lights are lanterns and the generator behind the shop, and the "power cut" is the generator running out of fuel, fixed with the jerry can from the warden's store (the same mechanics as the panel, a different model and a walk).

### Saboteur angles

Dropping a build off the jetty. Hiding a page in a tent on the far pitch or under a canoe. Tripping someone into the lake with clumsy mode on the jetty. Bricks on the jetty's planks, where a scream and a limp end in the water.

### Rival teams

The south fence is the dividing line, so the two camps' gates face each other and the lakes are at the far ends; the race happens round the two fire pits with the lake behind each team.

### Engine work

- **Water:** a zone on the level with a depth, the character controller's speed and carrying rules in it, floating pages, sinking builds that can be fished out, and the look of it (a plane with a shader, ripples at the shore).
- New hideout kinds: tent, cool box, canoe, hammock, the lifeguard's chair.
- The jetty as a **structure of sections** laid out from a seed (the same generator feature the train's carriages need, on a path over water instead of along a track).
- The pitches as **slots** that take one of several pieces (tent, big tent, caravan), which is a small generalisation of placing pieces in rooms.
- A climbing net (a ladder with a different model) and a treehouse platform.

### Open questions

Whether swimming should exist at all or whether the lake simply eats what falls in and spits players out on the shore after a dunking (simpler, and funnier). Whether the campfire can be lit during a round and what that does to pages near it.

---

## Shared engine work

In the order it is needed:

1. **A map picker** in the lobby (host only) and the `layout` seed going with a map id in the world message, so clients build the right map. Each map is its own `LevelDef` and layout function, with the house's tests run against it: layout problems, hiding spots reachable, dog walks clear, seats and spots counted.
2. **Toggles without insides** (roller shutters, carriage doors): a hideout kind with no page capacity, whose collider follows its state.
3. **Structures of parts** in the layout generator: a list of parts (racks, carriages, jetty sections) laid out along a line or in a pattern from the seed, each part bringing its walls, floor, lamps, hideouts and page spots, and the dog's network generated through the result. The train and the jetty need the same thing; the hardware store's aisle patterns are a simpler version of it.
4. **Slots that take one of several pieces** (the camp's pitches).
5. **New hideout kinds** (fourteen across the three maps), each a model, an opening, a sound and a test that its parts open where the dog can reach a page lying inside.
6. **Water** for the camp alone.
7. **A moving hazard** (the goods train) as an optional extra for the station.

Every map must keep the rival doubling: a straight south edge, nothing crossing it, and the job site in the open middle so the two sites face each other across the line.
