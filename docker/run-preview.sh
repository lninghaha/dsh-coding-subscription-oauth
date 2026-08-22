#!/usr/bin/env bash
set -euo pipefail

fail() {
	printf 'error: %s\n' "$*" >&2
	exit 1
}

valid_preview_port() {
	local port=$1
	[[ $port =~ ^[0-9]+$ ]] || return 1
	(( (port >= 17800 && port <= 17999) || (port >= 19000 && port <= 19199) ))
}

port_is_free() {
	local port=$1
	[[ -z $(ss -H -ltn "sport = :$port") ]]
}

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
dsh_install_dir=${DSH_INSTALL_DIR:-}
host_port=${DSH_PREVIEW_HOST_PORT:-17800}
backend_port=${DSH_PREVIEW_BACKEND_PORT:-17802}
network_mode=${DSH_PREVIEW_NETWORK:-bridge}
image=${DSH_PREVIEW_IMAGE:-e2e-dsh-oauth-web:0.4.0}
container=${DSH_PREVIEW_CONTAINER:-e2e-dsh-oauth-web-$host_port}
data_volume=${DSH_PREVIEW_DATA_VOLUME:-${container}-data}
workspace_volume=${DSH_PREVIEW_WORKSPACE_VOLUME:-${container}-workspace}
extra_authorities=${DSH_PREVIEW_AUTHORITIES:-}

[[ -n $dsh_install_dir ]] || fail 'set DSH_INSTALL_DIR to an audited @deepseek-ai/dsh program package directory'
[[ -f $dsh_install_dir/package.json ]] || fail "DSH_INSTALL_DIR has no package.json: $dsh_install_dir"
dsh_name=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).name' "$dsh_install_dir/package.json")
[[ $dsh_name == @deepseek-ai/dsh ]] || fail "DSH_INSTALL_DIR must be @deepseek-ai/dsh; found $dsh_name"
valid_preview_port "$host_port" || fail 'DSH_PREVIEW_HOST_PORT must be in 17800-17999 or 19000-19199'
valid_preview_port "$backend_port" || fail 'DSH_PREVIEW_BACKEND_PORT must be in 17800-17999 or 19000-19199'
[[ $host_port != "$backend_port" ]] || fail 'preview and backend ports must differ'
[[ $network_mode == bridge || $network_mode == host ]] || fail 'DSH_PREVIEW_NETWORK must be bridge or host'
[[ -z $(docker ps -a --filter "name=^/$container$" --format '{{.Names}}') ]] || fail "container already exists: $container"
port_is_free "$host_port" || fail "host port is already listening: $host_port"

if [[ $network_mode == host ]]; then
	[[ ${DSH_PREVIEW_HOST_NETWORK_CONFIRMED:-} == yes ]] || fail 'host network requires per-run maintainer approval and DSH_PREVIEW_HOST_NETWORK_CONFIRMED=yes'
	port_is_free "$backend_port" || fail "host backend port is already listening: $backend_port"
fi

authorities="127.0.0.1:$host_port,localhost:$host_port"
if [[ -n $extra_authorities ]]; then
	authorities="$authorities,$extra_authorities"
fi

docker build \
	--network none \
	--target web-preview \
	--build-arg NODE_VERSION=22.19.0 \
	--build-context "dsh-installed=$dsh_install_dir" \
	--resource memory=3g \
	--resource cpu-period=100000 \
	--resource cpu-quota=200000 \
	--tag "$image" \
	"$project_root"

docker volume create "$data_volume" >/dev/null
docker volume create "$workspace_volume" >/dev/null

docker run --rm \
	--name "test-dsh-oauth-volume-init-$host_port" \
	--network none \
	--user 0:0 \
	--memory 128m \
	--cpus 0.25 \
	--pids-limit 32 \
	--entrypoint sh \
	-v "$data_volume:/data/dsh" \
	-v "$workspace_volume:/workspace" \
	"$image" \
	-c 'chown -R 1000:1000 /data/dsh /workspace && chmod 700 /data/dsh /workspace'

run_args=(
	--detach
	--rm
	--name "$container"
	--init
	--user 1000:1000
	--read-only
	--cap-drop ALL
	--security-opt no-new-privileges
	--memory 3g
	--cpus 2
	--pids-limit 512
	--tmpfs /tmp:rw,nosuid,nodev,size=256m,mode=1777
	--tmpfs /run/dsh-preview:rw,nosuid,nodev,size=1m,mode=0700,uid=1000,gid=1000
	-v "$data_volume:/data/dsh"
	-v "$workspace_volume:/workspace"
	-e "DSH_PREVIEW_PORT=$host_port"
	-e "DSH_PREVIEW_BACKEND_PORT=$backend_port"
	-e "DSH_PREVIEW_AUTHORITIES=$authorities"
	-e NO_PROXY=127.0.0.1,localhost
	-e no_proxy=127.0.0.1,localhost
)

if [[ -n ${DSH_PREVIEW_PROXY:-} ]]; then
	run_args+=(
		-e "HTTP_PROXY=$DSH_PREVIEW_PROXY"
		-e "HTTPS_PROXY=$DSH_PREVIEW_PROXY"
	)
fi

if [[ $network_mode == host ]]; then
	run_args+=(--network host)
else
	run_args+=(--publish "0.0.0.0:$host_port:$host_port")
fi

docker run "${run_args[@]}" "$image" >/dev/null

printf 'preview container: %s\n' "$container"
printf 'local URL template: http://127.0.0.1:%s/?preview_token=<token>\n' "$host_port"
printf 'read the one-time bootstrap token without copying it to logs:\n'
printf '  docker exec %q sh -c %q\n' "$container" 'cat /run/dsh-preview/token'
printf 'stop and remove the container (volumes remain):\n'
printf '  docker rm -f %q\n' "$container"
