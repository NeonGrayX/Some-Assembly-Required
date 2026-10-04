# 01: Feasibility

## Verdict

**Yes, this works as a browser game**, as long as two things hold:

1. **The art stays simple.** Low-poly, flat-shaded and stylised. Bricks are generated in code, not modelled, and one small map (a house and its yard) is enough.
2. **Most of the build is not a live physics simulation.** Bricks snap onto a stud grid, and snapped bricks merge into one rigid body. Physics only runs on loose bricks, carried assemblies, ragdolls and collapses. This one decision keeps CPU load, network traffic and sync bugs small.

With those two constraints the game sits comfortably inside what browsers handle today. Games like _krunker.io_, _Bonk.io_, _Gartic Phone_ and the many Three.js physics demos show that 3D, physics and real-time multiplayer all run fine in a browser tab.

## What the browser gives us

| Need                 | Browser tech                                | Status                                                              |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| 3D rendering         | WebGL2 via Three.js (WebGPU optional later) | Mature, works on any recent desktop GPU and integrated graphics     |
| Physics              | Rapier compiled to WASM                     | Fast. Hundreds of bodies at 60 Hz is not a problem                  |
| Real-time networking | WebSocket (TCP)                             | Works everywhere and is good enough for a party game. No UDP needed |
| Proximity voice      | WebRTC audio + Web Audio `PannerNode`       | Works. See the HTTPS caveat below                                   |
| Mouse look           | Pointer Lock API                            | Works                                                               |
| Install size         | A few MB of JS and WASM, loaded once        | Loads in seconds                                                    |

## What the browser cannot do, and the workarounds

### 1. A browser tab cannot host a server

A web page cannot open a listening socket, so "one player hosts a lobby on their IP" cannot happen from inside the browser alone.

**Workaround:** ship the server as a **single small executable** (built with `bun build --compile` or Node SEA, around 50–90 MB, no installer). The host double-clicks it, it prints `http://192.168.x.x:7777`, and everyone else opens that address in their browser. The same executable serves the game files and runs the game server, so only the host downloads anything and clients install nothing.

The exact same server code also runs on a cheap VPS for internet play.

(The alternative is WebRTC peer-to-peer with the host's browser acting as server. It still needs a signalling server to connect peers, it is harder to debug, and it lets the host cheat by reading hidden info. Not recommended for v1.)

### 2. Microphones need HTTPS

Browsers only allow `getUserMedia` (microphone access) on **secure origins**: `https://` or `localhost`. A plain `http://192.168.1.20:7777` LAN address is not secure, so **proximity voice would not work on LAN over plain HTTP**.

Options, in order of preference:

- **VPS:** use a real domain with a Let's Encrypt certificate. No issue.
- **LAN host:** the host app generates a self-signed certificate and serves HTTPS. Each player clicks through a browser warning once. It is a bit ugly but works.
- **Fallback:** play without in-game voice and use Discord. The game still works because the scream and limp effects also play as sound effects.

### 3. Physics must not desync

Simulating every brick on every client and hoping the results match does not work, because floating-point physics diverges between machines.

**Workaround:** the server is authoritative. It runs Rapier and sends positions of moving objects. Clients interpolate between snapshots. Static, snapped builds are sent as discrete state ("brick #42 is attached to assembly #3 at stud (4,1,2), rotated 90°"), which is tiny and exact. Ragdolls are cosmetic and simulated locally on each client. Only the "knocked down" flag and the root position are synced.

### 4. Hidden information can be read by cheaters

Anything sent to a browser can be read in devtools. If the client knew who the saboteur was, or what every page said, someone would cheat.

**Workaround:** the server sends each client only what that player may know: their own role, page contents only after they pick the page up or someone shows it to them, and so on. See [03-architecture.md](03-architecture.md#hidden-information).

## Load estimates (8 players, one lobby)

- **Server CPU:** Rapier with a few hundred bodies, most of them asleep, steps in a few milliseconds at 30 Hz. A single 1 vCPU VPS can run several lobbies at once.
- **Server RAM:** under 100 MB per process.
- **Bandwidth:** about 8 players plus about 50 moving bodies, roughly 20 bytes each, gives about 1.2 KB per snapshot. At 20–30 Hz that is about 30 KB/s per client and about 250 KB/s out of the server per lobby. Any VPS handles this.
- **Voice:** WebRTC mesh, so the server carries no audio. Each client sends 7 Opus streams at about 24 kbps each, roughly 170 kbps upload, which home connections handle easily.
- **Client:** any laptop from the last ~6 years with integrated graphics should hold 60 fps on a low-poly map with instanced brick rendering.

## What would make it too demanding (so we avoid it)

- Realistic graphics, detailed textures or large open maps.
- Simulating every brick in a 300-brick build as its own free rigid body.
- Physical brick clutch (holding bricks together through friction instead of snapping).
- More than about 10 players per lobby, or server-side voice mixing.

## Conclusion

The game is a good fit for the browser. Joining by link with no install is a big win for a party game. The hard parts are networking and snapping/assembly logic, not raw performance. Both are well understood, and the roadmap tackles them first.
