# Connect our voice agent to the robot (venue runbook)

For the teammate standing at the robot. Follow top to bottom; every command is copy-paste.
It follows the method another team tested on the robot on 24 Nov (19:36-20:00): work on the
robot's host (there is no Docker container), use the raw microphone, run half duplex.

**Our code only carries audio. It never moves the robot.** Movement stays with the MangoBot operator.

## 0. What you need

- A laptop on the hall Wi-Fi (or on the robot's cable).
- This repo: `git clone https://github.com/HyperionBurn/deception-dso-navigator.git` (or `git pull`).
- Two things that are **not** in this repo; ask Wasif:
  - the robot login password (from the organisers' message),
  - our team access code.
- Robot address:
  - **Robot 2 on the hall Wi-Fi: `<robot-ip>`**
  - on the cable: `<robot-ip>` (also `.40` / `.42`)
  - if neither answers, find it from a Mac: `dns-sd -B _agibot._tcp local`, then `dns-sd -L <name> _agibot._tcp local`

Below, `ROBOT` means that address.

## 1. Copy our bridge to the robot (from your laptop, in the repo folder)

```bash
scp -r robot/bridge run@ROBOT:~/deception
```

That creates `~/deception` on the robot. If `~/deception` already exists, update just the program instead:

```bash
scp robot/bridge/navigator_bridge.py run@ROBOT:~/deception/
```

## 2. Log in

```bash
ssh run@ROBOT
```

The user `run` is shared by every team and by the robot's own software. Rules:

- work only inside `~/deception`;
- never `pip install --user`, never `sudo`, never touch another team's folder;
- never run anything that moves the robot.

## 3. Set up the environment (paste the whole block; repeat it in every new terminal)

```bash
cd ~/deception
source /opt/ros/humble/setup.bash
export PYTHONPATH=/agibot/software/common/local/lib/python3.10/dist-packages:$PYTHONPATH
export LD_LIBRARY_PATH=/agibot/software/common/lib:$LD_LIBRARY_PATH
export AMENT_PREFIX_PATH=/agibot/software/common:$AMENT_PREFIX_PATH
export PYTHONPATH=$PWD/pylib:$PYTHONPATH
export NAVIGATOR_ACCESS_CODE=PUT_THE_ACCESS_CODE_HERE
```

First time only, install the one library we need into our own folder:

```bash
python3 -m pip install --no-deps --target ./pylib websocket-client
```

If that fails because the robot has no internet, use the copy shipped in the repo:

```bash
python3 -m pip install --no-deps --no-index --find-links vendor --target ./pylib websocket-client
```

## 4. Make sure no other team is using the speaker

```bash
ros2 topic info -v --no-daemon /aima/hal/audio/playback
```

Read the publisher list. If another team's bridge is in it, ask them to stop it before you go on.

## 5. Switch off the built-in assistant ("Lumi") for our slot

Otherwise it answers too and talks to our agent.

```bash
ros2 service call /aimdk_5Fmsgs/srv/SetAgentPropertiesRequest aimdk_msgs/srv/SetAgentPropertiesRequest "{contents: {properties: [{key: {value: 2}, value: only_voice}]}}"
aima em stop-app agent
aima em start-app agent
```

## 6. Check (about 15 seconds)

```bash
python3 navigator_bridge.py --preflight
```

It prints PASS or FAIL per line: internet, agent session, ROS topics, mic, speaker (it plays a short test phrase), agent connection.

- The **mic** line listens on the wake-word stream. A FAIL on that line alone is fine, because step 7 uses the raw microphone instead.
- **internet** or **session** FAIL: the robot has no internet. Use the fallback in section 10.
- **speaker** FAIL: someone else holds the speaker (step 4) or Lumi is still on (step 5).

## 7. Run it

```bash
python3 navigator_bridge.py --mic raw --half-duplex --volume 95
```

- `--mic raw`: the raw microphone, **no wake word needed**. Just talk.
- `--half-duplex`: the raw microphone has no echo cancellation, so the robot would hear and answer itself without this. It means the robot does not listen while it is speaking: wait until it finishes, then talk.
- `--volume 95`: for the loud hall (the robot's normal volume is 72).
- **Enter** = start a fresh take. **q** then Enter = quit. Touching the robot's head also starts a fresh take.

You should hear: "أهلًا، أنا دليل آلي بالذكاء الاصطناعي. Hi, I'm an AI robot guide. Where would you like to go?"

If the raw microphone gives nothing, use the wake-word stream instead: run `python3 navigator_bridge.py --half-duplex --volume 95` and say the robot's wake word once before talking.

## 8. Quick test (say these, note what it answers)

1. Visitor, Arabic: "أبغى أروح المطبخ". Expect an Arabic confirmation, then "Operator, we're going to the kitchen" and a question about where the robot is.
2. Operator: "Operator here, at the pitch room door, facing reception." Expect "Operator, walk straight and stop at the purple pillar with the green speech bubble."
3. Operator: "Done." Expect "...walk straight and stop at the peach pillar."
4. Operator: "Done." Expect "...turn left. Walk straight and stop at the cafeteria menu boards."
5. Operator: "Done." Expect "Operator, stop here. Can you confirm we're at the cafeteria menu boards?"
6. Operator: "Confirmed." Expect the arrival announcement in Arabic.
7. Visitor, English: "Take me to the meeting room." Expect: not mapped yet, and an offer of the team tables or the kitchen.
8. Visitor: "What bus goes to Dubai Silicon Oasis?" Expect "One moment", then bus routes.

Only the **team tables** and the **kitchen** (the cafeteria) have directions today. The directions were drafted from a video and nobody has walked them, so **write down any wrong turn or landmark**. The robot can stand still for this test; you only need to say the operator lines.

Also note: how long it takes to answer, whether it cuts itself off, whether the volume is right, whether it hears you from 1-2 metres.

## 9. Before you leave: stop and put the robot back (do not skip)

Press **q** then Enter (or Ctrl+C) to stop our bridge. Then:

```bash
ros2 service call /aimdk_5Fmsgs/srv/SetVolume aimdk_msgs/srv/SetVolume "{audio_volume: 72}"
ros2 service call /aimdk_5Fmsgs/srv/SetAgentPropertiesRequest aimdk_msgs/srv/SetAgentPropertiesRequest "{contents: {properties: [{key: {value: 2}, value: normal}]}}"
aima em stop-app agent
aima em start-app agent
```

Then, from your laptop, fetch the logs and send them to Wasif (transcripts and timings, no secrets):

```bash
scp -r run@ROBOT:~/deception/logs ./robot-logs
```

## 10. If something goes wrong

| What you see | Do this |
|---|---|
| `ssh` times out | You are not on the robot's network. Join the hall Wi-Fi or plug in the cable, and check the address (section 0). |
| `ModuleNotFoundError: aimdk_msgs` or `rclpy` | The environment block in step 3 was not pasted in this terminal. Paste it again. |
| `ModuleNotFoundError: websocket` | Run the install line in step 3, and check `export PYTHONPATH=$PWD/pylib:$PYTHONPATH` was run from `~/deception`. |
| Robot answers itself or talks in a loop | Make sure `--half-duplex` is on the command. Lower the volume: `--volume 80`. |
| Two voices answer | Lumi is still on. Repeat step 5. |
| Robot is silent | Check step 4 (speaker in use) and raise the volume: `ros2 service call /aimdk_5Fmsgs/srv/SetVolume aimdk_msgs/srv/SetVolume "{audio_volume: 95}"` |
| It does not hear you | Check the microphone is publishing: `ros2 topic hz /aima/hal/audio/capture` (Ctrl+C to stop). If it is, try the wake-word run at the end of step 7. |
| "access code" or session error | Check `NAVIGATOR_ACCESS_CODE` in step 3. |
| Robot has no internet | Run the bridge on your laptop next to the robot instead: `pip install websocket-client sounddevice numpy`, then in `robot/bridge`: `python navigator_bridge.py --io laptop --code PUT_THE_ACCESS_CODE_HERE` (uses the laptop's microphone and speaker). |
| Anything that looks unsafe | Stop the bridge (Ctrl+C), do step 9, call a MangoBot engineer. |

## 11. What to send back to Wasif

- The preflight output (copy the text).
- The `robot-logs` folder from step 9.
- For each line of the quick test in section 8: what the robot actually said.
- Anything about the floor: where the meeting room, the conference room and the four call booths are, and where the robot starts.

More detail (all flags, what the lights mean, a longer test script): `ROBOT_TEST_HANDOFF_FOR_AI_AGENT.md` and `robot/bridge/QUICKSTART.md`. Where those two say "Docker container" or "PC2", this file wins: it reflects what was tested on the robot on 24 Nov.
