# Agent Note: Session-scoped REA experiment

Status: implemented

English | [中文](2026-10-22-rea-experiment.zh.md)

## Problem

A user needs to try REA's full advertised tool set from the Web assistant without hand-editing each agent preset. REA owns mutable analysis targets and local processes, so sharing one Host connection across chats can mix independent work. A global switch read on restore can also give an existing conversation tools it never selected or remove tools its history still references.

## Decision

The Host-owned `rea-experiment` settings namespace is disabled by default. Its Plugins settings card stages `enabled` together with the stdio launcher's `command`, `args`, and `toolCallTimeoutMs`. Saving validates and persists settings without starting a server. The advanced fields contain non-secret launch configuration; credentials do not belong in the command or arguments. Disabling stores only the switch and retains the saved launcher for later reuse.

A new top-level Web session samples the setting when its agent is composed. An enabled session opens an independent `dsh-mcp-client` instance with `serverName: rea` and records its selected launcher in `rea-experiment/selected` after discovery succeeds, before its first request. Every advertised tool joins that session's tool registry, with the existing MCP naming and execution rules. Initial connection or discovery failure rejects session preparation rather than publishing a chat with missing tools.

Restore and fork use the session's recorded launcher instead of current settings. A session without the selection record remains disabled. Changing or disabling the global setting affects newly created top-level sessions only; it does not stop or reconfigure a selected session. Ending that session disposes its connection. REA's browser and analysis engines remain local prerequisites, and successful tool discovery does not establish their availability.

The experiment composes interactive tools. It owns no scheduled collection, source authorization flow, incremental synchronization, or knowledge index. It contributes the fixed Host-owned `rea-external-content` prompt section: captured content is data rather than instructions, and access and actions require user authorization. A preset's complete persona suppresses that section under the existing prompt rules; REA does not override a user-selected complete prompt. The Host builds this prompt section independently of server instructions and tool result metadata.

## Alternatives considered

**One Host-wide REA connection.** Rejected because REA's active target and process lifecycle belong to an individual analysis session. Independent connections keep one chat's target selection and teardown from changing another chat.

**Read the current switch whenever a session is restored.** Rejected because a settings edit would silently alter existing conversation capabilities. A durable selection gives restore and fork the same launcher while a session without that record remains disabled.

**Curate an additional REA tool allowlist.** Rejected for this experiment because the user selects the complete advertised tool set. The existing tool executor and configured approval policy still own calls; tool filtering is not added as a second enablement decision.

**Connect when settings are saved.** Rejected because a successful shared probe cannot establish that a later session's independent server or required engines will work. Save owns configuration, and session preparation owns connection success.

## Consequences

The default deployment starts no REA process. Each opted-in session pays its own startup and process cost, and all advertised schemas add tokens to that session's model requests. Startup errors appear when that session is created or restored; saving the card cannot prove runtime readiness.

An opted-in session retains its launch configuration even after the global switch is disabled, including when restored or forked. Stopping REA for existing work requires ending the corresponding session. The durable event has no credential fields, but it makes the selected executable and arguments part of session data; users must keep credentials out of those values.

## Verification

The keyless [Web recorded-session scenario](../../../../apps/web/tests/rea-experiment.snapshot.ts) creates a session through the shipped Session API against a scenario-owned stdio server. Its recording pins the selected launcher, full advertised tool catalog, external-content prompt, and executed tool result; disabling the setting removes REA from a later session while preserving the selected session's tools. The scenario uses a portable persona-only preset and does not verify real REA engines or remote data access.

## Related decisions

The [MCP client plugin](../../../../packages/mcp/mcp-client/README.md) still owns bridge naming and result projection, and [plugin-owned settings](../../../../packages/settings/settings/README.md) still owns namespace-to-card dispatch. The [user-authorized subagent model routes](2026-08-24-user-authorized-subagent-model-routes.md) retain their independent authorization and durable selection rules; REA does not change model routing.
