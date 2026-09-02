import json
import sys
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


def brief(out):
    svc = (out or {}).get("service") or out or {}
    sd = svc.get("serviceDetails") or {}
    return f"bc={sd.get('buildCommand')!r} pub={sd.get('publishPath')!r}"

# create with nested serviceDetails
code, out = req("POST", "/services", {
    "type": "static_site", "name": "probe-brd4", "ownerId": OWNER,
    "repo": "https://github.com/afriinnox-eng/Broodiinnox-App", "branch": "main", "autoDeploy": "yes",
    "serviceDetails": {"buildCommand": "npm ci && npm run build", "publishPath": "dist"},
})
print("create(nested sd) ->", code, brief(out))
svc_id = (out or {}).get("service", {}).get("id")

if svc_id:
    code, out = req("PATCH", f"/services/{svc_id}", {
        "buildCommand": "npm ci && npm run build", "publishPath": "dist",
    })
    print("patch(flat) ->", code, brief(out))
    code, out = req("PATCH", f"/services/{svc_id}", {
        "serviceDetails": {"buildCommand": "npm ci && npm run build", "publishPath": "dist"},
    })
    print("patch(nested sd) ->", code, brief(out))
    code, out = req("PATCH", f"/services/{svc_id}", {
        "staticSiteDetails": {"buildCommand": "npm ci && npm run build", "publishPath": "dist"},
    })
    print("patch(staticSiteDetails) ->", code, brief(out))
    req("DELETE", f"/services/{svc_id}")
    print("probe deleted")
