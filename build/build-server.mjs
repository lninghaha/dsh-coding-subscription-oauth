import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Host-side externals: harness-provided runtime packages and optional peers stay
// external so the bundle binds against the host's own copies at runtime.
// esbuild's `external` only accepts plain strings, so prefix matching needs a plugin.
const externalPlugin = {
	name: "dsh-host-externals",
	setup(buildApi) {
		buildApi.onResolve({ filter: /^(@deepseek-ai\/|@earendil-works\/)/ }, ({ path }) => ({
			path,
			external: true,
		}));
	},
};

// The sources use explicit `.ts` specifiers (allowed by allowImportingTsExtensions).
// esbuild cannot resolve those on its own, so hand the real .ts file back
// (it lands in the bundle; types still come from tsc's declaration emit).
const tsSpecifierPlugin = {
	name: "dsh-ts-specifiers",
	setup(buildApi) {
		buildApi.onResolve({ filter: /^\..*\.ts$/ }, ({ path, resolveDir }) => ({
			path: resolve(resolveDir, path),
		}));
	},
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, ".next/lib");

// Bundled CommonJS deps (undici) call `require(...)`; in a pure ESM loader there
// is no `require`, so provide one from the module's own URL. Harmless when the
// harness's CommonJS plugin loader already defines it (esbuild's shim prefers
// an existing global require).
const REQUIRE_BANNER =
	'import { createRequire as __dshCreateRequire } from "node:module";\n' +
	"const require = __dshCreateRequire(import.meta.url);";

const shared = {
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22.19",
	sourcemap: "external",
	sourcesContent: true,
	legalComments: "none",
	metafile: true,
	plugins: [externalPlugin, tsSpecifierPlugin],
	outExtension: { ".js": ".js" },
};

await mkdir(outdir, { recursive: true });

const index = await build({
	...shared,
	entryPoints: [resolve(root, "src/index.ts")],
	outfile: resolve(outdir, "index.js"),
	banner: { js: `${REQUIRE_BANNER}\n/** dsh-coding-subscription-oauth standalone server bundle */` },
});
const bin = await build({
	...shared,
	entryPoints: [resolve(root, "src/bin.ts")],
	outfile: resolve(outdir, "bin.js"),
	banner: { js: `${REQUIRE_BANNER}\n/** dsh-coding-subscription-oauth credential CLI bundle */` },
});
const invariant = await build({
	...shared,
	entryPoints: [resolve(root, "src/invariant.ts")],
	outfile: resolve(outdir, "invariant.js"),
	banner: { js: "/** dsh-coding-subscription-oauth invariant entry */" },
});
await writeFile(
	resolve(outdir, "server.meta.json"),
	JSON.stringify({ index: index.metafile, bin: bin.metafile, invariant: invariant.metafile }, null, 2),
);
console.log(`built ${outdir}/{index,bin,invariant}.js`);
