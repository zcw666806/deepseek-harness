# Agent Note: User approval of reviewed plugin artifacts

Status: implemented

English | [中文](2026-10-26-plugin-review-workflow.zh.md)

## Problem

Selecting an assistant capability can lead an agent to install or execute third-party code before the user has seen its access requirements or a review of the deployed files. An installation request does not identify the artifact, dependencies, scripts, and configuration changes that the user is being asked to trust.

## Decision

The project [plugin review skill](../../../skills/dsh-plugin-review/SKILL.md) prioritizes existing callable capabilities and requires a review report followed by explicit user approval before installing or executing new plugin code. Automatic discovery remains enabled. The report identifies the artifact, dependencies, destination, intended actions, evidence, and unresolved risks; approval remains valid for the same object and actions, while material changes require an updated review and approval.

Read-only acquisition and inspection precede approval. Dependency installation, build scripts, candidate-provided scanners, local MCP startup, and activation through configuration or dynamic plugins cannot bypass it. Existing callable tools remain usable within the user's current authorization without repeating installation reviews.

The [profile bundle decision](../architecture/2026-08-05-profile-plugin-bundles.md) continues to own composition and installation mechanics, and the [pnpm decision](../../../../docs/development.md) continues to own the repository package manager and build-script policy. This skill adds an agent workflow without superseding those decisions or changing the installer.

## Alternatives considered

**Install first with scripts disabled.** This still installs code before the user's required review and approval, and does not prevent later execution when the plugin loads.

**Accept a clean vulnerability scan as approval.** Known-vulnerability reports neither authorize execution nor establish the absence of malicious behavior in deployed code.

**Require confirmation for every existing tool call.** Repeated confirmation does not review new code and obstructs authorized use of the capabilities already available to the session.

## Consequences

The user can approve a concrete artifact and execution scope, and the agent can continue unchanged approved work without another confirmation. Incomplete evidence remains visible instead of becoming a claim that a plugin has no backdoor.

The skill governs agent behavior; it does not add a runtime installation blocker or isolate loaded plugin code. Environments without the skill loaded retain their existing behavior. Runtime enforcement requires a separate implementation decision.
