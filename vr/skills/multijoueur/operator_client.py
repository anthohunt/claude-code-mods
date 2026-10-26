"""Pilote un Meta XR Operator via le proxy officiel de Meta (stdio JSON-RPC), en visant le port d'un joueur."""
import json, os, subprocess, threading, queue

PROXY = os.path.join(os.environ["APPDATA"], "metavr", "tools", "meta-xr-operator",  # proxy du compte courant
                     "meta-xr-operator-standalone-public", "windows", "meta-xr-operator-mcp-proxy.exe")

class OperatorClient:
    def __init__(self, port, timeout=40):
        self.timeout = timeout
        self.p = subprocess.Popen([PROXY, f"http://127.0.0.1:{port}"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, text=True, encoding="utf-8", bufsize=1)
        self.q = queue.Queue(); self._id = 0
        threading.Thread(target=self._read, daemon=True).start()
        self.call("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "juge-duo", "version": "1"}})
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def _read(self):
        for line in self.p.stdout:
            line = line.strip()
            if line.startswith("{"): self.q.put(json.loads(line))

    def _send(self, msg):
        self.p.stdin.write(json.dumps(msg) + "\n"); self.p.stdin.flush()

    def call(self, method, params=None):
        self._id += 1; mid = self._id
        self._send({"jsonrpc": "2.0", "id": mid, "method": method, "params": params or {}})
        while True:
            msg = self.q.get(timeout=self.timeout)
            if msg.get("id") == mid:
                if "error" in msg: raise RuntimeError(msg["error"])
                return msg["result"]

    def tool(self, name, **args):
        import time
        for _ in range(30):  # le proxy met quelques secondes à joindre le serveur de l'app
            try: return self.call("tools/call", {"name": name, "arguments": args})
            except RuntimeError as e:
                if "offline" not in str(e): raise  # seul le serveur pas encore joint se retente
                time.sleep(1)
        raise RuntimeError("serveur Operator injoignable")

    def close(self):
        try: self.p.stdin.close(); self.p.wait(5)
        except Exception: self.p.kill()
