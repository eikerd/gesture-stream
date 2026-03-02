# Pi Zero 2W IMX500 Pose Publisher

Lightweight headless Python service for the Raspberry Pi Zero 2W + AI Camera
(IMX500 sensor). Streams pose keypoints from on-chip inference over WebSocket
and optionally publishes to MQTT — no local ML frameworks, no GUI, minimal
CPU/RAM footprint.

## Architecture

```
IMX500 AI Camera
  │  (on-chip HigherHRNet / PoseNet inference)
  │  CSI — frames + tensor metadata
  ▼
Pi Zero 2W  (picamera2 → main.py)
  │
  ├── WebSocket server  ws://pi-zero-ai.local:8765
  │     JSON per frame: { ts, keypoints: [{name, x, y, score}] }
  │
  └── MQTT publish  (optional, set MQTT_BROKER env var)
        Topic: fitness/pose
```

The IMX500 does all neural network inference on-chip.
The Pi CPU only parses the returned tensor metadata and relays it.

## Hardware

| Component | Details |
|-----------|---------|
| Board | Raspberry Pi Zero 2W |
| OS | Raspberry Pi OS Bookworm Lite 64-bit |
| Camera | Raspberry Pi AI Camera (IMX500) |
| Connection | CSI ribbon (mini connector, same as Pi 5) |

## Setup

### 1. Flash and boot the Pi

Use Raspberry Pi Imager to flash Bookworm Lite 64-bit. Enable SSH and
configure WiFi in the Imager's advanced settings before writing.

### 2. Run the install script on the Pi

```bash
# Copy install script to the Pi
scp setup/install.sh pi@pi-zero-ai.local:~/
ssh pi@pi-zero-ai.local

# On the Pi:
chmod +x install.sh && ./install.sh
# The Pi reboots automatically after installation
```

### 3. Deploy the publisher from your Mac

```bash
./setup/deploy.sh pi@pi-zero-ai.local
```

### 4. Start and monitor the service

```bash
ssh pi@pi-zero-ai.local sudo systemctl start pose-publisher
ssh pi@pi-zero-ai.local sudo journalctl -u pose-publisher -f
```

## Configuration

All settings are read from environment variables at startup. Add them to the
systemd unit's `[Service]` section or export before running manually.

| Variable | Default | Description |
|----------|---------|-------------|
| `WS_PORT` | `8765` | WebSocket server port |
| `MQTT_BROKER` | _(unset)_ | MQTT broker hostname/IP; MQTT disabled if unset |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_TOPIC` | `fitness/pose` | MQTT publish topic |
| `CAMERA_WIDTH` | `640` | Capture width (pixels) |
| `CAMERA_HEIGHT` | `480` | Capture height (pixels) |
| `FRAMERATE` | `15` | Target framerate |
| `SCORE_THRESHOLD` | `0.3` | Minimum keypoint confidence to include |

Example with MQTT enabled:

```bash
# /etc/systemd/system/pose-publisher.service  [Service] section
Environment=MQTT_BROKER=homeassistant.local
Environment=MQTT_TOPIC=fitness/pose
Environment=SCORE_THRESHOLD=0.4
```

After editing the unit file, reload and restart:

```bash
sudo systemctl daemon-reload && sudo systemctl restart pose-publisher
```

## WebSocket Frame Format

Each frame is a JSON object:

```json
{
  "ts": 1740835200.123,
  "keypoints": [
    {"name": "nose",           "x": 0.502, "y": 0.183, "score": 0.931},
    {"name": "left_shoulder",  "x": 0.381, "y": 0.342, "score": 0.887},
    {"name": "right_shoulder", "x": 0.623, "y": 0.338, "score": 0.901}
  ]
}
```

- `ts` — Unix timestamp (seconds, 3 decimal places)
- `x`, `y` — Normalised coordinates in [0, 1] relative to frame dimensions
- `score` — Keypoint confidence in [0, 1]
- Only keypoints above `SCORE_THRESHOLD` are included in each frame

### COCO Keypoint Names (17 total)

`nose`, `left_eye`, `right_eye`, `left_ear`, `right_ear`,
`left_shoulder`, `right_shoulder`, `left_elbow`, `right_elbow`,
`left_wrist`, `right_wrist`, `left_hip`, `right_hip`,
`left_knee`, `right_knee`, `left_ankle`, `right_ankle`

## Models

The publisher prefers HigherHRNet (more accurate) and falls back to PoseNet
if HigherHRNet is not installed. Both are included in the `imx500-all` package.

| Model | Path | Notes |
|-------|------|-------|
| HigherHRNet COCO | `/usr/share/imx500-models/imx500_network_higherhrnet_coco.rpk` | Preferred |
| PoseNet | `/usr/share/imx500-models/imx500_network_posenet.rpk` | Fallback |

## Quick WebSocket Test

From any machine on the same network:

```python
import asyncio, websockets, json

async def test():
    async with websockets.connect("ws://pi-zero-ai.local:8765") as ws:
        while True:
            frame = json.loads(await ws.recv())
            print(f"ts={frame['ts']}  keypoints={len(frame['keypoints'])}")

asyncio.run(test())
```

## File Structure

```
vision-piz2w/
├── publisher/
│   ├── main.py        # WebSocket server + pose capture loop
│   └── config.py      # Config dataclass loaded from env vars
└── setup/
    ├── install.sh     # Pi bootstrap (apt packages + pip)
    ├── deploy.sh      # Mac → Pi rsync + systemd enable
    └── service/
        └── pose-publisher.service  # systemd unit
```

## Resource Usage (typical on Pi Zero 2W)

| Resource | Approximate |
|----------|-------------|
| CPU | 5–15% (depends on connected clients) |
| RAM | ~60–90 MB |
| Network | ~10–30 KB/s per WebSocket client at 15 fps |

The IMX500 handles all inference; the Pi only parses metadata tensors.
