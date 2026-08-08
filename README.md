# The Grand Frontier: Omni

A modular physics sandbox action game that runs in the browser. Salvage parts from a
procedurally generated world, weld them into whatever machine you can imagine, and find out
whether it drives.

No engine, no libraries, no build step, no asset files. Canvas 2D for rendering, the Web Audio
API for every sound, and a custom rigid-body solver underneath it all.

```bash
npm start          # serves on http://localhost:8080
```

(ES modules will not load from `file://`, so it does need to be served. `server.js` is a
dependency-free static server; any other one works too.)

---

## Controls

| Input | Action |
| --- | --- |
| `WASD` | Thrust / drive |
| Mouse | 360° aim — the chassis torques itself to face the cursor |
| `LMB` | Fire cannons / charge blades |
| `RMB` | Fire mortars |
| `SHIFT` / `SPACE` | Dash (brief invulnerability) |
| `B` | Build mode |
| `1`–`0`, wheel | Select part |
| `Q` / `E` | Rotate the part being placed |
| `LMB` / `RMB` (in build mode) | Weld part on / salvage part off |
| `CTRL` | Brake |
| `R` | Rebuild after death |
| `M` | Mute |

---

## The one idea everything else follows from

**The player is not special.** The player, every enemy, every boulder, every tree and every
piece of flying debris is the same thing: a `Body` — a rigid assembly of convex `Part`s held
together by `weld`s that have their own durability.

Nothing is driven by a script. Controllers emit an `Intent`:

```js
{ move: {x, y}, aim: {x, y}, fire, altFire, dash, brake }
```

…and that is the *entire* vocabulary any controller has. The player's keyboard produces one.
A behaviour tree produces one. `actuate()` in `src/game/actuation.js` consumes them
identically and turns them into forces applied at real world positions.

The consequences are not authored, they just happen:

- Shoot the thrusters off a Lancer and it handles badly — because it is short two thrusters,
  not because a "damaged" flag was set.
- Weld a thruster to a boulder in build mode and you have built a rocket-propelled battering
  ram. Nothing in the code knows what that is.
- A Bruiser that throws a boulder at you and misses may flatten another Bruiser. Friendly fire
  is not a special case; it is the absence of one.
- Mount thrusters off-center and you will spin, because thrust is applied at the part's
  position and torque is `r × F`.

---

## Systems

### Physics — `src/physics/`

Impulse-based rigid bodies with convex polygon collision: SAT for the contact normal and
depth, then reference/incident face clipping for a proper two-point manifold (one-point
manifolds make welded chassis wobble against walls). Sequential impulse solver with
accumulated impulses, Coulomb friction and Baumgarte position correction. Broadphase is a
spatial hash; simulation is culled to a box around the camera, so several hundred loaded props
cost nearly nothing.

**Structural destruction** is the interesting part. When welds or parts fail, `maintainStructure`
re-partitions the body into its surviving weld-connected components mid-step. Each fragment
inherits the correct velocity for its *new* centre of mass (`v + ω × r`), so a wing torn off
mid-turn keeps the spin it had at the moment it came free. Fragments that still contain a core
keep fighting; the rest become debris.

Mass, centre of gravity and rotational inertia are recomputed from the part list on every
structural change, and the body is re-origined onto its new centre of mass — which is why
losing a wing visibly changes how a machine rotates.

### Assembly — `src/game/assembly.js`

Attachment points are generated from the four flush positions around every existing part,
with occupied slots rejected. Placing a part welds it to every neighbour it physically abuts,
with weld strength derived from the weaker of the two materials. You can build onto *any* body
in reach, not just your own chassis.

### Combat — `src/game/combat.js`

Combat does not know what an "attack" is. It knows two parts collided hard, or a projectile
landed, and converts that into durability loss. Damage fatigues every weld holding the struck
part, so sustained fire on one corner shears that corner off even when the part itself
survives. Blade damage scales with impact speed, mass and trigger charge. Projectiles are swept
raycasts, so nothing tunnels at 1750 units/sec.

### Juice — `src/fx/juice.js`

Hitstop, directional screen shake, hit flash and zoom punch, each scaled by a real number out
of the simulation rather than a canned animation. Shake biases along the impact axis and falls
off with distance from the camera.

Hitstop draws from a refilling budget. This matters more than it sounds: naively stacking a
freeze per damage event pins the simulation near zero during a boss fight and the whole game
becomes permanent slow motion. The budget caps the long-run frozen fraction around 14% while
leaving isolated hits at full strength.

### World — `src/world/worldgen.js`

Chunks stream in around the player, all derived from the run seed, so revisiting a canyon gives
you back the same canyon. Five biomes vary how much ground is missing, what grows on it and
what patrols it. Terrain is baked once per chunk into an offscreen canvas via `ImageData` —
solidity sampled per tile, colour written per pixel — so ground has grain instead of being a
flat rectangle, and rendering is one blit per chunk.

Ground that isn't there is a real hazard: without a float core you slide in, the void chews on
your structure, and you are gone. With one you fly straight over. That single part turns a
chasm into a route.

### AI — `src/ai/`

A small behaviour tree library plus one shared tree. Archetypes differ only in numbers, not in
structure. The tree is *reactive* — it re-evaluates guard conditions every tick rather than
resuming into a running branch, so "chase the player" stops the instant "the player is visible"
stops holding.

States follow Patrol → Detect (with line-of-sight and a reaction delay) → Charge/Flank →
Special → fall back on structural loss. Specials are physics: a Bruiser finds a real boulder
nearby, drags it in, and hurls it.

### Audio — `src/audio/audio.js`

Every sound is synthesised at runtime; there are no audio files. Impacts are noise bursts
through swept bandpass filters plus struck-metal partials. Explosions are a pitch-swept sub
under filtered noise with a transient crack. The thruster hum is a continuous filtered voice
whose cutoff and pitch track actual thruster activation and energy brownout.

The soundtrack is a lookahead sequencer over `Am–F–C–G` that rewrites its own arrangement:
exploration is bass and pad, and as combat intensity climbs it adds kick, snare, hats and a
delayed square-wave arpeggio, and pushes the tempo and filter cutoff up.

---

## The energy economy

Cores and batteries supply energy; thrusters, wheels, float cores and cannons draw it. The
stored buffer is deliberately small relative to draw — a few seconds of everything at once.

Exceed your supply and the whole machine browns out: every actuator is scaled down by the same
ratio, so an over-built chassis gets *sluggish* rather than failing outright. Sixteen thrusters
on the starting chassis draw ~149/s against ~39/s of supply and pin the battery at zero for a
74% power cut. The HUD shows `DRAW n/n` live, and the fix is legible — weld on another battery,
or take a thruster off.

This is the main pressure that stops "bolt on everything" from being the correct answer.

---

## Layout

```
src/
  core/       math, seeded noise, event bus, input, camera
  physics/    rigid bodies + welds, SAT collision, solver, structural splitting
  game/       part catalog, blueprints, assembly, actuation, combat, projectiles, orchestration
  world/      chunked procedural generation and terrain baking
  ai/         behaviour tree library, enemy controller
  fx/         pooled particles, juice
  render/     canvas renderer
  ui/         HUD, minimap, build panel
  audio/      Web Audio synthesis and the adaptive sequencer
```

Systems talk through the event bus rather than calling each other. That is what lets an
interaction nobody planned — an AI boulder shattering a third party's chassis — produce full
damage, debris, sound and screen shake for free.

## License

MIT
