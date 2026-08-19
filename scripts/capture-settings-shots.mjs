/** Capture Coding OAuth Settings screenshots for README media/. */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const token = process.env.DSH_PREVIEW_TOKEN;
if (!token) throw new Error("DSH_PREVIEW_TOKEN required");
const base = process.env.DSH_PREVIEW_BASE ?? "http://127.0.0.1:17800";
const outDir = process.env.SHOT_OUT ?? "/opt/cursor/artifacts/settings-shots";
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
	headless: true,
	args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({
	viewport: { width: 1440, height: 1100 },
	deviceScaleFactor: 2,
});

const url = `${base}/?preview_token=${encodeURIComponent(token)}`;
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForLoadState("load");
await page.waitForTimeout(2500);

// Dismiss internal testing notice if present
for (const label of ["我知道了", "I understand", "Got it", "OK", "确定", "知道了"]) {
	const btn = page.getByRole("button", { name: label });
	if (await btn.count()) {
		await btn
			.first()
			.click({ timeout: 2000 })
			.catch(() => undefined);
		break;
	}
}
await page.waitForTimeout(800);

async function openSettings() {
	const candidates = [
		page.getByRole("button", { name: /设置|Settings/i }),
		page.getByText(/^设置$/),
		page.getByText(/^Settings$/),
		page.locator('[aria-label*="设置"], [aria-label*="Settings"], [data-testid*="settings"]'),
		page.locator("button").filter({ hasText: /设置|Settings/ }),
	];
	for (const loc of candidates) {
		if ((await loc.count()) > 0) {
			await loc
				.first()
				.click({ timeout: 3000 })
				.catch(() => undefined);
			await page.waitForTimeout(500);
			if (await page.getByText(/Coding OAuth|编码 OAuth|Coding subscriptions|编码订阅/).count()) return true;
			if (await page.getByText(/General|通用|Models|模型|Plugins|插件/).count()) return true;
		}
	}
	// Keyboard / programmatic fallbacks
	await page.keyboard.press("Control+,");
	await page.waitForTimeout(500);
	if (await page.getByText(/General|通用|Settings|设置/).count()) return true;

	await page.evaluate(() => {
		const nodes = Array.from(document.querySelectorAll("button, a, [role=button], div"));
		const hit = nodes.find((el) => /设置|Settings/.test((el.textContent ?? "").trim()));
		if (hit instanceof HTMLElement) hit.click();
	});
	await page.waitForTimeout(800);
	return (await page.getByText(/General|通用|Coding OAuth|编码 OAuth|Plugins|插件/).count()) > 0;
}

const opened = await openSettings();
await writeFile(join(outDir, "debug-home.png"), await page.screenshot({ fullPage: false }));
if (!opened) {
	// dump clickable texts near bottom
	const dump = await page.evaluate(() =>
		Array.from(document.querySelectorAll("button, a, [role=button]"))
			.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
			.filter(Boolean)
			.slice(0, 80),
	);
	await writeFile(join(outDir, "buttons.json"), JSON.stringify(dump, null, 2));
	throw new Error("Could not open Settings modal");
}

async function goCodingOauth() {
	const nav = page.getByText(/Coding OAuth|编码 OAuth/).first();
	await nav.click({ timeout: 5000 });
	await page.waitForTimeout(800);
	await page
		.getByText(/Coding subscriptions|编码订阅账户|编码订阅/)
		.first()
		.waitFor({ timeout: 10_000 });
}

await goCodingOauth();

async function shotTab(tabNameEn, tabNameZh, fileBase) {
	const tab = page.getByRole("tab", { name: new RegExp(`${tabNameEn}|${tabNameZh}`, "i") });
	if ((await tab.count()) > 0) await tab.first().click();
	else
		await page
			.getByRole("button", { name: new RegExp(`^${tabNameEn}$|^${tabNameZh}$`, "i") })
			.first()
			.click();
	await page.waitForTimeout(1200);
	// Prefer clipping the settings content panel (title + tabs + panel)
	const panel = page.locator("section[aria-labelledby='coding-oauth-settings-title']").first();
	if ((await panel.count()) > 0) {
		const box = await panel.boundingBox();
		if (box) {
			// include a bit of surrounding modal chrome
			const clip = {
				x: Math.max(0, box.x - 24),
				y: Math.max(0, box.y - 72),
				width: Math.min(page.viewportSize().width - Math.max(0, box.x - 24), box.width + 48),
				height: Math.min(page.viewportSize().height - Math.max(0, box.y - 72), box.height + 96),
			};
			await page.screenshot({ path: join(outDir, `${fileBase}.png`), clip });
			return;
		}
	}
	await page.screenshot({ path: join(outDir, `${fileBase}.png`) });
}

await shotTab("Accounts", "账户", "settings_accounts");
await shotTab("Gateway", "网关", "settings_gateway");
await shotTab("Capabilities", "能力", "settings_capabilities");

// Overview: wider modal framing
await shotTab("Accounts", "账户", "settings_accounts_reload");
const modal = page.locator('[role="dialog"], [aria-modal="true"]').first();
if ((await modal.count()) > 0) {
	const box = await modal.boundingBox();
	if (box) {
		await page.screenshot({
			path: join(outDir, "settings_overview.png"),
			clip: {
				x: Math.max(0, box.x),
				y: Math.max(0, box.y),
				width: box.width,
				height: Math.min(box.height, 900),
			},
		});
	} else {
		await page.screenshot({ path: join(outDir, "settings_overview.png") });
	}
} else {
	await page.screenshot({ path: join(outDir, "settings_overview.png") });
}

console.log(
	JSON.stringify({
		outDir,
		files: ["settings_accounts.png", "settings_gateway.png", "settings_capabilities.png", "settings_overview.png"],
	}),
);
await browser.close();
