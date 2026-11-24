"""Real-browser end-to-end test: sign in -> pick repo -> upload folder -> plan -> publish -> verify Git state.
Run:  python3 tests/e2e/smoke.py     (needs: pip install playwright && playwright install chromium)"""
import json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright, expect

PORT = 5199; URL = f"http://localhost:{PORT}"
root = os.path.dirname(os.path.abspath(__file__))
srv = subprocess.Popen(["node", os.path.join(root, "server.mjs")], env={**os.environ, "PORT": str(PORT)}, stdout=subprocess.PIPE, text=True)
srv.stdout.readline()

folder = os.path.join(tempfile.mkdtemp(), "my-portfolio")
for rel, body in {"index.html": "<h1>hi</h1>", "style.css": "body{}", "script.js": "console.log(1)", "assets/logo.svg": "<svg/>", "README.md": "# new readme",
                  ".env": "SECRET=1", "node_modules/x/y.js": "x"}.items():
    p = os.path.join(folder, rel); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "w").write(body)

errors = []
def ok(msg): print("  ✓", msg)
try:
    with sync_playwright() as pw:
        b = pw.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 900}); page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" and "fonts.g" not in m.text and "ERR_" not in m.text and "Failed to load resource" not in m.text else None)

        page.goto(URL); expect(page.get_by_role("heading", name="Your folder deserves a better Git history.")).to_be_visible(); ok("landing renders")
        page.goto(URL + "/dashboard.html"); page.wait_for_url(URL + "/?auth_error=signin_required"); expect(page.locator("#authError")).to_contain_text("Sign in"); ok("signed-out dashboard redirects with a message")

        page.goto(URL + "/__login"); expect(page.get_by_role("heading", name="Welcome, Octo")).to_be_visible(); ok("GitHub login -> dashboard")
        cookies = {c["name"]: c for c in ctx.cookies()}; sess = cookies["cc_session"]; assert sess["httpOnly"], "session cookie must be HttpOnly"; ok("session cookie is HttpOnly")

        page.get_by_role("link", name="Start new publishing").click(); page.wait_for_url("**/repositories.html")
        page.get_by_role("radio", name="octo/site").click(); expect(page.locator("#existingWarn")).to_be_visible(); ok("repo selected, existing-branch warning shown")
        page.get_by_role("button", name="Continue to upload").click(); page.wait_for_url("**/upload.html")

        page.set_input_files("#picker", folder)
        expect(page.locator("#work")).to_be_visible()
        expect(page.locator("#excluded")).to_contain_text(".env"); ok(".env excluded with a reason"); expect(page.locator("#excluded")).to_contain_text("Default rule")
        expect(page.locator("#stats")).to_contain_text("Selected"); expect(page.locator("#barText")).to_contain_text("5 files selected"); ok("5 files selected, node_modules skipped")
        expect(page.locator("#notices")).to_contain_text("node_modules"); page.get_by_role("button", name="index.html").click(); expect(page.locator("#preview pre")).to_contain_text("<h1>hi</h1>"); ok("text preview works")
        page.get_by_role("button", name="Review commit plan").click(); page.wait_for_url("**/commit-plan.html")

        expect(page.locator(".plan-row")).to_have_count(5); expect(page.locator("#publish")).to_have_text("Publish 5 files as 5 commits"); ok("plan shows 5 commits")
        expect(page.locator("#sUpd")).to_have_text("1"); ok("README.md detected as an update")
        first = page.locator(".plan-row .msg").first; first.fill("Add the site's README"); ok("message edited")
        page.locator("[data-act=down]").first.click(); ok("reordered")
        page.get_by_role("button", name="Publish 5 files as 5 commits").click(); page.wait_for_url("**/publishing.html**")
        expect(page.get_by_role("heading", name="Published")).to_be_visible(timeout=20000); expect(page.locator("#done")).to_have_text("5"); ok("publish completed in UI")

        state = json.load(urllib.request.urlopen(URL + "/__state"))
        assert len(state["log"]) == 6, state; assert all(c["parents"] == 1 for c in state["log"][:-1]); ok("6 commits in history (5 new + initial), each with a parent")
        assert {"index.html", "style.css", "script.js", "assets/logo.svg", "README.md", "keep.txt"} <= set(state["files"]); assert ".env" not in state["files"]; ok("all files present, existing keep.txt untouched, .env not published")
        assert any("Add the site's README" == c["message"] for c in state["log"]); ok("custom message used")
        ls = page.evaluate("JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)])"); assert "gho_" not in ls; ok("no token in localStorage/sessionStorage")
        page.goto(URL + "/history.html"); expect(page.locator(".hist")).to_have_count(1); expect(page.locator(".hist")).to_contain_text("Completed"); ok("history lists the job")
        page.goto(URL + "/settings.html"); page.locator("#tpl").select_option("update"); expect(page.locator(".toast")).to_contain_text("Saved"); ok("settings save")
        page.locator("[data-t=light]").click(); assert page.evaluate("document.documentElement.dataset.theme") == "light"; ok("theme switch")
        page.set_viewport_size({"width": 390, "height": 800}); page.goto(URL + "/dashboard.html"); expect(page.locator("#menuBtn")).to_be_visible(); ok("mobile layout shows menu button")
        page.goto(URL + "/settings.html"); page.get_by_role("button", name="Sign out").click(); page.wait_for_url(URL + "/")
        page.goto(URL + "/dashboard.html"); page.wait_for_url("**auth_error=signin_required"); ok("logout terminates the session")
        b.close()
finally:
    srv.terminate()
if errors:
    print("\nBrowser errors:"); [print(" ", e) for e in errors]; sys.exit(1)
print("\nE2E PASSED")
