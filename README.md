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

> **The feed is currently campus-only.** `mindrouter.uidaho.edu` is split-horizon DNS:
> on campus it resolves to `172.27.192.252` (private), and the public record
> (`mindrouter-public.hpc.uidaho.edu`, `129.101.236.240`) does not answer. GitHub-hosted
> runners therefore time out, so the hourly schedule in the workflow is commented out
> and syncing is a manual step from a machine on the campus network. Re-enable the
> `schedule:` block once the feed answers publicly, or point the job at a self-hosted
> campus runner.

`.github/workflows/sync-blog.yml` runs it on demand (**Actions → Sync blog →
Run workflow**), committing only when the tree actually changed. The manual run takes
two options: `dry_run` to preview, and `allow_empty_feed` — a safety catch, since the
script refuses to delete every local post when the feed comes back empty (that shape is
indistinguishable from an upstream fault). If the posts really were un-syndicated,
re-run with it checked.

Running it by hand:

```bash
pip install markdown pygments
python tools/sync_blog.py --dry-run -v      # preview against the live feed
python tools/sync_blog.py                   # write the changes
```

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
