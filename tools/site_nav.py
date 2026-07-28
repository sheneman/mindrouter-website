#!/usr/bin/env python3
"""The site navbar, defined once.

Five surfaces carry the navbar and each used to spell it differently: the hand-
written pages (index.html, configurator.html), the generated documentation
(tools/build_docs.py), and the generated blog (tools/sync_blog.py). This module
is the single definition; tools/sync_nav.py applies it to the hand-written
pages, and the two generators import it.

Every href is absolute so the same markup works from any depth of the site.
"""

from __future__ import annotations

# (key, href, label, icon). `key` marks the current page as active.
NAV_ITEMS = [
    ("features", "/#features", "Features", ""),
    ("telemetry", "/#telemetry", "Telemetry", ""),
    ("configurator", "/configurator.html", "Configurator", '<i class="bi bi-sliders"></i> '),
    ("docs", "/documentation.html", "Docs", ""),
    ("blog", "/blog/", "Blog", ""),
    ("cite", "/#cite", "Cite", ""),
    ("github", "https://github.com/ui-insight/MindRouter", "GitHub", '<i class="bi bi-github"></i> '),
    ("contact", "/#contact", "Contact", ""),
]


def nav_html(active: str | None = None, container: str = "container", indent: int = 4) -> str:
    """Render the navbar.

    `active` is a key from NAV_ITEMS (or None on the home page, whose entry is
    the brand). `container` is "container-fluid" on the full-width docs pages.
    """
    pad = " " * indent
    items = []
    for key, href, label, icon in NAV_ITEMS:
        classes = "nav-link active" if key == active else "nav-link"
        target = ' target="_blank" rel="noopener"' if href.startswith("http") else ""
        current = ' aria-current="page"' if key == active else ""
        items.append(f'{pad}                <li class="nav-item">'
                     f'<a class="{classes}" href="{href}"{target}{current}>{icon}{label}</a></li>')
    entries = "\n".join(items)
    return f"""{pad}<nav class="navbar navbar-expand-lg navbar-dark bg-dark sticky-top" aria-label="Main navigation">
{pad}    <div class="{container}">
{pad}        <a class="navbar-brand" href="/"><i class="bi bi-router"></i> MindRouter</a>
{pad}        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav" aria-controls="navbarNav" aria-expanded="false" aria-label="Toggle navigation">
{pad}            <span class="navbar-toggler-icon"></span>
{pad}        </button>
{pad}        <div class="collapse navbar-collapse" id="navbarNav">
{pad}            <ul class="navbar-nav me-auto">
{entries}
{pad}            </ul>
{pad}            <ul class="navbar-nav">
{pad}                <li class="nav-item">
{pad}                    <button class="theme-toggle nav-link" id="themeToggleBtn" title="Toggle dark mode" aria-label="Toggle dark mode"><i class="bi bi-sun-fill"></i></button>
{pad}                </li>
{pad}            </ul>
{pad}        </div>
{pad}    </div>
{pad}</nav>"""
