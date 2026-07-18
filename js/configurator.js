/**
 * MindRouter Cluster Configurator
 *
 * An interactive sizing tool: a draggable radar chart of workload dimensions
 * (including an intelligence axis calibrated against the current open-weight
 * frontier) and feature toggles. A small solver maps the workload onto real hardware
 * tiers (DGX Spark -> Supermicro PCIe GPU servers -> HGX B300) and renders a
 * price range, power estimate, rack diagram, and spec sheet.
 *
 * All pricing/capability numbers live in data/pricing.json (machine-refreshed,
 * see tools/update-pricing.md) — nothing here should hard-code a price.
 */
(function () {
    'use strict';

    // ------------------------------------------------------------------ //
    // Data + state                                                       //
    // ------------------------------------------------------------------ //

    let D = null;      // pricing database (data/pricing.json)
    let A = null;      // D.assumptions shorthand
    let result = null; // last solver result

    const state = {
        budget: 60000,
        users: 200,
        chat: 25,
        api: 50000,
        tokens: 1000,
        retention: 365,
        modelIdx: 2,          // index into D.models
        features: { ocr: false, voice: true, imagegen: false, embed: false },
    };

    // Radar axes. min/max are clamped ends; "log" axes interpolate in log
    // space so the interesting low end gets most of the travel.
    const AXES = [
        { id: 'budget',    label: 'Budget',            min: 4000, max: 1600000, scale: 'log',  fmt: fmtMoney },
        { id: 'users',     label: 'Total Users',       min: 5,    max: 50000,   scale: 'log',  fmt: fmtCount },
        { id: 'chat',      label: 'Concurrent Chat',   min: 1,    max: 2500,    scale: 'log',  fmt: fmtCount },
        { id: 'api',       label: 'API Req / wk',      min: 0,    max: 10000000, scale: 'log0', logMin: 1000, fmt: fmtCount },
        // Value is the index into D.models (snaps to class detents); max is set
        // from the data at boot. Shown as % of the open-weight frontier.
        { id: 'modelIdx',  label: 'Intelligence',      min: 0,    max: 7,       scale: 'lin',
          fmt: (v) => D ? D.models[clamp(Math.round(v), 0, D.models.length - 1)].intelligence + '%' : String(v) },
        { id: 'tokens',    label: 'Throughput tok/s',  min: 50,   max: 120000,  scale: 'log',  fmt: fmtCount },
        { id: 'retention', label: 'Log Retention',     min: 7,    max: 2555,    scale: 'log',  fmt: fmtDays },
    ];

    const PRESETS = {
        lab:      { budget: 9000,   users: 25,   chat: 5,   api: 5000,    tokens: 300,   retention: 90,
                    modelIntel: 51, features: { ocr: false, voice: false, imagegen: false, embed: false } },
        dept:     { budget: 90000,  users: 500,  chat: 60,  api: 250000,  tokens: 3000,  retention: 365,
                    modelIntel: 65, features: { ocr: true, voice: true, imagegen: false, embed: true } },
        campus:   { budget: 700000, users: 5000, chat: 400, api: 2000000, tokens: 15000, retention: 1095,
                    modelIntel: 89, features: { ocr: true, voice: true, imagegen: true, embed: true } },
        frontier: { budget: 1500000, users: 2000, chat: 150, api: 1000000, tokens: 10000, retention: 2555,
                    modelIntel: 100, features: { ocr: true, voice: true, imagegen: true, embed: true } },
    };

    // ------------------------------------------------------------------ //
    // Formatting helpers                                                 //
    // ------------------------------------------------------------------ //

    function fmtMoney(v) {
        if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 2) + 'M';
        if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
        return '$' + Math.round(v);
    }
    function fmtMoneyFull(v) {
        return '$' + Math.round(v).toLocaleString('en-US');
    }
    function fmtCount(v) {
        if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
        if (v >= 1e4) return Math.round(v / 1e3) + 'k';
        if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
        return String(Math.round(v));
    }
    function fmtDays(v) {
        if (v < 60) return Math.round(v) + ' d';
        if (v < 365) return Math.round(v / 30.4) + ' mo';
        const y = v / 365;
        return (y >= 3 ? Math.round(y) : y.toFixed(1)) + ' y';
    }
    function fmtWatts(w) {
        if (w >= 2000) return (w / 1000).toFixed(1) + ' kW';
        return Math.round(w) + ' W';
    }
    function fmtRange(lo, hi, fmt) { return fmt(lo) + ' – ' + fmt(hi); }

    // ------------------------------------------------------------------ //
    // Axis value <-> normalized t in [0,1]                               //
    // ------------------------------------------------------------------ //

    function axisT(ax, v) {
        if (ax.scale === 'lin') return clamp((v - ax.min) / (ax.max - ax.min), 0, 1);
        if (ax.scale === 'log0') {
            if (v <= 0) return 0;
            const lo = Math.log(ax.logMin), hi = Math.log(ax.max);
            return clamp(0.06 + 0.94 * (Math.log(Math.max(v, ax.logMin)) - lo) / (hi - lo), 0, 1);
        }
        const lo = Math.log(ax.min), hi = Math.log(ax.max);
        return clamp((Math.log(clamp(v, ax.min, ax.max)) - lo) / (hi - lo), 0, 1);
    }
    function axisV(ax, t) {
        t = clamp(t, 0, 1);
        if (ax.scale === 'lin') return Math.round(ax.min + t * (ax.max - ax.min));
        if (ax.scale === 'log0') {
            if (t < 0.06) return 0;
            const lo = Math.log(ax.logMin), hi = Math.log(ax.max);
            return niceRound(Math.exp(lo + (t - 0.06) / 0.94 * (hi - lo)));
        }
        const lo = Math.log(ax.min), hi = Math.log(ax.max);
        return niceRound(Math.exp(lo + t * (hi - lo)));
    }
    function niceRound(v) {
        if (v >= 100) {
            const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1);
            return Math.round(v / mag) * mag;
        }
        return Math.round(v);
    }
    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

    // ------------------------------------------------------------------ //
    // Solver                                                             //
    // ------------------------------------------------------------------ //

    function demandStreams(s) {
        const chatStreams = Math.ceil(s.chat * A.chat_active_fraction);
        const apiStreams = Math.ceil((s.api / 604800) * A.api_peak_to_avg * A.api_avg_request_seconds);
        return Math.max(1, chatStreams + apiStreams);
    }
    function demandTokens(s) { return demandStreams(s) * A.per_stream_tok_s; }

    function featVram(s) {
        let gb = 0;
        for (const k in s.features) if (s.features[k] && D.features[k]) gb += D.features[k].vram_gb;
        return gb;
    }

    function storageNeeds(s) {
        const reqWk = s.api + s.users * D.storage.chat_requests_per_user_week;
        const rawTb = reqWk * (s.retention / 7) * D.storage.bytes_per_request / 1e12;
        const tb = Math.max(D.storage.base_tb, Math.ceil(rawTb * 1.3)); // 1.3 = RAID/index overhead
        return { tb, low: tb * D.storage.usd_per_tb[0], high: tb * D.storage.usd_per_tb[1] };
    }

    // Size the workload onto one platform. Returns null when infeasible.
    //
    // The primary model runs as g replica groups of k GPUs each (tensor
    // parallel within a group). Every group holds its own full copy of the
    // weights (W); KV cache, auxiliary models, and feature models (restGb)
    // are counted once across the cluster and live in the groups' leftover
    // space: feasibility requires g*k*usable >= g*W + restGb.
    function sizeOn(p, s, model, restGb, targetTok, streams) {
        const gpu = D.gpus[p.gpu];
        const usable = gpu.vram_gb * A.vram_usable_fraction;
        const perfPer = (D.perf_tok_s_per_gpu[p.gpu] || {})[model.id];
        if (!perfPer) return null;
        const W = model.nvfp4_gb;
        const minFit = Math.ceil(W / usable);

        let gpuCount, servers, perfEff = perfPer, tpNote = '';

        if (p.class === 'desktop') {
            if (minFit > (p.tp_units_max || 1)) return null;
            if (minFit > 1) { perfEff = perfPer * 0.7; tpNote = 'TP across ' + minFit + ' linked units'; }
            const leftover = minFit * usable - W;
            if (leftover <= 0 && restGb > 0) return null;
            const gPerf = Math.ceil(targetTok / (perfEff * minFit));
            const gVram = restGb > 0 ? Math.ceil(restGb / leftover) : 1;
            gpuCount = Math.max(1, gPerf, gVram) * minFit;
            if (gpuCount > p.units_max) return null;
            servers = gpuCount;
        } else if (p.fixed_gpus) {
            if (minFit > p.fixed_gpus) return null;
            // One replica per HGX node; a node's leftover absorbs restGb.
            const leftover = p.fixed_gpus * usable - W;
            if (leftover <= 0 && restGb > 0) return null;
            const gPerf = Math.ceil(targetTok / (perfPer * p.fixed_gpus));
            const gVram = restGb > 0 ? Math.ceil(restGb / leftover) : 1;
            servers = Math.max(1, gPerf, gVram);
            if (servers > 8) return null;
            gpuCount = servers * p.fixed_gpus;
            if (minFit > 1) tpNote = 'TP' + minFit + ' groups';
        } else {
            if (minFit > p.max_gpus) return null;
            // Search group sizes k >= minFit: a bigger group wastes fewer
            // weight copies when KV/aux demand is high.
            let best = null;
            for (let k = minFit; k <= p.max_gpus; k++) {
                const groupsPerServer = Math.floor(p.max_gpus / k);
                if (groupsPerServer < 1) break;
                const leftover = k * usable - W;
                if (leftover <= 0 && restGb > 0) continue;
                const gPerf = Math.ceil(targetTok / (perfPer * k));
                const gVram = restGb > 0 ? Math.ceil(restGb / leftover) : 1;
                const g = Math.max(1, gPerf, gVram);
                const srv = Math.ceil(g / groupsPerServer);
                if (srv > 12) continue;
                const total = g * k;
                if (!best || total < best.total || (total === best.total && srv < best.srv)) {
                    best = { total, srv, k };
                }
            }
            if (!best) return null;
            gpuCount = best.total;
            servers = best.srv;
            if (best.k > 1) tpNote = 'TP' + best.k + ' groups';
        }

        // ---- price ----
        const stor = storageNeeds(s);
        let low = stor.low, high = stor.high;
        let network = null, mgmt = false;

        if (p.class === 'desktop') {
            low += servers * p.unit_price[0];
            high += servers * p.unit_price[1];
            if (servers === 2) network = 'dac_link';
            else if (servers > 2) network = 'qsfp_switch';
        } else if (p.class === 'hgx') {
            low += servers * p.system_price[0];
            high += servers * p.system_price[1];
            mgmt = true;
            if (servers > 1) network = 'dc_switch';
        } else {
            low += servers * p.base_price[0] + gpuCount * gpu.price[0];
            high += servers * p.base_price[1] + gpuCount * gpu.price[1];
            if (servers > 1) { network = 'small_switch'; mgmt = true; }
        }
        if (network) { low += D.network[network][0]; high += D.network[network][1]; }
        if (mgmt) { low += D.mgmt_node.price[0]; high += D.mgmt_node.price[1]; }

        low = Math.round(low * A.integration_overhead[0]);
        high = Math.round(high * A.integration_overhead[1]);

        // ---- power (GPUs at ~half of max draw; see assumptions) ----
        const gpuW = gpuCount * gpu.tdp_w;
        const platW = servers * (p.platform_w || 0) + (mgmt ? D.mgmt_node.power_w : 0);
        const pf = A.gpu_power_fraction_band, pp = A.platform_power_fraction_band;
        const powerLow = gpuW * pf[0] + platW * pp[0];
        const powerHigh = gpuW * pf[1] + platW * pp[1];
        const powerMid = gpuW * A.gpu_power_fraction_nominal + platW * 0.75;

        const aggTok = Math.round(perfEff * gpuCount);
        return {
            platform: p, gpu, gpuCount, servers, tpNote,
            priceLow: low, priceHigh: high,
            powerLow, powerHigh, powerMid,
            aggTok,
            perStreamTok: Math.min(120, Math.round(aggTok / streams)),
            totalVram: p.class === 'desktop' ? servers * gpu.vram_gb : gpuCount * gpu.vram_gb,
            storage: stor, network, mgmt,
        };
    }

    function solve(s) {
        const model = D.models[s.modelIdx];
        const streams = demandStreams(s);
        const targetTok = Math.max(s.tokens, demandTokens(s));
        const restGb = streams * model.kv_gb_per_stream + featVram(s);

        const candidates = [];
        for (const p of D.platforms) {
            const c = sizeOn(p, s, model, restGb, targetTok, streams);
            if (c) candidates.push(c);
        }
        candidates.sort((a, b) => (a.priceLow + a.priceHigh) - (b.priceLow + b.priceHigh));
        if (!candidates.length) return null;

        const chosen = candidates[0];
        return {
            model, streams, targetTok,
            chosen, alternates: candidates.slice(1, 4),
        };
    }

    // ------------------------------------------------------------------ //
    // Constraint propagation                                             //
    // ------------------------------------------------------------------ //

    // After any input change: keep chat <= users, lift the throughput axis to
    // what concurrency demands, and lift the budget axis to the estimated
    // price. Dragging budget *down* instead trades away intelligence, then
    // throughput, then scale — the classic cost/capability tradeoff.
    function propagate(changedId) {
        const flashes = [];

        if (changedId === 'chat' && state.chat > state.users) { state.users = state.chat; flashes.push('users'); }
        if (changedId === 'users' && state.users < state.chat) { state.chat = state.users; flashes.push('chat'); }

        const dTok = demandTokens(state);
        if (changedId !== 'tokens' && state.tokens < dTok) { state.tokens = dTok; flashes.push('tokens'); }

        let r = solve(state);

        if (changedId === 'budget') {
            let guard = 0;
            while (r && state.budget < r.chosen.priceHigh && guard++ < 60) {
                const dNow = demandTokens(state);
                if (state.tokens > dNow) {
                    state.tokens = Math.max(dNow, niceRound(state.tokens * 0.7));
                    if (!flashes.includes('tokens')) flashes.push('tokens');
                } else if (state.modelIdx > 0) {
                    state.modelIdx--;
                    if (!flashes.includes('modelIdx')) flashes.push('modelIdx');
                } else if (state.chat > 1 || state.api > 0) {
                    state.chat = Math.max(1, Math.floor(state.chat * 0.7));
                    state.api = Math.floor(state.api * 0.7);
                    if (!flashes.includes('chat')) flashes.push('chat');
                    if (!flashes.includes('api')) flashes.push('api');
                } else break;
                r = solve(state);
            }
            // Even the floor config costs money: budget can't go below it.
            if (r && state.budget < r.chosen.priceLow) {
                state.budget = r.chosen.priceLow;
                flashes.push('budget');
            }
        } else if (r && state.budget < r.chosen.priceHigh) {
            state.budget = r.chosen.priceHigh;
            flashes.push('budget');
        }

        result = r;
        return flashes;
    }

    function update(changedId) {
        const flashes = propagate(changedId);
        renderAll();
        for (const id of flashes) flashAxis(id);
    }

    // ------------------------------------------------------------------ //
    // Radar chart                                                        //
    // ------------------------------------------------------------------ //

    const SVGNS = 'http://www.w3.org/2000/svg';
    const R_CX = 360, R_CY = 282, R_R = 200, R_IN = 22;
    let radarEls = null;

    function el(name, attrs, parent) {
        const e = document.createElementNS(SVGNS, name);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(e);
        return e;
    }

    function axisAngle(i) { return -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length; }
    function axisPoint(i, t) {
        const a = axisAngle(i), r = R_IN + t * (R_R - R_IN);
        return [R_CX + r * Math.cos(a), R_CY + r * Math.sin(a)];
    }

    function buildRadar() {
        const svg = document.getElementById('radarSvg');
        svg.innerHTML = '';
        for (let ring = 1; ring <= 4; ring++) {
            const pts = AXES.map((_, i) => axisPoint(i, ring / 4).join(',')).join(' ');
            el('polygon', { points: pts, class: 'radar-ring' }, svg);
        }
        AXES.forEach((ax, i) => {
            const [x, y] = axisPoint(i, 1);
            el('line', { x1: R_CX, y1: R_CY, x2: x, y2: y, class: 'radar-spoke' }, svg);
        });

        const poly = el('polygon', { class: 'radar-poly', points: '' }, svg);

        const handles = [], labels = [], values = [];
        AXES.forEach((ax, i) => {
            const a = axisAngle(i);
            const lx = R_CX + (R_R + 26) * Math.cos(a);
            const ly = R_CY + (R_R + 26) * Math.sin(a);
            const anchor = Math.cos(a) > 0.35 ? 'start' : Math.cos(a) < -0.35 ? 'end' : 'middle';
            const lbl = el('text', {
                x: lx, y: ly + (Math.sin(a) > 0.35 ? 10 : Math.sin(a) < -0.35 ? -8 : 0),
                'text-anchor': anchor, class: 'radar-axis-label',
            }, svg);
            lbl.textContent = ax.label;
            const val = el('text', {
                x: lx, y: parseFloat(lbl.getAttribute('y')) + 16,
                'text-anchor': anchor, class: 'radar-axis-value',
            }, svg);
            labels.push(lbl); values.push(val);

            const h = el('circle', {
                r: 9, class: 'radar-handle', tabindex: 0, role: 'slider',
                'aria-label': ax.label, 'aria-valuemin': ax.min, 'aria-valuemax': ax.max,
            }, svg);
            h.addEventListener('pointerdown', (ev) => startDrag(ev, i, h));
            h.addEventListener('keydown', (ev) => radarKey(ev, i));
            handles.push(h);
        });
        radarEls = { svg, poly, handles, labels, values };
    }

    function renderRadar() {
        const pts = [];
        AXES.forEach((ax, i) => {
            const t = axisT(ax, state[ax.id]);
            const [x, y] = axisPoint(i, t);
            pts.push(x + ',' + y);
            radarEls.handles[i].setAttribute('cx', x);
            radarEls.handles[i].setAttribute('cy', y);
            radarEls.handles[i].setAttribute('aria-valuenow', Math.round(state[ax.id]));
            radarEls.handles[i].setAttribute('aria-valuetext', ax.fmt(state[ax.id]) + ' ' + ax.label);
            radarEls.values[i].textContent = ax.fmt(state[ax.id]);
        });
        radarEls.poly.setAttribute('points', pts.join(' '));
    }

    function svgPoint(svg, ev) {
        const pt = svg.createSVGPoint();
        pt.x = ev.clientX; pt.y = ev.clientY;
        return pt.matrixTransform(svg.getScreenCTM().inverse());
    }

    function startDrag(ev, i, handle) {
        ev.preventDefault();
        handle.setPointerCapture(ev.pointerId);
        handle.focus();
        handle.classList.add('dragging');
        const ax = AXES[i], a = axisAngle(i);
        const move = (e) => {
            const p = svgPoint(radarEls.svg, e);
            // Project the pointer onto the axis direction.
            const proj = (p.x - R_CX) * Math.cos(a) + (p.y - R_CY) * Math.sin(a);
            const t = clamp((proj - R_IN) / (R_R - R_IN), 0, 1);
            state[ax.id] = axisV(ax, t);
            update(ax.id);
        };
        const up = () => {
            handle.classList.remove('dragging');
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', up);
            handle.removeEventListener('pointercancel', up);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
    }

    function radarKey(ev, i) {
        const ax = AXES[i];
        const cur = state[ax.id];
        let dir = 0;
        if (ev.key === 'ArrowUp' || ev.key === 'ArrowRight') dir = 1;
        else if (ev.key === 'ArrowDown' || ev.key === 'ArrowLeft') dir = -1;
        else if (ev.key === 'Home' || ev.key === 'End') {
            ev.preventDefault();
            state[ax.id] = ev.key === 'Home' ? (ax.scale === 'log0' ? 0 : ax.min) : ax.max;
            update(ax.id);
            return;
        } else return;
        ev.preventDefault();
        let v = axisV(ax, clamp(axisT(ax, cur) + dir * 0.025, 0, 1));
        if (v === cur) {
            // Rounding can eat a small step on integer/log axes — guarantee movement.
            if (ax.scale === 'log0' && cur === 0 && dir > 0) v = ax.logMin;
            else if (ax.scale === 'log0' && dir < 0 && cur <= ax.logMin) v = 0;
            else v = clamp(cur + dir, ax.scale === 'log0' ? 0 : ax.min, ax.max);
        }
        state[ax.id] = v;
        update(ax.id);
    }

    function flashAxis(id) {
        const i = AXES.findIndex((a) => a.id === id);
        if (i < 0) return;
        [radarEls.labels[i], radarEls.values[i]].forEach((n) => {
            n.classList.add('flash');
            setTimeout(() => n.classList.remove('flash'), 700);
        });
    }

    // ------------------------------------------------------------------ //
    // Aux inputs: features, fine-tune, presets                           //
    // ------------------------------------------------------------------ //

    function buildFeatures() {
        const wrap = document.getElementById('featureChips');
        wrap.innerHTML = '';
        const icons = { ocr: 'bi-eye', voice: 'bi-mic', imagegen: 'bi-image', embed: 'bi-diagram-2' };
        for (const key in D.features) {
            const f = D.features[key];
            const lab = document.createElement('label');
            lab.className = 'feature-chip' + (state.features[key] ? ' on' : '');
            lab.innerHTML = '<input type="checkbox"' + (state.features[key] ? ' checked' : '') + '>'
                + '<i class="bi ' + (icons[key] || 'bi-plug') + '"></i> ' + f.label;
            lab.title = f.model + ' (+' + f.vram_gb + ' GB VRAM)';
            lab.querySelector('input').addEventListener('change', (ev) => {
                state.features[key] = ev.target.checked;
                lab.classList.toggle('on', ev.target.checked);
                update('features');
            });
            wrap.appendChild(lab);
        }
    }

    function buildInputs() {
        AXES.forEach((ax) => {
            const inp = document.getElementById('in-' + ax.id);
            if (!inp) return;
            inp.addEventListener('change', () => {
                const v = parseFloat(inp.value);
                if (!isFinite(v)) { syncInputs(); return; }
                state[ax.id] = clamp(v, ax.min === 0 ? 0 : ax.min, ax.max);
                update(ax.id);
            });
        });
        const sel = document.getElementById('in-model');
        sel.innerHTML = D.models.map((m, i) =>
            '<option value="' + i + '">' + m.label + ' — ' + m.example + '</option>').join('');
        sel.addEventListener('change', () => {
            state.modelIdx = parseInt(sel.value, 10);
            update('modelIdx');
        });
    }

    function syncInputs() {
        AXES.forEach((ax) => {
            const inp = document.getElementById('in-' + ax.id);
            if (inp && document.activeElement !== inp) inp.value = Math.round(state[ax.id]);
        });
        const sel = document.getElementById('in-model');
        if (sel && document.activeElement !== sel) sel.value = state.modelIdx;
    }

    function buildPresets() {
        document.querySelectorAll('.preset-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const p = PRESETS[btn.dataset.preset];
                if (!p) return;
                document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                for (const k of ['budget', 'users', 'chat', 'api', 'tokens', 'retention']) state[k] = p[k];
                state.modelIdx = D.models.findIndex((m) => m.intelligence === p.modelIntel);
                if (state.modelIdx < 0) state.modelIdx = 2;
                state.features = Object.assign({}, p.features);
                buildFeatures();
                update('preset');
            });
        });
    }

    // ------------------------------------------------------------------ //
    // Output rendering                                                   //
    // ------------------------------------------------------------------ //

    function renderAll() {
        renderRadar();
        syncInputs();
        renderOutput();
    }

    function renderOutput() {
        if (!result) {
            document.getElementById('priceBig').textContent = '—';
            document.getElementById('tierBadge').textContent = 'No configuration found';
            document.getElementById('powerLine').textContent = '';
            document.getElementById('powerNote').textContent = '';
            document.getElementById('specList').innerHTML = '';
            document.getElementById('altList').innerHTML = '';
            document.getElementById('diagramSvg').innerHTML = '';
            document.getElementById('warnList').innerHTML =
                '<div class="config-warn danger"><i class="bi bi-exclamation-triangle me-1"></i>'
                + 'This workload exceeds the configurator’s range — contact us to design a multi-rack deployment.</div>';
            document.getElementById('hintBox').innerHTML = '';
            return;
        }
        const c = result.chosen, p = c.platform, m = result.model;

        document.getElementById('tierBadge').textContent = p.label;
        document.getElementById('priceBig').textContent = fmtRange(c.priceLow, c.priceHigh, fmtMoneyFull);
        document.getElementById('powerLine').innerHTML =
            '<i class="bi bi-lightning-charge-fill"></i> ' + fmtWatts(c.powerLow) + ' – ' + fmtWatts(c.powerHigh)
            + ' <span class="power-note">est. draw</span>';
        const annualKwh = (c.powerMid / 1000) * 8760;
        document.getElementById('powerNote').textContent =
            'GPUs at ~' + Math.round(A.gpu_power_fraction_nominal * 100) + '% of max draw · ~'
            + Math.round(annualKwh).toLocaleString('en-US') + ' kWh/yr (≈ $'
            + Math.round(annualKwh * A.electricity_usd_per_kwh).toLocaleString('en-US') + '/yr @ $'
            + A.electricity_usd_per_kwh + '/kWh)';

        renderDiagram(c, m);
        renderSpecs(c, m);
        renderWarnings(buildWarnings(c, m));
        renderAlternates();
    }

    function gpuShort(label) {
        return label.replace('NVIDIA ', '').replace('(Server) ', '');
    }

    const NET_LABELS = {
        small_switch: '10/25G switch',
        dac_link: '200G QSFP direct link',
        qsfp_switch: '200G QSFP switch',
        dc_switch: '400G fabric switch',
    };

    function renderSpecs(c, m) {
        const p = c.platform;
        const rows = [];
        const row = (k, v, sub) => rows.push(
            '<div class="spec-row"><span class="spec-key">' + k + '</span><span class="spec-val">' + v
            + (sub ? ' <span class="sub">' + sub + '</span>' : '') + '</span></div>');

        if (p.class === 'desktop') {
            row('Hardware', c.servers + '× ' + p.label, p.sku);
        } else {
            row('Servers', c.servers + '× ' + p.vendor + ' ' + p.sku, p.label.replace(p.vendor + ' ', ''));
            row('GPUs', c.gpuCount + '× ' + gpuShort(c.gpu.label), c.tpNote || '');
        }
        row('Total GPU memory', c.totalVram.toLocaleString('en-US') + ' GB');
        row('Primary model', m.example, m.nvfp4_gb + ' GB @ NVFP4');
        const extras = [];
        for (const k in state.features) if (state.features[k]) extras.push(D.features[k].label);
        if (extras.length) row('Also serving', extras.join(' · '));
        row('Est. throughput', '~' + fmtCount(c.aggTok) + ' tok/s aggregate',
            '~' + c.perStreamTok + ' tok/s per stream @ ' + result.streams + ' streams');
        row('Storage (logs)', c.storage.tb + ' TB NVMe', fmtDays(state.retention) + ' retention');
        if (c.network) row('Networking', NET_LABELS[c.network] || c.network);
        if (c.mgmt) row('Head node', '1U MindRouter host');
        row('Rack space', p.rack_u ? (c.servers * p.rack_u) + 'U' + (c.mgmt ? ' + 1U' : '') : 'Desktop (' + c.servers + ' unit' + (c.servers > 1 ? 's' : '') + ')');
        row('Cooling', p.cooling === 'liquid' ? 'Direct liquid cooling required' : 'Air-cooled');
        document.getElementById('specList').innerHTML = rows.join('');
    }

    function buildWarnings(c, m) {
        const warns = [];
        const p = c.platform;
        if (state.budget < c.priceLow) {
            warns.push({ level: 'danger', text: 'Budget (' + fmtMoney(state.budget) + ') is below the estimated floor for this workload.' });
        }
        if (p.class === 'desktop' && (state.api > 100000 || state.chat > 12)) {
            warns.push({ level: 'warn', text: 'DGX Spark‑class hardware suits small workgroups; this concurrency will queue under load.' });
        }
        if (c.tpNote && p.class === 'pcie' && m.nvfp4_gb > 300) {
            warns.push({ level: 'warn', text: 'Large model over PCIe tensor-parallel: expect modest per‑stream speeds; NVLink (HGX) tiers are faster.' });
        }
        if (m.intelligence === 100) {
            warns.push({ level: 'warn', text: 'Frontier‑class (~3T) models require an HGX B300 node (2.3 TB pooled HBM) as the minimum footprint.' });
        }
        return warns;
    }

    function renderWarnings(warns) {
        document.getElementById('warnList').innerHTML = warns.map((w) =>
            '<div class="config-warn' + (w.level === 'danger' ? ' danger' : '') + '">'
            + '<i class="bi bi-exclamation-triangle me-1"></i>' + w.text + '</div>').join('');
        // Headroom hint: with substantial spare budget, suggest the next class up.
        const hintEl = document.getElementById('hintBox');
        hintEl.innerHTML = '';
        if (result && state.modelIdx < D.models.length - 1 && state.budget > result.chosen.priceHigh * 1.35) {
            const saved = state.modelIdx;
            state.modelIdx = saved + 1;
            const up = solve(state);
            state.modelIdx = saved;
            if (up && up.chosen.priceHigh <= state.budget) {
                hintEl.innerHTML = '<div class="config-hint"><i class="bi bi-arrow-up-circle me-1"></i>'
                    + 'Headroom: your budget also covers <strong>' + up.model.example + '</strong> ('
                    + fmtRange(up.chosen.priceLow, up.chosen.priceHigh, fmtMoney) + ' on ' + up.chosen.platform.label + ').</div>';
            }
        }
    }

    function renderAlternates() {
        const elx = document.getElementById('altList');
        if (!result || !result.alternates.length) { elx.innerHTML = ''; return; }
        elx.innerHTML = '<div class="alt-head">Alternative builds</div>'
            + result.alternates.map((c) =>
                '<div class="alt-row"><span>' + c.servers + '× ' + c.platform.label
                + (c.platform.class !== 'desktop' ? ' (' + c.gpuCount + ' GPU)' : '') + '</span>'
                + '<span class="alt-price">' + fmtRange(c.priceLow, c.priceHigh, fmtMoney) + '</span></div>').join('');
    }

    // ------------------------------------------------------------------ //
    // Rack diagram                                                       //
    // ------------------------------------------------------------------ //

    // The diagram is drawn with SVG attributes, so it resolves its palette
    // from the active theme at render time (mirrors the --cfg-* CSS vars).
    function diagTheme() {
        const light = document.documentElement.getAttribute('data-bs-theme') === 'light';
        return light ? {
            bg: '#f8fafc', bgBorder: '#e2e8f0', box: '#ffffff', boxBorder: '#b6c2d4',
            ear: '#d5dde8', line: '#b6c2d4', accent: '#0d9488', accentBg: 'rgba(13,148,136,0.08)',
            text: '#1e293b', sub: '#64748b', led: 'rgba(13,148,136,0.15)',
            featBg: 'rgba(111,66,193,0.08)', featBorder: '#6f42c1', featText: '#5b21b6',
        } : {
            bg: '#0d1225', bgBorder: '#1a2040', box: '#101830', boxBorder: '#2a3a6a',
            ear: '#1a2447', line: '#22305a', accent: '#64ffda', accentBg: 'rgba(100,255,218,0.1)',
            text: '#e9ecef', sub: '#5a6380', led: 'rgba(100,255,218,0.25)',
            featBg: 'rgba(111,66,193,0.15)', featBorder: '#6f42c1', featText: '#b794f6',
        };
    }

    function renderDiagram(c, m) {
        const svg = document.getElementById('diagramSvg');
        const T = diagTheme();
        const p = c.platform;
        const W = 640;
        const maxShow = 5;
        const shown = Math.min(c.servers, maxShow);
        const isDesk = p.class === 'desktop';

        const boxH = isDesk ? 56 : clamp(24 + p.rack_u * 11, 44, 112);
        const boxW = isDesk ? 300 : 360;
        const gap = 14;
        const featOn = Object.keys(state.features).filter((k) => state.features[k]);

        const stackTop = 18;
        const stackH = shown * (boxH + gap) - gap;
        const moreH = c.servers > maxShow ? 24 : 0;

        // MindRouter hub on the left, vertically centered on the node stack;
        // the network component (if any) hangs directly below it.
        const hubW = 190, hubH = 64, hubX = 20;
        const netH = c.network ? 30 : 0;
        const hubY = Math.max(stackTop, stackTop + stackH / 2 - (hubH + netH) / 2);

        const bottomY = Math.max(stackTop + stackH + moreH, hubY + hubH + netH);
        const H = bottomY + (featOn.length ? 46 : 16);

        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        svg.innerHTML = '';
        el('rect', { x: 0.75, y: 0.75, width: W - 1.5, height: H - 1.5, rx: 10, fill: T.bg, stroke: T.bgBorder, 'stroke-width': 1.5 }, svg);

        const boxX = W - boxW - 28;

        // Fan of links: one line out of MindRouter to each node (drawn first,
        // so the boxes sit on top of the line ends).
        const portX = hubX + hubW, portY = hubY + hubH / 2;
        for (let i = 0; i < shown; i++) {
            const sy = stackTop + i * (boxH + gap) + boxH / 2;
            const sx = isDesk ? boxX : boxX - 8;
            const midX = (portX + sx) / 2;
            el('path', {
                d: 'M ' + portX + ' ' + portY
                    + ' C ' + midX + ' ' + portY + ' ' + midX + ' ' + sy + ' ' + sx + ' ' + sy,
                fill: 'none', stroke: T.accent, 'stroke-opacity': 0.45, 'stroke-width': 1.75,
            }, svg);
            el('circle', { cx: sx, cy: sy, r: 3, fill: T.accent }, svg);
        }
        el('circle', { cx: portX, cy: portY, r: 4.5, fill: T.accent }, svg);

        // Hub
        const hub = el('g', {}, svg);
        el('rect', { x: hubX, y: hubY, width: hubW, height: hubH, rx: 8, fill: T.accentBg, stroke: T.accent, 'stroke-width': 1.5 }, hub);
        text(hub, hubX + hubW / 2, hubY + 27, 'MindRouter', { fill: T.accent, 'font-size': 16, 'font-weight': 700, 'text-anchor': 'middle' });
        text(hub, hubX + hubW / 2, hubY + 46, 'route · translate · balance', { fill: T.sub, 'font-size': 9.5, 'text-anchor': 'middle' });
        if (c.network) {
            el('rect', { x: hubX, y: hubY + hubH + 8, width: hubW, height: 22, rx: 4, fill: T.box, stroke: T.line }, svg);
            text(svg, hubX + hubW / 2, hubY + hubH + 23, NET_LABELS[c.network] || c.network,
                { fill: T.sub, 'font-size': 10, 'text-anchor': 'middle' });
        }

        // Server nodes on the right
        for (let i = 0; i < shown; i++) {
            const y = stackTop + i * (boxH + gap);
            const g = el('g', {}, svg);
            el('rect', { x: boxX, y, width: boxW, height: boxH, rx: 6, fill: T.box, stroke: T.boxBorder, 'stroke-width': 1.5 }, g);
            if (!isDesk) {
                // rack ears
                el('rect', { x: boxX - 8, y: y + 4, width: 8, height: boxH - 8, rx: 2, fill: T.ear }, g);
                el('rect', { x: boxX + boxW, y: y + 4, width: 8, height: boxH - 8, rx: 2, fill: T.ear }, g);
            }
            text(g, boxX + 14, y + 20, isDesk ? p.label : p.vendor + ' ' + p.rack_u + 'U ' + (p.cooling === 'liquid' ? '· liquid-cooled' : ''),
                { fill: T.text, 'font-size': 12, 'font-weight': 600 });
            const gpusHere = isDesk ? 1 : Math.ceil(c.gpuCount / c.servers);
            text(g, boxX + 14, y + 36, isDesk ? '128 GB unified · GB10' : gpusHere + '× ' + gpuShort(c.gpu.label),
                { fill: T.sub, 'font-size': 10.5 });
            // GPU activity LEDs
            const nLed = isDesk ? 1 : gpusHere;
            for (let j = 0; j < nLed; j++) {
                el('rect', {
                    x: boxX + boxW - 18 - j * 16, y: y + boxH - 18, width: 11, height: 11, rx: 2,
                    fill: T.led, stroke: T.accent, 'stroke-width': 1,
                }, g);
            }
        }
        if (c.servers > maxShow) {
            text(svg, boxX + boxW / 2, stackTop + stackH + 16,
                '+ ' + (c.servers - maxShow) + ' more identical server' + (c.servers - maxShow > 1 ? 's' : ''),
                { fill: T.sub, 'font-size': 11, 'text-anchor': 'middle' });
        }
        if (featOn.length) {
            const yF = H - 30;
            let xF = 20;
            for (const k of featOn) {
                const label = D.features[k].label;
                const w = label.length * 6.2 + 22;
                el('rect', { x: xF, y: yF, width: w, height: 20, rx: 10, fill: T.featBg, stroke: T.featBorder }, svg);
                text(svg, xF + w / 2, yF + 13.5, label, { fill: T.featText, 'font-size': 9.5, 'text-anchor': 'middle' });
                xF += w + 8;
            }
        }
    }

    function text(parent, x, y, str, attrs) {
        const t = el('text', Object.assign({ x, y }, attrs), parent);
        t.textContent = str;
        return t;
    }

    // ------------------------------------------------------------------ //
    // Copy spec                                                          //
    // ------------------------------------------------------------------ //

    function specText() {
        if (!result) return 'No feasible configuration.';
        const c = result.chosen, p = c.platform, m = result.model;
        const feats = Object.keys(state.features).filter((k) => state.features[k]).map((k) => D.features[k].label);
        return [
            'MindRouter Cluster Configurator — estimate (' + D.generated + ' pricing data)',
            '',
            'Workload: ' + Math.round(state.users) + ' users · ' + Math.round(state.chat) + ' concurrent chat · '
                + fmtCount(state.api) + ' API req/wk · '
                + fmtCount(result.targetTok) + ' tok/s target · ' + fmtDays(state.retention) + ' log retention',
            'Primary model: ' + m.example + ' (' + m.label + ', NVFP4, ' + m.nvfp4_gb + ' GB)',
            feats.length ? 'Features: ' + feats.join(', ') : null,
            '',
            'Hardware: ' + c.servers + '× ' + p.label + (p.class !== 'desktop' ? ' with ' + c.gpuCount + '× ' + gpuShort(c.gpu.label) : ''),
            'Total GPU memory: ' + c.totalVram + ' GB · Storage: ' + c.storage.tb + ' TB NVMe',
            'Estimated cost: ' + fmtRange(c.priceLow, c.priceHigh, fmtMoneyFull),
            'Estimated power: ' + fmtWatts(c.powerLow) + ' – ' + fmtWatts(c.powerHigh)
                + ' (GPUs at ~' + Math.round(A.gpu_power_fraction_nominal * 100) + '% max draw)',
            '',
            'Estimates for planning only; street pricing varies. Not a quote, sale, or endorsement of any',
            'vendor or brand: named hardware and models are reference examples, and comparable alternatives',
            'work just as well. https://mindrouter.ai/configurator.html',
        ].filter((l) => l !== null).join('\n');
    }

    // ------------------------------------------------------------------ //
    // Boot                                                               //
    // ------------------------------------------------------------------ //

    function boot(data) {
        D = data;
        A = D.assumptions;
        state.modelIdx = D.models.findIndex((m) => m.id === '31b');
        if (state.modelIdx < 0) state.modelIdx = 0;
        AXES.find((a) => a.id === 'modelIdx').max = D.models.length - 1;

        document.getElementById('dataDate').textContent = D.generated;
        buildRadar();
        buildFeatures();
        buildInputs();
        buildPresets();

        document.getElementById('copySpecBtn').addEventListener('click', function () {
            const btn = this;
            const reset = (html) => {
                btn.innerHTML = html;
                setTimeout(() => { btn.innerHTML = '<i class="bi bi-clipboard"></i> Copy spec sheet'; }, 1500);
            };
            const copy = (txt) => {
                if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt);
                // Fallback for non-secure contexts (plain http on a LAN)
                return new Promise((resolve, reject) => {
                    const ta = document.createElement('textarea');
                    ta.value = txt;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand('copy') ? resolve() : reject(new Error('copy blocked')); }
                    catch (e) { reject(e); }
                    finally { ta.remove(); }
                });
            };
            copy(specText())
                .then(() => reset('<i class="bi bi-check2"></i> Copied'))
                .catch(() => reset('<i class="bi bi-x-circle"></i> Copy failed'));
        });

        update('init');

        // Redraw the attribute-colored SVG diagram when the theme toggles.
        new MutationObserver(() => renderOutput()).observe(document.documentElement, {
            attributes: true, attributeFilter: ['data-bs-theme'],
        });

        // Deep link: configurator.html#preset=campus applies a preset on load.
        const hash = location.hash.match(/preset=(\w+)/);
        if (hash && PRESETS[hash[1]]) {
            const btn = document.querySelector('.preset-btn[data-preset="' + hash[1] + '"]');
            if (btn) btn.click();
        }
    }

    fetch('data/pricing.json')
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(boot)
        .catch((err) => {
            const elx = document.getElementById('configApp');
            elx.innerHTML = '<div class="alert alert-warning m-4">Could not load <code>data/pricing.json</code> ('
                + err.message + '). If you opened this page from disk, serve it over HTTP instead: '
                + '<code>python -m http.server 8080</code></div>';
        });
})();
