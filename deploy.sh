#!/usr/bin/env bash
set -e

host=taeho@121.141.156.200
key="$HOME/personal/credentials/home_server_key.pem"
remote_dir=/home/taeho/opod-admin
archive=$(mktemp /tmp/opod-admin.XXXXXX.tar.gz)
trap 'rm -f "$archive"' EXIT

docker build --platform linux/amd64 -f docker/Dockerfile -t opod-admin:latest .
docker save opod-admin:latest | gzip > "$archive"
scp -i "$key" "$archive" "$host:$remote_dir/image.tar.gz"
ssh -i "$key" "$host" "cd $remote_dir && bash deploy.sh"
