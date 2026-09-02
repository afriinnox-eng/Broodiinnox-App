import json
import sys
import time
import urllib.error
import urllib.request

API = "https://api.render.com/v1"
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


# 1. delete the misconfigured broodiinnox-app service (created without build settings)
_, svcs = req("GET", "/services?limit=100")
for item in svcs:
    s = item.get("service") or item
    if s.get("name") == "broodiinnox-app":
        code, _ = req("DELETE", f"/services/{s['id']}")
        print(f"deleted misconfigured service {s['id']} -> HTTP {code}")

# 2. create from blueprint (render.yaml in the repo)
code, out = req("POST", "/blueprints", {
    "name": "broodiinnox-blueprint",
    "repo": "https://github.com/afriinnox-eng/Broodiinnox-App",
    "branch": "main",
    "autoDeploy": "yes",
})
print("blueprint create ->", code, json.dumps(out)[:400] if out else "")

# 3. poll for the service + a live deploy
svc_id = None
for attempt in range(40):
    time.sleep(15)
    _, svcs = req("GET", "/services?limit=100")
    svc = next(((s.get("service") or s) for s in svcs if (s.get("service") or s).get("name") == "broodiinnox-app"), None)
    if svc:
        svc_id = svc["id"]
        sd = svc.get("serviceDetails") or {}
        print(f"  [{attempt}] found service {svc_id} buildCommand={sd.get('buildCommand')!r} publishPath={sd.get('publishPath')!r} url={sd.get('url')}")
        _, deploys = req("GET", f"/services/{svc_id}/deploys?limit=3")
        for item in deploys or []:
            d = item.get("deploy") or item
            print(f"      deploy {d.get('id')} {d.get('status')}")
            if d.get("status") == "live":
                print("LIVE", sd.get("url"))
                sys.exit(0)
print("blueprint did not produce a live service in time")
sys.exit(1)
