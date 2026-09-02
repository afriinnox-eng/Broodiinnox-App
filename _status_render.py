import json
import urllib.error
import urllib.request

API = "https://api.render.com/v1"
KEY = open(r"C:\Users\CLAUDE\Desktop\Tech Projects\render_api.txt").read().strip().split("=", 1)[1].strip()


def req(path):
    r = urllib.request.Request(f"{API}{path}", headers={"Authorization": f"Bearer {KEY}"})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


code, out = req("/blueprints?limit=20")
print("blueprints ->", code)
for b in out if isinstance(out, list) else []:
    print(" ", b.get("id"), b.get("name"), "status=", b.get("status"), "repo=", b.get("repo"))
