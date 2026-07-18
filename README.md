# MindRouter Website

Static promotional website for [MindRouter](https://github.com/ui-insight/MindRouter), an open-source LLM inference load balancer.

**Live at:** [mindrouter.ai](https://mindrouter.ai)

## Cluster Configurator

`configurator.html` is an interactive sizing tool: a draggable radar chart of workload
dimensions (budget, users, concurrency, API volume, intelligence level calibrated
against the open-weight frontier, throughput, log retention) and feature toggles
(OCR, TTS/STT, image generation, embeddings). It maps the workload onto real hardware
tiers — NVIDIA DGX Spark → Supermicro PCIe GPU servers (RTX Pro 6000 Blackwell / H200
NVL) → HGX B200/B300 nodes — and outputs a price range, power estimate, rack diagram,
and spec sheet.

All numbers live in **`data/pricing.json`** (USD street-price ranges from vendor/reseller
listings, model specs, and published inference benchmarks). Refresh it periodically with
the prompt in **`tools/update-pricing.md`** — designed to run as a scheduled Claude agent
(monthly cron) that re-researches prices and opens a PR. The page fetches the JSON at
load, so it needs to be served over HTTP (see below).

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
