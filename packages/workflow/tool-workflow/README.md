---
description: "The model-facing workflow tool: run a JavaScript orchestration script that fans out subagents, for users and maintainers choosing or configuring model-driven orchestration."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-workflow

English | [中文](README.zh.md)

## Summary

`dsh-tool-workflow` lets the model coordinate many subagents with a JavaScript script and collect its final JSON value. Foreground calls wait for completion; `run_in_background: true` returns a job id so the parent can continue other work. Background calls require the jobs service and job-control tools. Choose it when the user explicitly asks for workflow-style or large multi-agent orchestration; prefer plain subagent calls for one or two delegations.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `workflow` tool runs a model-authored orchestration script that fans work out across many subagents and returns the script's final JSON value. Use it only when the user explicitly asks for a workflow or for large multi-agent orchestration — an audit over many files, a migration, multi-angle research; for one or two delegations, prefer plain subagent calls.

### Calling the tool

The model submits `meta` (required identity data: `name`, `description`, and optional `whenToUse` and `phases`), `script` (required plain JavaScript body — no `export const meta` statement; the tool description carries the complete authoring contract), optional `args` (a JSON object exposed as the script's `args` global), and optional `run_in_background`. Wrap a bare list in an `args` field.

Foreground success returns `{ runId, agentsStarted, result }`, rendered as `workflow "<name>" completed (<count> agent<optional-s>).` followed by `Return value:` and pretty-printed JSON. Background success returns `{ jobId }` immediately; `job_output` collects the final result, `job_kill` stops the workflow, and the configured job notification policy delivers unreported completion. A parse or meta validation failure returns an error without registering a job. Execution failure and cancellation report their reason; partial output is never reported as success.

### What to expect during a run

Foreground calls wait and bridge the parent step's abort signal to the workflow. Background calls transfer ownership to the parent Agent's job registry: ending the initiating step leaves the job running, while `job_kill`, Agent disposal, or job-service disposal cancels it. Every settlement awaits workflow disposal before the job reports a terminal status. The model receives the final result rather than intermediate child messages. Background jobs are process-local and do not survive process exit.

### Config

| Field | Default | Meaning |
|---|---|---|
| `toolName` | `workflow` | The model-facing tool name to register. |
| `maxResultChars` | `50000` | Rendered-result ceiling; longer JSON is truncated with a notice. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-workflow) is the exhaustive source for every accepted field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the consumer is split from the engine and how the run lifecycle and records work; observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The consumer owns the model-facing schema, the `tool:<toolName>` system-prompt guidance, and the result envelope; script parsing, execution, caps, and cancellation live behind `ctx.workflowEngine`, so a hardened engine swaps in without changing what the model sees. Usage guidance ships with the tool plugin as a prompt section, never in the deployment persona.

### Run lifecycle

Foreground execution awaits `run.result` inside a `try/finally` and bridges `exec.signal` to `run.cancel()`. Background execution starts only after `ctx.jobs.start()` admits the owner and confirms a serving controller; missing services or controllers reject before workflow startup. The producer owns run cancellation and cleanup, and its job outcome contains the bounded final text. Both routes dispose the run before reporting settlement. A cleanup failure fails the job and leaves durable workflow records without a terminal suffix.

### Durable session records

For a foreground root transport execution (`exec.parent` absent), the tool projects the run into the calling Agent's Session with four log-only events: run-start after `start()` returns, member starts and endings filtered by `run.id`, then run-end only after the result is available and disposal reaches quiescence. Background calls use the existing job controls and notifications, without creating a foreground workflow Chat record. Nested transport calls write no workflow record. The first failed append stops later recording, leaving a legal continuous prefix without changing execution or cleanup. The invariant rejects duplicate starts, unpaired members, terminal events with open members, and updates after run-end while accepting missing terminal suffixes.

### Render intent

Decided up front per the [render-intent Agent Note](../../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md): a `generic` card titled `workflow: <meta.name>`, read directly from `args.meta.name` — presentation is a pure function of args — with the script text carried as `rawInput`. The result keeps the generic card.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: tool registration, run lifecycle, recorder wiring |
| [`src/types.ts`](src/types.ts) | The four log-only record event payloads and their `SessionEventMap` declaration |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: durable workflow-record protocol validation |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the tool-level contract is not enough. They move from the shared workflow model to the engine and the comparable delegation tool.

- [Workflow subsystem](../../../docs/subsystems/workflow.md) — the seam contract, start request, and event payloads.
- [Workflow seam](../workflow/README.md) — the run and result vocabulary behind the tool.
- [Worker-thread engine](../workflow-worker-thread/README.md) — the engine that executes the scripts.
- [subagent tool](../../subagent/tool-subagent/README.md) — the plain-delegation alternative for one or two children.
- [Group map](../README.md) — the workflow capability family and its packages.
- [Dynamic workflows Agent Note](../../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md) — the seam design and its decisions.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

Every parent request in this plugin's registration scope receives the workflow guidance below. A scoped tool restriction can hide the schema without removing this independently registered guidance.

##### Workflow guidance

```markdown
Use the <toolName> tool ONLY when the user explicitly asks for a workflow or for large multi-agent orchestration: you write a JavaScript script (the tool description documents the exact format) that fans work out across many subagents with phases and structured results. For one or two delegations, prefer plain subagent calls.
```

#### Token effect

Small fixed guidance cost per request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and guidance text are unchanged. Activation or disposal may invalidate reuse from this prompt section.

### Tool schema

#### What the model sees

When visible, the generated default [`workflow` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-workflow) carries the complete JavaScript hook and metadata contract; `toolName` can rename the definition, and the model submits script, metadata, and optional args.

#### Token effect

Substantial fixed schema cost on each request where the tool is visible.

#### KV Cache effect

Prefix-stable while `toolName`, definition, and visibility are unchanged. Renaming, plugin lifecycle, or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

The full model-written script, metadata, and args remain in the assistant tool call. Foreground success is exactly `workflow "<name>" completed (<count> agent<optional-s>).`, newline, `Return value:`, newline, and pretty-printed data-dependent JSON; a cap adds `… [truncated: <omitted> more characters]` on a new line. Background start is exactly `workflow "<name>" started in background (job_id: <jobId>). Use job_output to collect the result or job_kill to stop it.` The job's final text uses the same completion rendering or reports `workflow run was cancelled`, optionally suffixed ` (<error>)`, or `workflow run failed: <error-or-unknown error>`. Foreground failures have the ordinary `Error:` prefix. Intermediate child messages are omitted; job reads and notifications follow the [job-control tool](../../jobs/tool-jobs/README.md).

#### Token effect

Call tokens can be large and remain until compaction. Result rendering is capped by `maxResultChars`; child-model tokens are separate from the parent's retained context.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the tool does not yet support. They are current constraints, not a task backlog.

- **Background jobs require a live process and controller** — accepted jobs outlive the initiating tool step, but Agent or job-service disposal cancels them. Job ids do not resume a workflow after process exit.
- **`args` must be an object and Native result text is bounded** — callers wrap top-level arrays and scalars in a field; the canonical workflow result stays complete, while JSON beyond `maxResultChars` is truncated in the model-facing projection rather than stored behind a retrieval handle.
- **Workflow policy is fixed per tool registration** — provider selection, caps, and tool name are deployment config, not model-call arguments.
- **Background progress and results use job controls** — background calls do not create a dedicated workflow timeline. Foreground timelines cover top-level calls; nested PTC calls have no independent timeline.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

Open directions: storing truncated JSON behind a retrieval handle instead of clipping the projection; recording nested dispatches beyond the top level.

</details>
