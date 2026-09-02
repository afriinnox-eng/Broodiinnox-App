import json
import sys
import urllib.error
import urllib.request

API = "https://api.render.com/v1"
SVC = "srv-dabs4a67bikc73e3uma0"
KEY = open(r"C:\Users\CLAUDE\Desktop\Tech Projects\render_api.txt").read().strip().split("=", 1)[1].strip()


def req(method, path, body=None):
    headers = {"Authorization": f"Bearer {KEY}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(f"{API}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        return e.code, (json.loads(raw) if raw else {"raw": raw})


routes = [{"type": "rewrite", "source": "/*", "destination": "/index.html"}]
headers = [{"path": "/*", "name": "X-Frame-Options", "value": "sameorigin"}]

# try top-level first, then nested in serviceDetails
for label, body in [
    ("flat", {"routes": routes, "headers": headers}),
    ("nested", {"serviceDetails": {"routes": routes, "headers": headers}}),
]:
    code, out = req("PATCH", f"/services/{SVC}", body)
    print("patch", label, "->", code)
    code, out = req("GET", f"/services/{SVC}")
    s = out.get("service") or out
    print("  routes:", json.dumps(s.get("routes"))[:200])
    print("  headers:", json.dumps(s.get("headers"))[:200])
    sd = s.get("serviceDetails") or {}
    print("  sd keys:", list(sd.keys()))
    if s.get("routes") or s.get("headers"):
        print("applied with", label)
        break
