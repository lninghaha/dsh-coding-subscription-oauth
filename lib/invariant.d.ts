import { Context } from "@deepseek-ai/cordis";
//#region src/invariant.d.ts
declare const name = "grok-build-invariant";
declare const inject: string[];
declare const apply: (ctx: Context) => Promise<() => void>;
//#endregion
export { apply, inject, name };