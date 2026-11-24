# Agent Note: Live model listing as a user command

Status: implemented

English | [中文](2026-11-23-live-model-listing-command.zh.md)

## Problem

A user who asks an agent which models their saved API key can access can trigger many inference and tool steps before receiving a list. The configured model picker and installed adapter catalog describe routes and model metadata. Neither establishes what the saved connection reports today.

## Decision

The [Session Controller](../../../../packages/api/session-controller/README.md) registers `/models` when human commands are available. Only the owner can query the provider selected for the session's next request. The [LLM service](../../../../packages/llm/llm/README.md) applies one deadline to credential resolution and listing, and the adapter uses the saved endpoint and authentication. The result goes through the human command log.

## Alternatives considered

**Invoke a model-facing tool or shell command.** Both paths can add model rounds for a deterministic lookup. The shell path also lacks the adapter's route and credential resolution.

**Return the picker catalog.** An installed or locally configured list can differ from the provider's response, so the command reports the live listing or a failure.

## Consequences

Supported providers receive one directory request per command. Callers can distinguish empty listings from refusals and timeouts. The returned IDs reflect the provider's listing and do not establish inference access.
