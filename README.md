# MindRouter Website

Static promotional website for [MindRouter](https://github.com/ui-insight/MindRouter), an open-source LLM inference load balancer.

**Live at:** [mindrouter.ai](https://mindrouter.ai)

## Cluster Configurator

`configurator.html` is an interactive sizing tool: a draggable radar chart of workload
dimensions (budget, users, concurrency, API volume, intelligence level calibrated
against the open-weight frontier, throughput, log retention), with a hover glossary
explaining the technical terms. It maps the workload onto real hardware
tiers — NVIDIA DGX Spark → Supermicro PCIe GPU servers (RTX Pro 6000 Blackwell / H200
NVL) → HGX B200/B300 nodes — and outputs a price range, power estimate, rack diagram,
and spec sheet.

All numbers live in **`data/pricing.json`** (USD street-price ranges from vendor/reseller
listings, model specs, and published inference benchmarks). Refresh it periodically with
the prompt in **`tools/update-pricing.md`** — designed to run as a scheduled Claude agent
(monthly cron) that re-researches prices and opens a PR. The page fetches the JSON at
load, so it needs to be served over HTTP (see below).

## Documentation (generated from the MindRouter repo)

`documentation.html` and everything under `docs/` is **generated** — never hand-edit it.
[github.com/ui-insight/MindRouter](https://github.com/ui-insight/MindRouter) is the source
of truth; `tools/build_docs.py` pulls the markdown and renders it into this site's chrome:

| Upstream | Page |
| --- | --- |
| `backend/app/dashboard/templates/public/documentation.html` | `documentation.html` |
| `docs/images-api.md`, `video-api.md`, `voice-api.md` | `docs/<name>.html` |
| `docs/media-studio-integration.md`, `architecture.md`, `scheduler.md`, `branding.md` | `docs/<name>.html` |

The main page comes from the **in-app documentation template**, not `docs/index.md`: the
template is what mindrouter.uidaho.edu/documentation serves and it covers far more (33
sections vs 17 — document OCR, web search, MCP servers, agent skills, service API keys,
data retention, email, DLP, security hardening). It is a Jinja template, but the Jinja is
limited to block tags, so the content block is lifted out as-is. The `{{first_name}}`-style
braces in the body are documentation of email-template placeholders and are deliberately
left as literal text. Neither source is a superset of the other, so any `docs/index.md`
section the in-app page lacks (currently Implementation Notes) is appended — matched by
anchor, so it stops being appended if the in-app page ever gains it. Links to routes that only exist inside a deployment (`/docs`,
`/redoc`, `/images`, `/dashboard/api-keys`) are unlinked, keeping their text — a dead link
is worse than none — and links to the reference markdown on GitHub are pointed at the
copies under `docs/`.

```bash
pip install markdown                        # once
python tools/build_docs.py --dry-run -v     # preview
python tools/build_docs.py                  # write the changes
```

Rewrites applied on the way through: `*.uidaho.edu` hostnames become `example.com` (the
upstream media API references hard-code the University of Idaho deployment as their base
URL, which is wrong for a product site); links between markdown files point at the
generated pages, falling back to GitHub for anything not mirrored; ` -- ` becomes an em
dash; upstream's numbered table of contents is dropped in favour of the sticky sidebar,
keeping its pointers to the other references. Output is deterministic, so rebuilding
against unchanged upstream docs leaves the git tree clean.

Add a page by appending to `PAGES` in the script. `--source DIR` renders from a local
MindRouter checkout instead of GitHub.

## Blog (pull syndication)

Everything under `blog/` is **generated** — never hand-edit it. The MindRouter gateway
publishes the posts it has selected for syndication, and this site pulls them:

    GET https://mindrouter.uidaho.edu/api/blog/syndicated

`tools/sync_blog.py` treats that feed as the sole source of truth for the `blog/`
subtree. Each sync renders `blog/<slug>/index.html` with this repo's own templates
(nav, footer, `css/blog.css`), rehosts post images under `blog/images/<path>`,
regenerates `blog/index.html` and `blog/feed.xml`, and deletes any post directory or
image the feed no longer lists — that is how un-syndication propagates. Rendering is
deterministic, so a sync that changes nothing leaves the git tree clean.

**Syncing is manual, and must run from the campus network.** `mindrouter.uidaho.edu` is
split-horizon DNS: on campus it resolves to `172.27.192.252` (RFC1918), while the public
record (`mindrouter-public.hpc.uidaho.edu`, `129.101.236.240`) does not answer. A
GitHub-hosted runner times out on both the feed and the images, so there is no scheduled
job — sync when you publish or un-syndicate something:

```bash
pip install markdown pygments                # once
python tools/sync_blog.py --dry-run -v       # preview against the live feed
python tools/sync_blog.py                    # write the changes
git add -A blog && git commit -m 'blog: sync from MindRouter syndication feed' && git push
```

Posts are rewritten on the way through, the same way the documentation is: gateway image
URLs point at the rehosted copies under `blog/images/`, links to other syndicated posts
become site-relative, and `*.uidaho.edu` hostnames become `example.com` placeholders.
Email addresses (`mindrouter@uidaho.edu`) are left alone — the rule only matches
hostnames.

Posts are written for the University of Idaho deployment but syndicated to a site that
serves every deployment, so `PROSE_REWRITES` in the sync script neutralises the passages
where the institution is incidental — instructions addressed to campus readers ("If
you're at the University of Idaho, getting started takes about five minutes"), and
technical facts that happen to name the operator. Authorship and funding credits,
citations of other institutions, and unattributed "on-campus" phrasing are left as
written.

Each entry is an exact substring of the upstream markdown. Because upstream can reword a
passage and quietly break a substitution, the sync also **lints the rendered result**:
any institution reference outside the allowlist of intended keeps (`INSTITUTION_KEEP` —
authorship, funding, support address) prints a warning naming the post and quoting the
sentence. Fix the `PROSE_REWRITES` entry rather than ignoring the warning — or better,
fix the wording in the CMS so no substitution is needed.

Add `--allow-empty-feed` only if the feed legitimately returns zero posts — the script
otherwise refuses to delete every local post, since an empty feed is indistinguishable
from an upstream fault.

If the feed ever answers publicly, a ready-made hourly GitHub Action is in the history at
commit `8663b83` (`.github/workflows/sync-blog.yml`) — restore it and uncomment its
`schedule:` block. The same file also works unchanged on a self-hosted campus runner.

Posts render from `content_markdown` via python-markdown with the same extensions the
gateway uses (`codehilite` classes are already styled by `css/blog.css`); pass
`--renderer html` to use the feed's pre-rendered `content_html` instead, which needs no
dependencies. The renderer versions are pinned in the workflow so output stays stable
across runs.

Note that the gateway no longer has credentials for this repo and this repo never needs
MindRouter credentials — the feed is public and read-only.

## Local Development

Open `index.html` in a browser, or serve with any static server:

```bash
python -m http.server 8080
# Visit http://localhost:8080
```

## Deployment

Hosted via GitHub Pages with a custom domain (`mindrouter.ai`). The `CNAME` file configures the domain.

## Configuration

- **Contact form**: Replace `YOUR_FORM_ID` in `index.html` with your Formspree form ID
- **reCAPTCHA**: Register `mindrouter.ai` at [Google reCAPTCHA admin](https://www.google.com/recaptcha/admin) and replace `YOUR_RECAPTCHA_SITE_KEY`

## License

Apache 2.0
