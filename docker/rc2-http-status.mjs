export function assertHttp200(path, status) {
	if (status !== 200) throw new Error(`rc.2 smoke route returned ${String(status)}: ${path}`);
}
