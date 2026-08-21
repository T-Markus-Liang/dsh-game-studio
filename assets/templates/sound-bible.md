# Sound Bible: [Project Name]

## Audio Vision

### Sonic Identity
[Describe the overall audio personality of the game in 2-3 sentences. What does the game "sound like"? What emotions should the audio evoke?]

### Audio Pillars
1. **[Pillar 1]**: [How this pillar manifests in audio]
2. **[Pillar 2]**: [How this pillar manifests in audio]
3. **[Pillar 3]**: [How this pillar manifests in audio]

### Reference Games / Media
| Reference | What to Take From It | What to Avoid |
| ---- | ---- | ---- |
| [Game/Film 1] | [Specific audio quality to emulate] | [What doesn't fit our vision] |
| [Game/Film 2] | [Specific audio quality to emulate] | [What doesn't fit our vision] |

---

## Music Direction

### Style and Genre
[Primary musical style, instrumentation palette, tempo ranges]

### Instrumentation Palette
- **Core instruments**: [List the primary instruments/synths that define the sound]
- **Accent instruments**: [Used for emphasis, transitions, special moments]
- **Avoid**: [Instruments or styles that do NOT fit the game]

### Adaptive Music System
| Game State | Music Behavior | Transition |
| ---- | ---- | ---- |
| Exploration | [Tempo, energy, instrumentation] | [How it transitions to next state] |
| Combat | [Tempo, energy, instrumentation] | [Trigger condition and crossfade time] |
| Stealth/Tension | [Tempo, energy, instrumentation] | [Trigger and transition] |
| Victory/Reward | [Stinger or transition behavior] | [Return to exploration] |
| Menu/UI | [Style for menus] | [Fade on game start] |

### Music Rules
- [Rule about looping, e.g., "All exploration tracks must loop seamlessly after 2-4 minutes"]
- [Rule about silence, e.g., "Allow 10-15 seconds of silence between exploration loops"]
- [Rule about intensity, e.g., "Combat music must reach full intensity within 3 seconds of combat start"]
- [Rule about transitions, e.g., "All music transitions use 1.5 second crossfades"]

---

## Sound Effects

### SFX Palette
| Category | Description | Style Notes |
| ---- | ---- | ---- |
| Player Actions | [Movement, attacks, abilities] | [Punchy, responsive, front-of-mix] |
| Enemy Actions | [Attacks, abilities, death] | [Distinct from player, slightly recessed] |
| UI | [Button clicks, menu transitions, notifications] | [Clean, subtle, never annoying on repeat] |
| Environment | [Ambient loops, weather, objects] | [Immersive, layered, spatial] |
| Feedback | [Damage taken, item pickup, level up] | [Clear, satisfying, non-fatiguing] |

### Audio Feedback Priority
When multiple sounds compete, this priority determines what plays:
1. Player damage / critical warnings (always audible)
2. Player actions (attacks, abilities)
3. Enemy actions (nearby enemies first)
4. UI feedback
5. Environment / ambient

### SFX Rules
- [Rule about repetition, e.g., "Every SFX with >3 plays/minute needs 3+ variations"]
- [Rule about spatial audio, e.g., "All gameplay SFX must be 3D positioned, UI SFX are 2D"]
- [Rule about ducking, e.g., "Player hit SFX ducks all other SFX by 3dB for 200ms"]
- [Rule about response time, e.g., "Action SFX must trigger within 1 frame of the action"]

---

## Mixing

### Mix Bus Structure
| Bus | Content | Target Level |
| ---- | ---- | ---- |
| Master | Everything | 0 dB |
| Music | All music tracks | [target dBFS] |
| SFX | All sound effects | [target dBFS] |
| Dialogue | All voice/narration | [target dBFS] |
| UI | All interface sounds | [target dBFS] |
| Ambient | Environment loops | [target dBFS] |

### Mixing Rules
- Dialogue always takes priority — duck music and SFX during dialogue
- Music should be felt, not dominate — if players can't hear SFX over music, music is too loud
- Master output must never clip — use a limiter on the master bus
- All volumes must be adjustable by the player (per bus)
- Default mix should sound good on both speakers and headphones

### Dynamic Range
- [Specify loudness targets, e.g., "Target -14 LUFS integrated, -1 dBTP true peak"]
- [Specify compression policy, e.g., "Light compression on SFX bus, no compression on music"]

---

<!-- 迁移时截断至 100 行，完整内容见上游源 -->
