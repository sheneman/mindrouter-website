#!/usr/bin/env python3
"""Pull-syndicate the MindRouter blog into this site's blog/ subtree.

The gateway at mindrouter.uidaho.edu publishes the posts it has selected for
syndication at /api/blog/syndicated. This script treats that feed as the sole
source of truth for blog/: it renders each post with this site's templates,
rehosts the post images, regenerates the listing and RSS feed, and deletes any
post directory or image that the feed no longer mentions.

Rendering is deterministic — the same feed always produces byte-identical
output — so a sync that changes nothing leaves the git tree clean.

    python tools/sync_blog.py                # sync from the live feed
    python tools/sync_blog.py --dry-run -v   # report what would change
    python tools/sync_blog.py --feed-file f.json --root /tmp/site   # offline test
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from site_nav import nav_html

FEED_URL = "https://mindrouter.uidaho.edu/api/blog/syndicated"
SITE_URL = "https://mindrouter.ai"
BLOG_TAGLINE = "Updates, tutorials, and best practices from the MindRouter team."
USER_AGENT = "mindrouter-website-blog-sync/1.0 (+https://mindrouter.ai)"

# Slugs become directory names and URLs; image paths become file paths. Both
# come from a trusted service, but they are still untrusted input as far as the
# filesystem is concerned.
SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
IMAGE_PATH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$")

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
RFC822_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
RFC822_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------

def http_get(url: str, timeout: float = 30.0, retries: int = 3) -> bytes:
    """GET a URL with a couple of retries on transient failures."""
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            last = exc
            # A 4xx other than 429 will not fix itself; fail fast.
            if isinstance(exc, urllib.error.HTTPError) and 400 <= exc.code < 500 and exc.code != 429:
                break
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"GET {url} failed: {last}")


def load_feed(url: str | None, path: str | None) -> dict:
    raw = Path(path).read_bytes() if path else http_get(url or FEED_URL)
    feed = json.loads(raw.decode("utf-8"))
    if not isinstance(feed, dict) or not isinstance(feed.get("posts"), list):
        raise RuntimeError("feed is not a JSON object with a 'posts' list")
    return feed


# --------------------------------------------------------------------------
# Markdown rendering
# --------------------------------------------------------------------------

def render_markdown(text: str) -> str:
    """Render post markdown with the extensions css/blog.css is styled for."""
    import markdown  # imported lazily so --renderer html needs no dependency

    md = markdown.Markdown(extensions=["fenced_code", "codehilite", "tables",
                                       "sane_lists", "attr_list"],
                           extension_configs={"codehilite": {"guess_lang": False}})
    return md.convert(text)


def post_content_html(post: dict, renderer: str) -> str:
    """Return the post body as HTML, per the selected renderer."""
    md_source = post.get("content_markdown")
    if renderer in ("markdown", "auto") and md_source:
        try:
            return render_markdown(md_source)
        except ImportError:
            if renderer == "markdown":
                raise RuntimeError(
                    "the 'markdown' package is required for --renderer markdown "
                    "(pip install markdown pygments), or pass --renderer html"
                ) from None
    return post.get("content_html") or ""


# --------------------------------------------------------------------------
# Dates
# --------------------------------------------------------------------------

def parse_dt(value) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def human_date(dt: datetime | None) -> str:
    return f"{MONTHS[dt.month - 1]} {dt.day}, {dt.year}" if dt else ""


def rfc822(dt: datetime) -> str:
    """RFC 822 date for RSS, built without locale-dependent strftime names."""
    return (f"{RFC822_DAYS[dt.weekday()]}, {dt.day:02d} {RFC822_MONTHS[dt.month - 1]} "
            f"{dt.year} {dt.hour:02d}:{dt.minute:02d}:{dt.second:02d} +0000")


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------

def esc(value) -> str:
    return html.escape(value if isinstance(value, str) else "", quote=True)


FOOTER_HTML = """    <footer class="site-footer py-4 mt-5">
        <div class="container text-center">
            <p class="mb-2" style="font-size:1.1rem; font-weight:600;">
                <i class="bi bi-router" style="color:var(--mindrouter-primary);"></i> MindRouter
            </p>
            <p class="text-muted mb-2" style="font-size:0.9rem;">Open-Source LLM Inference Load Balancer</p>
            <p class="text-muted mb-2" style="font-size:0.82rem;">
                Developed by <a href="https://hpc.uidaho.edu" class="text-muted">Research Computing &amp; Data Services (RCDS)</a>
                at the <a href="https://www.uidaho.edu" class="text-muted">University of Idaho</a>
                &middot;
                <a href="https://www.iids.uidaho.edu" class="text-muted">Institute for Interdisciplinary Data Sciences (IIDS)</a>
            </p>
            <p class="text-muted mb-2" style="font-size:0.82rem;">
                <a href="https://github.com/ui-insight/MindRouter" class="text-muted"><i class="bi bi-github"></i> GitHub</a>
                &nbsp;&middot;&nbsp; Apache 2.0 License
                &nbsp;&middot;&nbsp;
                <a href="/blog/feed.xml" class="text-muted"><i class="bi bi-rss"></i> RSS</a>
            </p>
            <p class="text-muted mb-2 mx-auto" style="font-size:0.78rem; max-width:760px; line-height:1.7;">
                Sheneman, L. (2026). <em>MindRouter: Open-source LLM inference gateway for institutional AI sovereignty.</em>
                PEARC&nbsp;&rsquo;26. Association for Computing Machinery.
                <a href="https://doi.org/10.1145/3785462.3815861" class="text-muted" target="_blank" rel="noopener">doi:10.1145/3785462.3815861</a>
            </p>
            <div class="mt-3">
                <a href="https://www.uidaho.edu" target="_blank" rel="noopener"><img src="/img/uidaho-logo.png" alt="University of Idaho" class="uidaho-logo"></a>
            </div>
        </div>
    </footer>"""

THEME_SCRIPT = """    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
    <script>
    (function() {
        var btn = document.getElementById('themeToggleBtn');
        if (!btn) return;
        var icon = btn.querySelector('i');
        function updateIcon() {
            var isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
            if (icon) icon.className = isDark ? 'bi bi-moon-fill' : 'bi bi-sun-fill';
        }
        updateIcon();
        btn.addEventListener('click', function() {
            var next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-bs-theme', next);
            localStorage.setItem('mr-theme', next);
            updateIcon();
        });
    })();
    </script>"""


def page_head(title: str, description: str, canonical: str, og_type: str,
              extra: str = "") -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>{esc(title)}</title>
    <meta name="description" content="{esc(description)}">
    <meta property="og:title" content="{esc(title)}">
    <meta property="og:description" content="{esc(description)}">
    <meta property="og:type" content="{og_type}">
    <meta property="og:url" content="{esc(canonical)}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="canonical" href="{esc(canonical)}">
    <link rel="alternate" type="application/rss+xml" title="MindRouter Blog" href="/blog/feed.xml">
{extra}    <script>
    (function() {{
        var t = localStorage.getItem('mr-theme') ||
                (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-bs-theme', t);
    }})();
    </script>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css" rel="stylesheet">
    <link href="/css/style.css" rel="stylesheet">
    <link href="/css/blog.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/pygments-css@1.0.0/github.min.css" rel="stylesheet">
</head>
<body>
    <a class="skip-link" href="#main-content">Skip to main content</a>
{nav_html("blog")}
"""


def byline(dt: datetime | None, author: str | None) -> str:
    """Date and author line; either half may be absent."""
    bits = []
    if dt:
        bits.append(f'<time datetime="{esc(dt.isoformat())}">{esc(human_date(dt))}</time>')
    if author:
        bits.append(f"By {esc(author)}")
    return "&nbsp;&middot;&nbsp;".join(bits)


def render_post_page(post: dict, body_html: str, prev_post: dict | None,
                     next_post: dict | None) -> str:
    """A single post at /blog/<slug>/. `prev` is newer, `next` is older."""
    slug = post["slug"]
    url = f"{SITE_URL}/blog/{slug}/"
    published = parse_dt(post.get("published_at"))
    updated = parse_dt(post.get("updated_at"))
    author = (post.get("author") or "").strip() or None
    description = (post.get("description") or "").strip()

    ld = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": post.get("title") or slug,
        "url": url,
        "mainEntityOfPage": url,
        "publisher": {"@type": "Organization", "name": "MindRouter"},
    }
    if description:
        ld["description"] = description
    if published:
        ld["datePublished"] = published.isoformat()
    if updated:
        ld["dateModified"] = updated.isoformat()
    if author:
        ld["author"] = {"@type": "Person", "name": author}
    images = [img["url_local"] for img in post.get("_images", [])]
    if images:
        ld["image"] = [f"{SITE_URL}{path}" for path in images]
    ld_json = json.dumps(ld, indent=4, sort_keys=True).replace("</", "<\\/")
    extra = (f'    <meta property="article:published_time" content="{esc(published.isoformat())}">\n'
             if published else "")

    meta_line = byline(published, author)
    meta_html = (f'                    <p class="text-muted mb-4" style="font-size:0.9rem;">{meta_line}</p>\n'
                 if meta_line else "")

    def link(p: dict | None, direction: str) -> str:
        if not p:
            return '<span class="flex-fill"></span>'
        arrow, align = ("&larr;", "start") if direction == "prev" else ("&rarr;", "end")
        label = "Newer post" if direction == "prev" else "Older post"
        title = esc(p.get("title") or p["slug"])
        return (f'<a class="flex-fill text-{align} text-decoration-none" href="/blog/{esc(p["slug"])}/">'
                f'<span class="d-block text-muted" style="font-size:0.78rem;">{arrow} {label}</span>'
                f'<span>{title}</span></a>')

    nav_links = ""
    if prev_post or next_post:
        nav_links = f"""                    <hr class="my-5">
                    <nav class="d-flex justify-content-between gap-4" aria-label="Post navigation">
                        {link(prev_post, "prev")}
                        {link(next_post, "next")}
                    </nav>
"""

    return f"""{page_head(f'{post.get("title") or slug} — MindRouter Blog', description, url, "article", extra)}    <main id="main-content">
        <div class="container py-5">
            <div class="row">
                <div class="col-lg-8 mx-auto">
                    <p class="mb-3"><a href="/blog/" class="text-decoration-none text-muted" style="font-size:0.85rem;">&larr; All posts</a></p>
                    <h1 class="mb-2">{esc(post.get("title") or slug)}</h1>
{meta_html}                    <article class="blog-content">
{body_html}
                    </article>
{nav_links}                </div>
            </div>
        </div>
    </main>
{FOOTER_HTML}
    <script type="application/ld+json">
{ld_json}
    </script>
{THEME_SCRIPT}
</body>
</html>
"""


def render_index_page(posts: list[dict]) -> str:
    url = f"{SITE_URL}/blog/"
    if posts:
        entries = []
        for post in posts:
            published = parse_dt(post.get("published_at"))
            author = (post.get("author") or "").strip() or None
            meta_line = byline(published, author)
            meta_html = (f'                            <p class="text-muted mb-2" style="font-size:0.85rem;">{meta_line}</p>\n'
                         if meta_line else "")
            description = (post.get("description") or "").strip()
            desc_html = f'                            <p class="mb-2">{esc(description)}</p>\n' if description else ""
            entries.append(
                f"""                        <li class="mb-4 pb-4 border-bottom">
                            <h2 class="h4 mb-1"><a class="text-decoration-none" href="/blog/{esc(post["slug"])}/">{esc(post.get("title") or post["slug"])}</a></h2>
{meta_html}{desc_html}                            <a class="text-decoration-none" style="font-size:0.9rem;" href="/blog/{esc(post["slug"])}/">Read more &rarr;</a>
                        </li>""")
        listing = ('                    <ul class="list-unstyled mb-0">\n'
                   + "\n".join(entries) + "\n                    </ul>")
    else:
        listing = '                    <p class="text-muted">No posts yet. Check back soon.</p>'

    return f"""{page_head("Blog — MindRouter", BLOG_TAGLINE, url, "website")}    <main id="main-content">
        <div class="container py-5">
            <div class="row">
                <div class="col-lg-8 mx-auto">
                    <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-1">
                        <h1 class="mb-0">Blog</h1>
                        <a class="text-decoration-none text-muted" style="font-size:0.85rem;" href="/blog/feed.xml"><i class="bi bi-rss"></i> RSS</a>
                    </div>
                    <p class="text-muted mb-4">{esc(BLOG_TAGLINE)}</p>
{listing}
                </div>
            </div>
        </div>
    </main>
{FOOTER_HTML}
{THEME_SCRIPT}
</body>
</html>
"""


def render_feed_xml(posts: list[dict]) -> str:
    """RSS 2.0 over this site's own post URLs."""
    dates = [d for d in (parse_dt(p.get("published_at")) or parse_dt(p.get("updated_at"))
                         for p in posts) if d]
    build = f"    <lastBuildDate>{rfc822(max(dates))}</lastBuildDate>\n" if dates else ""
    items = []
    for post in posts:
        url = f"{SITE_URL}/blog/{post['slug']}/"
        published = parse_dt(post.get("published_at"))
        pub = f"      <pubDate>{rfc822(published)}</pubDate>\n" if published else ""
        description = (post.get("description") or "").strip()
        desc = f"      <description>{esc(description)}</description>\n" if description else ""
        author = (post.get("author") or "").strip()
        creator = f"      <dc:creator>{esc(author)}</dc:creator>\n" if author else ""
        items.append(f"""    <item>
      <title>{esc(post.get("title") or post["slug"])}</title>
      <link>{esc(url)}</link>
      <guid isPermaLink="true">{esc(url)}</guid>
{pub}{desc}{creator}    </item>""")
    body = "\n".join(items)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>MindRouter Blog</title>
    <link>{SITE_URL}/blog/</link>
    <atom:link href="{SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml"/>
    <description>{esc(BLOG_TAGLINE)}</description>
    <language>en-us</language>
{build}{body}{chr(10) if body else ""}  </channel>
</rss>
"""


# --------------------------------------------------------------------------
# Filesystem reconciliation
# --------------------------------------------------------------------------

class Tree:
    """Applies file changes (or just reports them, when dry_run)."""

    def __init__(self, dry_run: bool, verbose: bool):
        self.dry_run = dry_run
        self.verbose = verbose
        self.changes: list[str] = []

    def note(self, message: str) -> None:
        self.changes.append(message)
        if self.verbose:
            print(f"  {message}")

    def write(self, path: Path, text: str) -> None:
        if path.exists() and path.read_text(encoding="utf-8") == text:
            return
        self.note(f"{'update' if path.exists() else 'create'} {path}")
        if not self.dry_run:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")

    def write_bytes(self, path: Path, data: bytes) -> None:
        self.note(f"{'update' if path.exists() else 'create'} {path}")
        if not self.dry_run:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    def remove_file(self, path: Path) -> None:
        self.note(f"delete {path}")
        if not self.dry_run:
            path.unlink()

    def remove_dir(self, path: Path) -> None:
        self.note(f"delete {path}/")
        if not self.dry_run:
            shutil.rmtree(path)


def valid_posts(feed: dict, verbose: bool) -> list[dict]:
    posts, seen = [], set()
    for post in feed["posts"]:
        slug = post.get("slug") if isinstance(post, dict) else None
        if not isinstance(slug, str) or not SLUG_RE.match(slug) or ".." in slug:
            print(f"warning: skipping post with unusable slug {slug!r}", file=sys.stderr)
            continue
        if slug in seen:
            print(f"warning: skipping duplicate slug {slug!r}", file=sys.stderr)
            continue
        seen.add(slug)
        posts.append(post)
    return posts


def sync_images(post: dict, images_dir: Path, tree: Tree, base_url: str) -> list[dict]:
    """Rehost a post's images locally. Content-addressed paths are immutable,
    so an existing file is never re-downloaded."""
    kept = []
    for image in post.get("images") or []:
        if not isinstance(image, dict):
            continue
        path = (image.get("path") or "").lstrip("/")
        url = image.get("url") or ""
        if not path or not IMAGE_PATH_RE.match(path) or ".." in path.split("/"):
            print(f"warning: skipping image with unusable path {path!r}", file=sys.stderr)
            continue
        if not url.startswith(("https://", "http://")):
            url = f"{base_url.rstrip('/')}/blog/images/{path}"
        dest = images_dir / path
        if not dest.exists():
            tree.write_bytes(dest, http_get(url))
        kept.append({"path": path, "url_remote": url, "url_local": f"/blog/images/{path}"})
    return kept


def localize_image_urls(body_html: str, images: list[dict], base_url: str) -> str:
    """Point any absolute gateway image URL at our rehosted copy."""
    for image in images:
        for remote in {image["url_remote"],
                       f"{base_url.rstrip('/')}/blog/images/{image['path']}"}:
            body_html = body_html.replace(remote, image["url_local"])
    return body_html


# Deployment-specific hostnames do not belong on a product site. tools/
# build_docs.py applies the same rule to the documentation pages. An email
# address such as mindrouter@uidaho.edu has no label before uidaho.edu, so it
# is left alone.
UIDAHO_HOST = re.compile(r"\b([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.uidaho\.edu\b")

# Posts are written for the University of Idaho deployment and syndicated to a
# product site that serves every deployment. These substitutions neutralise the
# passages where the institution is incidental — instructions addressed to
# campus readers, and technical facts that happen to name the operator.
#
# Deliberately NOT rewritten: authorship and funding credits (they are accurate
# and match the site footer), citations of other institutions' deployments, and
# "on-campus"/"on-premises" phrasing that names no one in particular.
#
# Each pattern is an exact substring of the upstream markdown. When upstream
# edits one of these sentences the substitution stops matching, and the sync
# warns instead of silently letting the original wording through.
PROSE_REWRITES: dict[str, list[tuple[str, str]]] = {
    "agentic-ai-on-campus-powering-claude-code-with-mindrouter": [
        ("How the University of Idaho runs autonomous coding agents",
         "How we run autonomous coding agents"),
        ("At the University of Idaho, that backend is",
         "In our case, that backend is"),
        ("MindRouter is the University of Idaho's institutional LLM inference platform.",
         "MindRouter is an institutional LLM inference platform."),
        ("MindRouter at the University of Idaho has not yet been approved",
         "Our MindRouter deployment has not yet been approved"),
        ("If you're at the University of Idaho, getting started takes about five minutes:",
         "Getting started takes about five minutes:"),
    ],
    "from-audio-to-text-secure-on-campus-dictation-and-transcription-with-mindrouter": [
        ("all running on dedicated GPUs at the University of Idaho.",
         "all running on dedicated on-premises GPUs."),
        ("within the University of Idaho's on-premises MindRouter Artificial Intelligence GPU cluster.",
         "within an on-premises MindRouter Artificial Intelligence GPU cluster."),
        ("The Whisper model runs on NVIDIA GPUs in the University of Idaho's on-premises cluster.",
         "The Whisper model runs on NVIDIA GPUs in the institution's on-premises cluster."),
        ("The Voice API is available to all University of Idaho users with a MindRouter account.",
         "The Voice API is available to all users with a MindRouter account."),
    ],
    "bring-your-own-search-giving-your-llms-and-agents-a-window-to-the-live-web": [
        ("will leave the University of Idaho's MindRouter instance",
         "will leave your MindRouter instance"),
    ],
    "the-almost-free-lunch-how-speculative-decoding-doubles-our-ai-throughput": [
        ("The MindRouter cluster serves the entire University of Idaho community.",
         "The MindRouter cluster serves our entire user community."),
    ],
}

# Fields carrying prose that reaches a reader.
PROSE_FIELDS = ("title", "description", "content_markdown", "content_html")

# Institution references that are meant to survive: authorship and funding
# credits, and the support address. Anything else that mentions the operator is
# flagged after rendering — that check is on the result rather than on the
# substitutions, so it still fires when upstream rewords a passage and a
# PROSE_REWRITES entry silently stops matching.
INSTITUTION_RE = re.compile(r"University of Idaho|\bU of I\b|uidaho", re.IGNORECASE)
INSTITUTION_KEEP = (
    "Research Computing and Data Services",
    "developed and maintained at the University of Idaho with support from the "
    "National Science Foundation",
    "mindrouter@uidaho.edu",
)


def localize_post_links(body_html: str, slugs: set[str], base_url: str) -> str:
    """Point gateway links to posts we also host at our own copy.

    Matched on the URL rather than an href attribute: post markdown contains
    hand-written anchors, including upper-case <A HREF="...">.
    """
    prefix = re.escape(f"{base_url.rstrip('/')}/blog/")
    for slug in slugs:
        body_html = re.sub(f"{prefix}{re.escape(slug)}/?", f"/blog/{slug}/", body_html)
    return body_html


def rewrite_prose(post: dict) -> int:
    """Neutralise institution-specific wording in a post, in place.

    Returns the number of substitutions applied. A configured substitution that
    matches nothing is reported: upstream has reworded that passage, and the
    original phrasing may now be reaching the site unchanged.
    """
    applied = 0
    for original, replacement in PROSE_REWRITES.get(post["slug"], []):
        hit = False
        for field in PROSE_FIELDS:
            value = post.get(field)
            if isinstance(value, str) and original in value:
                post[field] = value.replace(original, replacement)
                hit = True
        if hit:
            applied += 1
        else:
            print(f"warning: {post['slug']}: no longer matches {original!r} — check "
                  f"whether the upstream wording still needs neutralising",
                  file=sys.stderr)
    return applied


def lint_institution(body_html: str, slug: str) -> int:
    """Warn about institution references left in a rendered post body."""
    found = 0
    for match in INSTITUTION_RE.finditer(body_html):
        window = body_html[max(0, match.start() - 200):match.end() + 200]
        if any(keep in window for keep in INSTITUTION_KEEP):
            continue
        found += 1
        context = re.sub(r"\s+", " ", body_html[max(0, match.start() - 60):match.end() + 60])
        print(f"warning: {slug}: institution reference survived rendering: …{context.strip()}…",
              file=sys.stderr)
    return found


def rewrite_domains(body_html: str, report: list[str]) -> str:
    """Rewrite uidaho.edu hostnames to example.com placeholders."""
    def swap(match: re.Match) -> str:
        replacement = f"{match.group(1).split('.')[0]}.example.com"
        report.append(f"{match.group(0)} -> {replacement}")
        return replacement

    return UIDAHO_HOST.sub(swap, body_html)


def prune_posts(blog_dir: Path, keep: set[str], tree: Tree) -> None:
    for child in sorted(blog_dir.iterdir()):
        if child.is_dir() and child.name != "images" and child.name not in keep:
            tree.remove_dir(child)


def prune_images(images_dir: Path, keep: set[str], tree: Tree) -> None:
    if not images_dir.exists():
        return
    for path in sorted(images_dir.rglob("*")):
        if path.is_file() and str(path.relative_to(images_dir)) not in keep:
            tree.remove_file(path)
    # Drop directories the pruning emptied (deepest first).
    for path in sorted(images_dir.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            tree.note(f"delete {path}/")
            if not tree.dry_run:
                path.rmdir()


def sync(feed: dict, root: Path, renderer: str, tree: Tree, allow_empty: bool) -> None:
    blog_dir = root / "blog"
    images_dir = blog_dir / "images"
    base_url = feed.get("base_url") or "https://mindrouter.uidaho.edu"
    posts = valid_posts(feed, tree.verbose)

    existing = {p.name for p in blog_dir.iterdir() if p.is_dir() and p.name != "images"} \
        if blog_dir.exists() else set()
    if not posts and existing and not allow_empty:
        raise RuntimeError(
            f"feed contains no posts but {len(existing)} post director"
            f"{'y' if len(existing) == 1 else 'ies'} exist locally; refusing to delete "
            "the whole blog on what may be a transient upstream fault. Re-run with "
            "--allow-empty-feed if the posts really were un-syndicated."
        )

    blog_dir.mkdir(parents=True, exist_ok=True)

    for post in posts:
        post["_images"] = sync_images(post, images_dir, tree, base_url)

    slugs = {p["slug"] for p in posts}
    domain_report: list[str] = []
    prose_edits = 0
    for post in posts:
        prose_edits += rewrite_prose(post)
        for field in ("title", "description"):
            if isinstance(post.get(field), str):
                post[field] = rewrite_domains(post[field], domain_report)

    for index, post in enumerate(posts):
        body = post_content_html(post, renderer)
        # Order matters: image and cross-post URLs are matched against the
        # gateway hostname, so localize them before it is rewritten away.
        body = localize_image_urls(body, post["_images"], base_url)
        body = localize_post_links(body, slugs, base_url)
        body = rewrite_domains(body, domain_report)
        lint_institution(body + (post.get("description") or ""), post["slug"])
        page = render_post_page(post, body,
                                posts[index - 1] if index > 0 else None,
                                posts[index + 1] if index + 1 < len(posts) else None)
        tree.write(blog_dir / post["slug"] / "index.html", page)

    prune_posts(blog_dir, {p["slug"] for p in posts}, tree)
    prune_images(images_dir, {img["path"] for p in posts for img in p["_images"]}, tree)

    tree.write(blog_dir / "index.html", render_index_page(posts))
    tree.write(blog_dir / "feed.xml", render_feed_xml(posts))

    if domain_report and tree.verbose:
        print("  domain rewrites:")
        for entry in sorted(set(domain_report)):
            print(f"    {entry} ({domain_report.count(entry)}x)")
    if tree.verbose:
        print(f"  prose rewrites: {prose_edits} passage(s) neutralised")
        remaining = [(p["slug"], (p.get("content_markdown") or "").count("University of Idaho"))
                     for p in posts]
        for slug, count in remaining:
            if count:
                print(f"    {slug}: {count} institution reference(s) kept (attribution/citation)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--feed-url", default=FEED_URL, help="syndication endpoint")
    parser.add_argument("--feed-file", help="read the feed from a local file instead")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent),
                        help="site root containing blog/ (default: this repo)")
    parser.add_argument("--renderer", choices=["auto", "markdown", "html"], default="markdown",
                        help="'markdown' renders content_markdown (default), 'html' uses the "
                             "gateway's content_html, 'auto' prefers markdown and falls back")
    parser.add_argument("--allow-empty-feed", action="store_true",
                        help="permit deleting every local post when the feed is empty")
    parser.add_argument("--dry-run", action="store_true", help="report changes, write nothing")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    try:
        feed = load_feed(args.feed_url, args.feed_file)
        tree = Tree(args.dry_run, args.verbose)
        sync(feed, Path(args.root).resolve(), args.renderer, tree, args.allow_empty_feed)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    source = args.feed_file or args.feed_url
    count = len(feed["posts"])
    if tree.changes:
        verb = "would change" if args.dry_run else "changed"
        print(f"{count} post(s) from {source}: {verb} {len(tree.changes)} path(s)")
    else:
        print(f"{count} post(s) from {source}: blog/ already up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
