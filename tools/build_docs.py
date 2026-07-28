#!/usr/bin/env python3
"""Render mindrouter.ai's documentation from the MindRouter repository's docs.

github.com/ui-insight/MindRouter is the source of truth for product
documentation. This script pulls the markdown, rewrites it for a public site,
and renders it into this site's chrome:

  the in-app documentation template -> documentation.html
  docs/<name>.md (see PAGES)        -> docs/<name>.html

Rewrites applied on the way through:

  * uidaho.edu hostnames become example.com — the upstream media API
    references hard-code the University of Idaho deployment as their base URL,
    which is wrong for a generic product site.
  * Links between markdown files point at the generated pages; links to files
    that are not mirrored fall back to GitHub.

Output is deterministic: no timestamps or commit SHAs are embedded, so a
rebuild against unchanged upstream docs leaves the git tree clean.

    python tools/build_docs.py                 # fetch from GitHub and write
    python tools/build_docs.py --dry-run -v    # report what would change
    python tools/build_docs.py --source DIR    # use a local checkout instead
"""

from __future__ import annotations

import argparse
import html
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from site_nav import nav_html

REPO = "ui-insight/MindRouter"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/main"
BLOB_BASE = f"https://github.com/{REPO}/blob/main"
USER_AGENT = "mindrouter-website-docs-build/1.0 (+https://mindrouter.ai)"

# The in-app documentation page is the fullest account of the product — it
# carries sections docs/index.md does not (OCR, web search, MCP servers, agent
# skills, service API keys, data retention, email, DLP, security hardening).
# It is a Jinja template, but almost entirely static markup, so the content
# block can be lifted straight out.
TEMPLATE_PAGE = {
    "src": "backend/app/dashboard/templates/public/documentation.html",
    "out": "documentation.html",
    "title": "Documentation",
}

# Merged into documentation.html for the sections the in-app page omits.
SUPPLEMENT_MD = "docs/index.md"

# Same topic, different heading in the two sources. Without this the section
# would be appended a second time under its own anchor.
SUPPLEMENT_ALIASES = {"voice-api": "voice"}

PAGES = [
    {"src": "docs/images-api.md", "out": "docs/images-api.html", "title": "Image Generation API"},
    {"src": "docs/video-api.md", "out": "docs/video-api.html", "title": "Video Generation API"},
    {"src": "docs/voice-api.md", "out": "docs/voice-api.html", "title": "Voice API"},
    {"src": "docs/media-studio-integration.md", "out": "docs/media-studio-integration.html",
     "title": "Media Studio Integration"},
    {"src": "docs/architecture.md", "out": "docs/architecture.html", "title": "Architecture"},
    {"src": "docs/scheduler.md", "out": "docs/scheduler.html", "title": "Scheduler"},
    {"src": "docs/branding.md", "out": "docs/branding.html", "title": "Branding & Theming"},
]
LINK_MAP = {Path(p["src"]).name: ("/" + p["out"]) for p in PAGES}
LINK_MAP["index.md"] = "/documentation.html"

# The in-app page links to the same references on GitHub; point them at the
# copies we host.
GITHUB_DOC_LINK = re.compile(
    rf"https://github\.com/{re.escape(REPO)}/blob/[^/]+/docs/([A-Za-z0-9._-]+\.md)")

# Links to routes that only exist inside a MindRouter deployment (/docs,
# /redoc, /images, /video, /dashboard/api-keys). Unlinked rather than pointed
# at a placeholder host: the wording reads fine without the anchor, and a dead
# link is worse than none.
APP_ROUTE_LINK = re.compile(r'<a\s[^>]*href="/(?!/)[^"]*"[^>]*>(.*?)</a>', re.DOTALL)

# The upstream page opens with a numbered list of its own sections, which the
# sticky sidebar already provides. The two sub-lists under it (pointers to the
# media API references and operator guides) are worth keeping.
TOC_SECTION = "Table of Contents"
TOC_REPLACEMENT_TITLE = "Additional References"

CALLOUT_WARNING = re.compile(r"^\s*<p><strong>(Important|Warning|Caution|Note on security)",
                             re.IGNORECASE)


# --------------------------------------------------------------------------
# Source
# --------------------------------------------------------------------------

def fetch(path: str, timeout: float = 30.0, retries: int = 3) -> str:
    url = f"{RAW_BASE}/{path}"
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            last = exc
            if isinstance(exc, urllib.error.HTTPError) and 400 <= exc.code < 500:
                break
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"GET {url} failed: {last}")


def load(path: str, source: str | None) -> str:
    if source:
        return (Path(source) / path).read_text(encoding="utf-8")
    return fetch(path)


# --------------------------------------------------------------------------
# Markdown rewriting
# --------------------------------------------------------------------------

UIDAHO_HOST = re.compile(r"\b([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.uidaho\.edu\b")


def rewrite_domains(text: str, report: list[str]) -> str:
    """Point deployment-specific hostnames at example.com.

    Prose that merely names the University of Idaho is left alone; only
    hostnames are touched.
    """
    def swap(match: re.Match) -> str:
        host, prefix = match.group(0), match.group(1)
        # Keep the leftmost label so mindrouter.uidaho.edu stays recognisable
        # as mindrouter.example.com, but drop internal sub-domains.
        replacement = f"{prefix.split('.')[0]}.example.com"
        report.append(f"{host} -> {replacement}")
        return replacement

    return UIDAHO_HOST.sub(swap, text)


def rewrite_links(text: str) -> str:
    """Retarget markdown links between docs at the generated pages."""
    def swap(match: re.Match) -> str:
        label, target = match.group(1), match.group(2)
        name, _, anchor = target.partition("#")
        dest = LINK_MAP.get(name)
        if dest is None:
            dest = f"{BLOB_BASE}/docs/{name}"
        return f"[{label}]({dest}{'#' + anchor if anchor else ''})"

    return re.sub(r"\[([^\]]+)\]\((?!https?://)([A-Za-z0-9._-]+\.md)(#[^)]*)?\)",
                  lambda m: swap(re.match(r"\[([^\]]+)\]\((.+)\)", m.group(0))), text)


def strip_rules(markdown_text: str) -> str:
    """Drop the '---' separators; sections get their own <hr> when rendered."""
    out, in_fence = [], False
    for line in markdown_text.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        if not in_fence and line.strip() == "---":
            continue
        out.append(line)
    return "\n".join(out)


def smart_dashes(markdown_text: str) -> str:
    """Upstream writes ' -- ' for an em dash; render it as one.

    Code fences and inline code spans are left alone so that command-line
    flags and shell snippets survive intact.
    """
    out, in_fence = [], False
    for line in markdown_text.splitlines():
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence or " -- " not in line:
            out.append(line)
            continue
        # Odd-indexed parts are inline code spans.
        parts = line.split("`")
        for index in range(0, len(parts), 2):
            parts[index] = parts[index].replace(" -- ", " — ")
        out.append("`".join(parts))
    return "\n".join(out)


def split_sections(markdown_text: str) -> tuple[str, str, list[tuple[str, str]]]:
    """Return (page title, intro markdown, [(heading, body markdown), ...])."""
    lines = markdown_text.splitlines()
    title, start = "", 0
    for index, line in enumerate(lines):
        if line.startswith("# "):
            title, start = line[2:].strip(), index + 1
            break

    intro, sections, current = [], [], None
    for line in lines[start:]:
        if line.startswith("## "):
            if current:
                sections.append(current)
            current = (line[3:].strip(), [])
        elif current:
            current[1].append(line)
        else:
            intro.append(line)
    if current:
        sections.append(current)
    return title, "\n".join(intro), [(h, "\n".join(b)) for h, b in sections]


def drop_toc_list(body: str) -> str:
    """Remove the numbered on-page table of contents, keep everything else."""
    out, dropping = [], False
    for line in body.splitlines():
        if re.match(r"^\d+\.\s+\[", line):
            dropping = True
            continue
        if dropping and not line.strip():
            continue
        dropping = False
        out.append(line)
    return "\n".join(out).strip()


def slug(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)          # headings may contain <code> etc.
    text = re.sub(r"`|\*", "", html.unescape(text)).lower()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    return re.sub(r"-+", "-", re.sub(r"\s+", "-", text.strip())).strip("-")


def fix_anchors(page_html: str, page_name: str, verbose: bool) -> str:
    """Repoint in-page links whose anchor does not match a generated id.

    Upstream links are inconsistent about headings containing '&' — some use
    GitHub's double hyphen (#health--metrics-endpoints), some a single one.
    Match them up by collapsing runs of hyphens.
    """
    ids = set(re.findall(r'\sid="([^"]+)"', page_html))
    collapsed = {}
    for value in ids:
        collapsed.setdefault(re.sub(r"-+", "-", value), []).append(value)

    def repoint(match: re.Match) -> str:
        target = match.group(1)
        if target in ids:
            return match.group(0)
        candidates = collapsed.get(re.sub(r"-+", "-", target), [])
        if len(candidates) == 1:
            return f'href="#{candidates[0]}"'
        if verbose:
            print(f"  warning: {page_name} links to #{target}, which has no heading")
        return match.group(0)

    return re.sub(r'href="#([^"]+)"', repoint, page_html)


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def plain(text: str) -> str:
    """Heading text with inline markdown syntax stripped, for the sidebar."""
    return re.sub(r"`|\*\*|\*|_", "", text)


def render_inline(text: str) -> str:
    """Render a heading's inline markdown (`code`, **bold**) without a <p>."""
    rendered = render_markdown(text).strip()
    match = re.fullmatch(r"<p>(.*)</p>", rendered, re.DOTALL)
    return match.group(1) if match else html.escape(text)


def render_markdown(text: str) -> str:
    import markdown

    md = markdown.Markdown(extensions=["fenced_code", "tables", "sane_lists", "attr_list"])
    return md.convert(text)


def decorate(html_text: str) -> str:
    """Apply this site's conventions to rendered markdown."""
    html_text = html_text.replace("<table>", '<table class="table table-bordered table-sm">')
    html_text = re.sub(r"<(h[34])>(.*?)</\1>",
                       lambda m: f'<{m.group(1)} id="{slug(m.group(2))}">{m.group(2)}</{m.group(1)}>',
                       html_text)

    # Upstream uses blockquotes as Note/Tip/Important callouts.
    def callout(match: re.Match) -> str:
        inner = match.group(1).strip()
        kind = "warning" if CALLOUT_WARNING.match(inner) else "secondary"
        return f'<div class="alert alert-{kind}">\n{inner}\n</div>'

    return re.sub(r"<blockquote>(.*?)</blockquote>", callout, html_text, flags=re.DOTALL)


FOOTER_HTML = """    <footer class="site-footer py-4">
        <div class="container text-center">
            <p class="mb-2" style="font-size:1.1rem; font-weight:600;">
                <i class="bi bi-router" style="color:var(--mindrouter-primary);"></i> MindRouter
            </p>
            <p class="text-muted mb-2" style="font-size:0.82rem;">
                <a href="https://github.com/ui-insight/MindRouter" class="text-muted"><i class="bi bi-github"></i> GitHub</a>
                &nbsp;&middot;&nbsp; Apache 2.0 License
            </p>
            <p class="text-muted mb-2 mx-auto" style="font-size:0.78rem; max-width:760px; line-height:1.7;">
                Sheneman, L. (2026). <em>MindRouter: Open-source LLM inference gateway for institutional AI sovereignty.</em>
                PEARC&nbsp;&rsquo;26. Association for Computing Machinery.
                <a href="https://doi.org/10.1145/3785462.3815861" class="text-muted" target="_blank" rel="noopener">doi:10.1145/3785462.3815861</a>
            </p>
        </div>
    </footer>"""

PAGE_CSS = """<style>
    .docs-sidebar {
        background: var(--mr-sidebar-bg, #f8f9fa);
        position: sticky;
        top: 56px;
        height: calc(100vh - 56px);
        overflow-y: auto;
        border-right: 1px solid var(--mr-border-color, #dee2e6);
    }
    .docs-sidebar .nav-link {
        padding: 0.3rem 1rem;
        font-size: 0.875rem;
        color: var(--mr-sidebar-text, #495057);
    }
    .docs-sidebar .nav-link:hover,
    .docs-sidebar .nav-link.active {
        color: #0d6efd;
        font-weight: 500;
    }
    .docs-content h2 {
        padding-top: 1rem;
        margin-top: 2rem;
        border-bottom: 1px solid var(--mr-border-color, #dee2e6);
        padding-bottom: 0.5rem;
    }
    .docs-content h3 { margin-top: 1.5rem; }
    .docs-content h4 { margin-top: 1.25rem; font-size: 1.05rem; font-weight: 600; }
    .docs-content pre {
        background: #1e1e1e;
        color: #d4d4d4;
        padding: 1rem;
        border-radius: 0.375rem;
        overflow-x: auto;
        font-size: 0.85rem;
    }
    .docs-content pre code { color: inherit; }
    .docs-content table { margin-bottom: 1rem; }
    .docs-content table code { white-space: nowrap; }
    .docs-content section:first-of-type h2 { margin-top: 0; }
    .docs-content .alert p:last-child { margin-bottom: 0; }
    .arch-diagram {
        font-family: monospace;
        font-size: 0.8rem;
        line-height: 1.4;
        white-space: pre;
    }
</style>"""

SCROLLSPY_JS = """    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
    <script>
    (function() {
        // Highlight the sidebar link for the section currently in view
        const sections = document.querySelectorAll('.docs-content section[id]');
        const tocLinks = document.querySelectorAll('.docs-sidebar .nav-link');
        if (!sections.length || !tocLinks.length) return;
        const observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    tocLinks.forEach(function(link) { link.classList.remove('active'); });
                    const active = document.querySelector('.docs-sidebar a[href="#' + entry.target.id + '"]');
                    if (active) active.classList.add('active');
                }
            });
        }, { rootMargin: '-20% 0px -80% 0px' });
        sections.forEach(function(section) { observer.observe(section); });
    })();
    </script>
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


def extract_block(template: str, name: str) -> str:
    match = re.search(r"\{%\s*block\s+" + name + r"\s*%\}(.*?)\{%\s*endblock\s*%\}",
                      template, re.DOTALL)
    if not match:
        raise RuntimeError(f"template has no {{% block {name} %}}")
    return match.group(1).strip()


def further_reading_html() -> str:
    """Links to the reference pages built from the markdown docs."""
    items = "\n".join(
        f'                    <li><a href="/{page["out"]}">{html.escape(page["title"])}</a></li>'
        for page in PAGES)
    return f"""            <section id="further-reading">
                <h2>Further Reading</h2>
                <p>Deeper references, each mirrored from the MindRouter repository:</p>
                <ul>
{items}
                </ul>
            </section>
"""


def supplement_sections(content: str, supplement_md: str, verbose: bool) -> tuple[str, list[tuple[str, str]]]:
    """Append sections of docs/index.md that the in-app page does not cover.

    Neither source is a superset of the other: the in-app template is far more
    complete, but index.md carries Implementation Notes. Sections are matched by
    anchor, so anything the in-app page gains later stops being appended here.
    """
    present = set(re.findall(r'<section id="([^"]+)"', content))
    added, rendered = [], []
    for heading, body in split_sections(supplement_md)[2]:
        anchor = slug(heading)
        if (heading == TOC_SECTION or not body.strip()
                or anchor in present
                or SUPPLEMENT_ALIASES.get(anchor) in present):
            continue
        added.append((anchor, heading))
        rendered.append(
            f'            <section id="{anchor}">\n'
            f"                <h2>{render_inline(heading)}</h2>\n"
            f"{decorate(render_markdown(body))}\n"
            f"            </section>\n\n            <hr>\n"
        )
        if verbose:
            print(f"    supplemented from docs/index.md: {heading}")
    return "".join(rendered), added


def build_template_page(page: dict, template: str, supplement_md: str = "",
                        verbose: bool = False) -> str:
    """Render the in-app documentation template into this site's chrome.

    The Jinja is limited to block tags; the `{{first_name}}`-style braces in the
    body are documentation of email-template placeholders and must survive as
    literal text, so nothing substitutes them.
    """
    styles = extract_block(template, "extra_css")
    content = extract_block(template, "content")

    content = GITHUB_DOC_LINK.sub(
        lambda m: LINK_MAP.get(m.group(1), m.group(0)), content)
    content = APP_ROUTE_LINK.sub(lambda m: m.group(1), content)

    source_note = (
        f'            <p class="text-muted" style="font-size:0.85rem;">'
        f'<i class="bi bi-git"></i> Mirrored from '
        f'<a href="{BLOB_BASE}/{page["src"]}" target="_blank" rel="noopener">the MindRouter '
        f'documentation page</a> in the MindRouter repository. Example hostnames are '
        f'placeholders — substitute your own deployment.</p>\n'
    )
    # Sit the provenance note directly under the page intro.
    anchor = '<p class="text-muted"><strong>Developed by</strong>'
    end = content.find("</p>", content.find(anchor))
    if anchor in content and end > 0:
        content = content[:end + 4] + "\n\n" + source_note + content[end + 4:]

    extra_html, extra_toc = ("", [])
    if supplement_md:
        extra_html, extra_toc = supplement_sections(content, supplement_md, verbose)

    # Add the supplemented sections and the reference pages to the body, and
    # both to the sidebar, so nothing on the page is unreachable from the TOC.
    last_section = content.rfind("</section>")
    if last_section > 0:
        content = (content[:last_section + 10] + "\n\n            <hr>\n\n" + extra_html
                   + further_reading_html() + content[last_section + 10:])
    sidebar_end = content.find("</ul>")
    if sidebar_end > 0:
        entries = "".join(
            f'                <li class="nav-item"><a class="nav-link" href="#{anchor}">'
            f'{html.escape(plain(text))}</a></li>\n' for anchor, text in extra_toc)
        entries += ('                <li class="nav-item"><a class="nav-link" '
                    'href="#further-reading">Further Reading</a></li>\n')
        content = content[:sidebar_end] + entries + "            " + content[sidebar_end:]

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>{html.escape(page["title"])} - MindRouter</title>
    <meta name="description" content="MindRouter documentation: API reference, deployment, scheduling, quotas, and operations for the open-source LLM inference load balancer.">
    <script>
    (function() {{
        var t = localStorage.getItem('mr-theme') ||
                (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-bs-theme', t);
    }})();
    </script>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css" rel="stylesheet">
    <link href="/css/style.css" rel="stylesheet">
{styles}
</head>
<body>
    <a class="skip-link" href="#main-content">Skip to main content</a>
{nav_html("docs", container="container-fluid")}
    <main id="main-content">
{content}
    </main>
{FOOTER_HTML}
{SCROLLSPY_JS}
</body>
</html>
"""


def build_page(page: dict, markdown_text: str, verbose: bool = False) -> str:
    is_index = page["out"] == "documentation.html"
    title, intro_md, sections = split_sections(markdown_text)

    rendered = []
    toc = []
    for index, (heading, body) in enumerate(sections):
        if heading == TOC_SECTION:
            body = drop_toc_list(body)
            if not body:
                continue
            heading = TOC_REPLACEMENT_TITLE
        anchor = slug(heading)
        toc.append((anchor, heading))
        section_html = decorate(render_markdown(body))
        rendered.append(
            f'            <section id="{anchor}">\n'
            f"                <h2>{render_inline(heading)}</h2>\n"
            f"{section_html}\n"
            f"            </section>\n\n            <hr>\n"
        )

    intro_html = decorate(render_markdown(intro_md)) if intro_md.strip() else ""
    source_note = (
        f'            <p class="text-muted" style="font-size:0.85rem;">'
        f'<i class="bi bi-git"></i> Mirrored from '
        f'<a href="{BLOB_BASE}/{page["src"]}" target="_blank" rel="noopener">'
        f'{page["src"]}</a> in the MindRouter repository. Example hostnames are '
        f'placeholders — substitute your own deployment.</p>\n'
    )
    back = ("" if is_index else
            '            <p class="mb-3"><a href="/documentation.html" class="text-decoration-none" '
            'style="font-size:0.85rem;">&larr; MindRouter Documentation</a></p>\n')

    # Repair anchors across the article body only — the scroll-spy script below
    # also contains an href="#..." fragment that must be left alone.
    content = fix_anchors(f"{intro_html}\n{source_note}            <hr>\n\n{''.join(rendered)}",
                          page["out"], verbose)

    toc_html = "\n".join(
        f'                <li class="nav-item"><a class="nav-link" href="#{anchor}">{html.escape(plain(text))}</a></li>'
        for anchor, text in toc)

    page_title = f'{page["title"]} - MindRouter'
    description = ("MindRouter documentation: API reference, deployment, scheduling, quotas, "
                   "and operations for the open-source LLM inference load balancer."
                   if is_index else
                   f'{page["title"]} reference for MindRouter, the open-source LLM inference load balancer.')

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>{html.escape(page_title)}</title>
    <meta name="description" content="{html.escape(description)}">
    <script>
    (function() {{
        var t = localStorage.getItem('mr-theme') ||
                (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-bs-theme', t);
    }})();
    </script>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css" rel="stylesheet">
    <link href="/css/style.css" rel="stylesheet">
{PAGE_CSS}
</head>
<body>
    <a class="skip-link" href="#main-content">Skip to main content</a>
{nav_html("docs", container="container-fluid")}
    <main id="main-content">
<div class="container-fluid py-0">
    <div class="row">
        <!-- Sidebar TOC -->
        <nav class="col-md-2 docs-sidebar py-3" aria-label="Documentation navigation">
            <h6 class="px-3 text-muted mb-3"><i class="bi bi-book"></i> Contents</h6>
            <ul class="nav flex-column">
{toc_html}
            </ul>
        </nav>

        <!-- Main Content -->
        <div class="col-md-10 py-4 px-4 docs-content">
{back}            <h1 class="mb-3"><i class="bi bi-book"></i> {html.escape(title or page["title"])}</h1>
{content}        </div>
    </div>
</div>
    </main>
{FOOTER_HTML}
{SCROLLSPY_JS}
</body>
</html>
"""


# --------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", help="local MindRouter checkout to read instead of GitHub")
    parser.add_argument("--root", default=str(Path(__file__).resolve().parent.parent),
                        help="site root to write into (default: this repo)")
    parser.add_argument("--dry-run", action="store_true", help="report changes, write nothing")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    changed, domain_report = [], []

    def emit(page: dict, output: str) -> None:
        dest = root / page["out"]
        if dest.exists() and dest.read_text(encoding="utf-8") == output:
            if args.verbose:
                print(f"  unchanged {page['out']}")
            return
        changed.append(page["out"])
        if args.verbose:
            print(f"  {'update' if dest.exists() else 'create'} {page['out']}")
        if not args.dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(output, encoding="utf-8")

    try:
        template = load(TEMPLATE_PAGE["src"], args.source)
        template = rewrite_domains(template, domain_report)
        # docs/index.md fills the gaps the in-app page leaves (Implementation Notes).
        supplement = smart_dashes(rewrite_links(strip_rules(
            rewrite_domains(load(SUPPLEMENT_MD, args.source), domain_report))))
        emit(TEMPLATE_PAGE,
             build_template_page(TEMPLATE_PAGE, template, supplement, args.verbose))

        for page in PAGES:
            markdown_text = load(page["src"], args.source)
            markdown_text = rewrite_domains(markdown_text, domain_report)
            markdown_text = smart_dashes(rewrite_links(strip_rules(markdown_text)))
            emit(page, build_page(page, markdown_text, args.verbose))
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    # /docs/ is a bucket of references, not a landing page; send it home.
    redirect = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n'
                '    <meta charset="UTF-8">\n'
                '    <meta http-equiv="refresh" content="0; url=/documentation.html">\n'
                '    <link rel="canonical" href="/documentation.html">\n'
                '    <title>MindRouter Documentation</title>\n</head>\n<body>\n'
                '    <p>Redirecting to the <a href="/documentation.html">MindRouter '
                'documentation</a>.</p>\n</body>\n</html>\n')
    index = root / "docs" / "index.html"
    if not index.exists() or index.read_text(encoding="utf-8") != redirect:
        changed.append("docs/index.html")
        if args.verbose:
            print(f"  {'update' if index.exists() else 'create'} docs/index.html")
        if not args.dry_run:
            index.parent.mkdir(parents=True, exist_ok=True)
            index.write_text(redirect, encoding="utf-8")

    if domain_report and args.verbose:
        print("  domain rewrites:")
        for entry in sorted(set(domain_report)):
            print(f"    {entry} ({domain_report.count(entry)}x)")

    verb = "would update" if args.dry_run else "updated"
    print(f"{len(PAGES) + 1} page(s) from {REPO}: "
          f"{f'{verb} {len(changed)}' if changed else 'already up to date'}"
          f"{' (' + ', '.join(changed) + ')' if changed else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
