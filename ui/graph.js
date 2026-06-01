const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_EVENT_HISTORY = 80;
const ROOT_AGENT_ID = "primary_agent";

const state = {
    graph: {
        nodes: [],
        edges: [],
        events: [],
        active_count: 0,
        sequence: 0,
        log: {},
    },
    selectedId: "primary_agent",
    connected: false,
    backendAvailable: false,
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
    logStatus: document.querySelector("#log-status"),
    downloadLog: document.querySelector("#download-log"),
    logFileName: document.querySelector("#log-file-name"),
    logPath: document.querySelector("#log-path"),
    replayDropzone: document.querySelector("#replay-dropzone"),
    replayFile: document.querySelector("#replay-file"),
    feed: document.querySelector("#event-feed"),
    selectedTitle: document.querySelector("#selected-title"),
    selectedStatus: document.querySelector("#selected-status"),
    selectedRole: document.querySelector("#selected-role"),
    selectedElapsed: document.querySelector("#selected-elapsed"),
    selectedTools: document.querySelector("#selected-tools"),
    selectedAction: document.querySelector("#selected-action"),
    selectedPrompt: document.querySelector("#selected-prompt"),
    demoButton: document.querySelector("#demo-button"),
    resetButton: document.querySelector("#reset-button"),
    stage: document.querySelector("#graph-stage"),
    zoomIn: document.querySelector("#zoom-in"),
    zoomOut: document.querySelector("#zoom-out"),
    zoomFit: document.querySelector("#zoom-fit"),
    zoomLevel: document.querySelector("#zoom-level"),
};

const zoomPan = {
    vx: 0,
    vy: 0,
    vw: 960,
    vh: 520,
    contentW: 960,
    contentH: 520,
    minScale: 0.25,
    maxScale: 4,
    dragging: false,
    dragPending: false,
    dragPointerId: 0,
    dragStartX: 0,
    dragStartY: 0,
    vxStart: 0,
    vyStart: 0,
    lastPinchDist: 0,
    animId: null,
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

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

function zoomAtPoint(factor, screenX, screenY, smooth = false) {
    const stageRect = els.stage.getBoundingClientRect();
    const stageW = stageRect.width;
    const stageH = stageRect.height;
    if (!stageW || !stageH) return;

    const fx = (screenX - stageRect.left) / stageW;
    const fy = (screenY - stageRect.top) / stageH;
    const svgX = zoomPan.vx + fx * zoomPan.vw;
    const svgY = zoomPan.vy + fy * zoomPan.vh;

    let newVw = zoomPan.vw / factor;
    let newVh = zoomPan.vh / factor;

    const newScale = stageW / newVw;
    const clamped = clamp(newScale, zoomPan.minScale, zoomPan.maxScale);
    if (clamped !== newScale) {
        newVw = stageW / clamped;
        newVh = stageH / clamped;
    }

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
    const pad = 40;
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

const DRAG_THRESHOLD = 5;

els.stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".zoom-controls")) return;
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

    if (zoomPan.dragPending && !zoomPan.dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD)
            return;
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

function humanize(text) {
    const value = String(text || "")
        .replace(/[_-]+/g, " ")
        .trim();
    if (!value) return "Agent";
    return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

function redact(value) {
    if (Array.isArray(value)) {
        return value.slice(0, 12).map((item) => redact(item));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                /key|token|secret|password|credential/i.test(key)
                    ? "[redacted]"
                    : redact(item),
            ]),
        );
    }
    return value;
}

function summarize(value, limit = 140) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return trim(value, limit);
    try {
        return trim(JSON.stringify(redact(value)), limit);
    } catch {
        return trim(String(value), limit);
    }
}

function basename(path) {
    const value = String(path || "").trim();
    if (!value) return "";
    return value.split(/[\\/]/).pop() || value;
}

function parseDate(value) {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function isoNow() {
    return new Date().toISOString();
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
    if (connected) {
        els.connectionText.textContent = "Live";
        return;
    }
    els.connectionText.textContent = state.backendAvailable
        ? "Disconnected"
        : "Static Replay";
}

function normalizeStatus(status) {
    return ["pending", "running", "complete", "failed"].includes(status)
        ? status
        : "pending";
}

function createEmptyGraph(log = {}) {
    return {
        nodes: [],
        edges: [],
        events: [],
        active_count: 0,
        sequence: 0,
        updated_at: isoNow(),
        log,
    };
}

function snapshotNode(node, now) {
    const end = node.completed_at || now;
    const elapsedSeconds = Math.max(
        0,
        Math.floor((end.getTime() - node.started_at.getTime()) / 1000),
    );
    return {
        id: node.id,
        label: node.label,
        role: node.role,
        status: node.status,
        last_action: node.last_action,
        elapsed_seconds: elapsedSeconds,
        started_at: node.started_at.toISOString(),
        updated_at: node.updated_at.toISOString(),
        completed_at: node.completed_at
            ? node.completed_at.toISOString()
            : null,
        model: node.model,
        parent_id: node.parent_id,
        nickname: node.nickname,
        spawn_prompt: node.spawn_prompt,
        event_count: node.event_count,
        tool_count: node.tool_count,
    };
}

function eventSnapshot(sequence, event) {
    const data = event.data || {};
    const labels = {
        session_start: "Session",
        user_input: "Input",
        agent_output: "Output",
        tool_call: "Tool call",
        tool_output: "Tool output",
        subagent_spawn: "Sub-agent spawned",
        subagent_complete: "Sub-agent complete",
        agent_error: "Error",
    };
    const summary =
        data.summary ||
        data.purpose ||
        data.tool_name ||
        data.output ||
        data.prompt ||
        data.message ||
        data.error ||
        event.event_type;
    return {
        sequence,
        event_type: event.event_type,
        label: labels[event.event_type] || humanize(event.event_type),
        agent_id: event.agent_id,
        parent_id: event.parent_id || null,
        summary: summarize(summary, 130),
        timestamp: parseDate(event.timestamp).toISOString(),
    };
}

function buildGraphFromEvents(events, logDetails = {}) {
    const nodes = new Map();
    const edges = new Map();
    const feed = [];
    let sequence = 0;

    function ensureNode(
        agentId,
        {
            label = null,
            role = null,
            status = "running",
            model = null,
            timestamp = null,
        } = {},
    ) {
        const now = parseDate(timestamp);
        let node = nodes.get(agentId);
        if (!node) {
            node = {
                id: agentId,
                label: label || humanize(agentId),
                role: role || "agent",
                status: status || "pending",
                last_action: "Waiting",
                started_at: now,
                updated_at: now,
                completed_at: null,
                model,
                parent_id: null,
                nickname: null,
                spawn_prompt: null,
                event_count: 0,
                tool_count: 0,
            };
            nodes.set(agentId, node);
            return node;
        }
        if (label) node.label = label;
        if (role) node.role = role;
        if (status && !["complete", "failed"].includes(node.status)) {
            node.status = status;
        }
        if (model) node.model = model;
        node.updated_at = now;
        return node;
    }

    function touch(
        event,
        { status = "running", action, role = null, label = null },
    ) {
        const data = event.data || {};
        const node = ensureNode(event.agent_id, {
            label: label || data.label || data.name || null,
            role: data.role || role,
            status,
            model: data.model || null,
            timestamp: event.timestamp,
        });
        node.last_action = trim(action, 140);
        node.updated_at = parseDate(event.timestamp);
        node.event_count += 1;
        if (event.parent_id) node.parent_id = event.parent_id;
        return node;
    }

    function linkParent(parentId, childId, label = "spawned") {
        for (const key of Array.from(edges.keys())) {
            const edge = edges.get(key);
            if (
                edge &&
                edge.to === childId &&
                edge.label === label &&
                edge.from !== parentId
            ) {
                edges.delete(key);
            }
        }
        edges.set(`${parentId}|${childId}|${label}`, {
            from: parentId,
            to: childId,
            label,
        });
    }

    for (const rawEvent of events) {
        const event = {
            ...rawEvent,
            agent_id: rawEvent.agent_id || ROOT_AGENT_ID,
            parent_id: rawEvent.parent_id || null,
            timestamp: parseDate(rawEvent.timestamp).toISOString(),
            data: rawEvent.data || {},
        };
        sequence += 1;
        const data = event.data;

        switch (event.event_type) {
            case "session_start": {
                const source = data.source;
                touch(event, {
                    action: source
                        ? `Session ${source}`
                        : "Visualizer attached",
                    role: "primary",
                    label: "Primary Agent",
                });
                break;
            }
            case "user_input": {
                const prompt = data.prompt || data.input || "Prompt received";
                touch(event, {
                    action: `User prompt: ${summarize(prompt, 110)}`,
                    role: "primary",
                    label: data.label || "Primary Agent",
                });
                break;
            }
            case "agent_output": {
                const output = data.output || data.message || "Responded";
                const status = data.status || "complete";
                const node = touch(event, {
                    status,
                    action: `Output: ${summarize(output, 120)}`,
                });
                if (["complete", "failed"].includes(status)) {
                    node.completed_at = parseDate(event.timestamp);
                }
                break;
            }
            case "tool_call": {
                const toolName = data.tool_name || data.tool || "tool";
                const args = data.args || data.input || data.tool_input;
                const suffix = args ? ` ${summarize(args, 90)}` : "";
                const node = touch(event, {
                    action: `Calling ${toolName}${suffix}`,
                });
                node.tool_count += 1;
                break;
            }
            case "tool_output": {
                const toolName = data.tool_name || data.tool || "tool";
                const output = data.output || data.result || data.tool_response;
                touch(event, {
                    action: `${toolName} result: ${summarize(output, 100)}`,
                });
                const spawnedAgentId = data.spawned_agent_id;
                if (spawnedAgentId) {
                    const parentId = event.agent_id || ROOT_AGENT_ID;
                    ensureNode(parentId, {
                        label:
                            parentId === ROOT_AGENT_ID ? "Primary Agent" : null,
                        role: parentId === ROOT_AGENT_ID ? "primary" : null,
                        status: "running",
                        timestamp: event.timestamp,
                    });
                    const child = ensureNode(spawnedAgentId, {
                        label: data.spawned_agent_label || null,
                        role: "subagent",
                        status: "pending",
                        timestamp: event.timestamp,
                    });
                    child.parent_id = parentId;
                    child.nickname = data.spawned_agent_label || child.nickname;
                    child.spawn_prompt =
                        data.spawn_prompt || child.spawn_prompt;
                    if (child.last_action === "Waiting") {
                        child.last_action = "Spawn requested";
                    }
                    child.updated_at = parseDate(event.timestamp);
                    linkParent(parentId, spawnedAgentId, "spawned");
                }
                break;
            }
            case "subagent_spawn": {
                const existing = nodes.get(event.agent_id);
                const parentId =
                    event.parent_id ||
                    (existing ? existing.parent_id : null) ||
                    ROOT_AGENT_ID;
                ensureNode(parentId, {
                    label: parentId === ROOT_AGENT_ID ? "Primary Agent" : null,
                    role: parentId === ROOT_AGENT_ID ? "primary" : null,
                    status: "running",
                    timestamp: event.timestamp,
                });
                const purpose = data.purpose || data.prompt || "Started";
                const label =
                    data.name || data.label || humanize(event.agent_id);
                const node = touch(event, {
                    status: "running",
                    action: `Spawned: ${summarize(purpose, 110)}`,
                    role: data.agent_type || data.role || "subagent",
                    label,
                });
                node.parent_id = parentId;
                node.nickname = data.name || node.nickname;
                if (data.prompt) node.spawn_prompt = data.prompt;
                node.started_at = new Date(
                    Math.min(
                        node.started_at.getTime(),
                        parseDate(event.timestamp).getTime(),
                    ),
                );
                linkParent(
                    parentId,
                    event.agent_id,
                    data.edge_label || "spawned",
                );
                break;
            }
            case "subagent_complete": {
                const result =
                    data.result_summary ||
                    data.result ||
                    data.output ||
                    "Finished";
                let status = data.status || "complete";
                if (status === "completed") status = "complete";
                if (!["complete", "failed"].includes(status))
                    status = "complete";
                const node = touch(event, {
                    status,
                    action: `Complete: ${summarize(result, 120)}`,
                });
                node.completed_at = parseDate(event.timestamp);
                break;
            }
            case "agent_error": {
                const error = data.error || data.message || "Error";
                const node = touch(event, {
                    status: "failed",
                    action: `Error: ${summarize(error, 120)}`,
                });
                node.completed_at = parseDate(event.timestamp);
                break;
            }
            default:
                break;
        }

        feed.unshift(eventSnapshot(sequence, event));
        if (feed.length > MAX_EVENT_HISTORY) {
            feed.length = MAX_EVENT_HISTORY;
        }
    }

    const now = new Date();
    const nodeSnapshots = Array.from(nodes.values())
        .map((node) => snapshotNode(node, now))
        .sort((a, b) =>
            String(a.started_at || a.id).localeCompare(
                String(b.started_at || b.id),
            ),
        );
    const edgeSnapshots = Array.from(edges.values());
    const activeCount = nodeSnapshots.filter(
        (node) => node.status === "running",
    ).length;
    return {
        nodes: nodeSnapshots,
        edges: edgeSnapshots,
        events: feed,
        active_count: activeCount,
        sequence,
        updated_at: now.toISOString(),
        log: logDetails,
    };
}

function parseLogEntries(content) {
    const text = String(content || "").trim();
    if (!text) return [];
    if (text.startsWith("[")) {
        const value = JSON.parse(text);
        if (!Array.isArray(value)) {
            throw new Error("Expected a JSON array.");
        }
        return value.filter((item) => item && typeof item === "object");
    }
    const entries = [];
    text.split(/\r?\n/).forEach((line, index) => {
        const raw = line.trim();
        if (!raw) return;
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new Error(`Invalid JSON on line ${index + 1}.`);
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(`Expected a JSON object on line ${index + 1}.`);
        }
        entries.push(parsed);
    });
    return entries;
}

function extractEventsFromEntries(entries) {
    const events = [];
    for (const entry of entries) {
        if (entry.event_type) {
            events.push(entry);
            continue;
        }
        if (
            entry.event &&
            typeof entry.event === "object" &&
            entry.event.event_type
        ) {
            events.push(entry.event);
        }
    }
    return events;
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
        els.selectedPrompt.textContent = "No spawn prompt captured.";
        return;
    }

    els.selectedTitle.textContent = selected.label;
    els.selectedStatus.textContent = normalizeStatus(selected.status);
    els.selectedRole.textContent = selected.role || "agent";
    els.selectedElapsed.textContent = formatElapsed(selected.elapsed_seconds);
    els.selectedTools.textContent = String(selected.tool_count || 0);
    els.selectedAction.textContent = selected.last_action || "Waiting";
    els.selectedPrompt.textContent =
        selected.spawn_prompt || "No spawn prompt captured.";
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

function renderLogDetails() {
    const details = state.graph.log || {};
    const fileName =
        details.replay_source ||
        details.file_name ||
        basename(details.current_path);
    const mode = details.mode || (state.backendAvailable ? "live" : "static");
    const modeLabel =
        mode === "replay" ? "Replay" : mode === "static" ? "Static" : "Live";
    els.logStatus.textContent = fileName
        ? `${modeLabel} | ${trim(fileName, 22)}`
        : modeLabel;
    els.logFileName.textContent = trim(fileName || "No log", 28);
    els.logPath.textContent =
        details.current_path ||
        (state.backendAvailable
            ? "Current log path will appear here."
            : "Static host mode. Drop a saved JSONL log to visualize it locally.");
    if (state.backendAvailable) {
        els.downloadLog.href = "/log/current";
        els.downloadLog.removeAttribute("aria-disabled");
        els.downloadLog.classList.remove("is-disabled");
        els.downloadLog.setAttribute(
            "download",
            details.file_name ||
                basename(details.current_path) ||
                "workflow-log.jsonl",
        );
    } else {
        els.downloadLog.removeAttribute("href");
        els.downloadLog.setAttribute("aria-disabled", "true");
        els.downloadLog.classList.add("is-disabled");
    }
}

function render() {
    renderMetrics();
    syncSelectedNode();
    renderGraph();
    renderFeed();
    renderSelected();
    renderLogDetails();
}

async function loadState() {
    try {
        const response = await fetch("/state", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`State request failed with ${response.status}`);
        }
        state.graph = await response.json();
        state.backendAvailable = true;
        setConnection(true);
    } catch {
        state.backendAvailable = false;
        state.graph = createEmptyGraph({
            mode: "static",
            replay_source: null,
            current_path: null,
            file_name: null,
        });
        setConnection(false);
    }
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
    if (!state.backendAvailable) return;
    const source = new EventSource("/stream");
    ["state", "event", "reset", "tick"].forEach((name) => {
        source.addEventListener(name, handleSse);
    });
    source.addEventListener("open", () => setConnection(true));
    source.addEventListener("error", () => setConnection(false));
}

async function postCommand(path) {
    if (!state.backendAvailable) {
        if (path === "/reset") {
            state.graph = createEmptyGraph({
                mode: "static",
                replay_source: null,
                current_path: null,
                file_name: null,
            });
            state.selectedId = ROOT_AGENT_ID;
            userHasInteracted = false;
            render();
        }
        return;
    }
    await fetch(path, { method: "POST" });
}

async function replayLogContent(content, filename) {
    if (state.backendAvailable) {
        const response = await fetch("/replay-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, filename }),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.ok) {
            state.graph = payload.state || state.graph;
            userHasInteracted = false;
            render();
            return;
        }
    }

    const entries = parseLogEntries(content);
    const events = extractEventsFromEntries(entries);
    if (!events.length) {
        throw new Error("No workflow events were found in the supplied log.");
    }
    state.graph = buildGraphFromEvents(events, {
        mode: "replay",
        replay_source: filename || "uploaded log",
        current_path: filename || null,
        file_name: filename || null,
    });
    state.selectedId = ROOT_AGENT_ID;
    userHasInteracted = false;
    setConnection(false);
    render();
}

async function replayFile(file) {
    if (!file) return;
    const text = await file.text();
    await replayLogContent(text, file.name);
}

els.demoButton.addEventListener("click", () => postCommand("/demo"));
els.resetButton.addEventListener("click", () => postCommand("/reset"));
els.replayFile.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    try {
        await replayFile(file);
    } catch (error) {
        window.alert(error instanceof Error ? error.message : "Replay failed.");
    } finally {
        event.target.value = "";
    }
});
["dragenter", "dragover"].forEach((name) => {
    els.replayDropzone.addEventListener(name, (event) => {
        event.preventDefault();
        els.replayDropzone.classList.add("dragover");
    });
});
["dragleave", "dragend"].forEach((name) => {
    els.replayDropzone.addEventListener(name, () => {
        els.replayDropzone.classList.remove("dragover");
    });
});
els.replayDropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.replayDropzone.classList.remove("dragover");
    const [file] = Array.from(event.dataTransfer?.files || []);
    if (!file) return;
    try {
        await replayFile(file);
    } catch (error) {
        window.alert(error instanceof Error ? error.message : "Replay failed.");
    }
});
els.svg.addEventListener("click", (e) => {
    if (!e.target.closest(".node")) {
        state.selectedId = null;
        render();
    }
});

setInterval(render, 1000);

// Resizing Logic for Panes
function setupResizers() {
    const workspace = document.querySelector(".workspace");
    const workspaceResizer = document.getElementById("workspace-resizer");
    const inspector = document.querySelector(".inspector");
    const nodePanel = document.querySelector(".node-panel");
    const replayPanel = document.querySelector(".replay-panel");
    const inspectorResizer1 = document.getElementById("inspector-resizer-1");
    const inspectorResizer2 = document.getElementById("inspector-resizer-2");

    if (!workspace || !workspaceResizer || !inspector) return;

    // Load initial width of workspace columns
    const savedWidth = localStorage.getItem("awv-inspector-width");
    if (savedWidth) {
        workspace.style.gridTemplateColumns = `1fr 14px ${savedWidth}px`;
    }

    // Load initial heights of inspector rows
    const savedNodeHeight = localStorage.getItem("awv-node-height");
    const savedReplayHeight = localStorage.getItem("awv-replay-height");
    if (savedNodeHeight && savedReplayHeight) {
        inspector.style.gridTemplateRows = `${savedNodeHeight}px 14px ${savedReplayHeight}px 14px 1fr`;
    }

    function getClientX(e) {
        return e.touches ? e.touches[0].clientX : e.clientX;
    }

    function getClientY(e) {
        return e.touches ? e.touches[0].clientY : e.clientY;
    }

    // Horizontal Resizer (Workspace Columns: Left vs Right)
    function initHorizontalResize(e) {
        const startX = getClientX(e);
        const startWidth = inspector.getBoundingClientRect().width;

        workspaceResizer.classList.add("active");
        document.body.classList.add("resizing-col");

        function onMove(moveEvent) {
            const dx = getClientX(moveEvent) - startX;
            // inspector is on the right, so dragging left (negative dx) increases its width
            const newWidth = Math.max(290, Math.min(600, startWidth - dx));
            workspace.style.gridTemplateColumns = `1fr 14px ${newWidth}px`;
            localStorage.setItem("awv-inspector-width", newWidth);

            // Re-fit graph to view if user hasn't panned or zoomed manually
            if (
                typeof userHasInteracted !== "undefined" &&
                !userHasInteracted &&
                typeof fitToView === "function"
            ) {
                fitToView(false);
            }
        }

        function onEnd() {
            workspaceResizer.classList.remove("active");
            document.body.classList.remove("resizing-col");
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onEnd);
            document.removeEventListener("touchmove", onMove);
            document.removeEventListener("touchend", onEnd);
        }

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onEnd);
        document.addEventListener("touchmove", onMove, { passive: false });
        document.addEventListener("touchend", onEnd);
    }

    workspaceResizer.addEventListener("mousedown", initHorizontalResize);
    workspaceResizer.addEventListener("touchstart", initHorizontalResize, {
        passive: true,
    });

    // Vertical Resizer 1 (Inspector: Node Panel vs Replay Panel)
    if (inspectorResizer1 && nodePanel && replayPanel) {
        function initVerticalResize1(e) {
            const startY = getClientY(e);
            const startNodeHeight = nodePanel.getBoundingClientRect().height;
            const startReplayHeight =
                replayPanel.getBoundingClientRect().height;

            inspectorResizer1.classList.add("active");
            document.body.classList.add("resizing-row");

            function onMove(moveEvent) {
                const dy = getClientY(moveEvent) - startY;
                let newNodeHeight = startNodeHeight + dy;
                let newReplayHeight = startReplayHeight - dy;

                // Enforce minimum height of 80px for both panels
                if (newNodeHeight < 80) {
                    newNodeHeight = 80;
                    newReplayHeight = startNodeHeight + startReplayHeight - 80;
                } else if (newReplayHeight < 80) {
                    newReplayHeight = 80;
                    newNodeHeight = startNodeHeight + startReplayHeight - 80;
                }

                inspector.style.gridTemplateRows = `${newNodeHeight}px 14px ${newReplayHeight}px 14px 1fr`;
                localStorage.setItem("awv-node-height", newNodeHeight);
                localStorage.setItem("awv-replay-height", newReplayHeight);
            }

            function onEnd() {
                inspectorResizer1.classList.remove("active");
                document.body.classList.remove("resizing-row");
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onEnd);
                document.removeEventListener("touchmove", onMove);
                document.removeEventListener("touchend", onEnd);
            }

            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onEnd);
            document.addEventListener("touchmove", onMove, { passive: false });
            document.addEventListener("touchend", onEnd);
        }

        inspectorResizer1.addEventListener("mousedown", initVerticalResize1);
        inspectorResizer1.addEventListener("touchstart", initVerticalResize1, {
            passive: true,
        });
    }

    // Vertical Resizer 2 (Inspector: Replay Panel vs Feed Panel)
    if (inspectorResizer2 && replayPanel) {
        function initVerticalResize2(e) {
            const startY = getClientY(e);
            const startReplayHeight =
                replayPanel.getBoundingClientRect().height;
            const currentNodeHeight = nodePanel
                ? nodePanel.getBoundingClientRect().height
                : 180;
            const inspectorHeight = inspector.getBoundingClientRect().height;

            inspectorResizer2.classList.add("active");
            document.body.classList.add("resizing-row");

            function onMove(moveEvent) {
                const dy = getClientY(moveEvent) - startY;
                let newReplayHeight = startReplayHeight + dy;

                // Feed panel must be at least 100px
                const maxReplayHeight = Math.max(
                    80,
                    inspectorHeight - currentNodeHeight - 28 - 100,
                );
                newReplayHeight = Math.max(
                    80,
                    Math.min(maxReplayHeight, newReplayHeight),
                );

                const nodeHeight =
                    localStorage.getItem("awv-node-height") ||
                    currentNodeHeight;
                inspector.style.gridTemplateRows = `${nodeHeight}px 14px ${newReplayHeight}px 14px 1fr`;
                localStorage.setItem("awv-replay-height", newReplayHeight);
            }

            function onEnd() {
                inspectorResizer2.classList.remove("active");
                document.body.classList.remove("resizing-row");
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onEnd);
                document.removeEventListener("touchmove", onMove);
                document.removeEventListener("touchend", onEnd);
            }

            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onEnd);
            document.addEventListener("touchmove", onMove, { passive: false });
            document.addEventListener("touchend", onEnd);
        }

        inspectorResizer2.addEventListener("mousedown", initVerticalResize2);
        inspectorResizer2.addEventListener("touchstart", initVerticalResize2, {
            passive: true,
        });
    }

    // Window Resize Handler: Update layout if window resizing causes container to be too small
    window.addEventListener("resize", () => {
        // Trigger fitToView(false) when window resizes and user hasn't panned/zoomed
        if (
            typeof userHasInteracted !== "undefined" &&
            !userHasInteracted &&
            typeof fitToView === "function"
        ) {
            fitToView(false);
        }
    });
}

setupResizers();

loadState()
    .then(() => {
        if (!state.backendAvailable) {
            els.demoButton.disabled = true;
            els.demoButton.title = "Demo requires the FastAPI server.";
        }
        connectStream();
    })
    .catch(() => {
        state.backendAvailable = false;
        setConnection(false);
    });
