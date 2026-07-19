# Pricing Data Refresh — Scheduled Agent Prompt

`data/pricing.json` drives the Cluster Configurator (`configurator.html`). It is a
static file, so keeping the estimates honest means re-researching street prices
periodically. This file is the prompt for a scheduled Claude agent (a Claude Code
"routine" created with `/schedule`, or any cron-driven `claude -p` invocation) that
refreshes the data and opens a PR.

Suggested cadence: **monthly** (AI hardware prices move, but not weekly).

Example one-shot run from the repo root:

```bash
claude -p "$(cat tools/update-pricing.md)" --permission-mode acceptEdits
```

---

## Prompt

You are refreshing `data/pricing.json` in the mindrouter-website repo — the pricing
database behind the public Cluster Configurator at https://mindrouter.ai/configurator.html.

**Do not change the JSON schema.** Only update values (prices, TDPs, VRAM, perf
numbers, model entries) and the `generated` / `generated_by` fields. The
configurator JavaScript depends on the existing keys:
`assumptions`, `gpus`, `platforms`, `models`, `perf_tok_s_per_gpu`,
`storage`, `network`, `mgmt_node`. Every model id used in `models[]` must have a
column in every row of `perf_tok_s_per_gpu` (value or null).

Using live web search, re-verify each of the following with at least 2 independent
sources (vendor pages and reputable resellers: supermicro.com, nvidia.com, Thinkmate,
WiredZone, Exxact, CDW, ServerSupply; r/LocalLLaMA acceptable for sanity checks):

1. **GPU street prices** (`gpus.*.price` as [low, high] USD): RTX PRO 6000 Blackwell
   96GB, H200 NVL, B200, B300. Also confirm TDPs if changed.
2. **Platform prices**: DGX Spark unit price (and cheapest GB10 partner equivalent);
   Supermicro 2U/4U PCIe GPU server base prices (configured, without GPUs); HGX B200
   and HGX B300 full-system prices (8-GPU, air- and liquid-cooled).
3. **Model landscape** (`models[]`): confirm the current open-weight frontier and
   near-frontier models. If the frontier moved (a new largest/smartest open model),
   update the top entries' `example`, `params_b`, `fp8_gb`, `nvfp4_gb`, and re-anchor
   `intelligence` so the frontier = 100 and other classes keep sensible relative
   spacing. Keep the same number of model classes as `models[]` currently contains
   (the dial snaps to them), and keep the array sorted by ascending `intelligence`.
4. **Throughput** (`perf_tok_s_per_gpu`): only adjust if you find better benchmark
   data (vLLM/SGLang/TensorRT-LLM, MLPerf, InferenceMAX). These are aggregate batched
   decode tok/s per GPU.
5. **Storage**: enterprise NVMe $/TB range.

Rules:
- Prices are street-price **ranges** [low, high], USD. Widen the range rather than
  guessing a point price. If you cannot verify a number, leave it unchanged.
- Update `generated` to today's date (YYYY-MM-DD) and `generated_by` to a short
  description of the refresh method.
- Validate the result parses: `python3 -c "import json;json.load(open('data/pricing.json'))"`.
- Sanity-check the configurator still behaves: serve the site
  (`python -m http.server 8080`) and confirm `configurator.html` loads without console
  errors and shows a price for the default state.
- Commit on a branch `pricing-refresh-YYYY-MM` and open a PR summarizing every number
  that changed and its sources. Do not push to main directly.
