import json
import urllib.request

spec = json.loads(urllib.request.urlopen("https://api-docs.render.com/openapi.json", timeout=60).read().decode())

svc_paths = [p for p in spec.get("paths", {}) if "services" in p]
for p in svc_paths:
    print("PATH", p, list(spec["paths"][p].keys()))

post = spec["paths"].get("/services", {}).get("post", {})
print("POST /services exists:", bool(post))
if post:
    rb = post.get("requestBody", {})
    print(json.dumps(rb, indent=1)[:4000])

schemas = spec.get("components", {}).get("schemas", {})
for name in schemas:
    if "PATCH" in name or name in ("servicePOST", "servicePUT", "staticSiteDetails"):
        print("SCHEMA", name)
        print(json.dumps(schemas[name], indent=1)[:2500])
