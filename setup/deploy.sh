#!/bin/bash
# deploy.sh — Sync publisher code to Pi and enable the systemd service.
#
# Usage:
#   ./setup/deploy.sh [user@host]
#
# Defaults to pi@pi-zero-ai.local if no argument is given.
#
# Prerequisites on the Mac:
#   - rsync and ssh available in PATH
#   - SSH key authentication configured for the Pi (recommended)

set -euo pipefail

HOST="${1:-pi@pi-zero-ai.local}"

echo "=== Deploying to ${HOST} ==="

# Sync publisher directory (Python source only, skip cache)
rsync -avz \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude '.DS_Store' \
    publisher/ "${HOST}:/home/pi/pose-publisher/"

# Copy systemd unit and enable the service
ssh "${HOST}" bash -s << 'REMOTE'
set -euo pipefail
sudo cp /home/pi/pose-publisher/service/pose-publisher.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable pose-publisher
echo "Service enabled."
REMOTE

echo ""
echo "=== Deployment complete ==="
echo "Start the service:  ssh ${HOST} sudo systemctl start pose-publisher"
echo "View logs:          ssh ${HOST} sudo journalctl -u pose-publisher -f"
