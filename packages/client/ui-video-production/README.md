---
description: "Video production workspace with editable storyboards, reference assets, media previews, and film sequencing."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-video-production

English | [中文](README.zh.md)

## Summary

This browser plugin contributes the Video creation workspace over the [video production service](../../video/video-production/README.md). Each Session has one persistent project. The workspace edits shot descriptions, generation settings, reference associations, selected versions, and the film sequence without changing the agent loop.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount this plugin beside the video production Host controller in the Web profile. Select **Video creation** in the composer and ask the planning model to write the project storyboard. **Open storyboard canvas** beneath the reply loads `storyboard.md` into an editable canvas in the current conversation. The first open imports the shot titles, durations, generation prompts, frame ratios, and resolutions. Later opens use the saved canvas so its edits and generated clips carry forward. In the canvas, upload reference images in the asset library and associate them with shots supported by the chosen generator.

The canvas separates reference images, shot prompts, generation, recorded videos, assembly, and the final film. Drag image ports to generation reference ports to associate assets; connect completed video ports to assembly to adopt versions. The inspector lists connected references in generation order; its arrow buttons reorder the same saved shot inputs after Save storyboard. Reference connections pass below their prompt card and follow its position. Deleting these connections removes the corresponding association or adoption. Prompt-to-generation and generation-to-version connections are fixed. Connections and inspector edits remain drafts until Save storyboard; generation and export require saved values. Pan, zoom, select, search, and arrange nodes with per-Session viewing state. The Asset library toggle retains upload fields while collapsed; existing projects open with the library collapsed, and the inspector appears only for a selected shot. View preferences use a versioned browser-storage key independent of the Host project. Without a saved viewport, large graphs focus the selected node or first shot at a readable zoom; Fit canvas provides the full overview. Sequence-strip ordering changes the saved film order independently of node positions.

The generation-target selector applies to the next single-shot or batch operation, independently of saved storyboard fields. It lists only Host-advertised targets, requires a choice when several exist, and requires reselection if that target disappears. Declared input limits disable unsupported requests. Each shot retains its generation attempts and their recorded prompts, parameters, ordered reference images, generator identity, and model. The card marks the generator as unrecorded when both its title and ID are absent. Changed inputs mark older results; changed adopted versions or sequence mark the exported film as needing an update. The film lists its recorded input versions. Generate missing shots starts a persisted Host-owned batch and skips completed video results. Closing the page stops observation while the batch continues. Pause and cancel wait for the current shot before stopping remaining work; explicit continuation after a Host restart submits only pending shots. Unconfirmed submissions require review and are never automatically retried. Batch observation uses the configurable batchPollIntervalMs cadence. Media loads on request into a native video player with a download link. Assemble and export requires a completed adopted video for every saved shot; Host configuration determines export availability. The film card reports the latest export attempt separately from any retained previous successful film.

Export project package transfers the saved project and its media in bounded chunks and provides a local download. To restore without a model call, select a Workspace, choose New Session, and open **Video creation** without sending a message. Restore project and media accepts that package only in an empty current Session and does not overwrite another project. Upload and download report byte progress and can be cancelled. Restored generation requirements remain visible; Restore capability settings is a separate explicit action that applies declarative settings without installing or starting engines. Browser package downloads are assembled into a complete Blob before saving.

Successful `generate_video` tool results also offer an inline video preview and download without creating a production project. The Session log authorizes those media reads; failed results and malformed metadata retain their textual result without a preview.

The video creation controls in the conversation composer offer the native video models configured for this tool. An explicit selection applies to subsequent tool calls in the same Session. With a single configured model, that model is shown by default.

## Understand the implementation

The plugin mounts its generated Remote namespace and registers a `studio` workbench for video. A Session-bound controller publishes project and operation snapshots through an injected framework hook. Components receive localized copy, callbacks, and a declared canvas store; they do not receive Cordis Context or subscribe to external sources.

Media reads are authorized by the Host project and fetched in bounded byte slices. The browser coalesces duplicate reads, checks byte-offset progress, and creates one Blob URL per attachment. Reconnection revokes those URLs and prevents earlier requests from publishing into the replacement connection. Plugin disposal first waits for active operations, media reads, and transfer cleanup, then revokes URLs and unmounts its Remote namespace.

A Host-backed directory retains saved project titles for Sessions without chat messages. It queries Session identities in batches of at most 256, updates from committed project responses, and rebuilds after reconnect. The Workspace presentation contribution makes those projects visible and searchable without changing conversation metadata.

While loaded, this feature prevents New Session from reusing a Session with a saved project or active project operation; other candidates receive an authoritative Host project check. It does not create chat messages to mark project use.

Editing stages a revision-fenced draft. Generation, ordering, and export require saved values, so a visible draft cannot accidentally generate from different Host values. A server revision conflict retains the draft and offers a refresh.

## Model Experience

Indirectly, through the video production service's model-facing tools; the workspace adds no prompt sections or tool schemas.

#### KV Cache effect

Canvas viewing state has no model-context effect. Project edits reach model context only when a subsequent logged tool operation reads them.

## Known Limitations and Deferred Work

- **Clip editing uses inspector controls.** Trim start/end, original audio volume and timed literal captions apply during film export; source videos remain intact. A full multitrack timeline, transitions, waveform editing, voice synthesis and music mixing remain separate capabilities.
- **Playback buffers one requested media object.** Transport is chunked, while the browser assembles the full object before playback; it does not stream playback from the Host filesystem.
- **Project updates are request-driven.** Refresh reads changes from another client; this package does not subscribe to a project change stream.

<a id="dev-note"></a>
### Dev Note

None.
