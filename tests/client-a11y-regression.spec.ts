import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("client accessibility regressions", () => {
	it("only associates mounted tab and disclosure panels with aria-controls", async () => {
		const [settingsTabs, providerCard] = await Promise.all([
			readFile(join(root, "src/client/components/SettingsTabs.tsx"), "utf8"),
			readFile(join(root, "src/client/components/ProviderCard.tsx"), "utf8"),
		]);

		expect(settingsTabs).toContain(`aria-controls={selected ? \`coding-oauth-panel-\${tab.id}\` : undefined}`);
		expect(providerCard).toContain(
			`aria-controls={expanded ? \`coding-oauth-models-\${definition.slug}\` : undefined}`,
		);
	});

	it("defers preview-trigger focus restoration until the trigger is enabled", async () => {
		const accountsTab = await readFile(join(root, "src/client/components/AccountsTab.tsx"), "utf8");
		const providerCard = await readFile(join(root, "src/client/components/ProviderCard.tsx"), "utf8");

		expect(accountsTab).toContain("if (trigger === undefined || sourcesBusy) return;");
		expect(accountsTab).toContain("}, [preview, sourcesBusy]);");
		expect(accountsTab).toContain(`document.getElementById(\`coding-oauth-source-pull-\${trigger}\`)?.focus();`);
		expect(accountsTab).toContain("onSetDefaultAccount");
		expect(accountsTab).toContain("onRemoveAccount");
		expect(providerCard).toContain("data-accounts-list");
		expect(providerCard).toContain("accountSetDefault");
		expect(providerCard).toContain("accountRemove");
		expect(providerCard).not.toMatch(/accessToken|refreshToken|credential\.access/u);
	});

	it("keeps the account connection target separate from the model disclosure", async () => {
		const [providerCard, settings] = await Promise.all([
			readFile(join(root, "src/client/components/ProviderCard.tsx"), "utf8"),
			readFile(join(root, "src/client/GrokBuildSettings.tsx"), "utf8"),
		]);

		const slugExpression = "$" + "{definition.slug}";
		expect(providerCard).toContain(`id={\`coding-oauth-models-toggle-${slugExpression}\`}`);
		expect(providerCard).toContain(`id={\`coding-oauth-login-${slugExpression}\`}`);
		expect(providerCard).toMatch(
			/if \(providerStatus\.status === "signed-in"\) \{\s+logoutTrigger\.current\?\.focus\(\);/u,
		);
		expect(providerCard).toContain(`document.getElementById(\`coding-oauth-login-${slugExpression}\`)?.focus();`);
		expect(settings).toContain('document.getElementById("coding-oauth-login-codex")?.focus()');
	});
});
