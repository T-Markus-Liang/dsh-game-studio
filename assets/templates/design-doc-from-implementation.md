# [System Name] — Design Document

---
**Status**: Reverse-Documented
**Source**: `[path to implementation code]`
**Date**: [YYYY-MM-DD]
**Verified By**: [User name or "pending review"]
**Implementation Status**: [Fully implemented | Partially implemented | Needs extension]
---

> **⚠️ Reverse-Documentation Notice**
>
> This design document was created **after** the implementation already existed.
> It captures current behavior and clarified design intent based on code analysis
> and user consultation. Some sections may be incomplete where implementation is
> partial or design intent was unclear during reverse-engineering.

---

## 1. Overview

**Purpose**: [What problem does this system solve?]

**Scope**: [What is included/excluded from this system?]

**Current Implementation**: [Brief description of what exists in code]

**Design Intent** (clarified):
- [Intent 1 — why this feature exists]
- [Intent 2 — what player experience it creates]
- [Intent 3 — how it fits into overall game pillars]

---

## 2. Detailed Design

### 2.1 Core Mechanics

[Describe the mechanics as implemented, organized clearly]

**[Mechanic 1 Name]**:
- **Description**: [What it does]
- **Implementation**: [How it works in code]
- **Design Rationale**: [Why it exists — from user clarification]
- **Player-Facing**: [How players experience this]

**[Mechanic 2 Name]**:
- **Description**: [What it does]
- **Implementation**: [How it works]
- **Design Rationale**: [Why it exists]
- **Player-Facing**: [Player experience]

### 2.2 Rules and Formulas

**Formulas Discovered in Code**:

| Formula | Expression | Purpose | Verified? |
|---------|-----------|---------|-----------|
| [Formula 1] | `[mathematical expression]` | [What it calculates] | ✅ / ⚠️ needs tuning |
| [Formula 2] | `[expression]` | [Purpose] | ✅ / ⚠️ needs tuning |

**Clarifications**:
- [Formula X]: Originally [value/approach], user clarified intent is [corrected intent]
- [Formula Y]: Implemented as [X], but should be [Y] — flagged for update

### 2.3 State and Data

**Data Structures** (from code):
- [Data structure 1]: `[fields/properties]`
- [Data structure 2]: `[fields/properties]`

**State Machines** (if applicable):
```
[State diagram or list of states and transitions]
```

**Persistence**:
- Saved: [What is saved to player save file]
- Not saved: [What is session-only or recalculated]

### 2.4 Integration Points

**Dependencies** (systems this depends on):
- [System 1]: [What it provides]
- [System 2]: [What it provides]

**Dependents** (systems that depend on this):
- [System 3]: [How it uses this system]
- [System 4]: [How it uses this system]

**API Surface** (public interface):
- [Method/Function 1]: [Purpose]
- [Method/Function 2]: [Purpose]

---

## 3. Edge Cases

**Handled in Code**:
<!-- 迁移时截断至 100 行，完整内容见上游源 -->
