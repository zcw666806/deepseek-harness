# Agent Note: Route video generation through its tool

Status: implemented

English | [中文](2026-10-19-video-generation-routing.zh.md)

## Problem

A persisted session selects `grok-imagine-video-1.5` as its conversational model and receives `400 INVALID_REQUEST` or missing-`finish_reason` errors through chat completions. The same session saves a six-second MP4 through `generate_video` after selecting `grok-4.7`. Video output capability does not imply chat completion support.

## Decision

Models declaring `video` output are tool targets. Conversational model lists exclude them, and the chat executor rejects direct selection with instructions to choose a chat model and use `generate_video`. Filtering alone cannot protect callers that already hold a model id.

Video execution captures current profiles and attachment storage when the tool starts. It resolves the target model's endpoint and provider authentication, preserves custom headers, and sends download credentials only to the API origin. Provider JSON is validated before use. Submission, cancellable polling, and download share one total deadline; provider configuration owns polling interval and timeout.

## Alternatives considered

- Treat video output as chat capability: rejected because the generation API returns an asynchronous job rather than chat completion chunks.
- Fix only the selector: rejected because saved selections and direct callers can bypass it.
- Authenticate every returned download URL: rejected because a provider response can point to another origin and disclose credentials.

## Consequences

A conversational model can invoke video generation without using a video model for chat. Execution waits for generation and attachment storage, bounded by cancellation and timeout. This decision does not add playback or artifact preview UI.

## Verification

The opt-in [live-provider test](../../../../packages/llm/llm-pi-ai/tests/video.e2e.ts) passes with a one-second, 480p generation request. It downloads the result, reads it back from local attachment storage, and verifies the encoded byte count and MP4 signature. Automatic retries are disabled for this billable test.

Focused runs pass: [protocol tests](../../../../packages/llm/llm-pi-ai/tests/video.spec.ts) cover generation, validation, cancellation, timeout, and download authentication; [routing](../../../../packages/llm/llm-pi-ai/tests/video-routing.spec.ts) and [adapter tests](../../../../packages/llm/llm-pi-ai/tests/adapter.spec.ts) cover video-target selection and chat rejection. [Configuration](../../../../packages/llm/llm-pi-ai/tests/config.spec.ts), [catalog](../../../../packages/llm/llm-pi-ai/tests/catalog.spec.ts), and [dynamic-settings tests](../../../../packages/llm/llm-pi-ai/tests/dynamic-config.spec.ts) cover defaults, bounds, output declarations, and per-operation settings.
