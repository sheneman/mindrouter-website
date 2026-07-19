/**
 * MindRouter Configurator Glossary
 *
 * Scans configured containers for known acronyms / technical terms and wraps
 * them in <span class="term">. Hovering, tapping, or focusing a term opens a
 * small dismissable popover with a definition, the term's role in the sizing,
 * and a small illustration. Exposed as window.MRGlossary.decorate(rootEl) so
 * configurator.js can re-decorate dynamically rendered output.
 *
 * Deep link: configurator.html#define=<key> opens that term's popover on load.
 */
(function () {
    'use strict';

    // ---------------------------------------------------------------- //
    // Small SVG illustrations (theme-aware via .g-* classes in CSS)    //
    // ---------------------------------------------------------------- //

    const GLYPHS = {
        desktop: '<rect x="18" y="6" width="28" height="32" rx="4" class="g-df"/><line x1="24" y1="14" x2="40" y2="14" class="g-a"/><line x1="24" y1="20" x2="40" y2="20" class="g-a"/><circle cx="32" cy="30" r="3" class="g-af"/>',
        gpu: '<rect x="8" y="8" width="44" height="22" rx="3" class="g-df"/><circle cx="22" cy="19" r="6" class="g-a"/><circle cx="39" cy="19" r="6" class="g-a"/><rect x="12" y="32" width="26" height="4" rx="1" class="g-afd"/>',
        sxm: '<rect x="16" y="6" width="32" height="32" rx="4" class="g-df"/><rect x="23" y="13" width="18" height="18" rx="2" class="g-a"/><line x1="10" y1="22" x2="16" y2="22" class="g-d"/><line x1="48" y1="22" x2="54" y2="22" class="g-d"/>',
        hgx: '<rect x="4" y="12" width="56" height="20" rx="3" class="g-df"/><rect x="8" y="17" width="5" height="10" class="g-afd"/><rect x="15" y="17" width="5" height="10" class="g-afd"/><rect x="22" y="17" width="5" height="10" class="g-afd"/><rect x="29" y="17" width="5" height="10" class="g-afd"/><rect x="36" y="17" width="5" height="10" class="g-afd"/><rect x="43" y="17" width="5" height="10" class="g-afd"/><rect x="50" y="17" width="5" height="10" class="g-afd"/><line x1="8" y1="35" x2="55" y2="35" class="g-a"/>',
        rack: '<rect x="12" y="8" width="40" height="28" rx="2" class="g-df"/><rect x="6" y="12" width="6" height="20" rx="1" class="g-afd"/><rect x="52" y="12" width="6" height="20" rx="1" class="g-afd"/><line x1="18" y1="16" x2="46" y2="16" class="g-a"/><circle cx="21" cy="29" r="2" class="g-af"/><circle cx="28" cy="29" r="2" class="g-af"/>',
        mem: '<rect x="14" y="9" width="36" height="21" rx="2" class="g-df"/><rect x="19" y="14" width="8" height="11" class="g-afd"/><rect x="31" y="14" width="8" height="11" class="g-afd"/><line x1="20" y1="30" x2="20" y2="36" class="g-d"/><line x1="28" y1="30" x2="28" y2="36" class="g-d"/><line x1="36" y1="30" x2="36" y2="36" class="g-d"/><line x1="44" y1="30" x2="44" y2="36" class="g-d"/>',
        quant: '<rect x="6" y="9" width="24" height="24" rx="2" class="g-d"/><path d="M34 21 h9 m-4 -4 l4 4 l-4 4" class="g-a"/><rect x="47" y="15" width="12" height="12" rx="2" class="g-af" opacity="0.75"/>',
        moe: '<circle cx="12" cy="22" r="5" class="g-a"/><line x1="17" y1="19" x2="40" y2="9" class="g-a"/><line x1="17" y1="25" x2="40" y2="35" class="g-a"/><circle cx="45" cy="8" r="4.5" class="g-af"/><circle cx="47" cy="17" r="4.5" class="g-df"/><circle cx="47" cy="27" r="4.5" class="g-df"/><circle cx="45" cy="36" r="4.5" class="g-af"/>',
        tp: '<rect x="10" y="8" width="44" height="28" rx="3" class="g-df"/><line x1="32" y1="8" x2="32" y2="36" class="g-a" stroke-dasharray="3 3"/><rect x="16" y="16" width="10" height="12" class="g-afd"/><rect x="38" y="16" width="10" height="12" class="g-afd"/>',
        speed: '<path d="M12 34 a20 20 0 0 1 40 0" class="g-d"/><line x1="32" y1="34" x2="44" y2="18" class="g-a"/><circle cx="32" cy="34" r="3.5" class="g-af"/>',
        stor: '<ellipse cx="32" cy="11" rx="18" ry="5.5" class="g-df"/><path d="M14 11 v22 a18 5.5 0 0 0 36 0 v-22" class="g-d"/><path d="M14 22 a18 5.5 0 0 0 36 0" class="g-d"/>',
        net: '<rect x="6" y="16" width="16" height="12" rx="2" class="g-df"/><rect x="42" y="16" width="16" height="12" rx="2" class="g-df"/><line x1="22" y1="22" x2="42" y2="22" class="g-a"/><circle cx="32" cy="22" r="2.5" class="g-af"/>',
        stream: '<path d="M10 11 h28 m-5 -4 l5 4 l-5 4" class="g-a"/><path d="M10 22 h36 m-5 -4 l5 4 l-5 4" class="g-a"/><path d="M10 33 h24 m-5 -4 l5 4 l-5 4" class="g-a"/>',
        router: '<rect x="6" y="14" width="20" height="16" rx="3" class="g-df"/><path d="M26 22 C36 22 36 10 46 10 M26 22 h20 M26 22 C36 22 36 34 46 34" class="g-a"/><circle cx="50" cy="10" r="2.5" class="g-af"/><circle cx="50" cy="22" r="2.5" class="g-af"/><circle cx="50" cy="34" r="2.5" class="g-af"/>',
        cool: '<path d="M32 5 C39 16 45 22 45 29 a13 13 0 0 1 -26 0 C19 22 25 16 32 5 Z" class="g-a"/><path d="M27 29 a6 6 0 0 0 5 6" class="g-d"/>',
        power: '<path d="M34 4 L20 26 h9 L27 40 L44 18 h-9 Z" class="g-a"/>',
        chip: '<rect x="20" y="10" width="24" height="24" rx="3" class="g-df"/><rect x="27" y="17" width="10" height="10" class="g-afd"/><line x1="26" y1="4" x2="26" y2="10" class="g-d"/><line x1="38" y1="4" x2="38" y2="10" class="g-d"/><line x1="26" y1="34" x2="26" y2="40" class="g-d"/><line x1="38" y1="34" x2="38" y2="40" class="g-d"/><line x1="14" y1="16" x2="20" y2="16" class="g-d"/><line x1="14" y1="28" x2="20" y2="28" class="g-d"/><line x1="44" y1="16" x2="50" y2="16" class="g-d"/><line x1="44" y1="28" x2="50" y2="28" class="g-d"/>',
        model: '<circle cx="12" cy="12" r="3.5" class="g-af"/><circle cx="12" cy="32" r="3.5" class="g-af"/><circle cx="32" cy="8" r="3.5" class="g-df"/><circle cx="32" cy="22" r="3.5" class="g-df"/><circle cx="32" cy="36" r="3.5" class="g-df"/><circle cx="52" cy="22" r="3.5" class="g-af"/><line x1="15" y1="13" x2="29" y2="9" class="g-d"/><line x1="15" y1="14" x2="29" y2="21" class="g-d"/><line x1="15" y1="31" x2="29" y2="23" class="g-d"/><line x1="15" y1="33" x2="29" y2="35" class="g-d"/><line x1="35" y1="9" x2="49" y2="21" class="g-d"/><line x1="35" y1="22" x2="48" y2="22" class="g-d"/><line x1="35" y1="35" x2="49" y2="23" class="g-d"/>',
    };

    // ---------------------------------------------------------------- //
    // Glossary entries. Order matters: at the same text position, the  //
    // earlier entry wins, so specific/multi-word patterns come first.  //
    // ---------------------------------------------------------------- //

    const ENTRIES = [
        { key: 'headnode', pattern: '1U MindRouter host|MindRouter host|head node', img: 'router', title: 'Head node',
          what: 'A small 1U server that runs MindRouter itself: routing, protocol translation, quotas, and telemetry, sitting in front of the GPU nodes.',
          role: 'Added automatically to multi-server builds; on single-box builds MindRouter runs on the box itself.' },
        { key: 'spark', pattern: 'DGX Sparks?', img: 'desktop', title: 'NVIDIA DGX Spark',
          what: 'A desktop AI mini-PC built around the GB10 chip with 128 GB of unified memory, in a palm-sized box drawing about as much power as a bright light bulb.',
          role: 'The smallest tier recommended here: one to four Sparks can serve a small workgroup with mid-size models.' },
        { key: 'gb10', pattern: 'GB10', img: 'chip', title: 'GB10 (Grace Blackwell)',
          what: 'NVIDIA’s “superchip” inside the DGX Spark: a 20-core Arm CPU and a Blackwell GPU sharing one 128 GB pool of memory.',
          role: 'Counts as the Spark’s GPU in this tool; its memory bandwidth is the Spark’s main speed limit.' },
        { key: 'rtx', pattern: 'RTX Pro 6000(?: Blackwell)?(?: \\(Server\\))?', img: 'gpu', title: 'RTX Pro 6000 Blackwell',
          what: 'NVIDIA’s 96 GB Blackwell professional GPU (PCIe card). The passive Server Edition slots into standard GPU servers, up to 4 per 2U or 8 per 4U chassis.',
          role: 'The mid-tier building block: strong throughput per dollar for models up to ~120B, and near-frontier models across several cards.' },
        { key: 'h200', pattern: 'H200(?: NVL)?', img: 'gpu', title: 'H200 NVL',
          what: 'A 141 GB Hopper-generation data-center GPU in PCIe form with very fast HBM3e memory (4.8 TB/s).',
          role: 'The bigger-memory PCIe option: fewer cards needed per model copy than the 96 GB tier.' },
        { key: 'b300', pattern: 'B300s?(?: \\(Blackwell Ultra\\))?|Blackwell Ultra', img: 'sxm', title: 'B300 (Blackwell Ultra)',
          what: 'NVIDIA’s flagship inference GPU with 288 GB of HBM3e — the largest GPU memory available. Eight of them pool 2.3 TB in one HGX server.',
          role: 'The only tier that fits the ~1.4 TB frontier model inside a single node.' },
        { key: 'b200', pattern: 'B200s?', img: 'sxm', title: 'B200',
          what: 'A Blackwell data-center GPU with 180 GB of HBM3e, sold as part of 8-GPU HGX systems (1.4 TB per node).',
          role: 'The workhorse big-model tier: a single node serves ~750B-class open models in 4-bit.' },
        { key: 'hgx', pattern: 'HGX', img: 'hgx', title: 'HGX',
          what: 'NVIDIA’s 8-GPU server baseboard: eight SXM GPUs fused by NVLink so they behave like one giant GPU with pooled memory.',
          role: 'The top hardware tiers here are complete Supermicro HGX systems (air- or liquid-cooled).' },
        { key: 'nvlink', pattern: 'NVLink', img: 'net', title: 'NVLink',
          what: 'NVIDIA’s GPU-to-GPU interconnect, an order of magnitude faster than PCIe.',
          role: 'What lets 8 GPUs on an HGX board pool their memory and split one giant model efficiently.' },
        { key: 'qsfp', pattern: '200G QSFP (?:switch|direct link)|QSFP', img: 'net', title: 'QSFP',
          what: 'A compact plug/cable standard for very fast networking (100–400 Gb/s). Two DGX Sparks link directly over a 200 Gb/s QSFP cable; more need a QSFP switch.',
          role: 'How a Spark cluster is wired together; included in the price when the build has multiple Sparks.' },
        { key: 'fabric', pattern: '400G fabric(?: switch)?', img: 'net', title: '400G fabric',
          what: 'The 400 Gb/s Ethernet/InfiniBand-class network used between multiple HGX nodes.',
          role: 'Added to the estimate when a build needs more than one HGX server.' },
        { key: 'supermicro', pattern: 'Supermicro', img: 'rack', title: 'Supermicro',
          what: 'A major server manufacturer, used in this tool as the reference vendor for chassis models and pricing.',
          role: 'Reference only — comparable GPU servers from other vendors work just as well with MindRouter.' },
        { key: 'sxm', pattern: 'SXM', img: 'sxm', title: 'SXM',
          what: 'NVIDIA’s socketed GPU module format: the GPU mounts flat onto an HGX baseboard instead of plugging into a PCIe slot, allowing far more power and cooling.',
          role: 'B200/B300 are SXM parts, which is why they only come inside complete HGX systems.' },
        { key: 'pcie', pattern: 'PCIe', img: 'gpu', title: 'PCIe',
          what: 'PCI Express, the standard expansion slot in every server. PCIe GPUs fit ordinary chassis without special baseboards.',
          role: 'The mid tiers use PCIe cards in standard Supermicro servers — cheaper and more flexible, but with slower GPU-to-GPU links than NVLink.' },
        { key: 'nvme', pattern: 'NVMe', img: 'stor', title: 'NVMe',
          what: 'Fast solid-state storage attached directly over PCIe — the standard for server drives.',
          role: 'Sized here to hold your request/response logs for the retention window you chose.' },
        { key: 'vram', pattern: 'GPU memory|VRAM', img: 'mem', title: 'GPU memory (VRAM)',
          what: 'The memory on the GPU itself. The model’s weights plus every active conversation’s KV cache must fit inside it.',
          role: 'The single biggest driver of which hardware tier you need: bigger models need more pooled GPU memory.' },
        { key: 'hbm', pattern: 'HBM3e|HBM', img: 'mem', title: 'HBM',
          what: 'High Bandwidth Memory: stacks of memory bonded next to the GPU die, several times faster than desktop graphics memory.',
          role: 'Memory bandwidth largely sets generation speed, which is why HBM-class GPUs dominate the upper tiers.' },
        { key: 'nvfp4', pattern: 'NVFP4', img: 'quant', title: 'NVFP4',
          what: 'NVIDIA’s 4-bit floating-point format on Blackwell GPUs: weights take ~4× less memory than 16-bit with minimal measured quality loss.',
          role: 'This tool assumes primary models are served in 4-bit, which is what makes frontier models fit a single node.' },
        { key: 'mxfp4', pattern: 'MXFP4', img: 'quant', title: 'MXFP4',
          what: 'An open 4-bit “microscaling” number format. Some models (gpt-oss, Kimi K3) are trained quantization-aware and ship natively in it.',
          role: 'For those models, 4-bit is the intended serving format, not a compromise.' },
        { key: 'fp8', pattern: 'FP8', img: 'quant', title: 'FP8',
          what: '8-bit floating point: half the memory of 16-bit at near-identical quality, natively accelerated by modern GPUs.',
          role: 'The step between full precision and 4-bit; used when a build has memory to spare.' },
        { key: 'quant', pattern: 'quantized|quantization', img: 'quant', title: 'Quantization',
          what: 'Storing model weights in fewer bits (8 or 4 instead of 16) to cut memory use and increase speed, at a small and usually negligible quality cost.',
          role: 'All sizing here assumes quantized serving — it roughly quarters the hardware needed versus full precision.' },
        { key: 'moe', pattern: '\\bMoE\\b|Mixture[- ]of[- ]Experts', img: 'moe', title: 'MoE (Mixture of Experts)',
          what: 'A model built from many “expert” sub-networks that activates only a few per token: enormous total size, but modest per-token compute.',
          role: 'Why a 2.8T-parameter model is servable at all — only ~50B parameters work on each token.' },
        { key: 'tp', pattern: 'TP\\d+ groups?|TP across \\d+ linked units|tensor[- ]parallel(?:ism)?', img: 'tp', title: 'Tensor Parallel (TP)',
          what: 'Splitting one model across several GPUs that compute each step together, pooling their memory. “TP6” means each copy of the model spans 6 GPUs.',
          role: 'How models bigger than a single GPU’s memory get served; this tool sizes whole TP groups per replica.' },
        { key: 'toks', pattern: 'tok/s', img: 'speed', title: 'Tokens per second (tok/s)',
          what: 'The unit of generation speed. A token is roughly ¾ of an English word; 20+ tok/s per user reads as fluid chat.',
          role: 'The throughput axis sets the cluster-wide floor; the estimate also shows per-stream speed.' },
        { key: 'kv', pattern: 'KV cache', img: 'mem', title: 'KV cache',
          what: 'The attention memory a model keeps for each conversation while generating. It grows with context length and with every simultaneous stream.',
          role: 'Concurrency costs GPU memory: more simultaneous users means more KV cache competing with the weights.' },
        { key: 'frontier', pattern: 'open-weight frontier', img: 'model', title: 'Open-weight frontier',
          what: 'The most capable AI model whose weights you can download and run on your own hardware (currently Kimi K3), as opposed to closed API-only models.',
          role: 'The Intelligence axis is scored against it: 100% = the frontier model itself.' },
        { key: 'kimi', pattern: 'Kimi K3(?: \\(2\\.8T\\))?', img: 'model', title: 'Kimi K3',
          what: 'Moonshot AI’s 2.8-trillion-parameter open-weight MoE model (July 2026) — the current open frontier, within a few points of the best closed models.',
          role: 'The 100% mark on the intelligence axis; needs ~1.4 TB of GPU memory even in 4-bit, i.e. an HGX B300 node.' },
        { key: 'glm', pattern: 'GLM-5\\.2(?: \\(753B\\))?', img: 'model', title: 'GLM-5.2',
          what: 'Zhipu AI’s 753B-parameter open MoE model (MIT license): the strongest fully downloadable model, about 89% of frontier, and a coding/agentic specialist.',
          role: 'The near-frontier tier: in 4-bit it fits a single 8-GPU node, an order of magnitude cheaper than frontier.' },
        { key: 'qwen', pattern: 'Qwen3\\.6-[A-Za-z0-9-]+|Qwen3\\.6', img: 'model', title: 'Qwen3.6',
          what: 'Alibaba’s open multimodal model family (Apache 2.0). The 27B dense member is the intelligence-per-gigabyte champion of the open field.',
          role: 'The upper-mid intelligence tiers: single-GPU (or even Spark-class) serving with strong capability.' },
        { key: 'gemma', pattern: 'Gemma 4(?: E4B| 31B)?', img: 'model', title: 'Gemma 4',
          what: 'Google’s open model family: the 31B dense model is capable, multimodal, and very token-efficient; the tiny E4B anchors the small tier.',
          role: 'The default mid-tier pick, and the smallest detent on the intelligence axis.' },
        { key: 'gptoss', pattern: 'gpt-oss-\\d+b|gpt-oss', img: 'model', title: 'gpt-oss',
          what: 'OpenAI’s open-weight MoE models (Apache 2.0), shipped natively in 4-bit. gpt-oss-120b fits on a single large GPU and batches extremely well.',
          role: 'The fast-MoE tier: modest intelligence but exceptional throughput per GPU.' },
        { key: 'dlc', pattern: '[Dd]irect liquid cooling|[Ll]iquid[- ]cool(?:ed|ing)', img: 'cool', title: 'Liquid cooling',
          what: 'Cold plates and facility water loops instead of fans. Removes far more heat per rack unit, but the building needs coolant plumbing (a CDU).',
          role: 'The 4U HGX B300 option is liquid-cooled: denser and quieter, with extra facility requirements.' },
        { key: 'onprem', pattern: 'on-premise|on-prem', img: 'rack', title: 'On-premise',
          what: 'Running on hardware you own and operate in your own facility, rather than renting cloud capacity.',
          role: 'The premise of this whole tool: your data never leaves your infrastructure, and costs are capital rather than per-token.' },
        { key: 'inference', pattern: '\\binference\\b', img: 'chip', title: 'Inference',
          what: 'Running a trained AI model to produce output — answering chats, completing API calls — as opposed to training one.',
          role: 'Everything sized here is inference capacity; training clusters are a different (much larger) exercise.' },
        { key: 'retention', pattern: '\\b[Ll]og retention\\b|\\bretention\\b', img: 'stor', title: 'Log retention',
          what: 'How long request/response logs and audit records are kept before deletion. Compliance policies often dictate months to years.',
          role: 'Drives the NVMe storage line in the estimate: requests × size × retention window.' },
        { key: 'tdp', pattern: 'TDP|max draw', img: 'power', title: 'TDP / max draw',
          what: 'Thermal Design Power: the maximum sustained power a part is built to draw. Real inference serving typically averages well below it.',
          role: 'The power estimate assumes GPUs average ~50% of max draw, shown as a 40–65% band.' },
        { key: 'ru', pattern: '\\b\\d+U\\b', img: 'rack', title: 'Rack unit (U)',
          what: 'The vertical unit of a standard 19-inch server rack: 1U = 1.75 inches (44.45 mm). A “4U” server is four units tall; a full rack is 42U.',
          role: 'The “Rack space” line totals how much rack height the recommended build occupies.' },
        { key: 'gpu', pattern: 'GPUs?\\b', img: 'gpu', title: 'GPU',
          what: 'Graphics Processing Unit: thousands of small cores doing parallel math. Modern AI runs almost entirely on them.',
          role: 'The core resource being sized — count, memory, and speed of GPUs determine everything else.' },
        { key: 'stream', pattern: '\\bstreams?\\b', img: 'stream', title: 'Stream',
          what: 'One generation in flight. Concurrency is how many streams the cluster serves at the same instant — active chats plus in-flight API calls.',
          role: 'Each stream needs KV-cache memory and a slice of throughput; the chat and API axes are converted into streams.' },
        { key: 'api', pattern: '\\bAPI\\b', img: 'net', title: 'API',
          what: 'Application Programming Interface: programmatic access for scripts and applications. MindRouter speaks OpenAI-, Ollama-, and Anthropic-compatible APIs.',
          role: 'The API axis models machine traffic (batch jobs, integrations) alongside interactive chat.' },
    ];

    // Master regex: one named group per entry, in priority order.
    const MASTER = new RegExp(
        ENTRIES.map((e, i) => '(?<g' + i + '>' + e.pattern + ')').join('|'), 'g');

    // ---------------------------------------------------------------- //
    // Decoration                                                       //
    // ---------------------------------------------------------------- //

    function decorate(root) {
        if (!root) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(n) {
                if (!n.nodeValue || n.nodeValue.length < 2) return NodeFilter.FILTER_REJECT;
                if (n.parentElement && n.parentElement.closest(
                    '.term, .term-pop, a, button, script, style, svg, select, input, textarea, label'))
                    return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        for (const node of nodes) {
            const src = node.nodeValue;
            MASTER.lastIndex = 0;
            let m = MASTER.exec(src);
            if (!m) continue;
            const frag = document.createDocumentFragment();
            let pos = 0;
            while (m) {
                let key = null;
                for (let i = 0; i < ENTRIES.length; i++) {
                    if (m.groups['g' + i] !== undefined) { key = ENTRIES[i].key; break; }
                }
                if (m.index > pos) frag.appendChild(document.createTextNode(src.slice(pos, m.index)));
                const span = document.createElement('span');
                span.className = 'term';
                span.dataset.term = key;
                span.tabIndex = 0;
                span.setAttribute('role', 'button');
                span.setAttribute('aria-label', m[0] + ' — show definition');
                span.textContent = m[0];
                frag.appendChild(span);
                pos = m.index + m[0].length;
                m = MASTER.exec(src);
            }
            if (pos < src.length) frag.appendChild(document.createTextNode(src.slice(pos)));
            node.parentNode.replaceChild(frag, node);
        }
        maybeOpenFromHash(root);
    }

    // ---------------------------------------------------------------- //
    // Popover                                                          //
    // ---------------------------------------------------------------- //

    let pop = null, currentTerm = null, hoverTimer = null, hashOpened = false;

    function ensurePop() {
        if (pop) return pop;
        pop = document.createElement('div');
        pop.className = 'term-pop';
        pop.setAttribute('role', 'dialog');
        pop.style.display = 'none';
        document.body.appendChild(pop);
        return pop;
    }

    function entryFor(key) { return ENTRIES.find((e) => e.key === key); }

    function open(termEl) {
        const e = entryFor(termEl.dataset.term);
        if (!e) return;
        ensurePop();
        currentTerm = termEl;
        pop.innerHTML =
            '<button type="button" class="term-pop-close" aria-label="Dismiss definition">×</button>'
            + '<div class="term-pop-head">'
            + '<svg viewBox="0 0 64 44" width="58" height="40" aria-hidden="true">' + (GLYPHS[e.img] || '') + '</svg>'
            + '<div class="term-pop-title">' + e.title + '</div></div>'
            + '<div class="term-pop-what">' + e.what + '</div>'
            + '<div class="term-pop-role"><strong>In this configurator:</strong> ' + e.role + '</div>';
        pop.querySelector('.term-pop-close').addEventListener('click', hide);
        pop.style.display = 'block';
        pop.style.visibility = 'hidden';

        const r = termEl.getBoundingClientRect();
        const pw = pop.offsetWidth, ph = pop.offsetHeight;
        let x = r.left + window.scrollX;
        x = Math.min(x, window.scrollX + document.documentElement.clientWidth - pw - 12);
        x = Math.max(x, window.scrollX + 12);
        let y = r.bottom + window.scrollY + 8;
        if (r.bottom + 8 + ph > window.innerHeight - 8 && r.top - 8 - ph > 0) {
            y = r.top + window.scrollY - ph - 8;
        }
        pop.style.left = x + 'px';
        pop.style.top = y + 'px';
        pop.style.visibility = 'visible';
    }

    function hide() {
        if (pop) pop.style.display = 'none';
        currentTerm = null;
    }

    function maybeOpenFromHash(root) {
        if (hashOpened) return;
        const m = location.hash.match(/define=([\w-]+)/);
        if (!m) return;
        const t = (root || document).querySelector('.term[data-term="' + m[1] + '"]');
        if (t) {
            hashOpened = true;
            t.scrollIntoView({ block: 'center' });
            open(t);
        }
    }

    // ---------------------------------------------------------------- //
    // Events (delegated: terms are re-created on every render)         //
    // ---------------------------------------------------------------- //

    document.addEventListener('mouseover', (e) => {
        const t = e.target.closest && e.target.closest('.term');
        if (!t) return;
        clearTimeout(hoverTimer);
        if (t !== currentTerm) hoverTimer = setTimeout(() => open(t), 180);
    });
    document.addEventListener('mouseout', (e) => {
        if (e.target.closest && e.target.closest('.term')) clearTimeout(hoverTimer);
    });
    document.addEventListener('click', (e) => {
        const t = e.target.closest && e.target.closest('.term');
        if (t) { e.preventDefault(); clearTimeout(hoverTimer); open(t); return; }
        if (pop && pop.style.display !== 'none' && !pop.contains(e.target)) hide();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { hide(); return; }
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('term')) {
            e.preventDefault();
            open(e.target);
        }
    });
    window.addEventListener('resize', () => {
        // Re-anchor to the term on resize (or dismiss if it's gone).
        if (!pop || pop.style.display === 'none') return;
        if (currentTerm && document.contains(currentTerm)) open(currentTerm);
        else hide();
    });

    // Static page copy is decorated immediately; configurator.js calls
    // decorate() again for its dynamically rendered output. (Form labels are
    // excluded by the walker, so the fine-tune grid is left alone.)
    ['.config-hero p', '.config-disclaimer', '.radar-hint'].forEach((sel) => {
        document.querySelectorAll(sel).forEach(decorate);
    });

    window.MRGlossary = { decorate, open: (key) => {
        const t = document.querySelector('.term[data-term="' + key + '"]');
        if (t) open(t);
    } };
})();
