# Phase 1 Checklist (MVP)

Source: Lifemaxxing PRD v1.4 (Build-Authoritative)

## Core Loop
- [x] IRL effort -> self-report -> chest -> items -> combat unlock -> identity reinforcement
- [x] Effort is the only source of power
- [x] Combat unlocks rewards (never creates power)

## Systems
- [x] Local-first identity (offline authoritative)
- [x] Web app (localStorage persistence)
- [x] Guest mode (no auth required)
- [x] Habits / effort anchors (create, select, pause)
- [x] Effort self-reporting (magnitude, optional note)
- [x] Chests (1 effort -> 1 chest)
- [x] Chest rarity based on consistency (no streak gating)
- [x] Items (cosmetic, dupes allowed)
- [x] Combat encounter (single; loss has zero penalty)
- [x] Recovery / mercy logic (rare; earned; non-farmable)

## Motivation Collapse Handling
- [x] Quiet mode after inactivity (reduced inputs, lower defaults)
- [x] Re-entry panel (single low effort action)
- [x] No deficit framing

## Visual / Interaction
- [x] Status-first UI
- [x] Panel-based layout
- [x] Evidence shown (identity level, totals, last effort/chest)
- [x] No missed days, no red warnings, no "behind" messaging

## Acceptance Criteria (Trust Tests)
- [x] Reopen after inactivity feels safe
- [x] Losing combat has zero negative consequence
- [x] Consistency beats intensity
- [x] Power never appears without effort
- [x] Identity never decreases

## Explicit Exclusions
- [x] Social features
- [x] Leaderboards / PvP
- [x] Competitive metrics
- [x] Cosmetic currency

## Remaining (if any)
- [ ] Optional login (persistence only)
- [ ] Phase 1 polish / QA
