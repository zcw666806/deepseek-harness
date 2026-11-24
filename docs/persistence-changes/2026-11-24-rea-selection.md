---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-24-rea-selection

English | [中文](2026-11-24-rea-selection.zh.md)

## Summary

Records the REA launcher selection for newly created opted-in Web sessions.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-24-rea-selection
baseline: false
changes:
  - root: "event:rea-experiment/selected"
    previous: null
    after: "b7db016f7c5cc71d209273d9042d1a79ada5fcf2fa20cfec95d5980546605d06"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Sessions without a selection keep the previous behavior. The new reader preserves the selected launcher when restoring or forking an opted-in session. A version 4 reader without REA refuses the unknown required event before resuming or changing the session. The event uses no ignorable marker because silently dropping it would change the tools available during replay. The writer version stays 4.

<a id="verification"></a>
## Verification

The current REA and video tool fixtures passed 20 tests. The previous build passed 21 storage contract and current event admission tests, including refusal of unknown required events before adoption.

<a id="dev-note"></a>
## Dev Note

None.
