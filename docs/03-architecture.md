# 03: Architecture

## Tech stack

| Layer                     | Choice                                                     | Why                                                                                            |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Language                  | **TypeScript** everywhere                                  | Client, server and shared code use one language, so the rules are written once                 |
| Build tool                | **Vite**                                                   | Fast dev server, simple production bundle                                                      |
| Rendering                 | **Three.js**                                               | Small, mature, huge ecosystem. `InstancedMesh` renders hundreds of bricks in a few draw calls  |
| Physics                   | **Rapier** (`@dimforge/rapier3d-compat`)                   | WASM, fast, works the same in browser and Node, has character controllers and joints           |
| UI (menus, pages, voting) | Plain DOM/CSS overlay (maybe Preact if it grows)           | HTML is simpler than in-canvas UI for text-heavy screens                                       |
| Server                    | **Node.js** + `ws`, compiled with **Bun** for the host app | Small, runs anywhere; Bun compiles it and the client into one executable                       |
| Wire format               | **MessagePack** (`msgpackr`)                               | Compact binary with no schema boilerplate. Can move to hand-packed buffers for snapshots later |
| Voice                     | **WebRTC** audio mesh, signalled through the game server   | Server carries no audio                                                                        |
| Tests                     | **Vitest**                                                 | Same toolchain as Vite                                                                         |

Engines we rejected:

- **Godot or Unity web export:** large downloads (20–40 MB of WASM), slow to start, harder to debug in the browser, and they still can't host a server from the browser.
- **Babylon.js:** a fine choice too, just heavier. Three.js plus Rapier is enough here.
- **Colyseus:** a good room framework, but it adds abstraction on top of something we can keep small. We can revisit if lobby or room management grows.

## Repository layout

```
/client        Vite app: rendering, input, UI, interpolation, voice
/server        Node game server: rooms, authoritative simulation, static file hosting
/shared        Types, protocol messages, brick catalogue, build format, rules, matching logic
/content       Maps (JSON + glTF), target builds (JSON), page art templates
/tools         Build editor / exporter, packaging scripts
/docs          These documents
```

npm workspaces (or pnpm). `shared` is imported by both client and server.

## Networking model

```
             +---------------------------------------+
             |  Server (authoritative)               |
             |  - Room state, roles, timer           |
             |  - Rapier world @ 60 Hz               |
             |  - Validates every action             |
             |  - Per-client visibility filter       |
             +----------+-------------------+--------+
          snapshots 20 Hz |  events (reliable) |  ^ inputs 60 Hz, action requests
                         v                   v  |
             +----------------+   +----------------+   ...up to 8 clients
             | Client         |   | Client         |
             | - predicts own |   |                |<--- WebRTC voice mesh --->
             |   movement     |   |                |
             | - interpolates |   |                |
             |   others ~100ms|   |                |
             +----------------+   +----------------+
```

- **Transport:** a single WebSocket per client. Two kinds of messages:
  - **Snapshots** (20 Hz, only the newest one matters): positions and rotations of players and _awake_ dynamic bodies. Sleeping or snapped objects are not sent.
  - **Events** (reliable, ordered): brick snapped or unsnapped, assembly broken, page picked up, meeting called, vote cast, timer, role assignment, and so on.
- **Player movement:** the client sends inputs. The client predicts its own movement with the same Rapier character controller and reconciles with the server. Other players are interpolated about 100 ms in the past.
- **Actions** (grab, place, swap, vote) are requests. The server validates them (range, cooldown, role) and broadcasts the result. The client may show an optimistic animation.
- **Held objects:** the holder's client renders the held object attached to its hand right away. The server owns where it is.
- **Where the code lives:** the room (`shared/src/net/room.ts`) only talks through a `send` callback, so the same code runs on the Node server and inside the browser for solo play. Clients run the shared `Sim` in replica mode. M3 in the roadmap has the details.

### Hidden information

The server keeps a per-client view and filters every message through it:

- **Roles:** each client is told only its own role (saboteurs also learn each other's).
- **Page contents:** sent only when the player holds the page, is being shown it, or it is posted on the board. Unrevealed pages are sent as "a page" with only a position.
- **Forgery flag:** never sent. A forged page's content simply differs, and its stamp and watermark have small differences that players must spot.
- **Saboteur actions:** a nearby witness gets the animation event. Players outside the witness range get only the result (a brick changed colour).
- **Hiding spots:** contents are sent only when someone opens the spot.

## Hosting

The **same server build** runs in two modes.

### A) Hosted (VPS)

- Any 1 vCPU / 1 GB VPS (Hetzner, DigitalOcean, etc., about €4–6/month).
- Run with Docker or systemd behind Caddy (automatic HTTPS via Let's Encrypt, WebSocket proxying).
- Lobbies are joined with a 4-letter room code: `https://game.example/ABCD`.
- Optional: run **coturn** on the same box as a TURN relay for voice when peers can't connect directly.
- Static client files can also go on any CDN or GitHub Pages. The server then only handles WebSockets.

### B) LAN host (one player hosts)

- Download one file: `some-assembly-required-host` (.exe / Linux / macOS), built with `bun build --compile`, with the client bundle embedded.
- Starting it opens a small console or a tray-style page that shows `Players join at: https://192.168.1.20:7777`.
- It serves the client files and the WebSocket on that port. Everyone else opens the URL in their browser.
- It generates a **self-signed certificate** on first start so the microphone works (see feasibility, section 2). Players click "proceed anyway" once. A `--http` flag turns off HTTPS (and voice).
- The host plays in their own browser like everyone else (`https://localhost:7777`). The host app has no UI beyond the address and logs.
- Firewall: the first start triggers the OS firewall prompt. The [hosting guide](06-hosting.md) says to allow private networks.
- Internet play through port forwarding works too but is not officially supported.

## Physics design

This is the most important technical decision. **Bricks are physical only while loose.**

1. **Loose brick:** an individual Rapier dynamic body (box collider sized by its footprint).
2. **Snapping:** when a held brick is released near a valid stud position on an assembly (or the baseplate), it snaps. That means the position is quantised to the stud grid, the rotation to 90°, and the brick becomes a **collider attached to the assembly's single rigid body**.
3. **Assembly:** a rigid body with N child colliders and a graph of brick-to-brick connections. A logical grid map (stud coordinate → brick id) is used for snapping checks and matching.
4. **Breaking:** on a contact impulse above a threshold, or a ragdoll hitting it, or a big drop, the server computes which connections break. Weakest link: the joint with the fewest studs connected and the highest torque. The connection graph is split into components, and each component becomes a new assembly body (single bricks become loose bricks). This gives the "tower snaps in half" effect without simulating friction.
5. **Carrying an assembly:** the player grabs it with a spring joint, so it wobbles and swings. Running, bumping and turning quickly add impulses. Heavy builds slow the carrier down.
6. **Baseplate at the job site:** kinematic (doesn't move) unless picked up for an inspector trip. Then it is a normal assembly.
7. **Ragdolls:** each client simulates them locally (about 6 bodies and joints per character, cosmetic only). The server only tracks `state = knockedDown` and a root position for the duration, which is enough for gameplay.
8. **Barefoot bricks:** a loose brick on the floor has a trigger volume. A player walking into it gets the `hurt` status, a scream event and a limp.

Scale: bricks are much bigger than real ones. A 2x4 brick is about the size of a shoebox next to a character (big chunky bricks read better and are easier to grab).

## Data formats

### Brick catalogue (`shared/bricks.ts`)

```ts
type BrickTypeId = '1x1' | '1x2' | '2x2' | '2x3' | '2x4' | '1x4' | 'plate2x4' | 'slope2x2' | ...;
interface BrickType { id: BrickTypeId; studsX: number; studsZ: number; heightPlates: number; nearMiss: BrickTypeId[] }
interface Colour { id: string; hex: string; nearMiss: string[] }   // light-grey <-> dark-grey, red <-> dark-red
```

### Target build (`content/builds/lighthouse.json`)

```jsonc
{
  "id": "lighthouse",
  "name": "Lighthouse",
  "baseplate": { "studsX": 16, "studsZ": 16 },
  "steps": [
    { "page": 1, "bricks": [ { "type": "2x4", "colour": "white", "pos": [4,0,6], "rot": 0 }, ... ] },
    { "page": 2, "pairedWith": null, "bricks": [ ... ] }
  ],
  "unlocksJoke": "catapult"
}
```

Page images are **rendered at runtime** from this data (an isometric Three.js render to a texture with the new bricks highlighted), so no hand-drawn pages are needed. Forged pages are made by changing one brick (a near-miss colour, a near-miss type, or a position shift of 1 stud) and nudging the stamp or watermark.

### Map (`content/maps/house.json` + `house.glb`)

- glTF with the static geometry (collision as simple boxes), plus JSON listing: hiding spots (id, position, type: drawer/rug/roof/dog...), bin positions and stock, the job-site location, the index location candidates, the inspector location, and the meeting room.

### Build editor (tool)

A simple in-browser editor (reusing the client's snapping code) to place bricks and split them into steps, then export JSON. This is how we create new target builds and joke builds.

## Client architecture

- **Game loop:** fixed 60 Hz simulation for local prediction, render at the display refresh rate.
- **Rendering:** one `InstancedMesh` per brick type, with per-instance colour. Simple toon or flat shading with soft shadows from a single directional light.
- **Input:** WASD plus mouse look (pointer lock). E = grab/interact, R = rotate held brick, Q = show page, F = saboteur ability menu (saboteur only), V = push-to-talk (optional), Tab = scoreboard and objectives.
- **Camera:** third person over the shoulder by default (so you see yourself ragdoll), and a first-person toggle for precise placement.
- **Placement assist:** a ghost preview of where the held brick will snap, which makes building with a mouse workable.
- **Audio:** Web Audio for effects (positional), plus voice streams through `PannerNode` with distance falloff. Meetings switch voice to global.

## Server architecture

- One process, many rooms. Each room has: player list, phase state machine, Rapier world, build state, page/spot state, and timers.
- Tick: 30 Hz physics, 20 Hz snapshots.
- Every rule lives in `shared/` as pure functions (`canSnap`, `matchBuild`, `applyVote`, ...) so it can be unit tested and used for client prediction.
- No database for the MVP. Rooms live in memory and disappear when empty.
- Logging: per-room event log (also useful for the end-of-round replay or highlights).

## Voice

- Signalling (SDP offer/answer, ICE candidates) is relayed by the game server over the existing WebSocket.
- Full mesh: each client connects to every other (fine for 8 or fewer).
- Volume per peer = f(distance) from the game state, with muffling through walls via a raycast against the level each frame (a handful of rays, cheap). Details in the roadmap's M7 notes.
- STUN: a public STUN server for internet games. TURN: optional coturn on the VPS. LAN: neither needed.
- Fallback: when voice is off, text chat bubbles above heads, and the "scream" is a sound effect.
