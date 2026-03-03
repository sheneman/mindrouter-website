/**
 * MindRouter Token Flow Animation (Simulated)
 * Adapted from the live MindRouter status page.
 * Uses simulated throughput instead of API fetch.
 */
(function() {
    const canvas = document.getElementById('tokenFlowCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const tpsEl = document.getElementById('tpsValue');
    const rpmEl = document.getElementById('rpmValue');
    const activeEl = document.getElementById('activeValue');
    const idleEl = document.getElementById('idleLabel');
    const srEl = document.getElementById('flowStatsSR');

    let W, H;
    const dpr = window.devicePixelRatio || 1;

    function resize() {
        const rect = canvas.parentElement.getBoundingClientRect();
        W = rect.width;
        H = rect.height;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        layoutNodes();
    }

    // --- Network topology ---
    const NODE_RADIUS = 6;
    let nodes = [];
    let edges = [];
    let inputNodes = [];
    let hubNode = null;
    let outputNodes = [];

    function layoutNodes() {
        nodes = [];
        edges = [];
        inputNodes = [];
        outputNodes = [];

        const cx = W / 2;
        const cy = H / 2;

        // Input nodes (left) - incoming requests
        const inputCount = 5;
        for (let i = 0; i < inputCount; i++) {
            const y = cy + (i - (inputCount - 1) / 2) * 40;
            const node = { x: W * 0.1, y: y, type: 'input', r: NODE_RADIUS };
            nodes.push(node);
            inputNodes.push(node);
        }

        // Central hub - the router
        hubNode = { x: cx, y: cy, type: 'hub', r: NODE_RADIUS * 2.5 };
        nodes.push(hubNode);

        // Output nodes (right) - 6 hardcoded backends
        const actualCount = 6;
        for (let i = 0; i < actualCount; i++) {
            const y = cy + (i - (actualCount - 1) / 2) * 38;
            const node = { x: W * 0.9, y: y, type: 'output', r: NODE_RADIUS };
            nodes.push(node);
            outputNodes.push(node);
        }

        // Edges: input->hub, hub->output
        for (const inp of inputNodes) {
            edges.push({ from: inp, to: hubNode });
        }
        for (const out of outputNodes) {
            edges.push({ from: hubNode, to: out });
        }
    }

    // --- Particles ---
    const particles = [];
    const PARTICLE_POOL_MAX = 800;

    const COLORS = [
        { r: 100, g: 255, b: 218 },
        { r: 72,  g: 202, b: 228 },
        { r: 144, g: 224, b: 239 },
        { r: 86,  g: 198, b: 170 },
        { r: 130, g: 170, b: 255 },
    ];

    function spawnParticle() {
        if (particles.length >= PARTICLE_POOL_MAX) return;
        const inp = inputNodes[Math.floor(Math.random() * inputNodes.length)];
        const out = outputNodes[Math.floor(Math.random() * outputNodes.length)];
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        const speed = 0.003 + Math.random() * 0.004;
        const size = 1.5 + Math.random() * 2.5;

        particles.push({
            x: inp.x, y: inp.y,
            seg: 0,
            t: 0,
            from: inp,
            mid: hubNode,
            to: out,
            speed: speed,
            size: size,
            color: color,
            alpha: 0.6 + Math.random() * 0.4,
            trail: [],
        });
    }

    // --- Simulated throughput ---
    let currentTPS = 0;
    let displayTPS = 0;
    let currentRPM = 0;
    let currentActive = 0;
    let simTime = Math.random() * 1000;

    function simulateThroughput() {
        simTime += 1;
        // Base sine wave (~800-2000 tok/s)
        const base = 1400 + Math.sin(simTime * 0.05) * 600;
        // Secondary oscillation
        const secondary = Math.sin(simTime * 0.13) * 300;
        // Noise
        const noise = (Math.random() - 0.5) * 400;
        // Occasional bursts
        const burst = Math.random() < 0.03 ? Math.random() * 2000 : 0;

        currentTPS = Math.max(50, base + secondary + noise + burst);
        currentRPM = Math.round(currentTPS * 0.08 + Math.random() * 5);
        currentActive = Math.round(3 + Math.random() * 8 + (burst > 0 ? 5 : 0));

        if (srEl) {
            srEl.textContent = Math.round(currentTPS) + ' tokens per second, ' + currentRPM + ' recent requests, ' + currentActive + ' active';
        }
    }

    simulateThroughput();
    setInterval(simulateThroughput, 1000);

    // --- Drawing helpers ---
    function drawEdge(edge, alpha) {
        ctx.beginPath();
        ctx.moveTo(edge.from.x, edge.from.y);
        const mx = (edge.from.x + edge.to.x) / 2;
        const my = (edge.from.y + edge.to.y) / 2;
        const offset = (edge.from.y - edge.to.y) * 0.15;
        ctx.quadraticCurveTo(mx + offset, my, edge.to.x, edge.to.y);
        ctx.strokeStyle = 'rgba(30, 45, 80, ' + alpha + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    function drawNode(node) {
        const glow = node.type === 'hub' ? 12 : 6;
        const baseColor = node.type === 'hub'
            ? { r: 100, g: 255, b: 218 }
            : node.type === 'input'
                ? { r: 72, g: 202, b: 228 }
                : { r: 130, g: 170, b: 255 };
        const logTPS = currentTPS > 0 ? Math.log10(1 + currentTPS) : 0;
        const intensity = node.type === 'hub'
            ? 0.12 + Math.min(logTPS * 0.2, 0.75)
            : 0.08 + Math.min(logTPS * 0.12, 0.45);

        // Glow
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r + glow, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(node.x, node.y, node.r, node.x, node.y, node.r + glow);
        grad.addColorStop(0, 'rgba(' + baseColor.r + ',' + baseColor.g + ',' + baseColor.b + ',' + intensity + ')');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + baseColor.r + ',' + baseColor.g + ',' + baseColor.b + ',' + (0.3 + intensity) + ')';
        ctx.fill();

        if (node.type === 'hub') {
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.r + 2, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(100,255,218,' + (0.2 + intensity * 0.5) + ')';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    function drawParticle(p) {
        // Trail
        if (p.trail.length > 1) {
            ctx.beginPath();
            ctx.moveTo(p.trail[0].x, p.trail[0].y);
            for (let i = 1; i < p.trail.length; i++) {
                ctx.lineTo(p.trail[i].x, p.trail[i].y);
            }
            ctx.strokeStyle = 'rgba(' + p.color.r + ',' + p.color.g + ',' + p.color.b + ',' + (p.alpha * 0.15) + ')';
            ctx.lineWidth = p.size * 0.6;
            ctx.stroke();
        }

        // Glow
        const glowR = p.size * 3;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        grad.addColorStop(0, 'rgba(' + p.color.r + ',' + p.color.g + ',' + p.color.b + ',' + (p.alpha * 0.5) + ')');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + p.color.r + ',' + p.color.g + ',' + p.color.b + ',' + p.alpha + ')';
        ctx.fill();
    }

    function curvePoint(from, to, t) {
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        const offset = (from.y - to.y) * 0.15;
        const ct = 1 - t;
        return {
            x: ct * ct * from.x + 2 * ct * t * (mx + offset) + t * t * to.x,
            y: ct * ct * from.y + 2 * ct * t * my + t * t * to.y,
        };
    }

    // --- Animation loop ---
    let lastTime = 0;
    const TRAIL_LENGTH = 8;

    function animate(time) {
        requestAnimationFrame(animate);
        const dt = Math.min(time - lastTime, 50);
        lastTime = time;

        // Smooth TPS display
        displayTPS += (currentTPS - displayTPS) * 0.08;
        tpsEl.textContent = displayTPS < 1 ? displayTPS.toFixed(1) : Math.round(displayTPS).toLocaleString();
        rpmEl.textContent = currentRPM;
        activeEl.textContent = currentActive;

        idleEl.style.display = (currentTPS < 0.1 && currentActive === 0) ? 'block' : 'none';

        // Spawn rate: log-scaled
        const spawnRate = 0.12 + (currentTPS > 0 ? Math.log10(1 + currentTPS) * 12 : 0);
        const spawnCount = Math.max(0, Math.floor(spawnRate * dt / 1000 + Math.random()));
        for (let i = 0; i < spawnCount; i++) spawnParticle();

        // Speed: log-scaled
        const speedMultiplier = 0.7 + (currentTPS > 0 ? Math.log10(1 + currentTPS) * 1.5 : 0);

        // Clear & background
        ctx.clearRect(0, 0, W, H);
        const bg = ctx.createLinearGradient(0, 0, W, 0);
        bg.addColorStop(0, '#080c18');
        bg.addColorStop(0.5, '#0a0e1a');
        bg.addColorStop(1, '#080c18');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // Edges
        const edgeLogTPS = currentTPS > 0 ? Math.log10(1 + currentTPS) : 0;
        const edgeAlpha = 0.25 + Math.min(edgeLogTPS * 0.15, 0.55);
        for (const edge of edges) drawEdge(edge, edgeAlpha);

        // Update & draw particles
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.t += p.speed * speedMultiplier * (dt / 16);

            if (p.t >= 1) {
                if (p.seg === 0) {
                    p.seg = 1;
                    p.t = 0;
                    p.trail = [];
                } else {
                    particles.splice(i, 1);
                    continue;
                }
            }

            const from = p.seg === 0 ? p.from : p.mid;
            const to = p.seg === 0 ? p.mid : p.to;
            const pt = curvePoint(from, to, p.t);
            p.x = pt.x;
            p.y = pt.y;

            p.trail.push({ x: p.x, y: p.y });
            if (p.trail.length > TRAIL_LENGTH) p.trail.shift();

            drawParticle(p);
        }

        // Nodes on top
        for (const node of nodes) drawNode(node);

        // Labels
        ctx.font = '10px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';

        if (inputNodes.length > 0) {
            ctx.fillStyle = 'rgba(90, 99, 128, 0.7)';
            ctx.fillText('Requests', inputNodes[0].x, inputNodes[0].y - 30);
        }
        if (hubNode) {
            ctx.fillStyle = 'rgba(100, 255, 218, 0.6)';
            ctx.font = '11px system-ui, -apple-system, sans-serif';
            ctx.fillText('MindRouter', hubNode.x, hubNode.y - hubNode.r - 12);
        }
        if (outputNodes.length > 0) {
            ctx.fillStyle = 'rgba(90, 99, 128, 0.7)';
            ctx.font = '10px system-ui, -apple-system, sans-serif';
            ctx.fillText('Backends', outputNodes[0].x, outputNodes[0].y - 30);
        }
    }

    window.addEventListener('resize', resize);
    resize();
    requestAnimationFrame(animate);

    // --- Simulated total tokens counter ---
    let totalTokens = 512847293;
    const counterEl = document.getElementById('total-tokens-counter');

    function incrementTokens() {
        // Increment proportional to current simulated TPS
        totalTokens += Math.round(currentTPS * (2 + Math.random()));
        if (counterEl) counterEl.textContent = totalTokens.toLocaleString();
    }

    setInterval(incrementTokens, 2000);
})();
