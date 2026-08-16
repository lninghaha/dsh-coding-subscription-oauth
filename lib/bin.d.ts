#!/usr/bin/env node
/** Standalone credential CLI for the coding-subscription bundle. */
export type CliAction = "login" | "logout" | "status" | "import";
export type CliProvider = "all" | "grok" | "codex" | "kimi" | "claude";
export declare function run(argv: readonly string[]): Promise<number>;
//# sourceMappingURL=bin.d.ts.map