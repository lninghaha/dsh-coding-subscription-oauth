import { readFile } from "node:fs/promises";
import semver from "semver";
import { describe, expect, it } from "vitest";

type PluginManifest = {
	engines?: { dsh?: string };
	peerDependencies?: Record<string, string>;
};

const semverOptions = { includePrerelease: true } as const;

function evaluatePluginCompatibility(
	manifest: PluginManifest,
	runtimeVersion: string,
): { ok: boolean; reason?: string } {
	const enginesDsh = manifest.engines?.dsh;
	if (typeof enginesDsh === "string" && enginesDsh.trim() !== "") {
		if (semver.satisfies(runtimeVersion, enginesDsh, semverOptions)) return { ok: true };
		return { ok: false, reason: `engines.dsh ${enginesDsh} does not satisfy ${runtimeVersion}` };
	}

	const peers = manifest.peerDependencies ?? {};
	for (const [name, range] of Object.entries(peers)) {
		if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
		if (!semver.satisfies(runtimeVersion, range, semverOptions)) {
			return { ok: false, reason: `${name}@${range} does not satisfy ${runtimeVersion}` };
		}
	}
	return { ok: true };
}

describe("DSH host plugin install compatibility (#51)", () => {
	it("rejects 0.2.1-rc.2 when engines.dsh is absent and dsh peers are exact 0.1.1-rc.2", () => {
		const legacyExactPeers: PluginManifest = {
			peerDependencies: {
				"@deepseek-ai/dsh-atomic-write": "0.1.1-rc.2",
				"@deepseek-ai/dsh-home-paths": "0.1.1-rc.2",
				"@deepseek-ai/dsh-llm": "0.1.1-rc.2",
				"@deepseek-ai/dsh-llm-pi-ai": "0.1.1-rc.2",
				"@deepseek-ai/dsh-tools": "0.1.1-rc.2",
			},
		};
		expect(evaluatePluginCompatibility(legacyExactPeers, "0.1.1-rc.2").ok).toBe(true);
		expect(evaluatePluginCompatibility(legacyExactPeers, "0.2.1-rc.2").ok).toBe(false);
	});

	it("accepts 0.1.1-rc.2 and 0.2.1-rc.2 via package.json engines.dsh, rejects 0.3.0", async () => {
		const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as PluginManifest;
		expect(typeof manifest.engines?.dsh).toBe("string");
		expect(evaluatePluginCompatibility(manifest, "0.1.1-rc.2").ok).toBe(true);
		expect(evaluatePluginCompatibility(manifest, "0.2.1-rc.2").ok).toBe(true);
		expect(evaluatePluginCompatibility(manifest, "0.3.0").ok).toBe(false);
	});
});
