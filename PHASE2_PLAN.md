# Lifemaxxing Phase 2 Plan (Draft)

Owner: Solo
Status: Draft
Principle: Local-first authority; sync is non-authoritative; no effort validation; no urgency framing.

## Milestones

### Milestone A — Sync foundation (non-authoritative)
Goal: "Never lose data" without changing effort validation.

- P2-A1 — Define sync model + metadata (deviceId, schemaVersion, createdAt, appVersion). (S)
  - Acceptance:
    - Documented payload schema and versioning.
    - Explicit statement: local data is authority.
- P2-A2 — Add device ID + backup metadata to payload. (S)
  - Acceptance:
    - Export payload includes deviceId, schemaVersion, createdAt, appVersion.
- P2-A3 — Conflict strategy (LWW + user prompt). (M)
  - Acceptance:
    - When remote newer but local changed, show choice to user.
    - No silent overwrites.
- P2-A4 — Restore preview (stats only). (S)
  - Acceptance:
    - Preview shows level, total effort, habits, efforts, chests, updatedAt.
- P2-A5 — Backup history list (latest 5). (M)
  - Acceptance:
    - List shows timestamp + device label.
- P2-A6 — Error/edge handling: offline, invalid payload, encryption mismatch. (M)
  - Acceptance:
    - Clear error messages; no crash.

### Milestone B — Web mirror parity
Goal: Web supports full core loop without new mechanics.

- P2-B1 — Audit parity gaps between web and mobile. (S)
  - Acceptance:
    - Checklist of missing features and UI differences.
- P2-B2 — Close parity gaps in habits/efforts/chests/items/combat. (M)
  - Acceptance:
    - Web can complete full loop: create habit -> log effort -> chest -> combat unlock -> inventory.
- P2-B3 — Copy review to meet PRD trust laws. (S)
  - Acceptance:
    - No "missed days" or urgency framing.

### Milestone C — Combat expansion
Goal: More variety, still optional and not farmable.

- P2-C1 — Add 2-3 encounter variants by rarity. (M)
  - Acceptance:
    - Difficulty tied to chest rarity; no new power sources.
- P2-C2 — Tune unlock ratio by rarity. (S)
  - Acceptance:
    - Rewards feel meaningful; no grind incentive.

### Milestone D — Narrative + cosmetics
Goal: Meaning without pressure; cosmetics only.

- P2-D1 — Item flavor text + short lore snippets. (M)
  - Acceptance:
    - Visible in inventory; no gating.
- P2-D2 — Cosmetic system scaffolding (titles/themes). (M)
  - Acceptance:
    - Selectable; no power effects.
- P2-D3 — Simple cosmetic store (offline catalog). (M)
  - Acceptance:
    - Lists cosmetics; no purchase flow yet.

### Milestone E — Optional social (sharing)
Goal: Share milestones without comparison.

- P2-E1 — Shareable milestone card (level-up, first mythic). (M)
  - Acceptance:
    - Opt-in sharing only; no rankings.

## Cross-cutting
- P2-X1 — Local DB schema migrations + versioning. (S)
  - Acceptance:
    - Upgrade path tested on sample data.
- P2-X2 — Trust-law regression checklist. (S)
  - Acceptance:
    - Manual checklist updated and used per milestone.
- P2-X3 — QA checklist update for Phase 2 flows. (S)
  - Acceptance:
    - Checklist includes backup, restore preview, conflict handling.

## Sequencing (recommended)
1. P2-A1 -> P2-A2 -> P2-A4 -> P2-A3 -> P2-A6 -> P2-A5
2. P2-B1 -> P2-B2 -> P2-B3
3. P2-C1 -> P2-C2
4. P2-D1 -> P2-D2 -> P2-D3
5. P2-E1
6. P2-X1 -> P2-X2 -> P2-X3 (as needed across milestones)

## Success Criteria
- Users can recover progress across devices without feeling penalized.
- Web mirrors core loop safely with no urgency or streak pressure.
- Combat remains optional and non-farmable.
- Cosmetics and social do not impact effort or power.
