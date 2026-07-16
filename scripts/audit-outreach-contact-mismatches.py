#!/usr/bin/env python3
"""Audit dental-prospects seed for contact emails that don't match practice websites."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "apps" / "portal" / "src" / "data" / "dental-prospects-seed.json"


def email_domain(email: str) -> str:
    email = email.strip().lower()
    return email.split("@")[-1] if "@" in email else ""


def website_host(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def domain_matches(email: str, website: str) -> bool:
    domain = email_domain(email)
    host = website_host(website)
    if not domain or not host:
        return True
    return domain == host or domain.endswith("." + host) or host.endswith("." + domain)


def main() -> None:
    data = json.loads(SEED.read_text(encoding="utf-8"))
    prospects = data.get("prospects") or []
    bad: list[dict[str, str]] = []

    for p in prospects:
        if p.get("outreach_segment") != "dentally_active":
            continue
        email = (p.get("email") or p.get("owner_email") or "").strip()
        website = (p.get("website") or "").strip()
        if not email or not website:
            continue
        if domain_matches(email, website):
            continue
        bad.append(
            {
                "practice": p.get("practice_name", ""),
                "postcode": p.get("postcode", ""),
                "region": p.get("region", ""),
                "contact": p.get("contact_name") or p.get("owner_name") or "",
                "email": email,
                "website": website,
            }
        )

    print(f"Scanned {len(prospects)} seed prospects")
    print(f"Dentally active with wrong-domain email in seed: {len(bad)}")
    for row in bad[:40]:
        print(
            f"- {row['practice']} ({row['postcode']}, {row['region']}): "
            f"{row['contact']} <{row['email']}> vs {row['website']}"
        )
    if len(bad) > 40:
        print(f"... and {len(bad) - 40} more")


if __name__ == "__main__":
    main()
