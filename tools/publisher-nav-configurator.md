# Instructions for MindRouter's Website Publisher: add the Configurator nav link

**Audience:** the blog/website publisher that generates `blog/index.html`, the
per-post pages, RSS, and `css/blog.css` for mindrouter.ai (see mindrouter-website
commit `38d0980`). These pages embed their own copy of the site navbar, and that
template predates the Cluster Configurator, so generated pages are missing its
nav link. Hand-edits to generated files get overwritten on the next publish, so
this must be fixed in the publisher's navbar template.

## The change

mindrouter.ai now has an interactive Cluster Configurator at
`https://mindrouter.ai/configurator.html`, linked from every hand-maintained
page's navbar. The site-wide canonical nav order (source of truth:
`index.html` in the mindrouter-website repo) is:

> Features · Telemetry · **Configurator** · Docs · Blog · GitHub · Contact

In the publisher's navbar template, insert one `<li>` **after Telemetry and
before Docs**. Blog pages live under `/blog/`, so use an absolute path:

```html
<li class="nav-item"><a class="nav-link" href="/configurator.html"><i class="bi bi-sliders"></i> Configurator</a></li>
```

The template's nav list should end up exactly like this (Blog keeps `active` on
blog pages):

```html
<li class="nav-item"><a class="nav-link" href="/#features">Features</a></li>
<li class="nav-item"><a class="nav-link" href="/#telemetry">Telemetry</a></li>
<li class="nav-item"><a class="nav-link" href="/configurator.html"><i class="bi bi-sliders"></i> Configurator</a></li>
<li class="nav-item"><a class="nav-link" href="/#docs">Docs</a></li>
<li class="nav-item"><a class="nav-link active" href="/blog/">Blog</a></li>
<li class="nav-item"><a class="nav-link" href="https://github.com/ui-insight/MindRouter" target="_blank"><i class="bi bi-github"></i> GitHub</a></li>
<li class="nav-item"><a class="nav-link" href="/#contact">Contact</a></li>
```

Notes:
- The `bi-sliders` icon comes from Bootstrap Icons, which the generated pages
  already load from CDN. No new assets are needed.
- Apply this to **every generated page that carries the navbar**: the blog
  landing page and all per-post pages. RSS is unaffected.
- Do not link with a relative path (`configurator.html`) — from `/blog/` it
  would resolve to `/blog/configurator.html` and 404.

## After changing the template

1. Regenerate all existing blog pages (including the currently published empty
   landing page) so live pages pick up the new nav, and publish.
2. Verify: every generated `blog/**/*.html` contains
   `href="/configurator.html"` exactly once, positioned between the Telemetry
   and Docs items:
   ```bash
   grep -L 'href="/configurator.html"' blog/**/*.html   # should print nothing
   ```
3. Going forward, if the site navbar changes again, mirror `index.html`'s nav
   list (minus the in-page anchors becoming `/#...` absolute forms) — it is the
   canonical ordering for the whole site.
