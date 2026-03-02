# Raspberry Pi Zero 2 W — AI Camera + HDMI Touchscreen Setup Guide

## Target System
- **Board:** Raspberry Pi Zero 2 W (512MB RAM, quad-core Cortex-A53 @ 1GHz)
- **OS:** Raspberry Pi OS Bookworm Lite 64-bit (already installed)
- **Camera:** Raspberry Pi AI Camera (IMX500 sensor) — connected via CSI ribbon cable
- **Display:** External HDMI touchscreen (e.g., Waveshare 7" 1024x600) via mini-HDMI adapter, touch input via USB OTG
- **Access:** SSH over WiFi (the single USB data port will be used by the touchscreen)

## Important Constraints
- The Pi Zero 2 W has only ONE micro-USB data port. The HDMI touchscreen's USB touch cable will occupy it (via OTG adapter). All management must happen over SSH/WiFi.
- 512MB RAM total. Budget ~128MB for GPU, ~100MB for OS overhead, leaving ~280MB for applications.
- No DSI connector exists on any Pi Zero — the official Raspberry Pi Touch Display will NOT work.
- The IMX500 does all neural network inference on-chip. Do NOT install TensorFlow, MediaPipe, or any local inference frameworks — they are unnecessary and will exhaust RAM.

---

## Phase 1: System Update & Base Packages

SSH into the Pi and run:

```bash
# Update everything first
sudo apt update && sudo apt full-upgrade -y

# Install essential tools
sudo apt install -y git htop vim

# Reboot after full upgrade
sudo reboot
```

---

## Phase 2: AI Camera (IMX500) Setup

```bash
# Install the IMX500 meta-package — this installs:
#   - /lib/firmware/imx500_loader.fpk and imx500_firmware.fpk
#   - Pre-compiled neural network models in /usr/share/imx500-models/
#   - IMX500 post-processing stages for rpicam-apps
#   - picamera2 IMX500 device support
sudo apt install -y imx500-all

# This install can take a while on the Zero 2 W. Be patient.

# Reboot required after firmware install
sudo reboot
```

### Verify Camera Detection

```bash
# Check if the camera is detected
rpicam-hello --list-cameras

# Expected output should show the imx500 sensor
# If you see "No cameras available!", try the config.txt fix below
```

### config.txt Fix (if camera not auto-detected)

Some Pi Zero 2 W units need a manual overlay. Edit `/boot/firmware/config.txt`:

```bash
sudo nano /boot/firmware/config.txt
```

Find `camera_auto_detect=1`. If the camera isn't detected, try changing to:

```ini
camera_auto_detect=0
dtoverlay=imx500
```

Then reboot:

```bash
sudo reboot
```

If that still fails, double-check:
- The CSI ribbon cable is seated correctly (metal contacts facing the board on the Zero 2 W)
- You're using the correct narrow ribbon cable (Zero series uses the mini CSI connector, same width as Pi 5)
- Try a different cable if available

### Test Camera with Object Detection

```bash
# Run a quick object detection test (outputs to HDMI if connected)
# The first run loads firmware to the IMX500 — this takes 1-2 minutes
rpicam-hello -t 0s --post-process-file /usr/share/rpi-camera-assets/imx500_mobilenet_ssd.json --viewfinder-width 640 --viewfinder-height 480 --framerate 15

# Test pose estimation
rpicam-hello -t 0s --post-process-file /usr/share/rpi-camera-assets/imx500_posenet.json --viewfinder-width 640 --viewfinder-height 480 --framerate 15
```

> **Note:** Use lower resolution (640x480) and framerate (15fps) on the Zero 2 W. The IMX500 handles inference fine, but the Zero's CPU/GPU struggles with high-res preview rendering.

### Fix Permissions (if you get permission errors)

```bash
# Temporary fix (resets on reboot)
sudo chmod -R a+rX /sys/kernel/debug

# Permanent fix — add user to video group
sudo usermod -a -G video $USER
logout
# Then SSH back in
```

---

## Phase 3: Python Camera Stack (picamera2)

```bash
# picamera2 is NOT pre-installed on Lite — install it
sudo apt install -y python3-picamera2

# Install OpenCV dependencies (needed for picamera2 AI demos)
sudo apt install -y python3-opencv python3-munkres python3-numpy

# Install pip packages if needed later
sudo apt install -y python3-pip
```

### Test picamera2 with IMX500

```bash
# Clone the picamera2 examples repo
cd ~
git clone https://github.com/raspberrypi/picamera2.git
cd picamera2

# Run object detection demo
# On headless/SSH: this needs a display. See Phase 4 for display setup.
# For now, test camera access without preview:
python3 -c "
from picamera2 import Picamera2
picam2 = Picamera2()
config = picam2.create_still_configuration()
picam2.configure(config)
picam2.start()
import time; time.sleep(2)
picam2.capture_file('/tmp/test.jpg')
picam2.stop()
print('Captured test image to /tmp/test.jpg')
"
```

### Available Pre-trained Models

These are installed by `imx500-all` in `/usr/share/imx500-models/`:

| Model | File | Use Case |
|-------|------|----------|
| MobileNet SSD v2 | `imx500_network_ssd_mobilenetv2_fpnlite_320x320_pp.rpk` | Object detection |
| YOLOv8n | `imx500_network_yolov8n_pp.rpk` | Object detection (better accuracy) |
| PoseNet | Referenced in `imx500_posenet.json` | Pose estimation / body keypoints |
| EfficientNet | `imx500_network_efficientnet_bo.rpk` | Image classification |
| MobileNet v2 | `imx500_network_mobilenet_v2.rpk` | Image classification |

List all available models:

```bash
ls /usr/share/imx500-models/
```

---

## Phase 4: HDMI Touchscreen Display Setup

### Hardware Connections

1. **mini-HDMI → HDMI adapter/cable** → HDMI input on touchscreen
2. **Touchscreen USB cable** → micro-USB OTG adapter → Pi Zero 2 W data port (the one NOT labeled PWR)
3. **Power** → Pi Zero 2 W PWR port via 5V/2.5A supply

### Display Configuration

Edit `/boot/firmware/config.txt`:

```bash
sudo nano /boot/firmware/config.txt
```

Add/modify the HDMI settings for your specific screen. For a typical 1024x600 screen:

```ini
# HDMI display settings (adjust for your specific screen)
hdmi_group=2
hdmi_mode=87
hdmi_cvt=1024 600 60 6 0 0 0
hdmi_drive=2

# Force HDMI output even without monitor detection
hdmi_force_hotplug=1

# GPU memory — balance between camera and display
gpu_mem=128
```

> For other screen resolutions, adjust `hdmi_cvt` accordingly. Format: `width height framerate aspect margins interlace reduced_blanking`

Reboot:

```bash
sudo reboot
```

### Touch Input

USB HID touch should work out of the box via `libinput` on Bookworm. Verify:

```bash
# Check for touch input device
libinput list-devices 2>/dev/null | grep -A 5 -i touch

# If libinput isn't installed
sudo apt install -y libinput-tools

# List all input devices
cat /proc/bus/input/devices
```

If touch input needs calibration:

```bash
sudo apt install -y xinput-calibrator
# Run calibration (requires X11/Wayland session — see Phase 5)
```

### Touch Rotation (if display is rotated)

If you mount the display rotated, add to `/boot/firmware/cmdline.txt`:

```bash
# For 90° rotation
video=HDMI-A-1:1024x600@60,rotate=90
```

---

## Phase 5: GUI / Display Server

You have three options depending on your app architecture. Pick ONE.

### Option A: Lightweight Wayland (recommended for web-based UI)

```bash
# Install minimal Wayland compositor
sudo apt install -y labwc wlr-randr

# Or for the full default Bookworm compositor:
# sudo apt install -y wayfire

# Install a lightweight browser for kiosk mode
sudo apt install -y surf
# Alternative: sudo apt install -y midori

# Start a Wayland session manually
# Create a startup script:
cat > ~/start-gui.sh << 'EOF'
#!/bin/bash
export XDG_RUNTIME_DIR=/tmp/runtime-$(whoami)
mkdir -p "$XDG_RUNTIME_DIR"
chmod 0700 "$XDG_RUNTIME_DIR"
exec labwc
EOF
chmod +x ~/start-gui.sh
```

### Option B: Pygame (recommended for native fullscreen app)

```bash
# Install pygame — runs directly on DRM/KMS, no compositor needed
sudo apt install -y python3-pygame

# Test pygame display
python3 -c "
import pygame
pygame.init()
screen = pygame.display.set_mode((1024, 600), pygame.FULLSCREEN)
screen.fill((0, 100, 200))
font = pygame.font.Font(None, 72)
text = font.render('Pi Zero 2 W Ready', True, (255, 255, 255))
screen.blit(text, (200, 250))
pygame.display.flip()
import time; time.sleep(5)
pygame.quit()
print('Display test complete')
"
```

### Option C: Framebuffer Direct (minimal, for custom rendering)

```bash
# Check framebuffer exists
ls -la /dev/fb*

# Test direct framebuffer write
cat /dev/urandom > /dev/fb0  # Should show noise on HDMI screen

# For Python framebuffer access, use pygame with SDL_VIDEODRIVER=kmsdrm
export SDL_VIDEODRIVER=kmsdrm
```

---

## Phase 6: Networking & Remote Access

```bash
# SSH should already be enabled if you set it up in Raspberry Pi Imager
# Verify sshd is running
sudo systemctl status ssh

# Install mDNS for .local discovery
sudo apt install -y avahi-daemon
# Now accessible at: <hostname>.local

# Set a static hostname if needed
sudo hostnamectl set-hostname pi-zero-ai
```

---

## Phase 7: Autostart Your Application

Create a systemd service to launch your app on boot:

```bash
sudo cat > /etc/systemd/system/fitness-app.service << 'EOF'
[Unit]
Description=Fitness Camera App
After=network.target
Wants=network.target

[Service]
Type=simple
User=pi
Environment=SDL_VIDEODRIVER=kmsdrm
Environment=XDG_RUNTIME_DIR=/tmp/runtime-pi
ExecStartPre=/bin/mkdir -p /tmp/runtime-pi
ExecStart=/usr/bin/python3 /home/pi/app/main.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable fitness-app.service

# Start/stop manually:
# sudo systemctl start fitness-app
# sudo systemctl stop fitness-app
# sudo journalctl -u fitness-app -f  (view logs)
```

---

## Phase 8: Thermal Management

The Zero 2 W throttles aggressively under load. Monitor and mitigate:

```bash
# Check current temperature
vcgencmd measure_temp

# Watch for throttling
vcgencmd get_throttled
# 0x0 = no throttling
# 0x50005 = throttled and temp limit reached

# Continuous monitoring
watch -n 1 'vcgencmd measure_temp && vcgencmd get_throttled'
```

**Recommendations:**
- Attach a small heatsink to the SoC (the metal-topped chip)
- If enclosed, ensure airflow
- Keep ambient temperature reasonable
- The IMX500 generates its own heat on the camera module — keep it slightly separated from the Pi if possible

---

## Phase 9: Optional — MQTT Integration with Home Assistant

```bash
# Install MQTT client libraries
sudo apt install -y mosquitto-clients
pip install paho-mqtt --break-system-packages

# Test publishing to your HA MQTT broker
mosquitto_pub -h <your-ha-ip> -t "fitness/status" -m "online"
```

---

## Quick Reference: Full config.txt

Here's what your `/boot/firmware/config.txt` should look like with everything configured:

```ini
# Standard Bookworm defaults
dtparam=audio=on
camera_auto_detect=1
display_auto_detect=1
auto_initramfs=1
dtoverlay=vc4-kms-v3d
max_framebuffers=2
disable_fw_kms_setup=1
arm_64bit=1
disable_overscan=1
arm_boost=1

# GPU memory split
gpu_mem=128

# HDMI touchscreen (adjust for your screen)
hdmi_group=2
hdmi_mode=87
hdmi_cvt=1024 600 60 6 0 0 0
hdmi_drive=2
hdmi_force_hotplug=1

# If camera_auto_detect doesn't find the IMX500, uncomment these:
# camera_auto_detect=0
# dtoverlay=imx500

[all]
```

---

## Smoke Test Checklist

Run through these after setup to confirm everything works:

```bash
# 1. Camera detected?
rpicam-hello --list-cameras

# 2. Camera captures an image?
rpicam-jpeg -o /tmp/test.jpg --width 640 --height 480

# 3. AI inference works? (run with HDMI connected)
rpicam-hello -t 10s --post-process-file /usr/share/rpi-camera-assets/imx500_mobilenet_ssd.json --viewfinder-width 640 --viewfinder-height 480

# 4. Pose estimation works?
rpicam-hello -t 10s --post-process-file /usr/share/rpi-camera-assets/imx500_posenet.json --viewfinder-width 640 --viewfinder-height 480

# 5. picamera2 Python access works?
python3 -c "from picamera2 import Picamera2; from picamera2.devices.imx500 import IMX500; print('IMX500 module available')"

# 6. Touch input detected?
cat /proc/bus/input/devices | grep -A 3 -i touch

# 7. Temperature OK under load?
vcgencmd measure_temp

# 8. RAM usage reasonable?
free -m

# 9. Network accessible?
hostname -I
```

---

## Architecture Summary

```
┌─────────────────────────────┐
│   IMX500 AI Camera          │
│   (on-chip neural network   │
│    inference — pose est,    │
│    object detection, etc.)  │
└──────────┬──────────────────┘
           │ CSI (frames + tensor metadata)
           ▼
┌─────────────────────────────┐
│   Pi Zero 2 W               │
│   Bookworm Lite 64-bit      │
│                             │
│   ├── rpicam-apps (CLI)     │
│   ├── picamera2 (Python)    │
│   ├── Your app (Python)     │
│   │   ├── Process tensors   │
│   │   ├── Rep counting      │
│   │   └── UI rendering      │
│   ├── pygame / labwc+surf   │
│   └── systemd autostart     │
│                             │
│   WiFi ←→ SSH management    │
│   WiFi ←→ MQTT → Home Asst │
└──────┬──────────┬───────────┘
       │ HDMI     │ USB OTG
       ▼          ▼
┌─────────────────────────────┐
│   7" HDMI Touchscreen       │
│   1024x600                  │
│   (display + touch input)   │
└─────────────────────────────┘
```
