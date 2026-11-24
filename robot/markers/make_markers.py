#!/usr/bin/env python3
"""Print the ArUco sign markers (A4, 300 dpi).

Each page is one DICT_4X4_50 marker (the camera's ground truth) plus the sign
text the operator reads — the same printout is both. Marker ids match
MARKER_LABELS in robot/bridge/navigator_bridge.py:

    1..6   signs A..F        11..14  call booths 1..4
    21     meeting room      22      conference room
    23     team tables       24      kitchen

    python3 robot/markers/make_markers.py        # writes *.png + markers.pdf

Needs opencv-contrib-python + Pillow (laptop only — nothing here runs on the
robot).
"""

import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

DPI = 300
PAGE = (2480, 3508)                 # A4 portrait @ 300 dpi
MARKER_PX = 1500                    # ~12.7 cm — big enough for the RGB-D camera
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# (marker id, big sign text) — keep in sync with MARKER_LABELS.
SIGNS = (
    [(i, f'SIGN {chr(ord("A") + i - 1)}') for i in range(1, 7)]
    + [(10 + i, f'CALL BOOTH {i}') for i in range(1, 5)]
    + [(21, 'MEETING ROOM'), (22, 'CONFERENCE ROOM'),
       (23, 'TEAM TABLES'), (24, 'KITCHEN')]
)


def font(size):
    for name in ('DejaVuSans-Bold.ttf', 'arialbd.ttf', 'Arial Bold.ttf'):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_page(marker_id, text):
    aruco = cv2.aruco
    dictionary = aruco.getPredefinedDictionary(aruco.DICT_4X4_50)
    marker = aruco.generateImageMarker(dictionary, marker_id, MARKER_PX)
    page = Image.new('L', PAGE, 255)
    page.paste(Image.fromarray(marker),
               ((PAGE[0] - MARKER_PX) // 2, 480))
    draw = ImageDraw.Draw(page)
    big = font(340)
    box = draw.textbbox((0, 0), text, font=big)
    draw.text(((PAGE[0] - (box[2] - box[0])) // 2, 2350), text,
              font=big, fill=0)
    small = font(120)
    draw.text((180, 3280), f'aruco 4x4_50  id {marker_id}', font=small, fill=80)
    return page.convert('RGB')


def main():
    pages = []
    for marker_id, text in SIGNS:
        page = make_page(marker_id, text)
        name = f'marker_{marker_id:02d}_{text.lower().replace(" ", "_")}.png'
        page.save(os.path.join(OUT_DIR, name), dpi=(DPI, DPI))
        pages.append(page)
        print(name)
    pdf = os.path.join(OUT_DIR, 'markers.pdf')
    pages[0].save(pdf, save_all=True, append_images=pages[1:],
                  resolution=DPI)
    print('markers.pdf')


if __name__ == '__main__':
    main()
