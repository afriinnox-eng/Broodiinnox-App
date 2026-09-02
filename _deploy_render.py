import json
import sys
import time
import urllib.error
import urllib.request

API = "https://api.render.com/v1"
KEY = open(r"C:\Users\CLAUDE\Desktop\Tech Projects\render_api.txt").read().strip().split("=", 1)[1].strip()
OWNER = "tea-dabesqtg1s2s73cg04e0"


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


_, svcs = req("GET", "/services?limit=100")
svc = next(((s.get("service") or s) for s in svcs if (s.get("service") or s).get("name") == "broodiinnox-app"), None)
if svc:
    print("already exists — deleting stale one")
    req("DELETE", f"/services/{svc['id']}")

body = {
    "type": "static_site",
    "name": "broodiinnox-app",
    "ownerId": OWNER,
    "repo": "https://github.com/afriinnox-eng/Broodiinnox-App",
    "branch": "main",
    "autoDeploy": "yes",
    "serviceDetails": {
        "buildCommand": "npm ci && npm run build",
        "publishPath": "dist",
    },
    "routes": [{"type": "rewrite", "source": "/*", "destination": "/index.html"}],
    "headers": [{"path": "/*", "name": "X-Frame-Options", "value": "sameorigin"}],
}
code, out = req("POST", "/services", body)
print("create ->", code)
if code not in (200, 201):
    print(json.dumps(out)[:500])
    sys.exit(1)
svc = out["service"]
svc_id = svc["id"]
sd = svc.get("serviceDetails") or {}
print(f"service id={svc_id} bc={sd.get('buildCommand')!r} pub={sd.get('publishPath')!r} url={sd.get('url')}")

for attempt in range(30):
    time.sleep(15)
    code, deploys = req("GET", f"/services/{svc_id}/deploys?limit=3")
    for item in deploys or []:
        d = item.get("deploy") or item
        print(f"  [{attempt}] {d.get('id')} {d.get('status')} trigger={d.get('trigger')}")
        if d.get("status") == "live":
            print("LIVE", sd.get("url"))
            sys.exit(0)
print("not live after ~7 minutes")
sys.exit(1)
