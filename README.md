# Some Assembly Required

A browser-based multiplayer building game with a hidden saboteur.

The team gets a target model (a lighthouse, a rocket, a giant duck) and a timer. The instruction pages are scattered around the map and the bricks sit in bins, some colours rarer than others. One player is secretly the saboteur. They try to make the build fail or come out wrong without getting caught.

**Status:** planning. There is no code yet.

## Documents

| Doc | Contents |
|-----|----------|
| [docs/01-feasibility.md](docs/01-feasibility.md) | Can this run in a browser? What is hard, and how we get around it |
| [docs/02-game-design.md](docs/02-game-design.md) | Rules, roles, round flow, saboteur tools, counterplay, and what goes in the MVP |
| [docs/03-architecture.md](docs/03-architecture.md) | Tech stack, networking, hosting (VPS or LAN host), physics, voice chat, data formats |
| [docs/04-roadmap.md](docs/04-roadmap.md) | Milestones and tasks, from an empty repo to a playable vertical slice and beyond |
| [docs/05-risks-and-open-questions.md](docs/05-risks-and-open-questions.md) | Known risks, mitigations, and decisions that are still open |

## Summary

- **Platform:** desktop browser. Players install nothing and join through a link or a LAN address.
- **Stack:** TypeScript, Three.js for rendering, Rapier (WASM) for physics, and a small Node.js WebSocket server.
- **Multiplayer:** one authoritative server that runs either on a cheap VPS (1 vCPU, 1 GB RAM is plenty) or on one player's PC as a small host app that people on the LAN connect to by IP.
- **Players:** 4 to 8 per lobby.
