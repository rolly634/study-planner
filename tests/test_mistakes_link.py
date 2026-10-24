"""誤答アプリ連携の表示テスト（スマホ幅、オフライン状態で端末内のデータを注入して確認）。

    python3 tests/test_mistakes_link.py [スクリーンショットの出力先]
"""
import json
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/claude-0/planner")
OUT.mkdir(parents=True, exist_ok=True)
PORT = 8766
errors = []


def check(cond, msg):
    print(("OK  " if cond else "NG  ") + msg)
    if not cond:
        errors.append(msg)


state = {
    "version": 1, "done": {}, "achieved": {}, "active": None,
    "marks": {"GO1-43": [{"id": "m-1", "d": "2026-10-24", "m": "x"}],
              "GO1-44": [{"id": "m-2", "d": "2026-10-24", "m": "x"}, {"id": "m-3", "d": "2026-10-31", "m": "o", "src": "mistakes"}, {"id": "m-4", "d": "2026-11-07", "m": "x"}]},
    "sessions": [{"id": "mistakes-1", "subject": "review", "start": 1761300000000, "end": 1761301800000, "manual": False, "source": "mistakes"}],
    "waiting": [{"mark_id": "m-9", "item_id": "GO1-45", "label": "合格るIAIIB 45", "subject": "math", "marked_on": "2026-10-24"}],
    "mistakes": {"KIIB-52": {"problems": 2, "teichaku": 1, "caution": False},
                 "KIIB-55": {"problems": 1, "teichaku": 0, "caution": True}},
}

srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "-d", str(APP)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium", args=["--no-sandbox"])
    ctx = b.new_context(**pw.devices["Pixel 7"], locale="ja-JP", timezone_id="Asia/Tokyo")
    ctx.route("https://cdn.jsdelivr.net/**", lambda r: r.abort())
    ctx.route("https://esm.sh/**", lambda r: r.abort())
    ctx.add_init_script(f"localStorage.setItem('study-planner:v1', {json.dumps(json.dumps(state))});")
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.clock.set_fixed_time("2026-10-24T10:00:00+09:00")
    page.goto(f"http://localhost:{PORT}/")
    page.wait_for_selector(".waiting")
    check("写真待ち 1件" in page.inner_text(".waiting"), "今日の画面に写真待ち1件")
    check("合格るIAIIB 45" in page.inner_text(".waiting"), "写真待ちに項目名")
    check(page.locator(".timer-btn.auto").count() == 1, "復習は「誤答アプリで自動記録」（タイマーなし）")
    check(page.locator("[data-timer=review]").count() == 0, "復習の開始ボタンがない")
    opts = page.eval_on_selector_all("#manualForm option", "els => els.map(e => e.value)")
    check("review" not in opts, f"手動追加に復習がない {opts}")
    badges = page.eval_on_selector_all(".mb", "els => els.map(e => e.textContent)")
    check("誤1/2" in badges, f"課題に誤答の状況（誤1/2） {badges}")
    page.screenshot(path=OUT / "01-today.png", full_page=True)
    page.click("[data-dismiss]")
    page.wait_for_function("() => !document.querySelector('.waiting')")
    check(True, "「確認した」で写真待ちが消える")

    page.click("#tabbar button[data-tab=review]")
    page.wait_for_selector(".rv")
    txt = page.inner_text("#view")
    check("要注意" in txt and "基礎問IIB 55" in txt, "復習タブに要注意の項目")
    titles = page.eval_on_selector_all(".hist .mk", "els => els.map(e => e.title)")
    check(any("誤答アプリで定着" in t for t in titles), f"誤答アプリ由来の○に注記 {titles}")
    page.screenshot(path=OUT / "02-review.png", full_page=True)
    page.click("#tabbar button[data-tab=today]")
    page.wait_for_selector("button[data-item='KIIB-52']")
    page.click("button[data-item='KIIB-52']")
    page.wait_for_selector("#markDlg[open]")
    check("2問中 1問定着" in page.inner_text("#markBody"), "○△×ダイアログに誤答アプリの状況")
    b.close()
srv.terminate()
print("\nエラー:", errors if errors else "なし")
sys.exit(1 if errors else 0)
