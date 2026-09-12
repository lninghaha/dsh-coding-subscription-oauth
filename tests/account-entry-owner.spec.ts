import { expect, it, vi } from "vitest";
import { AccountEntryCoordinator, type AccountEntryRole } from "../src/client/account-entry-owner.ts";

it("elects one ready entry regardless of load order and restores standalone when Hub exits", async () => {
	const coordinator = new AccountEntryCoordinator(),
		visible = new Set<string>();
	const owner: AccountEntryRole = "hub";
	const participant = (role: AccountEntryRole) => ({
		role,
		readOwner: async () => owner,
		mount: () => {
			visible.add(role);
			expect(visible.size).toBe(1);
			return () => {
				visible.delete(role);
			};
		},
	});
	const removeSub = coordinator.join(participant("standalone"));
	const removeHub = coordinator.join(participant("hub"));
	await coordinator.refresh();
	expect([...visible]).toEqual(["hub"]);
	removeHub();
	expect([...visible]).toEqual(["standalone"]);
	removeSub();
	expect(visible.size).toBe(0);
});
it("retains the current entry during network failure and falls back after registration failure", async () => {
	const coordinator = new AccountEntryCoordinator(),
		visible = new Set<string>();
	const dispose = coordinator.join({
		role: "standalone",
		readOwner: async () => {
			throw Error("offline");
		},
		mount: () => {
			visible.add("standalone");
			return () => {
				visible.delete("standalone");
			};
		},
	});
	const hub = coordinator.join({
		role: "hub",
		readOwner: async () => "hub",
		mount: () => {
			throw Error("slot unavailable");
		},
	});
	await coordinator.refresh();
	expect([...visible]).toEqual(["standalone"]);
	hub();
	dispose();
});
it("uses an authoritative server owner change instead of a boot-list guess", async () => {
	const coordinator = new AccountEntryCoordinator();
	let owner: AccountEntryRole = "hub";
	const hubMount = vi.fn(() => vi.fn()),
		subMount = vi.fn(() => vi.fn());
	const hub = coordinator.join({ role: "hub", readOwner: async () => owner, mount: hubMount });
	const sub = coordinator.join({ role: "standalone", readOwner: async () => owner, mount: subMount });
	await Promise.resolve();
	await Promise.resolve();
	owner = "standalone";
	await coordinator.refresh();
	expect(subMount).toHaveBeenCalled();
	sub();
	hub();
});
