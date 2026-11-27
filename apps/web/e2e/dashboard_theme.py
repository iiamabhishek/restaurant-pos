#!/usr/bin/env python3
"""Check dashboard themes in a running demo with at least one pending order.

Use a seeded demo owner and a branch with an order awaiting acceptance.
Run with Playwright for Python and Chromium installed:
    STAFF_URL=http://localhost:1995 python3 apps/web/e2e/dashboard_theme.py
"""
import os
import re
from unittest import TestCase, main

from playwright.sync_api import expect, sync_playwright


STAFF_URL = os.environ.get("STAFF_URL", "http://localhost:1995")


def contrast(badge):
    # Composite the counter over its ancestors, including the selected tab.
    colors = badge.evaluate("""el => {
        const ctx = document.createElement('canvas').getContext('2d');
        function paint(color) {
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
        }
        const backgrounds = [];
        for (let node = el; node; node = node.parentElement) {
            backgrounds.push(getComputedStyle(node).backgroundColor);
        }
        paint('white');
        backgrounds.reverse().forEach(paint);
        const rgb = () => Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
        const background = rgb();
        paint(getComputedStyle(el).color);
        return [background, rgb()];
    }""")
    luminances = []
    for color in colors:
        channels = [v / 255 for v in color]
        linear = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in channels]
        luminances.append(sum(v * weight for v, weight in zip(linear, (0.2126, 0.7152, 0.0722))))
    dark, light = sorted(luminances)
    return (light + 0.05) / (dark + 0.05)


class DashboardTheme(TestCase):
    @classmethod
    def setUpClass(cls):
        pw = sync_playwright().start()
        cls.addClassCleanup(pw.stop)
        cls.browser = pw.chromium.launch(channel=os.environ.get("BROWSER_CHANNEL"))
        cls.addClassCleanup(cls.browser.close)
        session = cls.browser.new_context()
        login = session.request.post(f"{STAFF_URL}/api/v1/auth/login", data={
            "email": "owner@demo.local", "password": "Password123!",
        })
        assert login.ok, f"Demo login failed with HTTP {login.status}"
        cls.session = session.storage_state()
        session.close()

    def page(self, scheme):
        context = self.browser.new_context(storage_state=self.session, color_scheme=scheme)
        self.addCleanup(context.close)
        return context.new_page()

    def test_first_click_switches_the_visible_theme(self):
        for initial, opposite in (("dark", "light"), ("light", "dark")):
            with self.subTest(initial=initial):
                page = self.page(initial)
                page.goto(f"{STAFF_URL}/orders")
                root = page.locator("html")
                toggle = page.get_by_role("button", name="Toggle theme")
                expect(root).to_have_css("color-scheme", initial)
                toggle.click()
                expect(root).to_have_css("color-scheme", opposite)
                page.reload()
                expect(root).to_have_css("color-scheme", opposite)
                toggle.click()
                expect(root).to_have_css("color-scheme", initial)

    def test_pending_count_contrast(self):
        for scheme in ("dark", "light"):
            page = self.page(scheme)
            for route in ("/orders", "/orders?tab=active", "/kds"):
                with self.subTest(scheme=scheme, route=route):
                    page.goto(STAFF_URL + route)
                    if route == "/kds":
                        label = page.get_by_role("heading", name="Incoming - needs a decision", exact=False)
                    else:
                        label = page.get_by_role("button", name="New (to accept)", exact=False)
                    badge = label.get_by_text(re.compile(r"^[1-9]\d*$"))
                    expect(badge).to_be_visible()
                    self.assertGreaterEqual(contrast(badge), 4.5)


if __name__ == "__main__":
    main()
