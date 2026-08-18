#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const base = new URL(process.env.DSH_WEB_URL ?? "http://127.0.0.1:3080");
const origin = base.origin;

async function jsonFetch(path, init = {}) {
	const response = await fetch(new URL(path, base), {
		...init,
		headers: {
			accept: "application/json",
			origin,
			...init.headers,
		},
	});
	const value = await response.json().catch(() => undefined);
	if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
	return value;
}

async function rpc(method, payload = {}) {
	const rpcId = randomUUID();
	const envelope = await jsonFetch(`/api/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
	});
	if (envelope?.rpcId !== rpcId || envelope?.result?.ok !== true) {
		throw new Error(`${method} failed: ${JSON.stringify(envelope?.result?.error ?? envelope)}`);
	}
	return envelope.result.value;
}

const status = await jsonFetch("/plugins/dsh-coding-subscription-oauth/oauth/status");
const catalog = await rpc("llm.models");
const registered = await rpc("llm.providers");
const groups = new Map(catalog.groups.map((group) => [group.id, group]));
const routes = [
	["grok", "grok-build"],
	["codex", "codex-oauth"],
	["kimi", "kimi-code-oauth"],
	["claude", "claude-code-oauth"],
];
const failures = [];
const report = [];
for (const [slug, route] of routes) {
	const authenticated = status?.providers?.[slug]?.status === "signed-in";
	const group = groups.get(route);
	if (authenticated && group === undefined) failures.push(`${route}: authenticated but absent from model catalog`);
	if (!authenticated && group !== undefined)
		failures.push(`${route}: unauthenticated but still advertises ${group.models.length} model(s)`);
	if (group !== undefined && !/\(OAuth\)$/u.test(group.name))
		failures.push(`${route}: provider name lacks (OAuth): ${group.name}`);
	report.push(
		`${route}: ${authenticated ? "authenticated" : "unauthenticated"} → ${group === undefined ? "hidden" : `${group.models.length} model(s), ${group.name}`}`,
	);
}

const providerIds = new Set(registered.providers.map((provider) => provider.provider));
const preservedRoutes = ["openai", "xai", "kimi-coding"];
for (const route of preservedRoutes) {
	if (!providerIds.has(route)) failures.push(`${route}: legacy API-key route is no longer registered`);
}
report.push(`preserved API-key routes: ${preservedRoutes.filter((route) => providerIds.has(route)).join(", ")}`);

const agyExpectation = process.env.DSH_EXPECT_AGY_AUTH ?? "signed-out";
if (!["signed-out", "signed-in", "auto"].includes(agyExpectation)) {
	throw new Error("DSH_EXPECT_AGY_AUTH must be signed-out, signed-in, or auto");
}
const agy = groups.get("agy");
if (agyExpectation === "signed-out" && agy !== undefined)
	failures.push(`agy: expected signed-out but advertises ${agy.models.length} model(s)`);
if (agyExpectation === "signed-in" && agy === undefined)
	failures.push("agy: expected signed-in but absent from model catalog");
if (agy !== undefined && agy.name !== "Google Antigravity (OAuth)")
	failures.push(`agy: provider name lacks OAuth label: ${agy.name}`);
report.push(`agy: ${agy === undefined ? "hidden" : `${agy.models.length} model(s), ${agy.name}`}`);

console.log(report.join("\n"));
if (failures.length > 0) {
	console.error("\nDeployment verification failed:");
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log("\nOAuth model catalog verification passed.");
}
