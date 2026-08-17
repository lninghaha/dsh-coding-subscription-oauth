#!/usr/bin/env bash
# Start dockerd for nested Docker builds. Idempotent; returns after readiness.
set -euo pipefail

if docker info >/dev/null 2>&1; then
	exit 0
fi

if [[ ! -f /etc/docker/daemon.json ]]; then
	sudo mkdir -p /etc/docker
	# vfs: fuse-overlayfs breaks promote-release.mjs directory rename (ENOTEMPTY)
	printf '%s\n' '{' '  "storage-driver": "vfs"' '}' | sudo tee /etc/docker/daemon.json >/dev/null
fi

if ! pgrep -x dockerd >/dev/null 2>&1; then
	sudo dockerd >/tmp/dockerd.log 2>&1 &
fi

for _ in $(seq 1 40); do
	if [[ -S /var/run/docker.sock ]]; then
		sudo chmod 666 /var/run/docker.sock || true
	fi
	if docker info >/dev/null 2>&1; then
		exit 0
	fi
	sleep 1
done

echo "error: dockerd failed to become ready" >&2
tail -n 50 /tmp/dockerd.log >&2 || true
exit 1
