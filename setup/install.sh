#!/bin/bash
# install.sh — Bootstrap script for Pi Zero 2W IMX500 pose publisher
# Run this directly on the Pi after flashing Raspberry Pi OS Bookworm Lite 64-bit.
#
# Usage:
#   chmod +x install.sh && ./install.sh
#
# The script will reboot the Pi at the end. After reboot, deploy your code
# with setup/deploy.sh from your Mac.

set -euo pipefail

echo "=== Phase 1: System update ==="
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git htop vim

echo "=== Phase 2: IMX500 AI Camera firmware and models ==="
# imx500-all installs:
#   - IMX500 firmware blobs (/lib/firmware/)
#   - Pre-built neural network models (/usr/share/imx500-models/)
#   - rpicam-apps IMX500 post-processing stages
#   - picamera2 IMX500 device support
sudo apt install -y imx500-all

echo "=== Phase 3: Python camera stack ==="
sudo apt install -y \
    python3-picamera2 \
    python3-opencv \
    python3-munkres \
    python3-numpy \
    python3-pip

echo "=== Phase 4: Python WebSocket and MQTT libraries ==="
pip install websockets paho-mqtt --break-system-packages

echo "=== Done! Rebooting in 5 seconds... ==="
echo "After reboot, deploy with:  ./setup/deploy.sh pi@<pi-hostname>.local"
sleep 5
sudo reboot
