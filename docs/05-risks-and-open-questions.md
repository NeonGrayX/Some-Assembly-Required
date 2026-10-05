# 05: Risks and Open Questions

## Risks

| #   | Risk                                                     | Impact              | Mitigation                                                                                                                                   |
| --- | -------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Placing bricks with a mouse in 3D is fiddly and not fun  | High                | Ghost preview, generous snap radius, big chunky bricks, a first-person precision mode. Prototype first (M1) and stop if it doesn't feel good |
| 2   | Networked physics feels laggy or desyncs                 | High                | Server authority, snapped builds sent as discrete state, interpolation, client-side cosmetic ragdolls. Networking spike before M3            |
| 3   | The saboteur is too strong or too weak                   | Medium              | Cooldowns, witness tells, a tunable match tolerance and timer. Needs playtesting, not theory                                                 |
| 4   | No voice on LAN because of the HTTPS requirement         | Medium              | Self-signed certificate in the host app. Fallback to Discord plus sound effects                                                              |
| 5   | WebRTC voice fails across some NATs                      | Low–Medium          | STUN plus an optional TURN on the VPS. Voice is a bonus, not required                                                                        |
| 6   | Breaking assemblies is too chaotic or too rare           | Medium              | Thresholds in config, tuned in playtests. Option for a "sturdy" lobby setting                                                                |
| 7   | Cheating via devtools                                    | Low (friends' game) | Per-client visibility filter means the client never gets secrets                                                                             |
| 8   | Scope creep (variants, joke builds, art)                 | High                | MVP list in 02 is fixed until the first playtest                                                                                             |
| 9   | Creating new target builds and pages takes too much work | Medium              | Pages are rendered from build JSON. In-browser build editor (M2)                                                                             |
| 10  | Brand or trademark issues with "Lego"                    | Medium              | Never use the name, logo or exact brick shape trademarks in the game. Say "bricks". Studs are fine                                           |

## Open questions (for the project owner)

1. **Art direction:** blocky low-poly (cheap and fast) or something more distinctive (cel-shaded, papercraft)? Affects M8 only.
2. **Camera:** third person by default with a first-person toggle (proposed), or first person only?
3. **Penalty for sending an innocent home:** 60 seconds for now. Playtest whether that is enough.
4. **Saboteur reveal on sending home:** hidden for now (keeps tension); roles are revealed on the results screen.
5. **Round length:** 8, 10 or 12 minutes? Depends on build size. Playtest.
6. **Lobby joining:** room codes on the VPS (proposed). For LAN, one room per host app?
7. **Mobile/touch support:** out of scope for now (proposed). Desktop browser with mouse and keyboard only.
8. **Domain or hosting provider** for the public server, if any.
9. ~~**Runtime for the host executable:** Bun (smaller, simpler compile) or Node SEA (more conservative)? Decide in M5. Both work.~~ Decided: Bun. It cross-compiles every platform from one machine and runs the server unchanged.
