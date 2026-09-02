import json
import sys
import time
import urllib.error
import urllib.request

API = "https://api.render.com/v1"
SVC = "srv-dabm1igjo6nc7385n440"
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


code, out = req("PATCH", f"/services/{SVC}", {
    "buildCommand": "npm ci && npm run build",
    "publishPath": "dist",
    "routes": [{"type": "rewrite", "source": "/*", "destination": "/index.html"}],
    "headers": [{"path": "/*", "name": "X-Frame-Options", "value": "sameorigin"}],
})
print("patch ->", code)
sd = (out or {}).get("serviceDetails") or {}
print("  buildCommand:", repr(sd.get("buildCommand")))
print("  publishPath :", repr(sd.get("publishPath")))

code, out = req("POST", f"/services/{SVC}/deploys", {})
print("deploy ->", code, "id=", (out or {}).get("id"))

for attempt in range(40):
    time.sleep(15)
    code, deploys = req("GET", f"/services/{SVC}/deploys?limit=3")
    for item in deploys or []:
        d = item.get("deploy") or item
        print(f"  [{attempt}] {d.get('id')} {d.get('status')}")
        if d.get("status") == "live":
            code, s2 = req("GET", f"/services/{SVC}")
            s = s2.get("service") or s2
            url = (s.get("serviceDetails") or {}).get("url")
            print("LIVE", url)
            sys.exit(0)
print("not live")
sys.exit(1)
