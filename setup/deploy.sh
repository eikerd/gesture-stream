#!/bin/bash
# deploy.sh — Sync publisher code to Pi and enable the systemd service.
#
# Usage:
#   ./setup/deploy.sh [user@host]
#
# Defaults to eikerd@192.168.42.230 if no argument is given.
#
# Prerequisites on the Mac:
#   - rsync and ssh available in PATH
#   - SSH key authentication configured for the Pi (recommended)

set -euo pipefail

HOST="${1:-eikerd@192.168.42.230}"

# Extract username and home directory from user@host
REMOTE_USER="${HOST%%@*}"
REMOTE_HOME="/home/${REMOTE_USER}"
DEPLOY_DIR="${REMOTE_HOME}/pose-publisher"

echo "=== Deploying to ${HOST} (user: ${REMOTE_USER}) ==="

# Sync publisher directory (Python source only, skip cache)
rsync -avz \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude '.DS_Store' \
    publisher/ "${HOST}:${DEPLOY_DIR}/"

# Generate service file with correct user/paths and install it
ssh "${HOST}" bash -s << REMOTE
set -euo pipefail
cat > /tmp/pose-publisher.service << 'UNIT'
[Unit]
Description=IMX500 Pose Publisher
After=network.target

[Service]
Type=simple
User=${REMOTE_USER}
WorkingDirectory=${DEPLOY_DIR}
ExecStart=/usr/bin/python3 ${DEPLOY_DIR}/main.py
Restart=on-failure
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
UNIT
sudo cp /tmp/pose-publisher.service /etc/systemd/system/pose-publisher.service
sudo systemctl daemon-reload
sudo systemctl enable pose-publisher
echo "Service enabled."
REMOTE

echo ""
echo "=== Deployment complete ==="
echo "Start the service:  ssh ${HOST} sudo systemctl start pose-publisher"
echo "View logs:          ssh ${HOST} sudo journalctl -u pose-publisher -f"
