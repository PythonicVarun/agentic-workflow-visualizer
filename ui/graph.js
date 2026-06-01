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
};

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

function drawDefs() {
    const defs = createSvg("defs");
    const marker = createSvg(
        "marker",
        {
            id: "arrow",
            viewBox: "0 0 10 10",
            refX: 9,
            refY: 5,
            markerWidth: 7,
            markerHeight: 7,
            orient: "auto-start-reverse",
        },
        defs,
    );
    createSvg("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#8a98aa" }, marker);
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
        "marker-end": "url(#arrow)",
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

    const pillWidth = 66;
    createSvg(
        "rect",
        {
            class: "status-pill",
            x: box.width - pillWidth - 14,
            y: 14,
            width: pillWidth,
            height: 22,
            rx: 8,
        },
        group,
    );
    nodeText(
        group,
        { class: "status-text", x: box.width - pillWidth + 3, y: 29 },
        status,
    );
}

function renderGraph() {
    const nodes = state.graph.nodes || [];
    const edges = state.graph.edges || [];
    els.svg.replaceChildren();
    drawDefs();

    els.empty.classList.toggle("hidden", nodes.length > 0);
    if (!nodes.length) {
        els.svg.setAttribute("viewBox", "0 0 960 520");
        return;
    }

    const { layout, width, height } = buildLayout(nodes, edges);
    els.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    els.svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    edges.forEach((edge) => drawEdge(edge, layout));
    nodes.forEach((node) => {
        const box = layout.get(node.id);
        if (box) drawNode(node, box);
    });
}

function renderFeed() {
    const events = state.graph.events || [];
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
    const selected =
        nodes.find((node) => node.id === state.selectedId) || nodes[0];
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

function renderMetrics() {
    const nodes = state.graph.nodes || [];
    const edges = state.graph.edges || [];
    els.nodeCount.textContent = String(nodes.length);
    els.edgeCount.textContent = String(edges.length);
    els.activeCount.textContent = String(state.graph.active_count || 0);
    els.sequence.textContent = `#${state.graph.sequence || 0}`;
}

function render() {
    renderMetrics();
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

setInterval(render, 1000);

loadState()
    .then(connectStream)
    .catch(() => setConnection(false));
