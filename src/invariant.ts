/**
 * Package-owned invariant companion for `dsh-coding-subscription-oauth`.
 * @module dsh-coding-subscription-oauth/invariant
 */

import type { Context } from "@deepseek-ai/cordis";
import type { InvariantInstaller } from "@deepseek-ai/dsh-invariants";

const PACKAGE_NAME = "dsh-coding-subscription-oauth";

export const name = "grok-build-invariant";
export const inject = ["invariants"];

const install: InvariantInstaller = () => {};

export const apply = (ctx: Context): Promise<() => void> =>
	Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
