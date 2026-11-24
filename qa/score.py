"""Check the team's manually recorded qualification evidence. No network or media access."""

import argparse
import json
import math
from pathlib import Path

FILMS = ("EASY", "MUSIC", "CHANGE")
FLAGS = ("one_take", "cast_in_shot", "verified_stop_and_arrival")
SPECIAL = {"MUSIC": "organizer_music", "CHANGE": "organizer_change_mid_route"}


def template():
    def entry():
        return {"status": "NOT_RUN", "evidence": ""}

    return {
        "schema_version": 2,
        "candidate_revision": "",
        "course_revision": "",
        "survey": entry(),
        "blind_walk": {case: entry() for case in ("HOLD", *FILMS)},
        "robot_audio": entry(),
        "films": {
            case: {
                **entry(), "duration_s": None, "languages": [],
                **dict.fromkeys((*FLAGS, *((SPECIAL[case],) if case in SPECIAL else ())), None),
            } for case in FILMS
        },
        "video": {
            **entry(), "duration_s": None, "cuts_only_between_routes": None,
        },
    }


def assess(card):
    if card["schema_version"] != 2:
        raise ValueError("Expected schema version 2.")
    missing, failed = [], []

    def evidence(label, record):
        status = record["status"]
        if status not in ("PASS", "FAIL", "NOT_RUN"):
            raise ValueError(f"{label}: invalid status {status!r}.")
        recorded = record["evidence"].strip()
        if status == "FAIL":
            failed.append(f"{label}: recorded FAIL")
        if status == "NOT_RUN" or not recorded:
            missing.append(f"{label}: status or evidence reference")

    def flag(label, record, name):
        value = record[name]
        if value is False:
            failed.append(f"{label}: {name}")
        elif value is None:
            missing.append(f"{label}: {name}")
        elif value is not True:
            raise ValueError(f"{label}: {name} must be true, false or null.")

    def duration(label, record):
        value = record["duration_s"]
        if value is None:
            missing.append(f"{label}: duration_s")
        elif type(value) not in (float, int) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"{label}: duration_s must be a positive number or null.")
        return value

    for name in ("candidate_revision", "course_revision"):
        if not card[name].strip():
            missing.append(name)
    evidence("survey", card["survey"])
    for case in ("HOLD", *FILMS):
        evidence(f"blind {case}", card["blind_walk"][case])
    navigation = "FAIL" if failed else "INCOMPLETE" if missing else "PASS"
    evidence("robot audio", card["robot_audio"])
    durations = []
    for case in FILMS:
        film = card["films"][case]
        label = f"film {case}"
        evidence(label, film)
        durations.append(duration(label, film))
        for name in FLAGS:
            flag(label, film, name)
        if case in SPECIAL:
            flag(label, film, SPECIAL[case])
        languages = film["languages"]
        if not isinstance(languages, list) or any(
            not isinstance(value, str) or not value.strip() for value in languages
        ):
            raise ValueError(f"{label}: languages must be a list of nonblank names.")
        if len({value.strip().casefold() for value in languages}) < 2:
            target = failed if film["status"] == "PASS" or languages else missing
            target.append(f"{label}: two distinct languages")
    video = card["video"]
    evidence("assembled video", video)
    final_s = duration("assembled video", video)
    flag("assembled video", video, "cuts_only_between_routes")
    if final_s is not None and final_s > 180:
        failed.append("assembled video exceeds 180 seconds")
    if None not in durations:
        total_s = sum(durations)
        if total_s > 180:
            failed.append("three takes exceed 180 seconds")
        if final_s is not None and final_s + 0.001 < total_s:
            failed.append("assembled video is shorter than its three continuous takes")
    return navigation, missing, failed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", nargs="?", type=Path)
    parser.add_argument("--template", action="store_true")
    args = parser.parse_args()
    if args.template and args.file is None:
        print(json.dumps(template(), indent=2))
        return 0
    if args.file is None or args.template:
        parser.error("Provide one scorecard path or --template.")
    try:
        navigation, missing, failed = assess(json.loads(args.file.read_text(encoding="utf-8-sig")))
    except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError) as error:
        print(f"Invalid scorecard: {error}")
        return 3
    print(f"Survey and blind rehearsal: {navigation} (manual evidence).")
    for label, items in (("Failed", failed), ("Missing", missing)):
        if items:
            print(f"{label}: {'; '.join(items)}.")
    if failed or missing:
        print("NOT READY.")
        return 1 if failed else 2
    print("Recorded gates complete. Review the cited evidence before sign-off.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
