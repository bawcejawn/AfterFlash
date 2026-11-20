"""Browser test of Rememberoll Cloud: buy a key, connect Google Drive, run an event, recover a key,
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
    for price in ("$5", "$10", "$30"):
        expect(page.locator(".plans")).to_contain_text(price)
    expect(page.locator(".plans")).not_to_contain_text("Lifetime")
    expect(page.locator("#ref-form")).to_be_visible()
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
    expect(page.locator(".plan-status")).to_contain_text("12-month plan: 365 days left")
    expect(page.locator("text=New event")).to_have_count(0)
    page.screenshot(path=f"{SHOTS}/03-connect.png", full_page=True)
    page.click("button:has-text('Connect Google Drive')")
    expect(page.locator(".callout")).to_contain_text("Google Drive connected", timeout=20000)
    expect(page.locator("text=Saving to Google Drive")).to_be_visible()
    expect(page.locator(".drive-panel")).to_contain_text("of 15.0 GB used")
    page.screenshot(path=f"{SHOTS}/04-connected.png", full_page=True)

    # ---- create an event
    page.fill("input[name=name]", "Sam & Alex"); page.fill("input[name=date]", "2027-06-12")
    page.click(".tpl-picker >> text=Blank")
    page.click("summary:has-text('More options')")
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
    # ---- prints: pick the photo, order, pay (fake Stripe), thank-you page
    shop = page.locator("section.shop")
    expect(shop).to_contain_text("4×6 prints, $0.50 each", timeout=15000)
    expect(shop.locator("button:has-text('Make a photo book')")).to_be_disabled()
    page.click("button:has-text('Select all')")
    page.select_option("select[name=copies]", "2")
    shop.locator("button", has_text="Order 2 prints ($1)").click()
    page.wait_for_url("**/order.html*", timeout=20000)
    expect(page.locator("h1")).to_have_text("Thank you! Your order is in", timeout=20000)
    assert "session_id" not in page.url
    page.goto(host_url)
    page.click("role=tab[name=/Photos/]")
    expect(page.locator("section.shop")).to_contain_text("Paid, being made", timeout=15000)
    page.screenshot(path=f"{SHOTS}/04b-prints.png", full_page=True)
    page.goto(BASE + "/admin.html")
    # ---- planner tools: branding shows on the album; "Start from" copies an event
    page.fill("input[name=bname]", "Bright Day Events")
    page.fill("input[name=burl]", "https://brightday.example")
    page.click("form:has(h2:has-text('Planner branding')) button:has-text('Save')")
    expect(page.locator("text=It shows on all your events")).to_be_visible(timeout=15000)
    album.goto(f"{BASE}/album.html?e={event_id}")
    expect(album.locator(".planner-credit a")).to_have_text("Bright Day Events", timeout=15000)
    assert album.locator(".planner-credit a").get_attribute("href") == "https://brightday.example"
    page.click("summary:has-text('More options')")
    page.select_option("select[name=from]", event_id)
    expect(page.locator("text=Copies the look")).to_be_visible()
    assert not page.locator("input[name=shotsPerGuest]").is_visible()
    page.screenshot(path=f"{SHOTS}/04c-planner.png", full_page=True)

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
    expect(page.locator("section", has=page.locator("h2", has_text="Owner: system health"))).to_contain_text("of 10 GB", timeout=15000)
    page.click("button:has-text('Run cleanup now')")
    expect(page.locator("text=Last nightly cleanup")).to_be_visible(timeout=15000)
    orders = page.locator("section", has=page.locator("h2", has_text="Owner: print orders"))
    expect(orders).to_contain_text("1 photos × 2", timeout=15000)
    expect(orders).to_contain_text("Austin")
    page.screenshot(path=f"{SHOTS}/05-owner.png", full_page=True)

    # ---- referral partner: owner adds a friend with a lifetime key
    expect(page.locator("text=Owner: referral partners")).to_be_visible()
    page.fill("input[placeholder='Partner’s name']", "Mike")
    page.fill("input[placeholder='Code (optional)']", "mike")
    page.click("button:has-text('Add partner')")
    expect(page.locator("h3", has_text="Partner code MIKE")).to_be_visible(timeout=15000)
    box = page.locator(".panel", has=page.locator("h3", has_text="Partner code MIKE"))
    partner_link = box.locator(".partner-link").first.inner_text().strip()
    assert partner_link.endswith("/?ref=MIKE"), partner_link
    partner_key = box.locator(".keybox").last.inner_text().strip()
    assert len(partner_key) == 43

    # a friend of Mike's opens his link: 10% off shows, and they buy 12 months
    buyer = browser.new_context(viewport={"width": 1200, "height": 900})
    buyer.route("https://checkout.stripe.com/**", fake_stripe)
    bp = buyer.new_page(); watch(bp, "buyer")
    bp.goto(BASE + "/?ref=MIKE")
    expect(bp.locator("#ref-msg")).to_contain_text("Code MIKE: 10% off applied")
    expect(bp.locator(".plans")).to_contain_text("$27")
    assert "ref=" not in bp.url, "code removed from the address bar"
    bp.screenshot(path=f"{SHOTS}/06-referral.png", full_page=True)
    bp.click("button[data-plan=year]")
    expect(bp.locator("h1")).to_contain_text("Here’s your admin key", timeout=20000)
    # a wrong code is refused politely
    bp.goto(BASE + "/index.html")
    bp.click("#ref-form button:has-text('Remove')")
    bp.fill("#ref-code", "nope99")
    bp.click("#ref-form button:has-text('Apply')")
    expect(bp.locator("#ref-msg")).to_contain_text("isn’t valid")

    # owner sees the sale and Mike's commission
    page.reload()
    expect(page.locator("text=Owner: referral partners")).to_be_visible(timeout=15000)
    row = page.locator("section", has=page.locator("h2", has_text="Owner: referral partners")).locator("table.list tbody tr").first
    expect(row).to_contain_text("1 ($27.00)")
    expect(row).to_contain_text("$5.40")

    # Mike signs in with his lifetime key and sees his code and earnings
    page.click("text=Sign out")
    page.fill("#ak", partner_key)
    page.click("button:has-text('Sign in')")
    expect(page.locator("h2", has_text="Your partner page")).to_be_visible(timeout=15000)
    expect(page.locator("text=Plan: Lifetime")).to_be_visible()
    expect(page.locator(".stats")).to_contain_text("$5.40")
    page.screenshot(path=f"{SHOTS}/07-partner.png", full_page=True)

    # Mike invites Lena to his team; she joins through the link (tier 2)
    page.click("button:has-text('Make an invite link')")
    invite = page.locator(".partner-link", has_text="partner.html#invite=").inner_text().strip()
    friend = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
    fp = friend.new_page(); watch(fp, "join")
    fp.goto(invite)
    expect(fp.locator("h1")).to_contain_text("Mike invited you")
    fp.fill("input[autocomplete=name]", "Lena")
    fp.fill("input[autocomplete=email]", "lena@example.com")
    fp.click("button:has-text('Join as a partner')")
    expect(fp.locator("h1")).to_contain_text("Mike invited you")  # the form won't submit until the agreement is ticked
    fp.check("text=I’ve read and agree")
    fp.click("button:has-text('Join as a partner')")
    expect(fp.locator("h1")).to_contain_text("Here’s your partner key", timeout=15000)
    assert "invite=" not in fp.url
    fp.screenshot(path=f"{SHOTS}/08-joined.png", full_page=True)
    lena_link = fp.locator(".partner-link").inner_text().strip()
    fp.check("text=I saved my partner key")
    fp.click("text=Open my partner page")
    expect(fp.locator("h2", has_text="Your partner page")).to_be_visible(timeout=15000)
    expect(fp.locator("text=(tier 2)")).to_be_visible()
    expect(fp.locator("h2", has_text="Partner account")).to_be_visible()
    # the same invite can't be used twice
    fp2 = friend.new_page(); fp2.goto(invite)
    expect(fp2.locator(".callout")).to_contain_text("expired or was already used")
    fp2.close()

    # one of Lena's customers buys a month: Lena earns 20% of $9, Mike gets the 5% team bonus
    bp.goto(lena_link)
    expect(bp.locator("#ref-msg")).to_contain_text("10% off applied")
    bp.click("button[data-plan=month]")
    expect(bp.locator("h1")).to_contain_text("Here’s your admin key", timeout=20000)
    fp.reload()
    expect(fp.locator(".stats")).to_contain_text("$1.80", timeout=15000)
    page.reload()
    expect(page.locator(".stats")).to_contain_text("$5.85", timeout=15000)  # $5.40 own + $0.45 team
    page.locator("summary", has_text="Your team").click()
    expect(page.locator("table.list", has_text="Lena")).to_be_visible()
    page.screenshot(path=f"{SHOTS}/09-team.png", full_page=True)

    # ---- legal pages
    for name in ("terms", "privacy", "help"):
        lp = host.new_page(); watch(lp, name)
        lp.goto(f"{BASE}/{name}.html")
        expect(lp.locator("h1")).to_contain_text("Rememberoll")
        if name == "help":
            lp.goto(f"{BASE}/help.html#camera")
            expect(lp.locator("#camera")).to_have_attribute("open", "")
            lp.fill("input[type=search]", "payout")
            expect(lp.locator("#partner-paid")).to_be_visible()
            expect(lp.locator("#camera")).to_be_hidden()
            lp.screenshot(path=f"{SHOTS}/10-help.png", full_page=True)
        lp.close()

    browser.close()

bad = [e for e in errors if "favicon" not in e and not ("Failed to load resource" in e and "404" in e)]
if bad:
    print("Browser errors:\n" + "\n".join(bad))
    sys.exit(1)
print("cloud e2e OK")
