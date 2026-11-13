# Agent Note: Workspace-owned comic projects and original artwork

Status: implemented

English | [中文](2026-11-12-workspace-comic-projects.zh.md)

## Problem

A short comic needs several passes over its panels, art, lettering, and reading order. Authors need to reopen their work in another conversation, send a specific layer to a drawing application, and hand off a project that someone else can edit. A reading PNG carries only the finished pixels.

## Decision

The [comic production service](../../../../packages/comic/comic-production/README.md) keeps project identity and saved revisions in the Workspace. A Session provides access to projects in its Workspace. Host operations check that membership and compare a submitted revision with the saved revision before publishing edits.

Page layout and dialogue are structured project data. Artwork revisions reference retained original PNG bytes. The [Comic studio view](../../../../packages/client/ui-comic-production/README.md) exports a layer at its original dimensions and accepts a replacement PNG of matching dimensions. Selecting an artwork revision is independent of editing panel geometry or lettering.

The versioned project package includes layout, lettering, artwork history, and the PNG data it references. Import creates a separate project. The browser renders a page PNG from the project's adopted artwork and lettering.

## Alternatives considered

**Bind the project to a Session.** A comic may need several conversations over its lifetime. Workspace ownership lets those conversations open the same saved project.

**Use normalized chat attachments as artwork masters.** The [attachment pipeline](../../../../docs/subsystems/attachment.md) can resize or re-encode images. Layer revisions require original dimensions and access to the source bytes.

**Build a complete browser drawing editor.** Exchanging a single PNG layer supports external brush work while keeping page layout and lettering editable in the workbench. Native drawing application documents stay with the author.

## Consequences

Authors can exchange a revised layer independently of the page layout and can transfer a project package to another Workspace. The first exchange format covers PNG layers. Full native drawing documents, generated art, and print output require separate integration. Simultaneous editors must reconcile a stale revision with the current saved project.
