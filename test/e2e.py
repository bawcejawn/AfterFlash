"""End-to-end browser test against test/server.mjs (real backend code, mocked Google services).
Uses Chrome's fake camera. Run: node test/server.mjs 8787 & python3 test/e2e.py
"""
import os, re, sys, time
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BASE", "http://localhost:8787")
ADMIN_KEY = open("/tmp/photoshare-admin-key").read().strip()
SHOTS = os.environ.get("SHOTS", "/tmp/ps-shots")
os.makedirs(SHOTS, exist_ok=True)
errors = []

def wait_js(page, expr, timeout=15000):
    """Poll an expression via CDP evaluate (wait_for_function would need unsafe-eval under our CSP)."""
    end = time.time() + timeout / 1000
    while time.time() < end:
        if page.evaluate(expr):
            return
        time.sleep(0.25)
    raise AssertionError("timed out waiting for: " + expr)

def watch(page, name):
    page.on("console", lambda m: errors.append(f"[{name}] console.{m.type}: {m.text}") if m.type in ("error",) else None)
    page.on("pageerror", lambda e: errors.append(f"[{name}] pageerror: {e}"))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"), args=[
        "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--no-sandbox"])
    desk = browser.new_context(viewport={"width": 1280, "height": 860})
    phone = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                permissions=["camera", "microphone"])

    # ---- landing
    page = desk.new_page(); watch(page, "home")
    page.goto(BASE + "/index.html")
    expect(page.locator("h1")).to_contain_text("Every guest gets a camera")
    page.screenshot(path=f"{SHOTS}/01-home.png", full_page=True)
    page.fill("#code", "bad!"); page.click("text=Join")
    expect(page.locator("#join-msg")).to_contain_text("doesn’t look like an event code")

    # ---- admin create
    page = desk.new_page(); watch(page, "admin")
    page.goto(BASE + "/admin.html")
    expect(page.locator("#health")).to_contain_text("Backend connected")
    page.fill("#ak", "wrong-key"); page.click("text=Sign in")
    expect(page.locator(".callout")).to_contain_text("isn’t right")
    page.fill("#ak", ADMIN_KEY); page.click("text=Sign in")
    expect(page.locator("h1")).to_have_text("Events")
    page.fill("input[name=name]", "Sam & Alex"); page.fill("input[name=date]", "2027-06-12")
    page.fill("input[name=shotsPerGuest]", "4")
    page.click("text=Create event")
    expect(page.locator(".keybox")).to_contain_text("host.html")
    host_url = page.locator(".keybox").inner_text().strip()
    event_id = re.search(r"e=([A-Za-z0-9]+)", host_url).group(1)
    page.screenshot(path=f"{SHOTS}/02-admin.png", full_page=True)
    # owner adds a second admin with their own key
    expect(page.locator("text=Signed in as Owner")).to_be_visible()
    page.fill("input[placeholder='Their name']", "Sarah")
    page.click("text=Create admin key")
    expect(page.locator("text=Admin key for Sarah")).to_be_visible()
    second_key = page.locator(".keybox").last.inner_text().strip()
    assert second_key != ADMIN_KEY and len(second_key) > 30
    expect(page.locator("table.list").last).to_contain_text("Sarah")

    # ---- host dashboard
    host = desk.new_page(); watch(host, "host")
    host.goto(host_url)
    expect(host.locator("h1").first).to_have_text("Sam & Alex")
    assert "#k=" not in host.url, "host key must be removed from the address bar"
    expect(host.locator(".qr-box svg")).to_be_visible()
    expect(host.locator(".event-code")).to_have_text(re.search(r"e=([A-Za-z0-9]+)", host_url).group(1))
    wall_url = host.locator("input[readonly]").nth(1).input_value()
    host.screenshot(path=f"{SHOTS}/03-host-share.png", full_page=True)

    # ---- guest camera
    cam = phone.new_page(); watch(cam, "cam")
    cam.goto(f"{BASE}/cam.html?e={event_id}")
    expect(cam.locator("h1")).to_have_text("Sam & Alex")
    cam.screenshot(path=f"{SHOTS}/04-cam-welcome.png")
    cam.fill("#gname", "Nana")
    cam.click("text=Open the camera")
    expect(cam.locator(".counter-window")).to_have_text("4")
    wait_js(cam, "document.querySelector('video') && document.querySelector('video').videoWidth > 0", 15000)
    cam.click("button[data-look=mono]")
    cam.click(".shutter")
    expect(cam.locator(".counter-window")).to_have_text("3", timeout=15000)
    cam.wait_for_timeout(600)
    cam.click("button[data-look=classic]")
    cam.click(".shutter")
    expect(cam.locator(".queue-pill")).to_contain_text("All photos uploaded", timeout=30000)
    expect(cam.locator(".counter-window")).to_have_text("2")
    cam.screenshot(path=f"{SHOTS}/05-cam.png")
    # a short video
    cam.click("button.chip:has-text('Video')")
    cam.wait_for_timeout(1500)
    wait_js(cam, "document.querySelector('video') && document.querySelector('video').videoWidth > 0", 15000)
    cam.click(".shutter")
    expect(cam.locator(".rec-badge")).to_be_visible()
    cam.wait_for_timeout(2500)
    cam.click(".shutter")
    expect(cam.locator(".counter-window")).to_have_text("1", timeout=15000)
    expect(cam.locator(".queue-pill")).to_contain_text("All photos uploaded", timeout=30000)
    cam.click("button.chip:has-text('Photo')")
    cam.wait_for_timeout(1500)
    wait_js(cam, "document.querySelector('video') && document.querySelector('video').videoWidth > 0", 15000)
    cam.click(".shutter")
    expect(cam.locator(".cam-msg")).to_contain_text("That’s a wrap", timeout=30000)
    cam.screenshot(path=f"{SHOTS}/06-cam-done.png")

    # reload keeps identity and shot count
    cam.reload()
    expect(cam.locator(".counter-window")).to_have_text("0", timeout=15000)

    # ---- album + report
    album = phone.new_page(); watch(album, "album")
    album.goto(f"{BASE}/album.html?e={event_id}")
    expect(album.locator(".tile")).to_have_count(4, timeout=15000)
    expect(album.locator(".tile .vid")).to_have_count(1)
    wait_js(album, "[...document.querySelectorAll('.tile img')].every(i => i.complete && i.naturalWidth > 0)", 15000)
    album.screenshot(path=f"{SHOTS}/07-album.png", full_page=True)
    album.locator(".tile").first.click()
    expect(album.locator(".lightbox img")).to_be_visible()
    album.screenshot(path=f"{SHOTS}/08-lightbox.png")
    album.once("dialog", lambda d: d.accept())
    album.click("text=Report")
    expect(album.locator(".tile")).to_have_count(3, timeout=15000)

    # ---- host moderation sees the report and restores it
    host.click("role=tab[name=/Photos/]")
    host.click("text=/Reported \\(1\\)/")
    expect(host.locator(".mod-item")).to_have_count(1)
    host.screenshot(path=f"{SHOTS}/09-host-photos.png", full_page=True)
    host.locator(".mod-item button.pick").first.click()
    host.click("button:has-text('Show')")
    expect(host.locator(".toast")).to_contain_text("Shown")

    # ---- settings save (develop later) → album hides photos
    host.click("role=tab[name='Settings']")
    host.select_option("select[name=reveal]", "after")
    host.fill("input[name=revealAt]", "2999-01-01T10:00")
    host.click("text=Save settings")
    expect(host.locator(".toast").last).to_contain_text("Settings saved")
    host.screenshot(path=f"{SHOTS}/10-host-settings.png", full_page=True)
    album.goto(f"{BASE}/album.html?e={event_id}")
    expect(album.locator(".empty")).to_contain_text("still developing")
    host.select_option("select[name=reveal]", "live")
    host.click("text=Save settings")

    # ---- TV wall
    tv = desk.new_page(); watch(tv, "tv")
    tv.goto(wall_url.replace("http://localhost:8787", BASE))
    tv.click("text=Start the show")
    wait_js(tv, "document.querySelector('.tv-stage img.on') !== null", 20000)
    expect(tv.locator(".tv-count")).to_contain_text("4 photos")
    tv.screenshot(path=f"{SHOTS}/11-tv.png")

    # ---- host guests tab + block
    host.click("role=tab[name='Guests']")
    expect(host.locator("table.list tbody tr")).to_have_count(1)
    expect(host.locator("table.list")).to_contain_text("Nana")

    # ---- unknown studio in link is refused
    bad = phone.new_page(); watch(bad, "bad")
    bad.goto(f"{BASE}/cam.html?e={event_id}&s=evil")
    expect(bad.locator("h1")).to_have_text("Hmm.")

    # ---- Koinos pages load under their CSP (koilib needs eval there) without script errors
    host.click("role=tab[name='Keepsakes']")
    host.click("text=Open the archive tool")
    arch = host
    expect(arch.locator("h1")).to_contain_text("Keep")
    expect(arch.locator("text=Connect Kondor")).to_be_visible()
    assert "#k=" not in arch.url
    assert arch.evaluate("typeof window.Contract === 'function' && typeof window.kondor === 'object'")
    arch.screenshot(path=f"{SHOTS}/12-archive.png", full_page=True)
    rec = desk.new_page(); watch(rec, "recover")
    rec.goto(f"{BASE}/recover.html")
    expect(rec.locator("h1")).to_have_text("Recover and verify")
    rec.fill("input[placeholder^='Koinos address']", "1ESjKUfpqNasvQDS7gmKNCCbbzLLPRr7jR")
    rec.fill("input[placeholder='Event code']", event_id)
    rec.click("text=Load from Koinos")
    expect(rec.locator(".callout, h1")).not_to_have_count(0, timeout=20000)
    rec.screenshot(path=f"{SHOTS}/13-recover.png", full_page=True)

    browser.close()

# network failures to the real Koinos RPC are expected in sandboxed runs
bad = [e for e in errors if "favicon" not in e and "ERR_TUNNEL_CONNECTION_FAILED" not in e and not ("Failed to load resource" in e and e.startswith("[recover]"))]
if bad:
    print("Browser errors:\n" + "\n".join(bad))
    sys.exit(1)
print("e2e OK")
