"""Forward a canonical recording as SDK notifications without running its tools."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


events = [
    record
    for line in Path(os.environ["SDK_RECORDED_SESSION"]).read_text(encoding="utf-8").splitlines()
    if (record := json.loads(line))["type"] != "session"
]
receipt = next(
    event for event in events
    if event["type"] == "agent/inbox/spliced" and event["data"].get("inserted")
)
message_id = receipt["data"]["inserted"][0]["id"]


def send(message: dict[str, object]) -> None:
    print(json.dumps(message), flush=True)


for line in sys.stdin:
    request = json.loads(line)
    method = request["method"]
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": request["id"], "result": {"serverInfo": {"name": "recorded-session-peer", "version": "1"}}})
    elif method == "session/prompt":
        session_id = request["params"]["sessionId"]
        for seq, event in enumerate(events):
            send({"jsonrpc": "2.0", "method": "session.event", "params": {"sessionId": session_id, "event": {**event, "seq": seq, "time": 0}}})
        send({"jsonrpc": "2.0", "method": "session.status", "params": {"sessionId": session_id, "status": "idle"}})
        send({"jsonrpc": "2.0", "id": request["id"], "result": {"messageId": message_id}})
    elif method == "shutdown":
        send({"jsonrpc": "2.0", "id": request["id"], "result": {}})
        break
