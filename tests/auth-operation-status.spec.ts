import { expect, it, vi } from "vitest";
import { SubscriptionWebAuth } from "../src/auth-routes.ts";
import { OAUTH_PROVIDER_DEFINITIONS } from "../src/oauth-providers.ts";

it("keeps a post-challenge login failure separate from healthy stored account status", async () => {
	const definition = OAUTH_PROVIDER_DEFINITIONS.find((d) => d.slug === "kimi")!;
	let rejectLogin: (e: Error) => void = () => undefined;
	const stored = {
		status: "signed-in",
		accounts: [{ id: "existing" }],
		activeAccountId: "existing",
		selected: ["model"],
		available: ["model"],
	};
	const session = {
		definition,
		availableModels: () => [{ id: "model" }],
		selectedModelIds: () => ["model"],
		visibleModels: () => [{ id: "model" }],
		store: { listAccounts: async () => stored.accounts, getActiveAccountId: async () => stored.activeAccountId },
		status: async () => ({ authenticated: true }),
		login: async (context: { notify: (event: unknown) => void }) => {
			context.notify({ type: "device_code", verificationUri: "https://auth.example.test", userCode: "TEST" });
			await new Promise<void>((_r, reject) => {
				rejectLogin = reject;
			});
		},
	};
	const auth = new SubscriptionWebAuth(session as never);
	try {
		await auth.signIn("device");
		rejectLogin(new Error("authorization expired"));
		await vi.waitFor(async () => expect((await auth.status()).operationError).toBe("authorization expired"));
		expect(await auth.status()).toMatchObject({
			status: "signed-in",
			operationError: "authorization expired",
			accounts: [{ id: "existing" }],
		});
		await auth.cancel();
		expect(await auth.status()).not.toHaveProperty("operationError");
	} finally {
		await auth.dispose();
	}
});
