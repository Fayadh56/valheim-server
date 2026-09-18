#!/usr/bin/env python3
"""Follow the Valheim container log and publish who is online to an SSM parameter."""
import json
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone

RE_START = re.compile(r"Valheim version:")
RE_CONNECT = re.compile(r"Got connection SteamID (\d+)")
RE_CHARACTER = re.compile(r"Got character ZDOID from (.+?) : ")
RE_CLOSE = re.compile(r"Closing socket (\d+)")


class Roster:
    def __init__(self):
        self.reset()

    def reset(self):
        self.pending = []
        self.names = {}

    def feed(self, line):
        """Apply one log line. Returns True when the set of online players changed."""
        if RE_START.search(line):
            had_players = bool(self.names)
            self.reset()
            return had_players
        match = RE_CONNECT.search(line)
        if match:
            self.pending.append(match.group(1))
            return False
        match = RE_CHARACTER.search(line)
        if match:
            name = match.group(1).strip()
            # a death or respawn logs the same line again; only a new name consumes a queued connection
            if name in self.names.values() or not self.pending:
                return False
            self.names[self.pending.pop(0)] = name
            return True
        match = RE_CLOSE.search(line)
        if match:
            steam_id = match.group(1)
            if steam_id in self.pending:
                self.pending.remove(steam_id)
            return self.names.pop(steam_id, None) is not None
        return False

    def players(self):
        return sorted(self.names.values(), key=str.lower)


def payload(roster):
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return json.dumps({"players": roster.players(), "updatedAt": now})


def publish(roster, parameter, region):
    command = ["aws", "ssm", "put-parameter", "--name", parameter, "--type", "String",
               "--overwrite", "--value", payload(roster), "--region", region]
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=30)
    except Exception as error:  # best effort: the next change or heartbeat retries
        print(f"publish failed: {error}", file=sys.stderr, flush=True)


def follow(parameter, region):
    roster = Roster()
    lock = threading.Lock()

    def heartbeat():
        while True:
            time.sleep(60)
            with lock:
                publish(roster, parameter, region)

    threading.Thread(target=heartbeat, daemon=True).start()
    process = subprocess.Popen(["docker", "logs", "-f", "valheim"], stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, errors="replace")
    for line in process.stdout:
        with lock:
            if roster.feed(line):
                publish(roster, parameter, region)
    return process.wait()


def replay():
    roster = Roster()
    for line in sys.stdin:
        roster.feed(line)
    print(json.dumps({"players": roster.players()}))


if __name__ == "__main__":
    if "--replay" in sys.argv:
        replay()
    elif len(sys.argv) == 3:
        sys.exit(follow(sys.argv[1], sys.argv[2]))
    else:
        print("usage: valheim-players <parameter-name> <region> | --replay", file=sys.stderr)
        sys.exit(2)
