"""Python SDK projections of the canonical Web-owned REA session."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from deepseek_harness import DeepSeekHarness, Notification


def test_rea_selection_is_raw_setup_evidence_outside_the_owned_turn(tmp_path: Path) -> None:
    tests = Path(__file__).resolve().parent
    source = tests.parents[2] / "snapshots" / "web" / "rea-experiment" / "session.jsonl"
    observed: list[Notification] = []
    with DeepSeekHarness(
        _launch_args=(sys.executable, str(tests / "fixtures" / "recorded_web_session_runtime.py")),
        cwd=str(tmp_path),
        env={"SDK_RECORDED_SESSION": str(source)},
    ) as harness:
        with harness.client.subscribe_notifications() as subscription:
            result = harness.run("Project the recorded Web turn.", session_id="rea-projection")
            subscription.drain(observed.append)

    raw_events = [notification.payload["event"] for notification in observed if notification.method == "session.event"]
    projection = {
        "selectionData": [event["data"] for event in raw_events if event["type"] == "rea-experiment/selected"],
        "rawEventTypes": [event["type"] for event in raw_events],
        "eventTypes": [event["type"] for event in result.events],
        "finalResponse": result.final_response,
        "finishReason": result.finish_reason,
    }
    expected = json.loads((tests / "expected" / "rea-experiment-projection.json").read_text(encoding="utf-8"))
    assert projection == expected
