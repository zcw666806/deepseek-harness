# Restaurant design workspace

English | [中文](README.zh.md)

## Summary

Inspect and adjust the supplied restaurant layout with the plan, Three.js scene, and Harness conversation on one page. Build furniture groups, preview a four-seat replacement, inspect its conflicts, and apply or undo an accepted change.

The [workbench development proposal](../.agents/notes/proposed/feature/2026-10-28-restaurant-design-workbench.md) describes the next milestones for viewer integration, restaurant rules, and scheme delivery.

## Table of Contents

- [Prepare a project](#prepare-a-project)
- [Open the workspace](#open-the-workspace)
- [Edit a layout](#edit-a-layout)
- [Limitations](#limitations)
- [Verification](#verification)

<a id="prepare-a-project"></a>

## Prepare a project

Run from a checkout with its existing dependencies. Supply the original offline HTML and a dedicated writable project directory:

```powershell
node --import tsx/esm restaurant-design/setup.ts --source "C:/path/restaurant.html" --workspace .artifacts/restaurant-design
```

The setup operation extracts JSON literals without executing the document, preserves a copy of the viewer, and creates `project.json`, `cordis.yml`, and `tools.patch.yml`. Repeating setup retains accepted project changes; a different source requires a different workspace. Project coordinates are millimetres. Imported dimensions remain unverified design data.

<a id="open-the-workspace"></a>

## Open the workspace

Start through the existing Web profile:

```powershell
node --import tsx/esm apps/cli/src/bin.ts --profile web --patch .artifacts/restaurant-design/cordis.yml -- --no-open --port 0
```

Open the printed launch URL to authenticate, then open `/api/restaurant.workbench` on that same origin. Select a workspace or an existing conversation in the Harness pane. The plan handles edits, the 3D pane follows the plan and supports camera controls, and the standalone viewer remains at `/api/restaurant.page`. The tools-only overlay supports the headless profile.

For the prepared local pilot, `pwsh -File restaurant-design/start.ps1` uses the dedicated workspace home and loads its optional model and browser-picker overlays when present. Stop it with Ctrl+C. Model settings stored in this workspace do not replace the global settings file.

<a id="edit-a-layout"></a>

## Edit a layout

Select furniture in the viewer, append selected items or enter their IDs, and create a named group when its membership is known. Use the workspace controls or ask the assistant to read the restaurant, move the selected items by a specified displacement, inspect conflicts, or undo the change. Selecting a grouped member expands the group. Groups support rigid translation; undo grouping before independently rotating, resizing, or deleting members.

For a four-seat replacement, select a group with one dining table, rectangular or round, and two chairs. If the source has individual furniture items, create the group first. Wait for the selection to sync, then ask the assistant “Replace the selected group with a four-seat table and show me a preview.” The preview uses a rectangular planning template, retains the table center and rotation, and checks furniture and chair pull-out space against the current layout.

Inspect the proposed arrangement in both views and review the conflict list. Apply or cancel the preview from the plan pane. A conflicting or outdated proposal cannot be applied. Applying saves the replacement as one revision, and Undo restores the original table, chairs, and group membership.

New or worsened overlaps reject the complete edit. Existing source overlaps remain visible as baseline findings. Rejected edits identify the conflicting objects and restore the accepted layout. Both views follow the server revision, and the original toolbar's undo and redo use server history. Exported project JSON includes the building data, furniture, groups, and keepout rules; private undo history stays in the working project file.

The page runs the supplied viewer inside an opaque-origin sandbox. Its trusted parent accepts only the configured restaurant operations through the existing authenticated Connection. The viewer cannot access Harness credentials or arbitrary Host APIs.

<a id="limitations"></a>

## Limitations

One Harness process owns one project file. Do not run Web and headless writers against the same file. Persistence stores complete version snapshots and is intended for this local pilot. The adapter requires the supplied viewer's declaration and editing anchors; it is not an arbitrary HTML or CAD importer.

Checks cover rotated furniture footprints, wall and window rectangles, conservative door-swing envelopes, manually configured convex keepout polygons, and the imported rectangular bounds. The four-seat template uses an explicit chair pull-out allowance for the proposed chairs. Other furniture keeps its existing footprint checks. The source plan contains overlapping and duplicated objects, which need design review. Building geometry is locked. Surveyed room containment, evacuation review, approved seating capacity, and construction drawings are outside this workflow.

<a id="verification"></a>

## Verification

```powershell
node node_modules/vitest/vitest.mjs run --config restaurant-design/vitest.config.ts
node node_modules/typescript/bin/tsc -p restaurant-design/tsconfig.check.json
```

The narrow typecheck consumes the checkout's built dependency declarations through project references. Tests cover persistent edits, rejected conflicts, grouped translation, revision races, sandbox isolation, browser rollback, real Loader tool registration, disposal, and repeatable project preparation. Browser verification against the actual Web profile covers grouping, a 300 mm move, Three.js display, refresh, undo, stale-revision rejection, and complete export. A live Claude Opus 5.5 turn reads and moves an item through the tools, updates the viewer, and restores it through a second undo turn.

The [keyless headless scenario](../snapshots/session/restaurant-layout/snapshot.yml) replays read, move, and undo against a synthetic two-item restaurant, and independently compares the complete resulting project file. Run it with `$env:DSH_SNAPSHOT='replay'; node node_modules/vitest/vitest.mjs run --config vitest.snapshot.config.ts -t restaurant-layout`.

The [replacement scenario](../snapshots/session/restaurant-replacement/snapshot.yml) verifies that a tool-generated preview leaves the saved project intact. The browser test uses the existing Harness composer and verifies that both views display the same preview, confirmation applies it once, and undo restores the original group.
