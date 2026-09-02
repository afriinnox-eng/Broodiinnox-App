import json
import sys
import time
import urllib.error
import urllib.request

API = "https://api.render.com/v1"
SVC = "srv-dabs4a67bikc73e3uma0"
KEY = open(r"C:\Users\CLAUDE\Desktop\Tech Projects\render_api.txt").read().strip().split("=", 1)[1].strip()

for attempt in range(6):
    time.sleep(14)
    r = urllib.request.Request(f"{API}/services/{SVC}/deploys?limit=3", headers={"Authorization": f"Bearer {KEY}"})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            deploys = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print("poll err", e.code)
        continue
    for item in deploys:
        d = item.get("deploy") or item
        print(f"[{attempt}] {d.get('id')} {d.get('status')} trigger={d.get('trigger')} finished={d.get('finishedAt')}")
        if d.get("status") == "live":
            print("LIVE")
            sys.exit(0)
        if d.get("status") == "deploy_failed":
            print("DEPLOY FAILED — inspect dashboard")
            sys.exit(2)
print("still building")
sys.exit(1)
