# HUD Design: [Game Name]

> **Status**: Draft | In Review | Approved | Implemented
> **Author**: [Name or agent — e.g., ui-designer]
> **Last Updated**: [Date]
> **Game**: [Game name — this is a single document per game, not per element]
> **Platform Targets**: [All platforms this HUD must work on — e.g., PC, PS5, Xbox Series X, Steam Deck]
> **Related GDDs**: [Every system that exposes information through the HUD — e.g., `design/gdd/combat.md`, `design/gdd/progression.md`, `design/gdd/quests.md`]
> **Accessibility Tier**: Basic | Standard | Comprehensive | Exemplary
> **Style Reference**: [Link to art bible HUD section if it exists — e.g., `design/art/art-bible.md § HUD Visual Language`]

> **Note — Scope boundary**: This document specifies all elements that overlay the
> game world during active gameplay — health bars, ammo counters, minimaps, quest
> trackers, subtitles, damage numbers, and notification toasts. For menu screens,
> pause menus, inventory, and dialogs that the player navigates explicitly, use
> `ux-spec.md` instead. The test: if it appears while the player is directly
> controlling their character, it belongs here.

---

## 1. HUD Philosophy

> **Why this section exists**: The HUD design philosophy is not decoration — it is a
> design constraint that every subsequent decision is measured against. Without a
> philosophy, individual elements get added on request ("the quest tracker wants a
> bigger icon") without any principled way to push back. With a philosophy, there is
> a shared, explicit standard. More importantly, the philosophy prevents the HUD from
> slowly growing to cover the game world while each individual addition seemed
> reasonable in isolation. Write this before specifying any elements.

**What is this game's relationship with on-screen information?**

[One paragraph. This is a design statement, not a description of features. Consider
the game's genre, pacing, and player fantasy. A stealth game's HUD philosophy might
be: "The world is the interface. If the player has to look away from the environment
to survive, the HUD has failed." A tactics game might say: "Complete situational
awareness is the game. The HUD is not an overlay — it is the battlefield."

Reference comparable games if helpful, but describe your specific stance:
Example — diegetic-first action RPG: "We treat screen information as a concession,
not a feature. Every HUD element must earn its pixel space by answering the question:
would the player make demonstrably worse decisions without this information visible?
If the answer is 'they'd adapt,' we put it in the environment instead."]

**Visibility principle** — when in doubt, show or hide?

[State the default resolution for ambiguous cases. Options:
- Default to HIDE: information is available on demand (e.g., Dark Souls — no quest tracker, no minimap, stats are in a menu)
- Default to SHOW: players prefer to be informed; cluttered is better than uncertain
- Default to CONTEXTUAL: information appears when it becomes relevant and fades when it does not
Most games benefit from contextual defaults. State your game's default clearly so every element decision is consistent.]

**The Rule of Necessity for this game**:

[Complete this sentence: "A HUD element earns its place when ______________."

Example: "...the player would have to stop playing to find the same information
elsewhere, or would make meaningfully worse decisions without it."

Example: "...removing it in playtesting causes measurable frustration or confusion
in more than 25% of testers within the first hour of play."

This rule is the veto power over feature requests to add HUD elements. Document it
so it can be cited in design reviews.]

---

## 2. Information Architecture

> **Why this section exists**: Before specifying any HUD element's visual design,
> position, or behavior, you must answer a more fundamental question: should this
> information be on the HUD at all? This section is a forcing function — it requires
> you to categorize EVERY piece of information the game world generates and make an
> explicit, intentional decision about how each is presented. "We'll figure that out
> later" is how games end up with 18 elements competing for the player's peripheral
> vision. This table is the master inventory of game information, not just HUD information.

| Information Type | Always Show | Contextual (show when relevant) | On Demand (menu/button) | Hidden (environmental / diegetic) | Reasoning |
|-----------------|-------------|--------------------------------|------------------------|----------------------------------|-----------|
| [Health / Vitality] | [X if action game — player needs constant awareness] | [X if exploration game — show only when injured] | [ ] | [ ] | [Example: always visible because health decisions (retreat, heal) must be instant in combat] |
| [Primary resource (mana / stamina / ammo)] | [ ] | [X — show when resource is being consumed or is critically low] | [ ] | [ ] | [Example: contextual because stable resource levels are not decision-relevant] |
| [Secondary resource (currency / materials)] | [ ] | [ ] | [X — check in inventory] | [ ] | [Example: on-demand because resource totals don't affect immediate gameplay decisions] |
| [Minimap / Compass] | [X] | [ ] | [ ] | [ ] | [Example: always visible because navigation decisions are constant during exploration] |
| [Quest objective] | [ ] | [X — show when objective changes or player is near it] | [ ] | [ ] | [Example: contextual — player knows their objective; only remind at key moments] |
| [Enemy health bar] | [ ] | [X — show only during combat encounters] | [ ] | [ ] | [Example: contextual because enemy health is irrelevant outside combat] |
| [Status effects (buffs/debuffs)] | [ ] | [X — show when active] | [ ] | [ ] | [Example: contextual because status effects only affect decisions when present] |
| [Dialogue subtitles] | [X when dialogue is playing] | [ ] | [ ] | [ ] | [Example: always show while dialogue is active — accessibility requirement] |
| [Combo / streak counter] | [ ] | [X — show while combo is active, hide on reset] | [ ] | [ ] | [Example: contextual because it communicates active performance, not baseline state] |
| [Timer] | [ ] | [X — show only in timed sequences] | [ ] | [ ] | [Example: contextual because timers only exist in specific encounter types] |
| [Tutorial prompts] | [ ] | [X — show for first-time situations only] | [ ] | [ ] | [Example: contextual and one-time; never repeat to experienced players] |
| [Score / points] | [ ] | [X — show in score-relevant modes only] | [ ] | [ ] | [Example: contextual by game mode; hidden in modes where score is irrelevant] |
| [XP / level progress] | [ ] | [ ] | [X — available via character screen] | [ ] | [Example: on-demand because progression does not affect in-moment gameplay decisions] |
| [Waypoint / objective marker] | [ ] | [X — show when player is navigating to objective] | [ ] | [ ] | [Example: contextual — suppress during cutscenes, cinematic moments, and free exploration] |

---

## 3. Layout Zones

> **Why this section exists**: The game world is the primary content — the HUD is a
<!-- 迁移时截断至 100 行，完整内容见上游源 -->
