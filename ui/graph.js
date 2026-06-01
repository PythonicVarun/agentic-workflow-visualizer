const SVG_NS = "http://www.w3.org/2000/svg";

const state = {
    graph: { nodes: [], edges: [], events: [], active_count: 0, sequence: 0 },
    selectedId: "primary_agent",
    connected: false,
};

const els = {
    svg: document.querySelector("#graph"),
    empty: document.querySelector("#empty-state"),
    connection: document.querySelector("#connection"),
    connectionText: document.querySelector("#connection-text"),
    nodeCount: document.querySelector("#node-count"),
    edgeCount: document.querySelector("#edge-count"),
    activeCount: document.querySelector("#active-count"),
    sequence: document.querySelector("#sequence"),
    feed: document.querySelector("#event-feed"),
    selectedTitle: document.querySelector("#selected-title"),
    selectedStatus: document.querySelector("#selected-status"),
    selectedRole: document.querySelector("#selected-role"),
    selectedElapsed: document.querySelector("#selected-elapsed"),
    selectedTools: document.querySelector("#selected-tools"),
    selectedAction: document.querySelector("#selected-action"),
    demoButton: document.querySelector("#demo-button"),
    resetButton: document.querySelector("#reset-button"),
    stage: document.querySelector("#graph-stage"),
    zoomIn: document.querySelector("#zoom-in"),
    zoomOut: document.querySelector("#zoom-out"),
    zoomFit: document.querySelector("#zoom-fit"),
    zoomLevel: document.querySelector("#zoom-level"),
};

/* ── Zoom & Pan Controller (viewBox-based for crisp vector rendering) ── */

const zoomPan = {
    /* viewBox state: vx, vy is the top-left corner; vw, vh is the visible area */
    vx: 0,
    vy: 0,
    vw: 960,
    vh: 520,
    /* Full content dimensions (set by buildLayout) */
    contentW: 960,
    contentH: 520,
    minScale: 0.25,
    maxScale: 4,
    /* Drag state */
    dragging: false,
    dragPending: false,
    dragPointerId: 0,
    dragStartX: 0,
    dragStartY: 0,
    vxStart: 0,
    vyStart: 0,
    /* Touch state */
    lastPinchDist: 0,
    /* Animation */
    animId: null,
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/** Current zoom scale = how much the content is magnified */
function currentScale() {
    const stageRect = els.stage.getBoundingClientRect();
    if (!stageRect.width) return 1;
    return stageRect.width / zoomPan.vw;
}

function applyViewBox() {
    els.svg.setAttribute(
        "viewBox",
        `${zoomPan.vx} ${zoomPan.vy} ${zoomPan.vw} ${zoomPan.vh}`,
    );
    const pct = Math.round(currentScale() * 100);
    els.zoomLevel.textContent = `${pct}%`;
}

function animateViewBox(
    targetVx,
    targetVy,
    targetVw,
    targetVh,
    duration = 280,
) {
    if (zoomPan.animId) cancelAnimationFrame(zoomPan.animId);
    const startVx = zoomPan.vx,
        startVy = zoomPan.vy;
    const startVw = zoomPan.vw,
        startVh = zoomPan.vh;
    const t0 = performance.now();
    function tick(now) {
        const elapsed = now - t0;
        const progress = Math.min(elapsed / duration, 1);
        /* ease-out cubic */
        const ease = 1 - Math.pow(1 - progress, 3);
        zoomPan.vx = startVx + (targetVx - startVx) * ease;
        zoomPan.vy = startVy + (targetVy - startVy) * ease;
        zoomPan.vw = startVw + (targetVw - startVw) * ease;
        zoomPan.vh = startVh + (targetVh - startVh) * ease;
        applyViewBox();
        if (progress < 1) {
            zoomPan.animId = requestAnimationFrame(tick);
        } else {
            zoomPan.animId = null;
        }
    }
    zoomPan.animId = requestAnimationFrame(tick);
}

/**
 * Zoom towards a point (in screen/stage coordinates).
 * We convert that point to SVG coordinates, compute the new vw/vh,
 * then reposition vx/vy so the SVG point stays under the cursor.
 */
function zoomAtPoint(factor, screenX, screenY, smooth = false) {
    const stageRect = els.stage.getBoundingClientRect();
    const stageW = stageRect.width;
    const stageH = stageRect.height;
    if (!stageW || !stageH) return;

    /* Cursor position as fraction of the stage */
    const fx = (screenX - stageRect.left) / stageW;
    const fy = (screenY - stageRect.top) / stageH;

    /* SVG coordinate under cursor */
    const svgX = zoomPan.vx + fx * zoomPan.vw;
    const svgY = zoomPan.vy + fy * zoomPan.vh;

    /* New visible dimensions */
    let newVw = zoomPan.vw / factor;
    let newVh = zoomPan.vh / factor;

    /* Clamp by min/max scale */
    const newScale = stageW / newVw;
    const clamped = clamp(newScale, zoomPan.minScale, zoomPan.maxScale);
    if (clamped !== newScale) {
        newVw = stageW / clamped;
        newVh = stageH / clamped;
    }

    /* Keep the SVG point under the cursor */
    const newVx = svgX - fx * newVw;
    const newVy = svgY - fy * newVh;

    if (smooth) {
        animateViewBox(newVx, newVy, newVw, newVh);
    } else {
        zoomPan.vx = newVx;
        zoomPan.vy = newVy;
        zoomPan.vw = newVw;
        zoomPan.vh = newVh;
        applyViewBox();
    }
}

function fitToView(smooth = true) {
    const stageRect = els.stage.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) return;
    const pad = 40; /* SVG-coordinate padding around the content */
    const cw = zoomPan.contentW + pad * 2;
    const ch = zoomPan.contentH + pad * 2;
    const stageAspect = stageRect.width / stageRect.height;
    const contentAspect = cw / ch;
    let vw, vh;
    if (contentAspect > stageAspect) {
        vw = cw;
        vh = cw / stageAspect;
    } else {
        vh = ch;
        vw = ch * stageAspect;
    }
    const vx = -pad + (zoomPan.contentW - vw + pad * 2) / 2;
    const vy = -pad + (zoomPan.contentH - vh + pad * 2) / 2;
    if (smooth) {
        animateViewBox(vx, vy, vw, vh);
    } else {
        zoomPan.vx = vx;
        zoomPan.vy = vy;
        zoomPan.vw = vw;
        zoomPan.vh = vh;
        applyViewBox();
    }
}

function zoomByStep(factor) {
    const stageRect = els.stage.getBoundingClientRect();
    const cx = stageRect.left + stageRect.width / 2;
    const cy = stageRect.top + stageRect.height / 2;
    zoomAtPoint(factor, cx, cy, true);
}

/* ── Wheel zoom ── */

els.stage.addEventListener(
    "wheel",
    (e) => {
        e.preventDefault();
        const delta = -e.deltaY;
        const factor = 1 + Math.sign(delta) * 0.12;
        zoomAtPoint(factor, e.clientX, e.clientY);
    },
    { passive: false },
);

/* ── Pointer drag for pan ── */

const DRAG_THRESHOLD = 5; /* px – must move this far before pan activates */

els.stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".zoom-controls")) return;
    /* Don't start pan immediately; record intent and wait for threshold */
    zoomPan.dragging = false;
    zoomPan.dragPending = true;
    zoomPan.dragStartX = e.clientX;
    zoomPan.dragStartY = e.clientY;
    zoomPan.vxStart = zoomPan.vx;
    zoomPan.vyStart = zoomPan.vy;
    zoomPan.dragPointerId = e.pointerId;
});

els.stage.addEventListener("pointermove", (e) => {
    if (!zoomPan.dragPending && !zoomPan.dragging) return;

    const dx = e.clientX - zoomPan.dragStartX;
    const dy = e.clientY - zoomPan.dragStartY;

    /* Still under threshold – don't pan yet */
    if (zoomPan.dragPending && !zoomPan.dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD)
            return;
        /* Threshold exceeded → promote to real drag */
        zoomPan.dragPending = false;
        zoomPan.dragging = true;
        els.stage.classList.add("grabbing");
        els.stage.setPointerCapture(zoomPan.dragPointerId);
    }

    const stageRect = els.stage.getBoundingClientRect();
    const svgPerPx = zoomPan.vw / stageRect.width;
    zoomPan.vx = zoomPan.vxStart - dx * svgPerPx;
    zoomPan.vy = zoomPan.vyStart - dy * svgPerPx;
    applyViewBox();
});

els.stage.addEventListener("pointerup", () => {
    zoomPan.dragging = false;
    zoomPan.dragPending = false;
    els.stage.classList.remove("grabbing");
});

els.stage.addEventListener("pointercancel", () => {
    zoomPan.dragging = false;
    zoomPan.dragPending = false;
    els.stage.classList.remove("grabbing");
});

/* ── Touch pinch zoom ── */

function pinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
}

els.stage.addEventListener(
    "touchstart",
    (e) => {
        if (e.touches.length === 2) {
            zoomPan.lastPinchDist = pinchDist(e.touches);
        }
    },
    { passive: true },
);

els.stage.addEventListener(
    "touchmove",
    (e) => {
        if (e.touches.length !== 2) return;
        e.preventDefault();
        const dist = pinchDist(e.touches);
        const factor = dist / zoomPan.lastPinchDist;
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        zoomAtPoint(factor, cx, cy);
        zoomPan.lastPinchDist = dist;
    },
    { passive: false },
);

/* ── Button controls ── */

els.zoomIn.addEventListener("click", (e) => {
    e.stopPropagation();
    zoomByStep(1.3);
});
els.zoomOut.addEventListener("click", (e) => {
    e.stopPropagation();
    zoomByStep(1 / 1.3);
});
els.zoomFit.addEventListener("click", (e) => {
    e.stopPropagation();
    fitToView();
});

/* ── Keyboard shortcuts ── */

document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomByStep(1.3);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        zoomByStep(1 / 1.3);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        fitToView();
    }
});

function createSvg(tag, attrs = {}, parent = els.svg) {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            element.setAttribute(key, String(value));
        }
    });
    parent.appendChild(element);
    return element;
}

function trim(text, limit = 42) {
    const clean = String(text || "")
        .replace(/\s+/g, " ")
        .trim();
    if (clean.length <= limit) return clean;
    return `${clean.slice(0, limit - 3).trim()}...`;
}

function formatElapsed(seconds) {
    const value = Math.max(0, Number(seconds || 0));
    if (value < 60) return `${value}s`;
    const minutes = Math.floor(value / 60);
    const remainder = value % 60;
    return `${minutes}m ${remainder}s`;
}

function setConnection(connected) {
    state.connected = connected;
    els.connection.classList.toggle("connected", connected);
    els.connection.classList.toggle("disconnected", !connected);
    els.connectionText.textContent = connected ? "Live" : "Disconnected";
}

function normalizeStatus(status) {
    return ["pending", "running", "complete", "failed"].includes(status)
        ? status
        : "pending";
}

function buildLayout(nodes, edges) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const children = new Map(nodes.map((node) => [node.id, []]));
    const targets = new Set();

    edges.forEach((edge) => {
        if (!byId.has(edge.from) || !byId.has(edge.to)) return;
        children.get(edge.from).push(edge.to);
        targets.add(edge.to);
    });

    children.forEach((list) => {
        list.sort((a, b) => {
            const aNode = byId.get(a);
            const bNode = byId.get(b);
            return String(aNode?.started_at || a).localeCompare(
                String(bNode?.started_at || b),
            );
        });
    });

    const roots = nodes
        .filter((node) => !targets.has(node.id))
        .sort((a, b) =>
            String(a.started_at || a.id).localeCompare(
                String(b.started_at || b.id),
            ),
        );
    if (!roots.length && nodes.length) roots.push(nodes[0]);

    const positions = new Map();
    const visited = new Set();
    let leafIndex = 0;
    let maxDepth = 0;

    function assign(id, depth) {
        if (visited.has(id)) return positions.get(id);
        visited.add(id);
        maxDepth = Math.max(maxDepth, depth);

        const childIds = (children.get(id) || []).filter((childId) =>
            byId.has(childId),
        );
        if (!childIds.length) {
            const position = { xIndex: leafIndex, depth };
            leafIndex += 1;
            positions.set(id, position);
            return position;
        }

        const childPositions = childIds.map((childId) =>
            assign(childId, depth + 1),
        );
        const averageX =
            childPositions.reduce((sum, position) => sum + position.xIndex, 0) /
            childPositions.length;
        const position = { xIndex: averageX, depth };
        positions.set(id, position);
        return position;
    }

    roots.forEach((root) => assign(root.id, 0));
    nodes.forEach((node) => {
        if (!visited.has(node.id)) assign(node.id, maxDepth + 1);
    });

    const nodeWidth = 250;
    const nodeHeight = 98;
    const gapX = 285;
    const gapY = 155;
    const marginX = 50;
    const marginY = 56;
    const width = Math.max(960, marginX * 2 + Math.max(1, leafIndex) * gapX);
    const height = Math.max(520, marginY * 2 + (maxDepth + 1) * gapY);

    const layout = new Map();
    positions.forEach((position, id) => {
        layout.set(id, {
            x: marginX + position.xIndex * gapX,
            y: marginY + position.depth * gapY,
            width: nodeWidth,
            height: nodeHeight,
        });
    });

    return { layout, width, height };
}

function drawEdge(edge, layout) {
    const from = layout.get(edge.from);
    const to = layout.get(edge.to);
    if (!from || !to) return;

    const x1 = from.x + from.width / 2;
    const y1 = from.y + from.height;
    const x2 = to.x + to.width / 2;
    const y2 = to.y;
    const midY = y1 + Math.max(35, (y2 - y1) * 0.48);
    const path = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
    createSvg("path", {
        class: "edge-path",
        d: path,
    });

    if (edge.label) {
        createSvg("text", {
            class: "edge-label",
            x: (x1 + x2) / 2 + 8,
            y: midY - 8,
        }).textContent = trim(edge.label, 18);
    }
}

function nodeText(group, attrs, text) {
    createSvg("text", attrs, group).textContent = text;
}

function drawNode(node, box) {
    const status = normalizeStatus(node.status);
    const group = createSvg("g", {
        class: `node ${status}${node.id === state.selectedId ? " selected" : ""}`,
        transform: `translate(${box.x}, ${box.y})`,
        tabindex: 0,
    });

    group.addEventListener("click", () => {
        state.selectedId = node.id;
        render();
    });
    group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            state.selectedId = node.id;
            render();
        }
    });

    createSvg(
        "rect",
        {
            class: "node-card",
            width: box.width,
            height: box.height,
            rx: 8,
        },
        group,
    );

    createSvg("circle", { class: "running-dot", cx: 20, cy: 22, r: 4 }, group);
    nodeText(
        group,
        { class: "node-title", x: 32, y: 27 },
        trim(node.label, 15),
    );
    nodeText(
        group,
        { class: "node-meta", x: 18, y: 48 },
        `${trim(node.role || "agent", 22)} | ${formatElapsed(node.elapsed_seconds)}`,
    );
    nodeText(
        group,
        { class: "node-action", x: 18, y: 73 },
        trim(node.last_action, 39),
    );

    const pillWidth = 72;
    const pillX = box.width - pillWidth - 12;
    const pillY = 12;
    const pillHeight = 22;
    createSvg(
        "rect",
        {
            class: "status-pill",
            x: pillX,
            y: pillY,
            width: pillWidth,
            height: pillHeight,
            rx: 8,
        },
        group,
    );
    createSvg(
        "text",
        {
            class: "status-text",
            x: pillX + pillWidth / 2,
            y: pillY + pillHeight / 2,
            "text-anchor": "middle",
            "dominant-baseline": "central",
        },
        group,
    ).textContent = status;
}

/* Track whether the user has ever interacted with zoom/pan.
   If not, each renderGraph auto-fits; once the user takes control we stop. */
let userHasInteracted = false;

function markUserInteraction() {
    userHasInteracted = true;
}
els.stage.addEventListener("wheel", markUserInteraction, { once: true });
els.stage.addEventListener(
    "pointerdown",
    (e) => {
        if (!e.target.closest(".zoom-controls")) markUserInteraction();
    },
    { once: true },
);

function renderGraph() {
    const nodes = state.graph.nodes || [];
    const edges = state.graph.edges || [];
    els.svg.replaceChildren();

    els.empty.classList.toggle("hidden", nodes.length > 0);
    if (!nodes.length) {
        zoomPan.contentW = 960;
        zoomPan.contentH = 520;
        if (!userHasInteracted) fitToView(false);
        applyViewBox();
        return;
    }

    const { layout, width, height } = buildLayout(nodes, edges);

    zoomPan.contentW = width;
    zoomPan.contentH = height;

    edges.forEach((edge) => drawEdge(edge, layout));
    nodes.forEach((node) => {
        const box = layout.get(node.id);
        if (box) drawNode(node, box);
    });

    if (!userHasInteracted) {
        fitToView(false);
    }
    /* Always apply the current viewBox (keeps user's zoom/pan intact) */
    applyViewBox();
}

function renderFeed() {
    let events = state.graph.events || [];
    if (state.selectedId) {
        events = events.filter((event) => event.agent_id === state.selectedId);
    }
    els.sequence.textContent = `#${events.length}`;
    els.feed.replaceChildren();
    events.slice(0, 30).forEach((event) => {
        const row = document.createElement("li");
        row.className = "event-row";
        row.addEventListener("click", () => {
            state.selectedId = event.agent_id;
            render();
        });

        const label = document.createElement("strong");
        label.textContent = `${event.label} | ${trim(event.agent_id, 24)}`;
        const summary = document.createElement("span");
        summary.textContent = trim(event.summary, 92);
        const time = document.createElement("span");
        time.textContent = new Date(event.timestamp).toLocaleTimeString();

        row.append(label, summary, time);
        els.feed.append(row);
    });
}

function renderSelected() {
    const nodes = state.graph.nodes || [];
    const selected = state.selectedId
        ? nodes.find((node) => node.id === state.selectedId)
        : null;
    if (!selected) {
        els.selectedTitle.textContent = "Primary Agent";
        els.selectedStatus.textContent = "pending";
        els.selectedRole.textContent = "agent";
        els.selectedElapsed.textContent = "0s";
        els.selectedTools.textContent = "0";
        els.selectedAction.textContent = "Waiting";
        return;
    }

    els.selectedTitle.textContent = selected.label;
    els.selectedStatus.textContent = normalizeStatus(selected.status);
    els.selectedRole.textContent = selected.role || "agent";
    els.selectedElapsed.textContent = formatElapsed(selected.elapsed_seconds);
    els.selectedTools.textContent = String(selected.tool_count || 0);
    els.selectedAction.textContent = selected.last_action || "Waiting";
}

function syncSelectedNode() {
    const nodes = state.graph.nodes || [];
    if (!nodes.length) {
        state.selectedId = null;
        return;
    }
    if (state.selectedId !== null) {
        const exists = nodes.some((node) => node.id === state.selectedId);
        if (!exists) {
            state.selectedId = null;
        }
    }
}

function renderMetrics() {
    const nodes = state.graph.nodes || [];
    const edges = state.graph.edges || [];
    els.nodeCount.textContent = String(nodes.length);
    els.edgeCount.textContent = String(edges.length);
    els.activeCount.textContent = String(state.graph.active_count || 0);
}

function render() {
    renderMetrics();
    syncSelectedNode();
    renderGraph();
    renderFeed();
    renderSelected();
}

async function loadState() {
    const response = await fetch("/state", { cache: "no-store" });
    state.graph = await response.json();
    render();
}

function handleSse(event) {
    const payload = JSON.parse(event.data);
    if (payload.state) {
        state.graph = payload.state;
        render();
    }
}

function connectStream() {
    const source = new EventSource("/stream");
    ["state", "event", "reset", "tick"].forEach((name) => {
        source.addEventListener(name, handleSse);
    });
    source.addEventListener("open", () => setConnection(true));
    source.addEventListener("error", () => setConnection(false));
}

async function postCommand(path) {
    await fetch(path, { method: "POST" });
}

els.demoButton.addEventListener("click", () => postCommand("/demo"));
els.resetButton.addEventListener("click", () => postCommand("/reset"));
els.svg.addEventListener("click", (e) => {
    if (!e.target.closest(".node")) {
        state.selectedId = null;
        render();
    }
});

setInterval(render, 1000);

loadState()
    .then(connectStream)
    .catch(() => setConnection(false));
