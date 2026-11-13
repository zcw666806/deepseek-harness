# Agent Note: Keep the restaurant design pilot opt-in and project-owned

Status: implemented

English | [中文](2026-10-27-restaurant-design-pilot.zh.md)

## Problem

The supplied restaurant HTML contains a working SVG and Three.js editor, but its browser state omits the building data and its local history cannot represent assistant edits. The source also contains overlaps and duplicated geometry, so rejecting every inherited overlap prevents ordinary layout work.

## Decision

The [local restaurant workspace](../../../../restaurant-design/README.md) mounts a project provider, tool consumer, and browser consumer through an explicit Harness overlay. The default application composition and model remain unchanged. One synchronous file writer owns complete project data and accepted version history; both mouse and tool edits use that writer with an expected revision. A failed persistence operation publishes neither a revision nor history.

The writer rejects newly introduced or worsened overlaps while retaining imported findings as a baseline. Explicit groups permit existing internal overlaps and support rigid translation; browser state replacement cannot independently move, rotate, resize, or remove a member to bypass checks. Undo and redo create monotonically increasing revisions.

The supplied document runs in an opaque-origin sandbox with network access disabled. A trusted parent checks message ownership and proxies only fixed restaurant operations through authenticated Connection routes. Neither the imported document nor model tool arguments obtain arbitrary Host access.

The workbench frames the existing Harness conversation beside the editable plan and the read-only Three.js scene. The replacement tool uses the selection and revision captured when the user submitted the message. A preview exists only in memory. The trusted viewer wrapper owns confirmation and commits the checked proposal at its base revision. Undo restores the original items and membership from the same history.

## Alternatives considered

### Build a separate assistant application

A separate application duplicates model routing, session history, and tool execution before the restaurant workflow has been validated. An opt-in overlay exercises those existing capabilities without adding a supported Node application launcher.

### Synchronize only localStorage and screenshots

Browser-only history loses assistant changes, and screenshots omit editable geometry. A complete project plus a shared writer preserves measurable edits and one undo history.

### Treat every imported overlap as a new error

The supplied plan contains inherited overlapping objects. Comparing candidate findings with the accepted layout permits corrections while rejecting new conflicts and worsening existing conflicts.

## Consequences

The pilot supports the supplied viewer and one process per project. The four-seat template checks proposed chair pull-out space, and other furniture uses footprint checks. Surveyed room containment, fire review, and construction drawings require additional information. The source viewer remains a retained workspace asset, and repository fixtures use synthetic plans.

## Verification

Focused tests exercise source extraction, persistence failure, rigid groups, baseline comparisons, version conflict, selection races, sandbox isolation, accepted-state rollback, and real Loader tool registration and disposal. The actual Web profile demonstrates a 300 mm group move, Three.js display, refresh, shared undo, stale-revision rejection, and complete project export. A real model completes move and undo turns; the [keyless scenario](../../../../snapshots/session/restaurant-layout/snapshot.yml) pins those tool operations with synthetic geometry and an independent file oracle.
