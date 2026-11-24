# X2 sensor inventory — what the bridge may read

Source: x2-aimdk.agibot.com v1.1.0, cached under `.cache/docs/` (HAL sensor
interfaces 5.4.1, perception/SLAM 5.5.2, navigation 5.5.3, vision 5.5.1,
Python examples). Everything below is **read-only subscription** — the motion
guard (`guard_ros_name`) still applies, and only the camera topic in
`ALLOWED_ROS_NAMES` is actually wired today.

## Cameras (all published on PC2 — safe to subscribe inside our container)

| Topic | Msg type | Rate | Gives us |
|---|---|---|---|
| `/aima/hal/sensor/rgbd_head_front/rgb_image` | `sensor_msgs/Image` | 30 Hz | Front RGB frame, 1280×720 RGB8 |
| `/aima/hal/sensor/rgbd_head_front/rgb_image/compressed` | `sensor_msgs/CompressedImage` | 30 Hz | Same, MJPEG — **what `--camera-markers` uses** (cheap to decode, front-facing where the signs are) |
| `/aima/hal/sensor/rgbd_head_front/rgb_camera_info` | `sensor_msgs/CameraInfo` | 30 Hz | RGB intrinsics |
| `/aima/hal/sensor/rgbd_head_front/depth_image` | `sensor_msgs/Image` | 30 Hz | Depth (frame `rgbd_head_front`; pixels NOT RGB-aligned — hardware D2C off, use `/tf_static` to `rgbd_depth_head_front` if ever needed) |
| `/aima/hal/sensor/rgbd_head_front/depth_camera_info` | `sensor_msgs/CameraInfo` | 30 Hz | Depth intrinsics |
| `/aima/hal/sensor/rgbd_head_front/imu` | `sensor_msgs/Imu` | 200 Hz | RGB-D IMU (frame `camera_gyro_optical_frame`) |
| `/aima/hal/sensor/stereo_head_front_left/rgb_image[/compressed]` | `Image`/`CompressedImage` | 10 Hz | Front stereo left, 2064×1552 (Ultra) / 2048×1536 (new rev), frame `stereo_head_front` |
| `/aima/hal/sensor/stereo_head_front_right/rgb_image[/compressed]` | `Image`/`CompressedImage` | 10 Hz | Front stereo right, frame `stereo_head_front_right` |
| `/aima/hal/sensor/stereo_head_front_*/camera_info` | `CameraInfo` | 1 Hz | Stereo intrinsics |
| `/aima/hal/sensor/stereo_head_front/imu` | `sensor_msgs/Imu` | 200 Hz | Stereo IMU |
| `/aima/hal/sensor/rgb_head_rear/rgb_image[/compressed]` | `Image`/`CompressedImage` | 10 Hz | Rear camera (partly blocked by the neck handle; new rev rotated 90°) — poor choice for signs |
| `/aima/hal/sensor/rgb_head_rear/camera_info` | `CameraInfo` | 1 Hz | Rear intrinsics |

Camera QoS: `SensorDataQoS` — `BEST_EFFORT + VOLATILE + KEEP_LAST(5)` (per the
`echo_camera_rgbd` Python example).

**Front "interaction" RGB camera**: hardware exists (sensor list) but publishes
**no HAL topic** — it lives on PC3 (interaction unit). Not reachable.
**Vision API (5.5.1)**: page is a placeholder ("to be enabled"). Nothing there.
Doc warning: never subscribe high-bandwidth *raw* streams across compute units —
inside the PC2 container this does not apply; the compressed topic is trivial.

## LiDAR / IMU / misc

| Topic | Msg type | Rate | Gives us |
|---|---|---|---|
| `/aima/hal/sensor/lidar_chest_front/lidar_pointcloud` | `sensor_msgs/PointCloud2` | 10 Hz | Chest LiDAR cloud (frame `lidar_chest_front`) — raw points, not a position |
| `/aima/hal/sensor/lidar_chest_front/imu` | `sensor_msgs/Imu` | 200 Hz | LiDAR IMU (frame `lidar_imu_chest_front`) |
| `/aima/hal/imu/chest/state` `/aima/hal/imu/torso/state` | `sensor_msgs/Imu` | 500 Hz | Body IMUs (frame `base_link`) — could detect "robot being moved" cheaply |
| `/aima/hal/sensor/touch_head` | `aimdk_msgs/TouchState` | 100 Hz | Already used (fresh take) |
| `/aima/hal/sensor/gnss` | GNSS | 1 Hz | Useless indoors |

## Pose / SLAM (perception module — read carefully before asking)

| Topic/service | Type | Rate | Notes |
|---|---|---|---|
| `/slam/lidar_odom` | `nav_msgs/Odometry` | 10 Hz | **Robot pose in map** (frame `map` → child `torso_link`). This is the "where am I" we want — BUT it only publishes *after relocalization* on a stored map |
| `/integrated_command` | `std_msgs/String` | — | Write-only control channel (`start_mapping`, `stop_mapping:<name>`, `start_relocalization:<map_id>`). **We must never publish here** — mapping/relocalization is MangoBot's |
| `/relocalization_pose` | `geometry_msgs/Pose` | — | Initial pose estimate, in **pixel coords** from `grid_map_info.txt` line 2. Same rule — not ours to send |
| `/aimdk_5Fmsgs/srv/GetStoredMapByName` | service | — | Returns `MapMetaData` + PNG path + map_id; `map_id` also via `sqlite3 /agibot/data/var/MapManagerModule/map.db "SELECT * FROM map;"` |
| `/aima/te/pnc_task_request`, `/aima/pnc/pnc_task_response`, `/task_master/state`, `/pilot` | nav task msgs | — | Navigation — off limits (MangoBot owns movement; `nav`/`pnc_task` are in our denylist anyway) |

## What this means for the two stretch goals

1. **"Camera confirms arrival" — doable today, no MangoBot needed.**
   `--camera-markers` subscribes the front RGB-D **compressed** topic, decodes
   ≤4 fps with `cv2.aruco` (DICT_4X4_50), and tells the agent WHERE the robot
   is: a centred, close marker (2 stable frames) sends `Camera: the robot is
   now at <name>.` and any other stable sighting (3 frames) sends
   `Camera: <name> is visible <bearing>[, about N m away].` — distance comes
   from `rgb_camera_info` intrinsics when available, marker size otherwise.
   The printed signs in
   `robot/markers/` ARE the markers (ids 1–6 signs A–F, 11–14 booths, 21–24
   rooms). One dependency: `opencv-contrib-python-headless` + `numpy` in the
   container — `pip3 install` there (we can't pre-vendor it: any wheel we
   download on the laptop is the wrong platform); missing cv2 → logs once and
   disables.

2. **"Know where the robot is without asking" — two tiers.**
   - Tier 1 (works now): last-seen marker is a coarse position — good enough
     for "you're near sign B" context.
   - Tier 2 (needs MangoBot): if `/slam/lidar_odom` already publishes (the
     preflight now lists any `/slam/*`, `/localization*` topics it sees),
     nearest-sign = pose → Euclidean distance to sign coordinates we record
     once during setup. If it does **not** publish, someone must run
     relocalization on the venue map (`start_relocalization:<map_id>` +
     initial pose) — that is a MangoBot action, not ours, per both the robot
     rules and our guard.

## Ask MangoBot

- Is a venue map stored and is the robot already relocalized on it (does
  `/slam/lidar_odom` publish)? If not, can they relocalize it once for us?
- Map id + `grid_map_info.txt` path if we go the pose route.
- OK to `pip3 install opencv-contrib-python-headless` in our container? (No
  offline wheel we can carry — needs the platform build.)
