import urllib.request

BASE = "https://broodiinnox-app.onrender.com"
for path in ["/", "/farmer/dashboard", "/admin/dashboard"]:
    try:
        with urllib.request.urlopen(BASE + path, timeout=60) as r:
            body = r.read().decode("utf-8", "ignore")
            print(
                path, "->", r.status,
                "len", len(body),
                "| Broodiinnox title:", "Broodiinnox" in body,
                "| app root:", 'id="root"' in body,
            )
    except Exception as e:  # noqa: BLE001
        print(path, "-> ERROR", e)
