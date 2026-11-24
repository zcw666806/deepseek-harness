# Agent Note: Develop a restaurant workbench around the existing viewer

Status: proposed

English | [中文](2026-10-28-restaurant-design-workbench.zh.md)

## Problem

The [implemented pilot](../../implemented/feature/2026-10-27-restaurant-design-pilot.md) supports shared project persistence, grouped translation, geometric checks, and undo. The [viewer adapter](../../../../restaurant-design/src/page.ts) rewrites HTML declarations and functions, while its browser bridge reads the supplied editor's internal variables. Chat and preview occupy separate tabs. Tools repeatedly return the complete project and all findings, and the project has no restaurant component catalog, seating assignments, use-space definitions, or candidate layouts.

The supplied viewer shares substantial interface and function code with [wy51ai/floorplan-3d](https://github.com/wy51ai/floorplan-3d). The exact derivation and upstream commit are unconfirmed. The source contains duplicate or overlapping geometry and provisional dimensions; a geometric finding is not automatically a design mistake, and furniture counts do not establish seating capacity.

## Proposal

Keep Harness as the assistant runtime and retain the current offline viewer as the rendering starting point. Develop a single-project, single-user restaurant workbench through the following milestones. This proposal extends the pilot and does not supersede its implemented decision record.

### Responsibility assignment

| Owner | Responsibility |
| --- | --- |
| Harness | Conversation, model routing, tool execution, attachments, and durable model-visible records |
| Restaurant project service | Dimensions, objects, groups, rules, candidate changes, accepted revisions, and geometry checks |
| Viewer adapter | Load a project, report selection and edit requests, display accepted or candidate geometry, and export a view |
| Existing SVG and Three.js renderer | Plan drawing, selection, materials, camera controls, and walkthrough |
| Delivery module | Version-bound plan sheets, furniture and seating schedules, unresolved inputs, and exports |

Mouse edits and assistant calls must use the same project operations. The viewer remains sandboxed and has no direct file, credential, or unrestricted Host access. Model-visible constraints, selections, screenshots, and results must remain reconstructable through the existing tool, attachment, and session mechanisms.

### Milestone 0: Source and data baseline

Record the upstream comparison target, retained source fingerprint, known differences, and license information before integrating upstream code. Preserve the supplied offline asset and original project data. Absorb upstream changes selectively after comparison; include the [upstream license](https://github.com/wy51ai/floorplan-3d/blob/master/LICENSE) with adopted code when distributing it.

Review object classifications, duplicate candidates, usable-area outlines, doors, and zones with the designer. Preserve existing findings until their meaning is confirmed. Record how each dimension was obtained and whether the designer confirmed it. Distinguish field measurements, values read from drawings, and assumptions. Rules requiring missing information must report incomplete input. The rectangular drawing bounds must not be presented as a surveyed room outline.

### Milestone 1: One usable design workflow

Place the viewer beside the existing Harness conversation. Replace function rewriting incrementally with an explicit adapter for project loading, selection, edit proposals, accepted revisions, plan SVG export, and image capture. Pin supported viewer versions and reject unsupported imports with a clear diagnostic. Preserve the existing offline rendering behavior.

Introduce confirmed two-seat and four-seat dining templates and an atomic group-replacement operation. Extend group operations with explicit ungrouping and whole-group rotation while retaining accepted membership and relative geometry. A replacement must validate the entire resulting layout before publishing one revision; failure leaves the previous layout and history unchanged.

Give the model a compact project summary, current selection, applicable rules, and finding counts. Record the selected IDs and revision when a request is submitted, so references such as "this table" cannot follow later selection changes. Fetch object or region details on demand. Mutation receipts contain the revision, changed objects, and introduced, resolved, or worsened findings. Keep full project export available separately. Preserve required task information and measure request size on the existing restaurant before setting configurable result limits.

Use one vertical acceptance workflow: select a two-seat group, request a four-seat replacement, preview the candidate, apply it if valid, and undo it. Ordinary explicit edits may apply after validation; multi-object alternatives and edits requested as previews remain candidates until selected. Committing a stale candidate requires recomputation against the current revision.

### Milestone 2: Restaurant use and movement rules

Expand the small catalog to include six-seat groups, booths, separate dining chairs, and sideboards only when their dimensions and use spaces are recorded. Separate physical footprints from seated, pulled-out, door-opening, and maintenance spaces. Define permitted overlaps by component roles and use states; sharing a group must not exempt unrelated collisions. Assign seats explicitly to components or confirmed booth allocations, and keep unknown allocations visible. Report the configured layout's seat count without presenting it as an approved occupancy limit.

Allow a designer to mark and edit rectangular keepout and aisle regions in the plan, name them, and attach project-specific targets and their sources. Check furniture and recorded use spaces against those regions. Return the conflicting objects, highlighted location, measured values, target, and input completeness. Do not describe manually reserved regions as automatic evacuation-route analysis.

### Milestone 3: Alternatives and scheme delivery

Produce two local alternatives for a selected zone, such as retaining seating with wider movement space or increasing seating within the entered rules. Use confirmed component templates and bounded candidate search, then let the model explain the measured trade-offs. Report when no feasible candidate is found; do not claim a whole-restaurant optimum.

Save named scheme versions and compare changed objects, recorded seating, rule findings, and unresolved dimensions. Export a plan PDF with a vector plan, selected dimensions, furniture and seating schedules, screenshots, and project revision. Define the paper size and drawing scale explicitly, and verify the printed result. Label the deliverable as a layout scheme. Preserve complete JSON export.

### Later construction workflow

Treat construction deliverables as a separate scope after the scheme workflow is accepted. They require verified site information, finished levels, assemblies, installation details, relevant engineering systems, and professional review. Select and validate one CAD/BIM handoff against a designer's actual workflow before integrating multiple platforms. Automatic image or CAD recognition, kitchen engineering, multi-user collaboration, and photorealistic rendering are outside these milestones.

### Implementation order and evidence

Finish source and data review, then complete the replacement workflow before expanding the catalog and movement rules. Build alternatives and PDF delivery on those checked operations. Keep model choice configurable; Astra activation depends on available credentials and successful task-level verification, while the pilot's verified model remains usable. A model upgrade does not replace geometric or data validation.

Each implemented milestone needs focused geometry and project tests, a keyless recorded-session case with an independent project-file oracle, and real browser evidence for both views and history. Repeat real-model verification for changed tool behavior. Any new document format must be versioned and imported explicitly into a new project, preserving the source file.

## Alternatives considered

### Replace the current viewer with a fresh engine

The current SVG and Three.js interactions already support the pilot. Replacing the engine before validating restaurant operations adds rendering and interaction work without resolving component semantics or project rules. Introduce the adapter first and reconsider the engine only when a demonstrated requirement cannot be met.

### Keep extending HTML rewriting

Rewriting is sufficient for the known pilot asset, but new editing features would depend on more internal names and call order. An explicit adapter confines that dependency and provides a stable test target.

### Add BIM and construction output immediately

The project lacks the measured and professional information needed for construction output. Implementing file conversion before those inputs exist produces incomplete deliverables. Scheme PDF export can validate plan expression and handoff earlier.

## Acceptance criteria

- In one screen, a user selects a dining group and requests a previewed 300 mm move. The candidate is distinct from the accepted scheme; applying it updates both views and one revision, and undo restores the original geometry.
- Replacing a confirmed two-seat group with a confirmed four-seat template updates membership, geometry, and recorded seating atomically. A rejected replacement identifies its conflicts and leaves the accepted project unchanged.
- After marking an entrance keepout region and entering chair pull-out space, a user can locate an intrusion, adjust the layout, and export a scheme PDF whose plan, schedules, and revision agree.
- Unknown dimensions, seating assignments, and use spaces remain identifiable. No unperformed check is reported as passed.

## Risks

Source similarity alone does not identify an upstream revision. Inherited labels and overlapping objects need confirmation, and a visual template may not match a real product. Room containment and door movement require different geometry from drawing bounds and broad rectangles. Candidate generation may find no usable layout. PDF scale, text, and dimensions require visual verification. The single-writer and single-user limits remain in force throughout these milestones.
