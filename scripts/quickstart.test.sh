#!/usr/bin/env bash
# Exercise the real quickstart without contacting Docker, GitHub or a package manager.
set -euo pipefail
quickstart=$(cd "$(dirname "$0")" && pwd)/quickstart.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"

export calls="$work/calls" downloaded="$work/downloaded" run_as=user USER=quickstart-test
mkdir -p nodedr-restaurant-pos/.git
cat > nodedr-restaurant-pos/install.sh <<'SH'
#!/bin/sh
echo "install as $run_as" >> "$calls"
SH
chmod +x nodedr-restaurant-pos/install.sh

uname() { echo Linux; }
git() { [[ "$*" == "-C nodedr-restaurant-pos pull --ff-only" ]]; }
docker() {
  [[ "$*" == info ]] || return 1
  local access=$before
  if [[ -f $downloaded ]]; then access=$after; fi
  [[ $access == user || ( $access == sudo && $run_as == sudo ) ]]
}
sudo() {
  case "$1" in
    docker|./install.sh) run_as=sudo "$@" ;;
    usermod|systemctl) return 0 ;;
    *) return 1 ;;
  esac
}
curl() {
  [[ "$*" == "-fsSL https://get.docker.com" ]] || return 1
  echo download >> "$calls"
  touch "$downloaded"
}
export -f uname git docker sudo curl

check() {
  local scenario=$1 status=0 expected_status=$4
  export before=$2 after=$3
  shift 4
  : > "$calls"
  rm -f "$downloaded"
  bash "$quickstart" > output 2>&1 || status=$?
  if [[ $status != "$expected_status" ]] || ! diff -u <(printf '%s\n' "$@") "$calls"; then
    echo "FAIL: $scenario (exit $status, expected $expected_status)" >&2
    cat output >&2
    return 1
  fi
  echo "PASS: $scenario"
}

check "Docker works for the current user" user user 0 "install as user"
check "Existing Docker needs sudo" sudo sudo 0 "install as sudo"
check "Docker works directly after installation" unavailable user 0 download "install as user"
check "Docker needs sudo after installation" unavailable sudo 0 download "install as sudo"
check "Docker stays unreachable after installation" unavailable unavailable 1 download
