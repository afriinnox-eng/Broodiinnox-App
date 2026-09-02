import json
import sys
import urllib.error
import urllib.request

API = "https://api.render.com/v1"
KEY = open(r"C:\Users\CLAUDE\Desktop\Tech Projects\render_api.txt").read().strip().split("=", 1)[1].strip()

body = {
    "type": "static_site",
    "name": "broodiinnox-app",
    "ownerId": "tea-dabesqtg1s2s73cg04e0",
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
data = json.dumps(body).encode()
req = urllib.request.Request(
    f"{API}/services", data=data, method="POST",
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"},
)
try:
    with urllib.request.urlopen(req, timeout=90) as resp:
        out = json.loads(resp.read().decode())
        svc = out["service"]
        sd = svc.get("serviceDetails") or {}
        print("created id=", svc["id"], "bc=", sd.get("buildCommand"), "pub=", sd.get("publishPath"), "url=", sd.get("url"))
except urllib.error.HTTPError as e:
    print("ERR", e.code, e.read().decode()[:300])
    sys.exit(1)
