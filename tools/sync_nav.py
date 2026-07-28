#!/usr/bin/env python3
"""Apply the shared navbar (tools/site_nav.py) to the hand-written pages.

The generated pages get it by importing site_nav directly:

    documentation.html, docs/*.html  -> tools/build_docs.py
    blog/**/index.html               -> tools/sync_blog.py

This script covers the two pages that are maintained by hand. Run it after
changing NAV_ITEMS, then rebuild the generated pages so all five surfaces stay
in step.

    python tools/sync_nav.py --dry-run -v
    python tools/sync_nav.py
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from site_nav import nav_html

# page -> the NAV_ITEMS key that should render as active on it.
STATIC_PAGES = {
    "index.html": None,          # home is the brand, not a nav item
    "configurator.html": "configurator",
}

NAV_BLOCK = re.compile(r'[ \t]*<nav class="navbar.*?</nav>', re.DOTALL)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent),
                        help="site root (default: this repo)")
    parser.add_argument("--dry-run", action="store_true", help="report changes, write nothing")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    changed = []
    for name, active in STATIC_PAGES.items():
        path = root / name
        original = path.read_text(encoding="utf-8")
        matches = NAV_BLOCK.findall(original)
        if len(matches) != 1:
            print(f"error: {name} has {len(matches)} navbars, expected exactly 1", file=sys.stderr)
            return 1
        updated = NAV_BLOCK.sub(lambda _: nav_html(active), original, count=1)
        if updated == original:
            if args.verbose:
                print(f"  unchanged {name}")
            continue
        changed.append(name)
        if args.verbose:
            print(f"  update {name}")
        if not args.dry_run:
            path.write_text(updated, encoding="utf-8")

    verb = "would update" if args.dry_run else "updated"
    print(f"{len(STATIC_PAGES)} hand-written page(s): "
          + (f"{verb} {', '.join(changed)}" if changed else "navbar already in sync"))
    if changed and not args.dry_run:
        print("now rebuild the generated pages: "
              "python tools/build_docs.py && python tools/sync_blog.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
