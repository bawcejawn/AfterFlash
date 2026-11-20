"""End-to-end browser test against test/server.mjs (real backend code, mocked Google services).
Uses Chrome's fake camera. Run: node test/server.mjs 8787 & python3 test/e2e.py
"""
import os, re, sys, time, json, urllib.request
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
    page.on("response", lambda r: errors.append(f"[{name}] HTTP {r.status} {r.url}") if r.status >= 400 and "mock-lh3" not in r.url and "/mock-drive/thumbnail" not in r.url else None)
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
    page.click(".tpl-picker >> text=Blank")
    page.click("summary:has-text('More options')")
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
    # owner opens an event dashboard straight from the admin list (no host link needed)
    page.locator("table.list a:has-text('Open dashboard')").first.click()
    expect(page.locator(".event-code")).to_be_visible(timeout=15000)
    assert "admin:" not in page.url
    page.go_back()

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
    # the viewfinder is the camera's own video (no slow canvas copy); looks are GPU filters on it
    expect(cam.locator(".viewfinder")).to_have_attribute("data-look", "mono")
    assert cam.locator(".vf-preview").count() == 0
    assert "grayscale" in cam.evaluate("getComputedStyle(document.querySelector('.viewfinder video')).filter")
    cam.click("button[data-look=vivid]")
    expect(cam.locator("button.chip:has-text('Beauty')")).to_have_attribute("aria-pressed", "false")  # off until chosen
    cam.click("button.chip:has-text('Beauty')")
    expect(cam.locator("button.chip:has-text('Beauty')")).to_have_attribute("aria-pressed", "true")
    cam.click("button.chip:has-text('Beauty')")
    cam.click("button[data-look=mono]")
    # two quick shots: the shutter is ready again at once, photos finish in the background
    cam.click(".shutter")
    expect(cam.locator(".counter-window")).to_have_text("3", timeout=15000)
    expect(cam.locator(".shutter")).to_be_enabled(timeout=3000)
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
    # guestbook from the camera page
    cam.click("text=Sign the guestbook")
    cam.fill(".modal textarea", "Congratulations you two!")
    cam.click(".modal button:has-text('Send')")
    expect(cam.locator(".toast").last).to_contain_text("guestbook", timeout=15000)
    # a voice message
    cam.wait_for_timeout(1200)
    cam.click("text=Sign the guestbook")
    cam.click(".modal button:has-text('Record a voice message')")
    cam.wait_for_timeout(2500)
    cam.click(".modal button:has-text('Stop recording')")
    expect(cam.locator(".modal")).to_contain_text("Voice message ready", timeout=10000)
    cam.click(".modal button:has-text('Send')")
    expect(cam.locator(".toast").last).to_contain_text("guestbook", timeout=20000)

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
    # enhance toggle: switches to a locally generated copy
    album.click(".lightbox button:has-text('Enhance')")
    expect(album.locator(".lightbox button:has-text('Enhance: on')")).to_be_visible()
    wait_js(album, "(document.querySelector('.lightbox img')||{}).src?.startsWith('blob:')", 15000)
    album.screenshot(path=f"{SHOTS}/08b-enhanced.png")
    album.click(".lightbox button:has-text('Enhance: on')")
    album.screenshot(path=f"{SHOTS}/08-lightbox.png")
    album.once("dialog", lambda d: d.accept())
    album.click("text=Report")
    expect(album.locator(".tile")).to_have_count(3, timeout=15000)

    album.goto(f"{BASE}/album.html?e={event_id}&view=mine")
    expect(album.locator(".tile")).to_have_count(4, timeout=15000)
    album.click("role=tab[name='Guestbook']")
    expect(album.locator(".note").filter(has_text="Congratulations")).to_have_count(1, timeout=15000)
    expect(album.locator(".voice")).to_contain_text("Voice message, 0:0", timeout=15000)
    album.click(".voice button:has-text('Play')")
    wait_js(album, "(() => { const a = document.querySelector('.voice audio'); return a && a.src.startsWith('blob:') && a.readyState >= 1; })()", 15000)
    # the phone remembers the event on the home page
    album.goto(f"{BASE}/index.html")
    expect(album.locator("#my-events")).to_contain_text("Sam & Alex")
    expect(album.locator("#my-events a:has-text('Camera')")).to_have_attribute("href", re.compile(event_id))

    # ---- host moderation sees the report and restores it
    host.click("role=tab[name=/Photos/]")
    host.click("text=/Reported \\(1\\)/")
    expect(host.locator(".mod-item")).to_have_count(1)
    host.screenshot(path=f"{SHOTS}/09-host-photos.png", full_page=True)
    host.locator(".mod-item button.pick").first.click()
    host.click("button:has-text('Show')")
    expect(host.locator(".toast")).to_contain_text("Shown")
    # favorites
    host.click("text=/^All \\(/")
    host.locator(".mod-item .heart").first.click()
    expect(host.locator(".toast").last).to_contain_text("Added to favorites")
    expect(host.locator("text=/Download favorites \\(1\\)/")).to_be_visible()
    album.goto(f"{BASE}/album.html?e={event_id}")
    expect(album.locator(".fav-badge")).to_have_count(1, timeout=15000)
    # guestbook tab for host
    host.click("role=tab[name=/Photos/]")
    host.click("text=Find missing photos")
    expect(host.locator(".toast").last).to_contain_text("Nothing missing", timeout=20000)
    host.click("role=tab[name='Guestbook']")
    expect(host.locator(".note").filter(has_text="Congratulations")).to_have_count(1)

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

    # ---- private storage event: files are locked at rest, app still shows them
    page = desk.new_page(); watch(page, "admin2")
    page.goto(BASE + "/admin.html")
    page.fill("#ak", ADMIN_KEY); page.click("text=Sign in")
    expect(page.locator("h1")).to_have_text("Events", timeout=15000)
    page.fill("input[name=name]", "Private party"); page.fill("input[name=date]", "2027-07-01")
    page.click("summary:has-text('More options')")
    page.check("input[name=encrypted]")
    page.click("text=Create event")
    expect(page.locator(".keybox").first).to_contain_text("host.html")
    p_host_url = page.locator(".keybox").first.inner_text().strip()
    p_id = re.search(r"e=([A-Za-z0-9]+)", p_host_url).group(1)
    pc = phone.new_page(); watch(pc, "pcam")
    pc.goto(f"{BASE}/cam.html?e={p_id}")
    pc.fill("#gname", "Lee"); pc.click("text=Open the camera")
    wait_js(pc, "document.querySelector('video') && document.querySelector('video').videoWidth > 0", 15000)
    pc.click(".shutter")
    expect(pc.locator(".queue-pill")).to_contain_text("All photos uploaded", timeout=30000)
    pc.click("text=Sign the guestbook")
    pc.click(".modal button:has-text('Record a voice message')")
    pc.wait_for_timeout(2000)
    pc.click(".modal button:has-text('Stop recording')")
    expect(pc.locator(".modal")).to_contain_text("Voice message ready", timeout=10000)
    pc.click(".modal button:has-text('Send')")
    expect(pc.locator(".toast").last).to_contain_text("guestbook", timeout=20000)
    # what Drive holds is ciphertext only
    stored = json.loads(urllib.request.urlopen(BASE + "/mock-files").read())
    enc = [f for f in stored if f["name"].endswith(".enc")]
    assert len(enc) >= 3, stored
    assert all(f["head"] == "PSE1" and not f["shared"] for f in enc), enc
    pa = phone.new_page(); watch(pa, "palbum")
    pa.goto(f"{BASE}/album.html?e={p_id}")
    expect(pa.locator(".tile")).to_have_count(1, timeout=15000)
    wait_js(pa, "[...document.querySelectorAll('.tile img')].every(i => i.src.startsWith('blob:') && i.complete && i.naturalWidth > 0)", 20000)
    pa.locator(".tile").first.click()
    wait_js(pa, "(document.querySelector('.lightbox img')||{}).src?.startsWith('blob:') && document.querySelector('.lightbox img').naturalWidth > 0", 20000)
    pa.screenshot(path=f"{SHOTS}/14-private-album.png")
    pa.keyboard.press("Escape")
    pa.click("role=tab[name='Guestbook']")
    pa.click(".voice button:has-text('Play')")
    wait_js(pa, "(() => { const a = document.querySelector('.voice audio'); return a && a.src.startsWith('blob:') && a.readyState >= 1; })()", 15000)
    ph = desk.new_page(); watch(ph, "phost")
    ph.goto(p_host_url)
    ph.click("role=tab[name=/Photos/]")
    wait_js(ph, "[...document.querySelectorAll('.mod-item img')].some(i => i.src.startsWith('blob:') && i.naturalWidth > 0)", 20000)
    expect(ph.locator(".mod-item a:has-text('View')")).to_have_count(0)
    page.goto(BASE + "/admin.html")
    with page.expect_download() as dl:
        page.click("text=Download key backup")
    backup = json.loads(open(dl.value.path()).read())
    assert p_id in json.dumps(backup), backup

    # ---- branding: logo, heading style and tagline show on the guest pages
    import zlib, struct
    def png(w, h):
        raw = b"".join(b"\x00" + b"".join(bytes([200, 60, 90, 255 if (x // 8 + y // 8) % 2 else 0]) for x in range(w)) for y in range(h))
        chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
        return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    host.click("role=tab[name='Settings']")
    host.set_input_files("fieldset:has(legend:text('Branding')) input[type=file]", files=[{"name": "logo.png", "mimeType": "image/png", "buffer": png(96, 48)}])
    expect(host.locator(".toast").last).to_contain_text("Logo saved", timeout=15000)
    host.select_option("select[name=font]", "script")
    host.fill("input[name=tagline]", "Snap away, share the love")
    host.click("text=Save settings")
    expect(host.locator(".toast").last).to_contain_text("Settings saved")
    bc = phone.new_page(); watch(bc, "brandcam")
    bc.goto(f"{BASE}/cam.html?e={event_id}")
    wait_js(bc, "document.documentElement.dataset.font === 'script'", 10000)
    wait_js(bc, "[...document.querySelectorAll('img.brand-logo')].some(i => !i.hidden && i.naturalWidth === 96)", 15000)
    bc.screenshot(path=f"{SHOTS}/15-branded-cam.png")
    bc.close()

    # ---- highlight video: made in the browser from the album
    host.click("role=tab[name='Highlight video']")
    host.select_option("select[name=speed]", "2")
    host.click("button:has-text('Make the video')")
    try:
        expect(host.locator("video.film-preview")).to_be_visible(timeout=90000)
    except Exception:
        print("DEBUG status:", host.locator("p[aria-live]").all_inner_texts(), host.locator(".toast").all_inner_texts(), errors[-5:])
        raise
    expect(host.locator("text=/Done: /")).to_be_visible()
    size_kb = int(host.locator("p[data-bytes]").get_attribute("data-bytes")) / 1024
    assert size_kb > 20, size_kb
    with host.expect_download() as dl:
        host.click("a:has-text('Download video')")
    dl.value.save_as(f"{SHOTS}/highlight.{dl.value.suggested_filename.rsplit('.', 1)[-1]}")
    host.screenshot(path=f"{SHOTS}/16-highlight.png", full_page=True)

    # ---- the app home: tiles, typed code, safety check, my events
    ap = ictx_app = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True).new_page(); watch(ap, "app")
    ap.goto(f"{BASE}/app.html")
    expect(ap.locator(".app-tile")).to_have_count(3)  # no Partner tile on the free version
    ap.click(".app-tile >> text=Scan a code")
    ap.fill("#typed", "https://evil.example/cam.html?e=" + event_id); ap.click("text=Go")
    expect(ap.locator("text=For your safety")).to_be_visible()
    ap.fill("#typed", event_id); ap.click("text=Go")
    ap.wait_for_url("**/cam.html*")
    ap.goto(f"{BASE}/app.html#host")
    expect(ap.locator("text=Sign in with my key")).to_be_visible()

    # ---- invitations: host turns it on, a guest RSVPs with a selfie, edits it, host sees it in the CSV
    host.goto(host_url)
    host.click("role=tab[name=Invitations]")
    host.click("text=Turn on invitation")
    expect(host.get_by_text("Invitation link", exact=True)).to_be_visible()
    host.fill("input[name=venue]", "Rose Hall"); host.fill("input[name=startsAt]", "2027-06-12T17:00")
    host.check("input[name=plusOnes]"); host.check("input[name=askMeal]"); host.fill("input[name=meal0]", "Chicken"); host.fill("input[name=meal1]", "Fish")
    host.click("text=Save invitation")
    expect(host.locator("text=Invitation saved")).to_be_visible()
    invite_url = host.locator(".linkline input").first.input_value()
    ictx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    inv = ictx.new_page(); watch(inv, "invite")
    inv.goto(invite_url)
    expect(inv.locator("text=Rose Hall").first).to_be_visible()
    inv.fill("input[name=name]", "Pat Doe"); inv.click("text=Yes, I’ll be there")
    inv.select_option("select.meal >> nth=0", "Fish"); inv.select_option("select[name=size]", "2")
    inv.fill("input[placeholder='Their name']", "Lee Doe"); inv.select_option("select.meal >> nth=1", "Chicken")
    inv.evaluate("""async () => {
      const c = document.createElement('canvas'); c.width = 600; c.height = 800; const x = c.getContext('2d'); x.fillStyle = '#e0a080'; x.fillRect(0, 0, 600, 800);
      const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      const dt = new DataTransfer(); dt.items.add(new File([b], 'me.jpg', { type: 'image/jpeg' }));
      const input = document.querySelector('input[type=file][accept="image/*"]'); input.files = dt.files; input.dispatchEvent(new Event('change'));
    }""")
    expect(inv.locator(".rsvp-photo-preview img")).to_be_visible()
    inv.click("text=Send my RSVP")
    expect(inv.locator("text=You’re on the list!")).to_be_visible(timeout=20000)
    inv.screenshot(path=f"{SHOTS}/14-invite.png", full_page=True)
    private_link = inv.locator(".invite-private input").input_value()
    inv.click("text=Change my answer"); inv.click("text=Maybe"); inv.click("text=Update my RSVP")
    expect(inv.locator("text=noted a maybe")).to_be_visible()
    other = browser.new_context().new_page(); watch(other, "invite2")
    other.goto(private_link)
    expect(other.locator("text=noted a maybe")).to_be_visible()
    assert "#r=" not in other.url, "private token stays out of the address bar"
    host.click("text=Refresh")
    expect(host.locator(".rsvp-row", has_text="Pat Doe")).to_contain_text("Lee Doe (Chicken)")
    expect(host.locator(".rsvp-row img.thumb")).to_be_visible(timeout=10000)
    with host.expect_download() as dl:
        host.click("text=Download guest list (CSV)")
    csv_text = open(dl.value.path(), encoding="utf-8-sig").read()
    assert "Pat Doe (Fish); Lee Doe (Chicken)" in csv_text and "Maybe" in csv_text, csv_text

    # ---- a friend sets up their own Rememberoll (their own backend, their own Drive)
    friend = browser.new_context(viewport={"width": 1100, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
    friend.route(re.compile(r"^https://script\.google\.com/macros/s/AKfy[A-Za-z0-9_-]+/exec"), lambda route: route.fulfill(response=route.fetch(url=BASE + "/mock-byo")))
    fp = friend.new_page(); watch(fp, "setup")
    fp.goto(BASE + "/setup.html")
    fp.click("button:has-text('Copy the code')")
    expect(fp.locator(".toast").last).to_contain_text("Code copied")
    assert "var APP_VERSION" in fp.evaluate("navigator.clipboard.readText()")
    fp.fill("#exec-url", "https://script.google.com/macros/s/AKfyFRIEND0000000000000000000000000/dev")
    fp.click("button:has-text('Connect')")
    expect(fp.locator(".callout")).to_contain_text("test URL")
    friend_url = "https://script.google.com/macros/u/1/s/AKfyFRIEND0000000000000000000000000/exec"
    fp.fill("#exec-url", friend_url)
    fp.fill("#studio-name", "Jordan's parties")
    fp.click("button:has-text('Connect')")
    expect(fp.locator("h1")).to_have_text("You’re set up", timeout=20000)
    friend_key = fp.locator(".keybox").inner_text().strip()
    assert len(friend_key) == 43 and friend_key != ADMIN_KEY
    fp.screenshot(path=f"{SHOTS}/17-setup-done.png", full_page=True)
    fp.click("text=Create your first event")
    expect(fp.locator("h1")).to_have_text("Events", timeout=15000)
    fp.fill("input[name=name]", "Jordan's birthday"); fp.fill("input[name=date]", "2027-03-03")
    fp.click(".tpl-picker >> text=Surprise party")
    expect(fp.locator(".tpl-blurb")).to_contain_text("in secret")
    fp.screenshot(path=f"{SHOTS}/17b-templates.png", full_page=True)
    fp.click("text=Create event")
    fh_url = fp.locator(".keybox").first.inner_text().strip()
    assert "b=AKfyFRIEND" in fh_url, fh_url
    f_id = re.search(r"e=([A-Za-z0-9]+)", fh_url).group(1)
    # the owner's admin key is useless on the friend's Rememberoll and vice versa
    assert '"unauthorized"' in fp.evaluate(f"fetch('{BASE}/mock-byo', {{method: 'POST', body: JSON.stringify({{a: 'adminCheck', k: '{ADMIN_KEY}'}})}}).then(r => r.text())")
    # a guest of the friend's event uploads to the friend's backend
    gctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, permissions=["camera", "microphone"])
    gctx.route(re.compile(r"^https://script\.google\.com/macros/s/AKfy[A-Za-z0-9_-]+/exec"), lambda route: route.fulfill(response=route.fetch(url=BASE + "/mock-byo")))
    fg = gctx.new_page(); watch(fg, "friendcam")
    fg.goto(f"{BASE}/cam.html?e={f_id}&b=AKfyFRIEND0000000000000000000000000")
    expect(fg.locator("h1")).to_have_text("Jordan's birthday")
    fg.click("text=Open the camera")
    wait_js(fg, "document.querySelector('video') && document.querySelector('video').videoWidth > 0", 15000)
    fg.click(".shutter")
    expect(fg.locator(".queue-pill")).to_contain_text("All photos uploaded", timeout=30000)
    # an admin page link naming a backend this device never set up is ignored (no key phishing)
    ev2 = desk.new_page(); watch(ev2, "phish")
    ev2.goto(BASE + "/admin.html?b=AKfyEVIL00000000000000000000000000000")
    expect(ev2.locator(".callout")).to_contain_text("isn’t set up on this device")
    # the friend's home page lists their Rememberoll
    fp.goto(BASE + "/index.html")
    expect(fp.locator("#my-studios")).to_contain_text("Jordan's parties")

    # ---- Koinos pages load under their CSP (koilib needs eval there) without script errors
    assert host.locator("role=tab[name='Keepsakes']").count() == 0
    arch = desk.new_page(); watch(arch, "archive")
    arch.goto(host_url.replace("host.html", "archive.html"))
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
# Drive thumbnail 404s are expected when a photo turns private (reported/hidden): the app falls back.
# Any other HTTP error is still reported by the response listener above.
bad = [e for e in errors if "favicon" not in e and not ("Failed to load resource" in e and "404" in e) and "ERR_TUNNEL_CONNECTION_FAILED" not in e and not ("Failed to load resource" in e and e.startswith("[recover]"))]
if bad:
    print("Browser errors:\n" + "\n".join(bad))
    sys.exit(1)
print("e2e OK")
