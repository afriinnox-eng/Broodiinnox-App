import json
import urllib.error
import urllib.request

API = "https://api.render.com/v1"
KEY = open(r"C:\Users\CLAUDE\Desktop\Tech Projects\render_api.txt").read().strip().split("=", 1)[1].strip()
SVC = "srv-dabm1igjo6nc7385n440"


def req(method, path):
    r = urllib.request.Request(f"{API}{path}", method=method, headers={"Authorization": f"Bearer {KEY}"})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


code, raw = req("GET", f"/services/{SVC}")
svc = json.loads(raw)
print("service:", json.dumps({
    "id": svc.get("id"), "name": svc.get("name"),
    "serviceDetails": svc.get("serviceDetails"),
}, indent=1)[:1200])

code, raw = req("GET", f"/services/{SVC}/deploys?limit=5")
deploys = json.loads(raw)
for item in deploys:
    d = item.get("deploy") or item
    commit = (d.get("commit") or {}).get("message", "")[:60]
    print("deploy:", d.get("id"), d.get("status"), "trigger:", d.get("trigger"), "commit:", commit, "started:", d.get("startedAt"), "finished:", d.get("finishedAt"))
