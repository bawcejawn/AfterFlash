"""Browser test of PhotoShare Cloud: buy a key, connect Google Drive, run an event, recover a key,
owner tools. Google and Stripe pages are simulated by cloud/test/server.mjs.
Run: node cloud/test/server.mjs 8788 & python3 cloud/test/e2e.py
"""
import os, re, sys, json, time, urllib.request
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE", "http://localhost:8788")
OWNER_KEY = open("/tmp/photoshare-owner-key").read().strip()
SHOTS = os.environ.get("SHOTS", "/tmp/ps-cloud-shots")
os.makedirs(SHOTS, exist_ok=True)
errors = []


def watch(page, name):
    page.on("console", lambda m: m.type == "error" and errors.append(f"[{name}] console.error: {m.text}"))
    page.on("pageerror", lambda e: errors.append(f"[{name}] pageerror: {e}"))


def wait_js(page, expr, timeout=15000):
    """Poll an expression (wait_for_function would need unsafe-eval under our CSP)."""
    end = time.time() + timeout / 1000
    while time.time() < end:
        if page.evaluate(expr):
            return
        time.sleep(0.25)
    raise AssertionError("timed out waiting for: " + expr)


def fake_google(sub="google-sub-1"):
    def handler(route):
        q = parse_qs(urlparse(route.request.url).query)
        purpose = "connect" if q.get("access_type") == ["offline"] else "recover"
        route.fulfill(status=302, headers={"location": f"{BASE}/__google-consent?state={q['state'][0]}&purpose={purpose}&sub={sub}"})
    return handler


def fake_stripe(route):
    sid = urlparse(route.request.url).path.rsplit("/", 1)[-1]
    route.fulfill(status=302, headers={"location": f"{BASE}/__stripe-pay?sid={sid}"})


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"), args=[
        "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
    host = browser.new_context(viewport={"width": 1200, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
    host.route("https://checkout.stripe.com/**", fake_stripe)

    # ---- the sales page
    page = host.new_page(); watch(page, "home")
    page.goto(BASE + "/index.html")
    expect(page.locator("#pricing")).to_be_visible()
    expect(page.locator(".plan")).to_have_count(3)
    expect(page.locator(".plans")).to_contain_text("$5")
    expect(page.locator(".plans")).to_contain_text("$20")
    expect(page.locator(".plans")).to_contain_text("$50")
    expect(page.locator(".test-banner")).to_contain_text("Test mode")
    expect(page.locator("a[href='setup.html']")).to_have_count(2)  # present but hidden (self-host only)
    assert not page.locator("a[href='setup.html']").first.is_visible()
    page.screenshot(path=f"{SHOTS}/01-home.png", full_page=True)

    # ---- buy → admin key
    page.click("button[data-plan=year]")
    expect(page.locator("h1")).to_contain_text("Here’s your admin key", timeout=20000)
    assert "session_id" not in page.url, "purchase id removed from the address bar"
    key = page.locator("#admin-key").inner_text().strip()
    assert len(key) == 43
    page.screenshot(path=f"{SHOTS}/02-welcome.png", full_page=True)
    expect(page.locator("text=Continue: connect Google Drive")).to_have_attribute("aria-disabled", "true")
    page.check("text=I saved my admin key")
    page.click("text=Continue: connect Google Drive")

    # ---- connect Google Drive
    expect(page.locator("h2", has_text="Step 1: Connect your Google Drive")).to_be_visible(timeout=15000)
    expect(page.locator(".plan-status")).to_contain_text("1-year plan: 365 days left")
    expect(page.locator("text=New event")).to_have_count(0)
    page.screenshot(path=f"{SHOTS}/03-connect.png", full_page=True)
    page.click("button:has-text('Connect Google Drive')")
    expect(page.locator(".callout")).to_contain_text("Google Drive connected", timeout=20000)
    expect(page.locator("text=Saving to Google Drive")).to_be_visible()
    expect(page.locator(".drive-panel")).to_contain_text("of 15.0 GB used")
    page.screenshot(path=f"{SHOTS}/04-connected.png", full_page=True)

    # ---- create an event
    page.fill("input[name=name]", "Sam & Alex")
    page.fill("input[name=shotsPerGuest]", "3")
    page.click("text=Create event")
    expect(page.locator(".keybox")).to_contain_text("host.html", timeout=20000)
    host_url = page.locator(".keybox").inner_text().strip()
    event_id = re.search(r"e=([A-Za-z0-9]+)", host_url).group(1)

    # ---- a guest shoots
    phone = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, permissions=["camera", "microphone"])
    cam = phone.new_page(); watch(cam, "cam")
    cam.goto(f"{BASE}/cam.html?e={event_id}")
    expect(cam.locator("h1")).to_have_text("Sam & Alex")
    cam.fill("#gname", "Nana")
    cam.click("text=Open the camera")
    wait_js(cam, "document.querySelector('video') && document.querySelector('video').videoWidth > 0")
    cam.click(".shutter")
    expect(cam.locator(".queue-pill")).to_contain_text("All photos uploaded", timeout=30000)
    files = json.loads(urllib.request.urlopen(BASE + "/__files").read())
    photos = [f for f in files if f["name"].endswith(".jpg") and "_preview" not in f["name"]]
    assert len(photos) == 1 and photos[0]["public"] and photos[0]["owner"] == "google-sub-1", files

    # ---- album shows it (served by Google's image servers, simulated)
    album = phone.new_page(); watch(album, "album")
    album.goto(f"{BASE}/album.html?e={event_id}")
    expect(album.locator(".tile")).to_have_count(1, timeout=15000)
    wait_js(album, "[...document.querySelectorAll('.tile img')].every(i => i.complete && i.naturalWidth > 0)")

    # ---- host dashboard from the admin page
    page.locator("table.list a:has-text('Open dashboard')").click()
    expect(page.locator(".event-code")).to_have_text(event_id, timeout=15000)
    page.click("role=tab[name=/Photos/]")
    expect(page.locator(".mod-item")).to_have_count(1)
    page.go_back()

    # ---- lost key: sign in with Google
    page.goto(BASE + "/admin.html")
    page.click("text=Sign out")
    page.click("button:has-text('Sign in with Google')")
    expect(page.locator("h1")).to_have_text("Your admin key", timeout=20000)
    new_key = page.locator(".keybox").inner_text().strip()
    assert new_key != key and len(new_key) == 43
    page.check("text=I saved my admin key")
    page.click("button:has-text('Continue')")
    expect(page.locator("text=Saving to Google Drive")).to_be_visible(timeout=15000)
    page.click("text=Sign out")
    page.fill("#ak", key)
    page.click("button:has-text('Sign in')")
    expect(page.locator(".callout")).to_contain_text("isn’t right")

    # ---- owner tools
    page.fill("#ak", OWNER_KEY)
    page.click("button:has-text('Sign in')")
    expect(page.locator("text=Owner: accounts")).to_be_visible(timeout=15000)
    expect(page.locator("text=/1 accounts: 1 paid/")).to_be_visible()
    page.fill("input[placeholder^='Who it’s for']", "Jordan")
    page.click("text=Create a free key")
    expect(page.locator("text=Free admin key")).to_be_visible()
    expect(page.locator("text=/2 accounts: 1 paid, 1 free/")).to_be_visible()
    page.screenshot(path=f"{SHOTS}/05-owner.png", full_page=True)

    # ---- legal pages
    for name in ("terms", "privacy"):
        lp = host.new_page(); watch(lp, name)
        lp.goto(f"{BASE}/{name}.html")
        expect(lp.locator("h1")).to_contain_text("PhotoShare")
        lp.close()

    browser.close()

bad = [e for e in errors if "favicon" not in e and not ("Failed to load resource" in e and "404" in e)]
if bad:
    print("Browser errors:\n" + "\n".join(bad))
    sys.exit(1)
print("cloud e2e OK")
