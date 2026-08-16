//#region src/bin.d.ts
/** Standalone credential CLI for the coding-subscription bundle. */
type CliAction = 'login' | 'logout' | 'status' | 'import';
type CliProvider = 'all' | 'grok' | 'codex' | 'kimi' | 'claude';
declare function run(argv: readonly string[]): Promise<number>;
//#endregion
export { CliAction, CliProvider, run };