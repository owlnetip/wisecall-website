#!/usr/bin/env python3
"""Backwards-compatible wrapper for York (YO) dental marketing lists."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dental_marketing_lib import build_region


def main() -> None:
    skip_scan = "--skip-website-scan" in sys.argv
    build_region("york", skip_scan=skip_scan)


if __name__ == "__main__":
    main()
