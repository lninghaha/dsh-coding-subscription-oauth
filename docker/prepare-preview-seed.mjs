import { chmod, lstat, mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DSH_ROOT = "/opt/dsh";
const PLUGIN_ROOT = "/opt/dsh-plugin";
const SEED_HOME = "/opt/dsh-seed";
const PROFILE_ROOT = join(SEED_HOME, "profiles", "web");
const PLUGIN_NAME = "dsh-coding-subscription-oauth";
const PROFILE_MARKER = "dsh-oauth-preview-v1";

async function manifest(root) {
	return JSON.parse(await readFile(join(root, "package.json"), "utf8"));
}

async function assertPackage(root, expectedName, expectedVersion) {
	const info = await lstat(root);
	if (!info.isDirectory()) throw new Error(`expected package directory: ${root}`);
	const value = await manifest(root);
	if (value.name !== expectedName) throw new Error(`expected ${expectedName} at ${root}; found ${String(value.name)}`);
	if (expectedVersion !== undefined && value.version !== expectedVersion) {
		throw new Error(`expected ${expectedName}@${expectedVersion}; found ${String(value.version)}`);
	}
	return value;
}

async function ensureLink(target, path) {
	await lstat(target).then((info) => {
		if (!info.isDirectory()) throw new Error(`expected symlink target directory: ${target}`);
	});
	await mkdir(dirname(path), { recursive: true });
	try {
		const info = await lstat(path);
		if (info.isSymbolicLink() && (await readlink(path)) === target) return;
		throw new Error(`refusing to replace unexpected preview path: ${path}`);
	} catch (error) {
		if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
	}
	await symlink(target, path, "dir");
}

const dsh = await assertPackage(DSH_ROOT, "@deepseek-ai/dsh", "0.1.0-rc.6");
const plugin = await assertPackage(PLUGIN_ROOT, PLUGIN_NAME, "0.4.0");
if (dsh.engines?.node !== undefined && typeof dsh.engines.node !== "string") {
	throw new Error("invalid @deepseek-ai/dsh engines.node metadata");
}

await mkdir(join(PLUGIN_ROOT, "node_modules"), { recursive: true });
for (const [peer, range] of Object.entries(plugin.peerDependencies ?? {})) {
	const peerRoot = join(DSH_ROOT, "node_modules", peer);
	const exactVersion = typeof range === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(range) ? range : undefined;
	await assertPackage(peerRoot, peer, exactVersion);
	await ensureLink(peerRoot, join(PLUGIN_ROOT, "node_modules", peer));
}

await mkdir(join(PROFILE_ROOT, "node_modules"), { recursive: true });
await ensureLink(PLUGIN_ROOT, join(PROFILE_ROOT, "node_modules", PLUGIN_NAME));
await ensureLink(PLUGIN_ROOT, join(DSH_ROOT, "node_modules", PLUGIN_NAME));
await writeFile(
	join(PROFILE_ROOT, "package.json"),
	`${JSON.stringify(
		{
			name: "dsh-profile-web-preview",
			private: true,
			dependencies: { [PLUGIN_NAME]: "file:/opt/dsh-plugin" },
			dsh: {
				profile: {
					bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", PLUGIN_NAME],
				},
			},
		},
		null,
		2,
	)}\n`,
);
await writeFile(
	join(PROFILE_ROOT, "cordis.patch.yml"),
	"# The preview image omits host-native PTY execution; OAuth/settings do not require it.\n- id: subprocess\n  disabled: true\n- id: bash-sandbox\n  disabled: true\n- id: permission\n  disabled: true\n",
);
await writeFile(
	join(PROFILE_ROOT, "pnpm-workspace.yaml"),
	"packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n",
);
await writeFile(join(PROFILE_ROOT, ".preview-seed-version"), `${PROFILE_MARKER}\n`);
await chmod(SEED_HOME, 0o700);
