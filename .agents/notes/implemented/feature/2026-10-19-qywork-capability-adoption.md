# Agent Note: Reuse Harness services for qywork-derived capabilities

Status: implemented

English | [中文](2026-10-19-qywork-capability-adoption.zh.md)

## Problem

Qywork combines useful capabilities with features Harness already provides. Importing its application would duplicate execution, storage, permissions, and presentation. The reference is clean [qywork revision bd11cbe74d56a2031f9c5476de79d64d46ea410a](https://github.com/qingxueyanshang/qywork-qingyan-harness/tree/bd11cbe74d56a2031f9c5476de79d64d46ea410a); existing Harness packages own adopted behavior.

## Decision

**On-demand MCP resources.** `dsh-mcp-client` exposes server-qualified list/read operations when a server advertises resources, including servers without tools. Listing returns one page and its opaque continuation cursor; reading returns ordered text and resource identity. Binary blobs produce an omission indication without retaining base64 in canonical results or model history. Calls use the existing SDK, tool policy, cancellation, timeout, and connection lifecycle. Resources are not eagerly injected. Resource templates and prompts remain unsupported. The reference is [qywork resource consumption](https://github.com/qingxueyanshang/qywork-qingyan-harness/blob/bd11cbe74d56a2031f9c5476de79d64d46ea410a/packages/mcp/src/resources.ts).

**Background workflows through jobs.** `workflow` accepts `run_in_background`; admitted work returns a job id and continues independently of the initiating tool signal. Existing job notifications, `job_output`, and `job_kill` own observation, collection, and cancellation. Background runs do not append the foreground `tool-workflow/*` timeline: its step-closure interpretation would present ongoing work as interrupted. Foreground recording remains available. Jobs are process-local, with no journal or restart-resume promise. Qywork's [orchestrator](https://github.com/qingxueyanshang/qywork-qingyan-harness/blob/bd11cbe74d56a2031f9c5476de79d64d46ea410a/packages/team/src/orchestrator.ts) supplies comparison evidence, not a replacement engine.

**Preserve unmatched local file endings.** `dsh-fs-local` matches literal LF-normalized text while mapping matched ranges into the original file. Only replacement spans change; their newlines use the dominant file style, with LF on ties. Diff text remains normalized. Existing locks, observation/version checks, atomic writes, and literal ambiguity errors retain ownership. This adopts the behavior illustrated by [qywork editing · tools/src/files.ts](https://github.com/qingxueyanshang/qywork-qingyan-harness/tree/bd11cbe74d56a2031f9c5476de79d64d46ea410a), without importing its filesystem implementation.

## Comparison

| Area | Existing Harness capability | Adoption or remaining difference |
|---|---|---|
| Models, context, skills | Multi-provider routes, compaction, spill, session search, layered skill catalogs | Retained; these are not newly imported features. |
| MCP resources | SDK connection, remote tools, reconnect | List/read selected; templates/prompts and binary delivery excluded. |
| Workflow execution | Script orchestration, continuable children, jobs | Background selected; persistent review/checkpoint graphs remain distinct. |
| Local editing | Literal edit, stale guard, atomic write | Mixed LF/CRLF preservation selected. |
| Long-term memory | AGENTS instructions and [external memory MCP examples](2026-07-31-third-party-memory-mcp-examples.md) | Built-in project/global memory CRUD and management remain gaps; see [qywork memory · tools/src/memory.ts](https://github.com/qingxueyanshang/qywork-qingyan-harness/tree/bd11cbe74d56a2031f9c5476de79d64d46ea410a). |
| Skill import | Filesystem discovery and on-demand loading | Transactional directory/ZIP import remains separate; see [qywork installer · tools/src/skills/install.ts](https://github.com/qingxueyanshang/qywork-qingyan-harness/tree/bd11cbe74d56a2031f9c5476de79d64d46ea410a). |
| Calendar schedules | Durable same-session one-shot/fixed-interval reminders | Daily calendar rules and project scheduling differ; see [qywork schedules](https://github.com/qingxueyanshang/qywork-qingyan-harness/blob/bd11cbe74d56a2031f9c5476de79d64d46ea410a/packages/core/src/domain/schedule.ts). |
| External CLI continuation | ACP delegation and in-process continuation | Vendor CLI session-id resume remains separate; see [qywork backend](https://github.com/qingxueyanshang/qywork-qingyan-harness/blob/bd11cbe74d56a2031f9c5476de79d64d46ea410a/packages/team/src/cli-backend.ts). |
| Workbench | ZIP exports, plugin settings, deterministic skill loading, [deliverable references](../../../../packages/client/ui-deliverables/README.md) | [Inline media preview](https://github.com/qingxueyanshang/qywork-qingyan-harness/blob/bd11cbe74d56a2031f9c5476de79d64d46ea410a/apps/web/src/components/FileView.tsx), lazy file-tree editing, and dedicated import pages remain distinct. |
| Desktop browser, native automation, Office | Generic subprocess/MCP integration | CDP/native control and [Office tools · tools/src/office.ts](https://github.com/qingxueyanshang/qywork-qingyan-harness/tree/bd11cbe74d56a2031f9c5476de79d64d46ea410a) need dedicated services, configuration, permissions, and tests; not adopted. |

## Alternatives considered

**Copy the application or create parallel services.** Rejected because Bun/Tauri integration, storage tables, and vendor adapters would introduce competing lifecycle and authority owners.

**Import every identified difference.** Rejected because calendar rules, managed memory, package installation, persistent review, and host automation need independent ownership and permission decisions. Unicode-aware estimates also require respecting the [replay token-meter decision](../architecture/2026-07-15-replay-token-meter-service.md); provider usage anchors already mitigate historical estimation error.

**Extend the workflow timeline for background runs.** Rejected for this scope: existing jobs already expose control and completion without changing the durable workflow/UI protocol.

## Consequences

Three bounded capabilities reuse established services. Background workflows trade a dedicated member timeline and restart recovery for existing job controls. Binary resources remain explicitly unreadable through these operations. The [MCP client](2026-07-07-mcp-client-plugin.md), [dynamic workflows](2026-07-05-dynamic-workflows.md), and [filesystem schemas](2026-06-17-filesystem-tool-schemas.md) remain partial owners of transport, script, and observation rules; none is fully superseded or archived.

## Verification

Coverage includes resource-only Loader composition/disposal, pagination, text order, binary omission, malformed responses, policy denial, and cancellation; background admission, outcomes, cancellation, owner disposal, and cleanup failure; mixed endings, multiline/repeated matches, metacharacters, lone carriage returns, and large search spans. Recorded-session snapshots provide evidence for model-visible tool changes.
