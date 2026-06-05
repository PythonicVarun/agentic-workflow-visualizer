const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_EVENT_HISTORY = 80;
const ROOT_AGENT_ID = "primary_agent";
const LLM_CONFIG_STORAGE_KEY = "awv-llm-config";
const AGENT_SUMMARY_STORAGE_KEY = "awv-agent-summaries";
const TOOL_DESCRIPTION_STORAGE_KEY = "awv-tool-descriptions";

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
    modalNodeId: null,
    modalRenderKey: null,
    liveDetailSequence: null,
    liveDetailSyncing: false,
    configModalOpen: false,
    llmConfig: loadLLMConfig(),
    agentSummaries: loadAgentSummaries(),
    summaryQueue: [],
    summaryInflight: new Set(),
    summaryProcessing: false,
    llmStatus: "",
    expandedToolRuns: new Set(),
    toolDescriptions: loadToolDescriptions(),
    toolQueue: [],
    toolProcessing: false,
    toolInflight: new Set(),
};

const sessionLibrary = {
    loaded: false,
    mode: "files",
    selectedSessionId: null,
    selectedFileId: null,
    sessions: [],
    files: [],
    sessionMap: new Map(),
    childMap: new Map(),
};

const els = {
    svg: document.querySelector("#linear-flow"),
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
    replayFolder: document.querySelector("#replay-folder"),
    pickLogFiles: document.querySelector("#pick-log-files"),
    pickLogFolder: document.querySelector("#pick-log-folder"),
    replayDropnote: document.querySelector("#replay-dropnote"),
    feed: document.querySelector("#event-feed"),
    selectedTitle: document.querySelector("#selected-title"),
    selectedStatus: document.querySelector("#selected-status"),
    selectedRole: document.querySelector("#selected-role"),
    selectedElapsed: document.querySelector("#selected-elapsed"),
    selectedTools: document.querySelector("#selected-tools"),
    selectedAction: document.querySelector("#selected-action"),
    selectedSummaryBadge: document.querySelector("#selected-summary-badge"),
    selectedSummaryDescription: document.querySelector(
        "#selected-summary-description",
    ),
    selectedPrompt: document.querySelector("#selected-prompt"),
    selectedToolHistory: document.querySelector("#selected-tool-history"),
    selectedToolHistoryCount: document.querySelector(
        "#selected-tool-history-count",
    ),
    selectedToolHistoryEmpty: document.querySelector(
        "#selected-tool-history-empty",
    ),
    demoButton: document.querySelector("#demo-button"),
    resetButton: document.querySelector("#reset-button"),
    stage: document.querySelector("#graph-stage"),
    agentModal: document.querySelector("#agent-modal"),
    agentModalBackdrop: document.querySelector("#agent-modal-backdrop"),
    agentModalDialog: document.querySelector("#agent-modal-dialog"),
    agentModalTitle: document.querySelector("#agent-modal-title"),
    agentModalSubtitle: document.querySelector("#agent-modal-subtitle"),
    agentModalClose: document.querySelector("#agent-modal-close"),
    agentModalRole: document.querySelector("#agent-modal-role"),
    agentModalStatus: document.querySelector("#agent-modal-status"),
    agentModalElapsed: document.querySelector("#agent-modal-elapsed"),
    agentModalTools: document.querySelector("#agent-modal-tools"),
    agentModalAction: document.querySelector("#agent-modal-action"),
    agentModalSummaryBadge: document.querySelector("#agent-modal-summary-badge"),
    agentModalSummaryDescription: document.querySelector(
        "#agent-modal-summary-description",
    ),
    agentModalPrompt: document.querySelector("#agent-modal-prompt"),
    agentModalToolHistory: document.querySelector("#agent-modal-tool-history"),
    agentModalToolHistoryCount: document.querySelector(
        "#agent-modal-tool-history-count",
    ),
    agentModalToolHistoryEmpty: document.querySelector(
        "#agent-modal-tool-history-empty",
    ),
    llmConfigButton: document.querySelector("#llm-config-button"),
    configModal: document.querySelector("#config-modal"),
    configModalBackdrop: document.querySelector("#config-modal-backdrop"),
    configModalDialog: document.querySelector("#config-modal-dialog"),
    configModalClose: document.querySelector("#config-modal-close"),
    llmConfigForm: document.querySelector("#llm-config-form"),
    llmBaseUrl: document.querySelector("#llm-base-url"),
    llmApiKey: document.querySelector("#llm-api-key"),
    llmModel: document.querySelector("#llm-model"),
    llmConfigStatus: document.querySelector("#llm-config-status"),
    llmConfigSave: document.querySelector("#llm-config-save"),
    llmConfigClear: document.querySelector("#llm-config-clear"),

    // Replay player elements
    replayPlayer: document.querySelector("#replay-player"),
    replayClockTime: document.querySelector("#replay-clock-time"),
    replayEvtCurrent: document.querySelector("#replay-evt-current"),
    replayEvtTotal: document.querySelector("#replay-evt-total"),
    replayScrubber: document.querySelector("#replay-scrubber"),
    replayPlay: document.querySelector("#replay-play"),
    replayPlayIcon: document.querySelector("#replay-play-icon"),
    replayRewind: document.querySelector("#replay-rewind"),
    replayStep: document.querySelector("#replay-step"),
    replaySpeed: document.querySelector("#replay-speed"),
    replayElapsed: document.querySelector("#replay-elapsed"),

    // Session library elements
    sessionLibrarySection: document.querySelector("#session-library-section"),
    sessionLibraryToggle: document.querySelector("#session-library-toggle"),
    sessionLibraryTitle: document.querySelector("#session-library-title"),
    sessionLibraryCount: document.querySelector("#session-library-count"),
    sessionLibraryList: document.querySelector("#session-library-list"),
    sessionLibraryEmpty: document.querySelector("#session-library-empty"),
};

// Zoom & pan disabled for linear scrollable layout
const zoomPan = { vx: 0, vy: 0, vw: 960, vh: 520, contentW: 960, contentH: 520 };

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function fitToView() {}
function applyViewBox() {}

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
    if (typeof value === "string") return trim(stripAnsi(value), limit);
    try {
        return trim(JSON.stringify(redact(value)), limit);
    } catch {
        return trim(String(value), limit);
    }
}

function stripAnsi(text) {
    return String(text || "").replace(
        // eslint-disable-next-line no-control-regex
        /\u001b\[[0-9;?]*[ -/]*[@-~]/g,
        "",
    );
}

function normalizeToolValue(value) {
    const parsed = parseToolPayload(value);
    if (typeof parsed === "string") {
        return stripAnsi(parsed).trim();
    }
    return redact(parsed);
}

function formatToolValue(value) {
    const normalized = normalizeToolValue(value);
    if (normalized === null || normalized === undefined || normalized === "") {
        return "None";
    }
    if (typeof normalized === "string") return normalized;
    try {
        return JSON.stringify(normalized, null, 2);
    } catch {
        return String(normalized);
    }
}

function toolRunSummary(run) {
    return (
        summarize(run.output, 84) ||
        summarize(run.input, 84) ||
        "Waiting for tool output"
    );
}

function toolRunStatus(run) {
    return run.status === "running" ? "running" : "complete";
}

function createToolRun(toolName, event, data, sequence, fallbackInput = null) {
    const runId =
        data.tool_use_id ||
        data.call_id ||
        data.id ||
        `${event.agent_id}:${toolName}:${sequence}`;
    return {
        id: runId,
        tool_name: toolName || "tool",
        input: normalizeToolValue(
            data.args ?? data.input ?? data.tool_input ?? fallbackInput,
        ),
        output: normalizeToolValue(
            data.output ?? data.result ?? data.tool_response ?? null,
        ),
        status:
            data.output !== undefined ||
            data.result !== undefined ||
            data.tool_response !== undefined
                ? "complete"
                : "running",
        started_at: parseDate(event.timestamp).toISOString(),
        completed_at:
            data.output !== undefined ||
            data.result !== undefined ||
            data.tool_response !== undefined
                ? parseDate(event.timestamp).toISOString()
                : null,
        sequence,
        summary: data.summary || null,
    };
}

function basename(path) {
    const value = String(path || "").trim();
    if (!value) return "";
    return value.split(/[\\/]/).pop() || value;
}

function safeJsonParse(value) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text) return null;
    if (!/^[\[{]/.test(text)) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function contentText(content) {
    if (!Array.isArray(content)) return "";
    return content
        .map((item) => item?.text || item?.value || item?.input || "")
        .filter(Boolean)
        .join("\n")
        .trim();
}

function parseToolPayload(rawValue) {
    if (rawValue && typeof rawValue === "object") return rawValue;
    const parsed = safeJsonParse(rawValue);
    return parsed ?? rawValue;
}

function normalizeCodexThreadSource(meta = {}) {
    if (meta.thread_source) return meta.thread_source;
    if (meta.source && typeof meta.source === "object" && meta.source.subagent) {
        return "subagent";
    }
    if (meta.source === "exec") return "subagent";
    return "user";
}

function stripCodexSystemBlocks(text) {
    return String(text || "")
        .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, " ")
        .replace(/<subagent_notification>[\s\S]*?<\/subagent_notification>/gi, " ")
        .replace(/# AGENTS\.md instructions[\s\S]*?<\/INSTRUCTIONS>/gi, " ")
        .replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeCodexPrompt(text) {
    const cleaned = stripCodexSystemBlocks(text);
    const promptMatch = cleaned.match(/User prompt:\s*([\s\S]+)/i);
    return promptMatch ? promptMatch[1].trim() : cleaned;
}

function fileDisplayPath(file) {
    return file?.webkitRelativePath || file?.name || "selected log";
}

function formatDateTime(value) {
    const date = parseDate(value);
    return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
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
    const isStaticReplay = !connected && !state.backendAvailable;
    els.downloadLog.style.display = isStaticReplay ? "none" : "";
    els.demoButton.style.display = isStaticReplay ? "none" : "";
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

function safeLocalStorageGet(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeLocalStorageSet(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // Ignore storage failures in private or restricted contexts.
    }
}

function safeLocalStorageRemove(key) {
    try {
        window.localStorage.removeItem(key);
    } catch {
        // Ignore storage failures in private or restricted contexts.
    }
}

function normalizeLLMConfig(config = {}) {
    const baseUrl = String(config.baseUrl || "")
        .trim()
        .replace(/\/+$/, "");
    const apiKey = String(config.apiKey || "").trim();
    const model = String(config.model || "").trim();
    return { baseUrl, apiKey, model };
}

function loadLLMConfig() {
    const raw = safeLocalStorageGet(LLM_CONFIG_STORAGE_KEY);
    const parsed = safeJsonParse(raw);
    return normalizeLLMConfig(parsed || {});
}

function persistLLMConfig(config) {
    safeLocalStorageSet(
        LLM_CONFIG_STORAGE_KEY,
        JSON.stringify(normalizeLLMConfig(config)),
    );
}

function loadAgentSummaries() {
    const raw = safeLocalStorageGet(AGENT_SUMMARY_STORAGE_KEY);
    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
    }
    const cleaned = Object.fromEntries(
        Object.entries(parsed).filter(([, summary]) => {
            const signature = String(summary?.signature || "");
            return /^sig_[0-9a-f]{8}$/.test(signature);
        }),
    );
    if (Object.keys(cleaned).length !== Object.keys(parsed).length) {
        safeLocalStorageSet(
            AGENT_SUMMARY_STORAGE_KEY,
            JSON.stringify(cleaned),
        );
    }
    return cleaned;
}

function persistAgentSummaries() {
    safeLocalStorageSet(
        AGENT_SUMMARY_STORAGE_KEY,
        JSON.stringify(state.agentSummaries),
    );
}

function loadToolDescriptions() {
    const raw = safeLocalStorageGet(TOOL_DESCRIPTION_STORAGE_KEY);
    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
    }
    return parsed;
}

function persistToolDescriptions() {
    safeLocalStorageSet(
        TOOL_DESCRIPTION_STORAGE_KEY,
        JSON.stringify(state.toolDescriptions),
    );
}

function hasLLMConfig(config = state.llmConfig) {
    return Boolean(config?.baseUrl && config?.apiKey && config?.model);
}

function maskSecret(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (text.length <= 8) return `${text.slice(0, 2)}...${text.slice(-2)}`;
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function sanitizeSummaryName(value, fallback) {
    const cleaned = String(value || "").replace(/^["']|["']$/g, "").trim();
    const compact = cleaned.replace(/\s+/g, " ");
    const words = compact.split(" ").filter(Boolean).slice(0, 3);
    const text = trim(words.join(" "), 42);
    return text || trim(fallback, 42);
}

function sanitizeSummaryDescription(value, fallback) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const fallbackText = String(fallback || "").replace(/\s+/g, " ").trim();
    return text || fallbackText;
}

function fallbackNodeName(node) {
    const base =
        node?.label ||
        node?.nickname ||
        (node?.role ? `${humanize(node.role)} Agent` : humanize(node?.id));
    return sanitizeSummaryName(base, "Agent");
}

function fallbackNodeDescription(node) {
    const fallback = node?.spawn_prompt
        ? trim(node.spawn_prompt, 120)
        : node?.last_action ||
          `${humanize(node?.role || "agent")} task in progress.`;
    return sanitizeSummaryDescription(fallback, "No task summary available yet.");
}

function hashString(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `sig_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function buildNodeSummarySignature(node) {
    if (!node?.id) return "";
    const tools = getNodeToolRuns(node)
        .slice(0, 6)
        .map((run) =>
            [
                run.tool_name || "tool",
                summarize(run.input, 70),
                summarize(run.output, 70),
            ].join("|"),
        )
        .join("||");

    const signatureSource = JSON.stringify({
        id: node.id,
        label: node.label,
        role: node.role,
        status: node.status,
        prompt: node.spawn_prompt,
        action: node.last_action,
        model: node.model,
        tools,
        toolCount: node.tool_count,
        eventCount: node.event_count,
    });
    return hashString(signatureSource);
}

function getNodeSummaryEntry(node) {
    if (!node?.id) return null;
    const summary = state.agentSummaries[node.id];
    if (!summary) return null;
    if (replay.active) {
        return summary;
    }

    return summary.signature === buildNodeSummarySignature(node) ? summary : null;
}

function getNodePresentation(node) {
    const summary = getNodeSummaryEntry(node);
    if (summary?.status === "ready") {
        return {
            name: sanitizeSummaryName(summary.name, fallbackNodeName(node)),
            description: sanitizeSummaryDescription(
                summary.description,
                fallbackNodeDescription(node),
            ),
            status: "ready",
        };
    }
    if (summary?.status === "error") {
        return {
            name: fallbackNodeName(node),
            description: sanitizeSummaryDescription(
                summary.error,
                "Summary generation failed for this agent.",
            ),
            status: "error",
        };
    }
    if (state.summaryInflight.has(node?.id)) {
        return {
            name: fallbackNodeName(node),
            description: "Generating an LLM task summary for this agent.",
            status: "pending",
        };
    }
    if (!hasLLMConfig()) {
        return {
            name: fallbackNodeName(node),
            description:
                "Configure an LLM to generate a readable task summary for this agent.",
            status: "pending",
        };
    }
    return {
        name: fallbackNodeName(node),
        description: fallbackNodeDescription(node),
        status: "pending",
    };
}

function setSummaryBadge(element, status) {
    if (!element) return;
    const normalized =
        status === "ready" || status === "error" ? status : "pending";
    element.classList.remove("pending", "ready", "error");
    element.classList.add(normalized);
    element.textContent = normalized;
}

function summaryCanBeGenerated(node) {
    if (!node) return false;
    if (!["complete", "failed"].includes(node.status)) return false;
    return Boolean(
        node.spawn_prompt ||
            (node.last_action && node.last_action !== "Waiting") ||
            node.tool_count ||
            node.event_count > 1,
    );
}

function enqueueNodeSummary(node) {
    if (!hasLLMConfig() || !summaryCanBeGenerated(node)) return;
    const signature = buildNodeSummarySignature(node);
    if (!signature) return;
    const existing = state.agentSummaries[node.id];
    if (existing?.signature === signature && existing.status === "ready") return;
    if (existing?.signature === signature && existing.status === "error") return;
    if (state.summaryInflight.has(node.id)) return;
    const queued = state.summaryQueue.some(
        (item) => item.nodeId === node.id && item.signature === signature,
    );
    if (queued) return;
    state.summaryQueue.push({ nodeId: node.id, signature });
}

function queueCompletedAgentSummaries() {
    if (!hasLLMConfig()) return;
    (state.graph.nodes || [])
        .filter((node) => ["complete", "failed"].includes(node.status))
        .forEach((node) => enqueueNodeSummary(node));
    void processSummaryQueue();
}

function queueAllPossibleReplaySummaries() {
    if (!hasLLMConfig() || !replay.active || !replay.allEvents.length) return;
    const fullGraph = buildGraphFromEvents(replay.allEvents, replay.logDetails);
    (fullGraph.nodes || [])
        .filter((node) => ["complete", "failed"].includes(node.status))
        .forEach((node) => enqueueNodeSummary(node));

    const allRuns = [];
    (fullGraph.nodes || []).forEach((node) => {
        const runs = node?.tool_runs || [];
        allRuns.push(...runs);
    });

    allRuns.sort((a, b) => {
        const aSeq = Number(a?.sequence || 0);
        const bSeq = Number(b?.sequence || 0);
        return aSeq - bSeq;
    });

    allRuns.forEach((run) => {
        enqueueToolDescription(run);
    });

    void processSummaryQueue();
    void processToolQueue();
}

function llmContentText(content) {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content
        .map((item) => item?.text || item?.value || "")
        .filter(Boolean)
        .join("\n")
        .trim();
}

function parseSummaryPayload(content) {
    const direct = safeJsonParse(content);
    if (Array.isArray(direct)) {
        return direct.find(
            (item) =>
                item &&
                typeof item === "object" &&
                !Array.isArray(item) &&
                (item.name || item.description),
        );
    }
    if (direct && typeof direct === "object") return direct;
    const text = String(content || "");
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        const extractedArray = safeJsonParse(arrayMatch[0]);
        if (Array.isArray(extractedArray)) {
            return extractedArray.find(
                (item) =>
                    item &&
                    typeof item === "object" &&
                    !Array.isArray(item) &&
                    (item.name || item.description),
            );
        }
    }
    const objectMatch = text.match(/\{[\s\S]*\}/);
    const extractedObject = objectMatch ? safeJsonParse(objectMatch[0]) : null;
    return extractedObject &&
        typeof extractedObject === "object" &&
        !Array.isArray(extractedObject)
        ? extractedObject
        : null;
}

function normalizeComparableName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function mirrorsExistingAgentLabel(node, name) {
    const candidate = normalizeComparableName(name);
    if (!candidate) return false;
    const existingNames = [
        node?.label,
        node?.nickname,
        humanize(node?.id),
    ]
        .map((value) => normalizeComparableName(value))
        .filter(Boolean);
    return existingNames.includes(candidate);
}

function buildSummaryRequestContext(node) {
    const toolText = getNodeToolRuns(node)
        .slice(0, 6)
        .map((run, index) => {
            const input = summarize(run.input, 120) || "none";
            const output = summarize(run.output, 120) || "pending";
            return `${index + 1}. ${run.tool_name || "tool"} | input: ${input} | output: ${output}`;
        })
        .join("\n");
    return [
        `Agent id: ${node.id}`,
        `Existing UI label for reference only: ${node.label || "none"}`,
        `Existing nickname for reference only: ${node.nickname || "none"}`,
        `Role: ${node.role || "agent"}`,
        `Status: ${node.status || "pending"}`,
        `Spawn prompt: ${node.spawn_prompt || "none"}`,
        `Latest action: ${node.last_action || "none"}`,
        `Model: ${node.model || "unknown"}`,
        `Tool count: ${node.tool_count || 0}`,
        `Observed tools:\n${toolText || "none"}`,
    ].join("\n");
}

async function requestNodeSummaryAttempt(node, retryMode = false) {
    const { baseUrl, apiKey, model } = state.llmConfig;
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
                {
                    role: "system",
                    content:
                        retryMode
                            ? "You label software agents by the task they actually performed. Your previous answer reused the existing agent label, which is incorrect. Return only strict JSON as a single object with exactly two top-level keys: name and description. The name must describe the completed task, must not repeat, paraphrase, or closely resemble the existing UI label, nickname, or agent id, and must be short: 1 to 3 words only. Do not wrap the object in markdown. Do not add commentary. Do not return an array. If you were about to return a list, return only the best single object instead. The description should be one short sentence describing what the agent did."
                            : "You label software agents by the task they actually performed. Return only strict JSON as a single object with exactly two top-level keys: name and description. The name must describe the completed task, must not repeat, paraphrase, or closely resemble the existing UI label, nickname, or agent id, and must be short: 1 to 3 words only. Do not wrap the object in markdown. Do not add commentary. Do not return an array. If you were about to return a list, return only the best single object instead. The description should be one short sentence describing what the agent did.",
                },
                {
                    role: "user",
                    content: buildSummaryRequestContext(node),
                },
            ],
        }),
    });

    if (!response.ok) {
        const detail = trim(await response.text(), 180);
        throw new Error(detail || `LLM request failed with ${response.status}.`);
    }

    const payload = await response.json();
    const choice = payload?.choices?.[0];
    const content =
        llmContentText(choice?.message?.content) ||
        String(choice?.message?.content || choice?.text || "").trim();
    const parsed = parseSummaryPayload(content);
    if (!parsed) {
        throw new Error("LLM response did not contain valid JSON.");
    }

    return {
        name: sanitizeSummaryName(parsed.name, fallbackNodeName(node)),
        description: sanitizeSummaryDescription(
            parsed.description,
            fallbackNodeDescription(node),
        ),
    };
}

async function requestNodeSummary(node) {
    const first = await requestNodeSummaryAttempt(node, false);
    if (!mirrorsExistingAgentLabel(node, first.name)) {
        return first;
    }

    const second = await requestNodeSummaryAttempt(node, true);
    if (!mirrorsExistingAgentLabel(node, second.name)) {
        return second;
    }

    throw new Error(
        "LLM summary name mirrored the existing agent label instead of the completed task.",
    );
}

async function processSummaryQueue() {
    if (state.summaryProcessing || !hasLLMConfig()) return;
    const nextJob = state.summaryQueue.shift();
    if (!nextJob) return;
    state.summaryProcessing = true;
    state.summaryInflight.add(nextJob.nodeId);
    render();

    try {
        let node;
        if (replay.active && replay.allEvents.length > 0) {
            const fullGraph = buildGraphFromEvents(replay.allEvents, replay.logDetails);
            node = (fullGraph.nodes || []).find((item) => item.id === nextJob.nodeId);
        } else {
            node = (state.graph.nodes || []).find(
                (item) => item.id === nextJob.nodeId,
            );
        }
        if (!node) return;
        const currentSignature = buildNodeSummarySignature(node);
        if (currentSignature !== nextJob.signature) {
            enqueueNodeSummary(node);
            return;
        }
        const result = await requestNodeSummary(node);
        state.agentSummaries[node.id] = {
            signature: currentSignature,
            status: "ready",
            name: result.name,
            description: result.description,
            updated_at: isoNow(),
        };
        persistAgentSummaries();
    } catch (error) {
        state.agentSummaries[nextJob.nodeId] = {
            signature: nextJob.signature,
            status: "error",
            error: trim(
                error instanceof Error ? error.message : "Summary generation failed.",
                150,
            ),
            updated_at: isoNow(),
        };
        persistAgentSummaries();
    } finally {
        state.summaryInflight.delete(nextJob.nodeId);
        state.summaryProcessing = false;
        render();
        if (state.summaryQueue.length) {
            void processSummaryQueue();
        }
    }
}

async function requestToolDescription(run) {
    if (!hasLLMConfig()) throw new Error("No LLM config");
    const url = `${state.llmConfig.baseUrl}/chat/completions`;
    const truncatedInput = trim(formatToolValue(run.input), 1000);

    const systemPrompt = `You are a helpful coding assistant. Given the name of a tool and its input arguments, generate a very short, single-sentence summary of the action being performed (maximum 10 words).
Return your response as a JSON object with a single key "description". Do not output markdown, wrap it in a raw JSON string.

Example:
Tool Name: list_dir
Tool Input: {"DirectoryPath": "/workspace/project"}

Response: {"description": "Listing files in project"}
`;

    const userPrompt = `Tool Name: ${run.tool_name}
Tool Input: ${truncatedInput}`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${state.llmConfig.apiKey}`,
        },
        body: JSON.stringify({
            model: state.llmConfig.model,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
        }),
    });

    if (!response.ok) {
        throw new Error(`LLM failed with status ${response.status}`);
    }

    const payload = await response.json();
    const choice = payload?.choices?.[0];
    const content = String(choice?.message?.content || "").trim();
    const objectMatch = content.match(/\{[\s\S]*\}/);
    const parsed = objectMatch ? safeJsonParse(objectMatch[0]) : null;
    if (!parsed || !parsed.description) {
        throw new Error("Invalid JSON response from LLM");
    }
    return parsed.description;
}

function enqueueToolDescription(run) {
    if (!hasLLMConfig()) return;
    if (!run?.id || !run?.tool_name) return;
    const existing = state.toolDescriptions[run.id];
    if (existing && existing.status === "ready") return;
    if (existing && existing.status === "error") return;
    if (state.toolInflight.has(run.id)) return;
    const queued = state.toolQueue.some((item) => item.id === run.id);
    if (queued) return;
    state.toolQueue.push(run);
    void processToolQueue();
}

async function processToolQueue() {
    if (state.toolProcessing || !hasLLMConfig()) return;
    const run = state.toolQueue.shift();
    if (!run) return;

    state.toolProcessing = true;
    state.toolInflight.add(run.id);

    try {
        const desc = await requestToolDescription(run);
        state.toolDescriptions[run.id] = {
            status: "ready",
            description: desc,
        };
        persistToolDescriptions();
    } catch (error) {
        state.toolDescriptions[run.id] = {
            status: "error",
            description: "Failed to generate tool description.",
        };
        persistToolDescriptions();
    } finally {
        state.toolInflight.delete(run.id);
        state.toolProcessing = false;
        render();
        if (state.toolQueue.length) {
            void processToolQueue();
        }
    }
}

function getToolDescription(run) {
    if (!run?.id) return "";
    const entry = state.toolDescriptions[run.id];
    if (entry?.status === "ready") {
        return entry.description;
    }
    if (state.toolInflight.has(run.id)) {
        return "Generating action description...";
    }
    return "";
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
        tool_runs: (node.tool_runs || []).map((run) => ({
            ...run,
            input: normalizeToolValue(run.input),
            output: normalizeToolValue(run.output),
        })),
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
    const pendingToolRuns = new Map();
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
                tool_runs: [],
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

    function pendingToolKey(agentId, runId) {
        return `${agentId}:${runId}`;
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
                const isPrimaryAgent = event.agent_id === ROOT_AGENT_ID;
                const node = touch(event, {
                    action: `User prompt: ${summarize(prompt, 110)}`,
                    role: data.role || (isPrimaryAgent ? "primary" : "agent"),
                    label: data.label || (isPrimaryAgent ? "Primary Agent" : null),
                });
                node.spawn_prompt = prompt;
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
                const run = createToolRun(toolName, event, data, sequence, args);
                node.tool_runs.push(run);
                pendingToolRuns.set(
                    pendingToolKey(event.agent_id, run.id),
                    run,
                );
                break;
            }
            case "tool_output": {
                const toolName = data.tool_name || data.tool || "tool";
                const output = data.output || data.result || data.tool_response;
                const node = touch(event, {
                    action: `${toolName} result: ${summarize(output, 100)}`,
                });
                const toolId =
                    data.tool_use_id ||
                    data.call_id ||
                    data.id ||
                    `${event.agent_id}:${toolName}:${sequence}`;
                const existingRun = pendingToolRuns.get(
                    pendingToolKey(event.agent_id, toolId),
                );
                if (existingRun) {
                    existingRun.output = normalizeToolValue(output);
                    if (
                        existingRun.input === null ||
                        existingRun.input === undefined ||
                        existingRun.input === ""
                    ) {
                        existingRun.input = normalizeToolValue(
                            data.args ?? data.input ?? data.tool_input ?? null,
                        );
                    }
                    existingRun.status = "complete";
                    existingRun.completed_at = parseDate(event.timestamp).toISOString();
                    existingRun.summary = data.summary || existingRun.summary;
                    pendingToolRuns.delete(
                        pendingToolKey(event.agent_id, toolId),
                    );
                } else {
                    node.tool_runs.push(
                        createToolRun(
                            toolName,
                            event,
                            data,
                            sequence,
                            data.args ?? data.input ?? data.tool_input ?? null,
                        ),
                    );
                    node.tool_count += 1;
                }
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

    let now = new Date();
    if (events && events.length > 0) {
        now = parseDate(events[events.length - 1].timestamp);
    }
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

const REPLAY_FILE_EXTENSIONS = [".jsonl", ".ndjson", ".json"];
let replayDropnoteBaseText = "";

function isSupportedReplayFile(file) {
    const name = String(file?.name || "").toLowerCase();
    return REPLAY_FILE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function formatReplayFilePath(file) {
    return fileDisplayPath(file) || file?.name || "Unnamed file";
}

function setReplayDropnote(message = "", tone = "default") {
    if (!els.replayDropnote) return;
    const detail = String(message || "").trim();
    els.replayDropnote.textContent = detail
        ? `${detail} ${replayDropnoteBaseText}`.trim()
        : replayDropnoteBaseText;
    els.replayDropnote.classList.toggle("is-warning", tone === "warning");
}

function summarizeReplayImportIssues(report, source) {
    const parts = [];
    if (report.unreadable.length) {
        const sample = formatReplayFilePath(report.unreadable[0].file);
        parts.push(
            `Skipped ${report.unreadable.length} unreadable file${report.unreadable.length === 1 ? "" : "s"} (for example, ${sample}).`,
        );
    }
    if (report.invalid.length) {
        const sample = formatReplayFilePath(report.invalid[0].file);
        parts.push(
            `Skipped ${report.invalid.length} invalid log file${report.invalid.length === 1 ? "" : "s"} (for example, ${sample}).`,
        );
    }
    if (report.unsupported.length && source === "folder") {
        parts.push(
            `Ignored ${report.unsupported.length} non-log file${report.unsupported.length === 1 ? "" : "s"}.`,
        );
    }
    return parts.join(" ");
}

async function readReplayImport(fileList, source = "files") {
    const allFiles = Array.from(fileList || []).filter(Boolean);
    const report = {
        unreadable: [],
        invalid: [],
        unsupported: [],
    };
    const supportedFiles = [];

    allFiles.forEach((file) => {
        if (isSupportedReplayFile(file)) {
            supportedFiles.push(file);
        } else {
            report.unsupported.push(file);
        }
    });

    if (!supportedFiles.length) {
        if (source === "folder") {
            throw new Error(
                "No .jsonl, .ndjson, or .json files were found in the selected folder.",
            );
        }
        throw new Error("Select one or more .jsonl, .ndjson, or .json log files.");
    }

    const settled = await Promise.allSettled(
        supportedFiles.map(async (file) => {
            const text = await file.text();
            return {
                file,
                text,
                entries: parseLogEntries(text),
            };
        }),
    );

    const parsedFiles = [];
    settled.forEach((result, index) => {
        const file = supportedFiles[index];
        if (result.status === "fulfilled") {
            parsedFiles.push(result.value);
            return;
        }
        const reason =
            result.reason instanceof Error
                ? result.reason.message
                : String(result.reason || "Unknown error.");
        const issue = { file, reason };
        if (/read|permission|notreadable|acquired/i.test(reason)) {
            report.unreadable.push(issue);
        } else {
            report.invalid.push(issue);
        }
    });

    if (!parsedFiles.length) {
        if (report.unreadable.length && !report.invalid.length) {
            throw new Error(
                "None of the selected files could be read. The browser reported a file access or permission error.",
            );
        }
        const firstInvalid = report.invalid[0];
        if (firstInvalid) {
            throw new Error(
                `${formatReplayFilePath(firstInvalid.file)} could not be parsed: ${firstInvalid.reason}`,
            );
        }
    }

    return { parsedFiles, report };
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

function getCodexSessionMeta(entries) {
    const metaEntry = entries.find(
        (entry) =>
            entry?.type === "session_meta" &&
            entry.payload &&
            typeof entry.payload === "object",
    );
    return metaEntry?.payload || null;
}

function deriveCodexSessionTitle(entries, meta, fallbackName) {
    for (const entry of entries) {
        if (entry?.type !== "event_msg" || entry?.payload?.type !== "user_message") {
            continue;
        }
        const prompt = normalizeCodexPrompt(entry.payload.message);
        if (prompt) return trim(prompt, 58);
    }
    if (meta?.agent_nickname) {
        return `${humanize(meta.agent_nickname)} session`;
    }
    return basename(fallbackName || meta?.id || "codex-session");
}

function buildCodexSessionDescriptor(file, entries) {
    const meta = getCodexSessionMeta(entries);
    if (!meta?.id) return null;
    const threadSource = normalizeCodexThreadSource(meta);
    const timestamps = entries
        .map((entry) => parseDate(entry?.timestamp).getTime())
        .filter((value) => Number.isFinite(value));
    const startedAt = meta.timestamp || entries[0]?.timestamp || isoNow();
    const updatedAt = timestamps.length
        ? new Date(Math.max(...timestamps)).toISOString()
        : startedAt;
    const parentSessionId =
        meta.forked_from_id ||
        meta.source?.subagent?.thread_spawn?.parent_thread_id ||
        null;
    return {
        id: meta.id,
        meta,
        entries,
        file,
        fileName: file.name,
        filePath: fileDisplayPath(file),
        threadSource,
        parentSessionId,
        nickname:
            meta.agent_nickname ||
            meta.source?.subagent?.thread_spawn?.agent_nickname ||
            null,
        role:
            meta.agent_role ||
            meta.source?.subagent?.thread_spawn?.agent_role ||
            (threadSource === "subagent" ? "subagent" : "primary"),
        cwd: meta.cwd || null,
        startedAt,
        updatedAt,
        title: deriveCodexSessionTitle(entries, meta, file.name),
    };
}

function rebuildSessionLibrary(descriptors) {
    sessionLibrary.loaded = true;
    sessionLibrary.mode = "codex";
    sessionLibrary.selectedSessionId = null;
    sessionLibrary.selectedFileId = null;
    sessionLibrary.files = [];
    sessionLibrary.sessions = descriptors
        .slice()
        .sort(
            (a, b) =>
                parseDate(b.updatedAt).getTime() - parseDate(a.updatedAt).getTime(),
        );
    sessionLibrary.sessionMap = new Map(
        sessionLibrary.sessions.map((session) => [session.id, session]),
    );
    sessionLibrary.childMap = new Map();
    sessionLibrary.sessions.forEach((session) => {
        if (!session.parentSessionId) return;
        const existing = sessionLibrary.childMap.get(session.parentSessionId) || [];
        existing.push(session.id);
        sessionLibrary.childMap.set(session.parentSessionId, existing);
    });
}

function rebuildFileLibrary(parsedFiles) {
    sessionLibrary.loaded = true;
    sessionLibrary.mode = "files";
    sessionLibrary.selectedSessionId = null;
    sessionLibrary.selectedFileId = null;
    sessionLibrary.sessions = [];
    sessionLibrary.sessionMap = new Map();
    sessionLibrary.childMap = new Map();
    sessionLibrary.files = parsedFiles
        .map(({ file, text, entries }, index) => {
            const events = extractEventsFromEntries(entries);
            const timestamps = events
                .map((event) => parseDate(event.timestamp).getTime())
                .filter((value) => Number.isFinite(value));
            const updatedAt = timestamps.length
                ? new Date(Math.max(...timestamps)).toISOString()
                : file.lastModified
                  ? new Date(file.lastModified).toISOString()
                  : isoNow();
            return {
                id: `file-${index}-${file.name}`,
                file,
                text,
                entries,
                fileName: file.name,
                filePath: fileDisplayPath(file),
                updatedAt,
                eventCount: events.length,
                title: file.name,
            };
        })
        .sort(
            (a, b) =>
                parseDate(b.updatedAt).getTime() - parseDate(a.updatedAt).getTime(),
        );
}

function rebuildIndexedFileLibrary(items) {
    sessionLibrary.loaded = true;
    sessionLibrary.mode = "files";
    sessionLibrary.selectedSessionId = null;
    sessionLibrary.selectedFileId = null;
    sessionLibrary.sessions = [];
    sessionLibrary.sessionMap = new Map();
    sessionLibrary.childMap = new Map();
    sessionLibrary.files = items
        .map((item, index) => {
            const fileName = basename(item.file || item.path || `log-${index}.jsonl`);
            return {
                id: `indexed-file-${index}-${fileName}`,
                file: null,
                text: null,
                entries: null,
                fileName,
                filePath: item.file || item.path || fileName,
                fetchUrl: `./logs/${fileName}`,
                updatedAt: isoNow(),
                eventCount: Number(item.events || 0),
                title: item.title || fileName,
                description: item.description || "Log file",
                duration: item.duration || null,
                agents: Number(item.agents || 0),
                model: item.model || null,
            };
        })
        .sort((a, b) => a.title.localeCompare(b.title));
}

async function loadIndexedLogs() {
    if (sessionLibrary.loaded) return;
    try {
        const response = await fetch("./logs/index.json", {
            cache: "no-store",
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (!Array.isArray(payload) || !payload.length) return;
        rebuildIndexedFileLibrary(payload);
        renderSessionLibrary();
    } catch {
        // Ignore when no bundled log index is available.
    }
}

function primarySessions() {
    return sessionLibrary.sessions.filter(
        (session) => session.threadSource !== "subagent",
    );
}

function spawnedSubagentCount(sessionId) {
    return (sessionLibrary.childMap.get(sessionId) || []).length;
}

function descendantSessionIds(sessionId) {
    const results = [];
    const stack = [...(sessionLibrary.childMap.get(sessionId) || [])];
    while (stack.length) {
        const childId = stack.pop();
        results.push(childId);
        const next = sessionLibrary.childMap.get(childId) || [];
        stack.push(...next);
    }
    return results;
}

function renderSessionLibrary() {
    const list = els.sessionLibraryList;
    const empty = els.sessionLibraryEmpty;
    const count = els.sessionLibraryCount;
    const isCodexMode = sessionLibrary.mode === "codex";
    const sessions = isCodexMode ? primarySessions() : [];
    const files = isCodexMode ? [] : sessionLibrary.files;

    els.sessionLibraryTitle.textContent = isCodexMode
        ? "Codex Sessions"
        : "Demo Logs";
    count.textContent = String(isCodexMode ? sessions.length : files.length);

    if (!sessionLibrary.loaded) {
        list.innerHTML = "";
        list.style.display = "none";
        empty.style.display = "";
        empty.textContent =
            "Load one or more log files to inspect them here.";
        return;
    }

    if (isCodexMode && !sessions.length) {
        list.innerHTML = "";
        list.style.display = "none";
        empty.style.display = "";
        empty.textContent =
            "No primary Codex sessions were found in the selected files.";
        return;
    }

    if (!isCodexMode && !files.length) {
        list.innerHTML = "";
        list.style.display = "none";
        empty.style.display = "";
        empty.textContent = "No replayable log files were found.";
        return;
    }

    empty.style.display = "none";
    list.style.display = "";
    list.innerHTML = "";

    if (!isCodexMode) {
        files.forEach((entry) => {
            const li = document.createElement("li");
            li.className = `demo-log-card session-log-card${sessionLibrary.selectedFileId === entry.id ? " is-selected" : ""}`;
            li.dataset.fileId = entry.id;
            li.setAttribute("role", "button");
            li.setAttribute("tabindex", "0");

            const header = document.createElement("div");
            header.className = "demo-log-header session-log-header";

            const playIcon = document.createElement("span");
            playIcon.className = "demo-log-play-icon";
            playIcon.innerHTML =
                '<svg viewBox="0 0 14 14" width="12" height="12" fill="currentColor"><polygon points="4,2 12,7 4,12"/></svg>';

            const titleWrap = document.createElement("div");
            titleWrap.className = "session-log-title-wrap";

            const title = document.createElement("span");
            title.className = "demo-log-title";
            title.textContent = entry.title;

            const path = document.createElement("span");
            path.className = "session-log-path";
            path.textContent = entry.filePath;

            titleWrap.append(title, path);
            header.append(playIcon, titleWrap);
            li.appendChild(header);

            const description = document.createElement("p");
            description.className = "session-log-description";
            description.textContent =
                entry.description ||
                `${entry.eventCount} replay event${entry.eventCount === 1 ? "" : "s"}`;
            li.appendChild(description);

            const meta = document.createElement("div");
            meta.className = "demo-log-meta session-log-meta";

            const updated = document.createElement("span");
            updated.className = "demo-log-pill";
            updated.textContent =
                entry.duration || formatDateTime(entry.updatedAt);
            meta.appendChild(updated);

            if (entry.eventCount) {
                const eventPill = document.createElement("span");
                eventPill.className = "demo-log-pill";
                eventPill.textContent = `${entry.eventCount} event${entry.eventCount === 1 ? "" : "s"}`;
                meta.appendChild(eventPill);
            }

            if (entry.agents) {
                const agentPill = document.createElement("span");
                agentPill.className = "demo-log-pill";
                agentPill.textContent = `${entry.agents} agent${entry.agents === 1 ? "" : "s"}`;
                meta.appendChild(agentPill);
            }

            const typePill = document.createElement("span");
            typePill.className = "demo-log-pill model-pill";
            typePill.textContent = entry.model || "log file";
            meta.appendChild(typePill);

            li.appendChild(meta);
            list.appendChild(li);
        });
        return;
    }

    sessions.forEach((session) => {
        const li = document.createElement("li");
        const spawnedCount = spawnedSubagentCount(session.id);
        li.className = `demo-log-card session-log-card${sessionLibrary.selectedSessionId === session.id ? " is-selected" : ""}`;
        li.dataset.sessionId = session.id;
        li.setAttribute("role", "button");
        li.setAttribute("tabindex", "0");

        const header = document.createElement("div");
        header.className = "demo-log-header session-log-header";

        const playIcon = document.createElement("span");
        playIcon.className = "demo-log-play-icon";
        playIcon.innerHTML =
            '<svg viewBox="0 0 14 14" width="12" height="12" fill="currentColor"><polygon points="4,2 12,7 4,12"/></svg>';

        const titleWrap = document.createElement("div");
        titleWrap.className = "session-log-title-wrap";

        const title = document.createElement("span");
        title.className = "demo-log-title";
        title.textContent = session.title;

        const path = document.createElement("span");
        path.className = "session-log-path";
        path.textContent = session.filePath;

        titleWrap.append(title, path);
        header.append(playIcon, titleWrap);
        li.appendChild(header);

        const description = document.createElement("p");
        description.className = "session-log-description";
        description.textContent = session.cwd || "Codex session log";
        li.appendChild(description);

        const meta = document.createElement("div");
        meta.className = "demo-log-meta session-log-meta";

        const updated = document.createElement("span");
        updated.className = "demo-log-pill";
        updated.textContent = formatDateTime(session.updatedAt);
        meta.appendChild(updated);

        const childPill = document.createElement("span");
        childPill.className = "demo-log-pill";
        childPill.textContent = `${spawnedCount} sub-agent${spawnedCount === 1 ? "" : "s"}`;
        meta.appendChild(childPill);

        const source = document.createElement("span");
        source.className = "demo-log-pill model-pill";
        source.textContent =
            typeof session.meta.source === "string"
                ? session.meta.source
                : session.threadSource;
        meta.appendChild(source);

        li.appendChild(meta);
        list.appendChild(li);
    });
}

function collectSpawnHints(sessions) {
    const hints = new Map();
    sessions.forEach((session) => {
        const pendingCalls = new Map();
        session.entries.forEach((entry) => {
            if (entry?.type !== "response_item" || !entry.payload) return;
            const payload = entry.payload;
            if (
                (payload.type === "function_call" ||
                    payload.type === "custom_tool_call") &&
                payload.call_id
            ) {
                pendingCalls.set(payload.call_id, {
                    name: payload.name,
                    args: parseToolPayload(payload.arguments || payload.input),
                });
                return;
            }
            if (
                payload.call_id &&
                (payload.type === "function_call_output" ||
                    payload.type === "custom_tool_call_output")
            ) {
                const pending = pendingCalls.get(payload.call_id);
                if (!pending || pending.name !== "spawn_agent") return;
                const parsedOutput = parseToolPayload(payload.output);
                const agentId = parsedOutput?.agent_id;
                if (!agentId) return;
                hints.set(agentId, {
                    parentSessionId: session.id,
                    nickname:
                        parsedOutput.nickname ||
                        pending.args?.agent_nickname ||
                        null,
                    prompt: pending.args?.message || null,
                });
            }
        });
    });
    return hints;
}

function sessionAgentId(sessionId, rootSessionId) {
    return sessionId === rootSessionId ? ROOT_AGENT_ID : sessionId;
}

function codexToolOutputName(payloadType, fallback) {
    if (fallback) return fallback;
    if (!payloadType || !payloadType.endsWith("_output")) return "tool";
    return payloadType.replace(/_output$/, "");
}

function translateCodexSession(session, rootSessionId, spawnHints) {
    const events = [];
    const agentId = sessionAgentId(session.id, rootSessionId);
    const parentId = session.parentSessionId
        ? sessionAgentId(session.parentSessionId, rootSessionId)
        : null;
    const pendingCalls = new Map();

    if (session.id === rootSessionId) {
        events.push({
            event_type: "session_start",
            agent_id: ROOT_AGENT_ID,
            timestamp: session.startedAt,
            data: {
                source: session.meta.source || session.threadSource,
                label: "Primary Agent",
                role: "primary",
            },
        });
    } else {
        const spawnHint = spawnHints.get(session.id);
        events.push({
            event_type: "subagent_spawn",
            agent_id: agentId,
            parent_id: parentId,
            timestamp: session.startedAt,
            data: {
                name: spawnHint?.nickname || session.nickname || humanize(agentId),
                label: spawnHint?.nickname || session.nickname || humanize(agentId),
                prompt: spawnHint?.prompt || null,
                role: session.role || "subagent",
                purpose: spawnHint?.prompt || `${humanize(session.role)} task`,
            },
        });
    }

    session.entries.forEach((entry) => {
        if (!entry || !entry.type) return;
        if (entry.type === "event_msg") {
            const payload = entry.payload || {};
            if (payload.type === "user_message") {
                const prompt = normalizeCodexPrompt(payload.message);
                if (!prompt) return;
                events.push({
                    event_type: "user_input",
                    agent_id: agentId,
                    parent_id: parentId,
                    timestamp: entry.timestamp,
                    data: {
                        prompt,
                        label:
                            agentId === ROOT_AGENT_ID
                                ? "Primary Agent"
                                : session.nickname || humanize(agentId),
                        role: session.role || (agentId === ROOT_AGENT_ID ? "primary" : "subagent"),
                    },
                });
                return;
            }
            if (payload.type === "agent_message" && payload.phase === "commentary") {
                events.push({
                    event_type: "agent_output",
                    agent_id: agentId,
                    parent_id: parentId,
                    timestamp: entry.timestamp,
                    data: {
                        output: payload.message || "Updated",
                        status: "running",
                    },
                });
                return;
            }
            if (payload.type === "task_complete") {
                if (agentId === ROOT_AGENT_ID) {
                    events.push({
                        event_type: "agent_output",
                        agent_id: agentId,
                        timestamp: entry.timestamp,
                        data: {
                            output: payload.last_agent_message || "Task complete",
                            status: "complete",
                        },
                    });
                } else {
                    events.push({
                        event_type: "subagent_complete",
                        agent_id: agentId,
                        parent_id: parentId,
                        timestamp: entry.timestamp,
                        data: {
                            status: "complete",
                            result_summary:
                                payload.last_agent_message || "Sub-agent complete",
                        },
                    });
                }
                return;
            }
            if (payload.type === "task_failed") {
                events.push({
                    event_type: "agent_error",
                    agent_id: agentId,
                    parent_id: parentId,
                    timestamp: entry.timestamp,
                    data: {
                        error: payload.error || payload.message || "Task failed",
                    },
                });
            }
            return;
        }

        if (entry.type !== "response_item") return;
        const payload = entry.payload || {};
        if (
            (payload.type === "function_call" ||
                payload.type === "custom_tool_call") &&
            payload.call_id
        ) {
            const parsedArgs = parseToolPayload(payload.arguments || payload.input);
            pendingCalls.set(payload.call_id, {
                name: payload.name || "tool",
                args: parsedArgs,
            });
            events.push({
                event_type: "tool_call",
                agent_id: agentId,
                parent_id: parentId,
                timestamp: entry.timestamp,
                data: {
                    tool_name: payload.name || "tool",
                    args: parsedArgs,
                    call_id: payload.call_id,
                },
            });
            return;
        }

        if (
            payload.call_id &&
            (payload.type === "function_call_output" ||
                payload.type === "custom_tool_call_output" ||
                payload.type === "tool_search_output")
        ) {
            const pending = pendingCalls.get(payload.call_id);
            const output = parseToolPayload(payload.output);
            const toolName = codexToolOutputName(payload.type, pending?.name);
            const data = {
                tool_name: toolName,
                output,
                call_id: payload.call_id,
            };
            if (toolName === "spawn_agent" && output?.agent_id) {
                data.spawned_agent_id = output.agent_id;
                data.spawned_agent_label =
                    output.nickname || pending?.args?.agent_nickname || null;
                data.spawn_prompt = pending?.args?.message || null;
            }
            events.push({
                event_type: "tool_output",
                agent_id: agentId,
                parent_id: parentId,
                timestamp: entry.timestamp,
                data,
            });
        }
    });

    return events;
}

function replayCodexSession(sessionId) {
    const root = sessionLibrary.sessionMap.get(sessionId);
    if (!root) return;
    const sessionIds = [sessionId, ...descendantSessionIds(sessionId)];
    const sessions = sessionIds
        .map((id) => sessionLibrary.sessionMap.get(id))
        .filter(Boolean)
        .sort(
            (a, b) =>
                parseDate(a.startedAt).getTime() - parseDate(b.startedAt).getTime(),
        );
    const spawnHints = collectSpawnHints(sessions);
    const events = sessions.flatMap((session) =>
        translateCodexSession(session, sessionId, spawnHints),
    );
    if (!events.length) {
        throw new Error("No replayable events were found in the selected session.");
    }
    sessionLibrary.selectedSessionId = sessionId;
    renderSessionLibrary();
    replayLoadEvents(
        events,
        root.title,
        {
            mode: "replay",
            replay_source: root.title,
            current_path: root.filePath,
            file_name: root.fileName,
        },
    );
}

function replayFileEntry(fileId) {
    const entry = sessionLibrary.files.find((item) => item.id === fileId);
    if (!entry) return;
    sessionLibrary.selectedFileId = fileId;
    renderSessionLibrary();
    if (entry.text) {
        return replayLogContent(entry.text, entry.fileName);
    }
    if (!entry.fetchUrl) {
        throw new Error(`No replay content is available for ${entry.fileName}.`);
    }
    return fetch(entry.fetchUrl, { cache: "no-store" })
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(`Failed to load ${entry.fileName} from logs folder.`);
            }
            entry.text = await response.text();
            return replayLogContent(entry.text, entry.fileName);
        });
}

async function handleReplaySelection(fileList, source = "files") {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    const { parsedFiles, report } = await readReplayImport(files, source);
    const importSummary = summarizeReplayImportIssues(report, source);
    setReplayDropnote(importSummary, importSummary ? "warning" : "default");

    const codexSessions = parsedFiles
        .map(({ file, entries }) => buildCodexSessionDescriptor(file, entries))
        .filter(Boolean);

    if (source === "folder" && codexSessions.length) {
        rebuildSessionLibrary(codexSessions);
        renderSessionLibrary();
        const firstSession = primarySessions()[0];
        if (firstSession) replayCodexSession(firstSession.id);
        return;
    }

    rebuildFileLibrary(parsedFiles);
    renderSessionLibrary();
    const firstFile = sessionLibrary.files[0];
    if (firstFile) {
        await replayFileEntry(firstFile.id);
    }
}

function graphHasDetailedTools(graph) {
    return (graph?.nodes || []).some(
        (node) => Array.isArray(node.tool_runs) && node.tool_runs.length > 0,
    );
}

function getNodeToolRuns(node) {
    return (node?.tool_runs || []).slice().sort((a, b) => {
        const aSeq = Number(a?.sequence || 0);
        const bSeq = Number(b?.sequence || 0);
        return bSeq - aSeq;
    });
}

function wrapNodeText(text, maxChars = 34) {
    const words = String(text || "")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let current = words[0];
    for (let index = 1; index < words.length; index += 1) {
        const next = `${current} ${words[index]}`;
        if (next.length <= maxChars) {
            current = next;
        } else {
            lines.push(current);
            current = words[index];
        }
    }
    lines.push(current);
    return lines;
}

function getTerminalNodeDescriptionLines(node) {
    const presentation = getNodePresentation(node);
    return wrapNodeText(presentation.description, 34);
}

function getNodeHeight(node) {
    const presentation = getNodePresentation(node);
    const lines = Math.max(1, wrapNodeText(presentation.description, 34).length);
    if (["complete", "failed"].includes(node?.status)) {
        return Math.max(122, 96 + lines * 16);
    }
    return Math.max(122, 116 + Math.max(0, lines - 1) * 16);
}

function getNodeFullHeight(node) {
    const baseHeight = getNodeHeight(node);
    const runs = getNodeToolRuns(node);
    if (runs.length === 0) return baseHeight;
    let h = baseHeight + 12;
    runs.forEach((run) => {
        const isExpanded = state.expandedToolRuns.has(run.id);
        const hasDesc = getToolDescription(run);
        const runHeight = isExpanded ? 208 : (hasDesc ? 44 : 36);
        h += runHeight + 8;
    });
    return h;
}

function toggleToolRun(runId) {
    if (state.expandedToolRuns.has(runId)) {
        state.expandedToolRuns.delete(runId);
    } else {
        state.expandedToolRuns.add(runId);
    }
    render();
}

function createToolHistoryCard(run) {
    const isExpanded = state.expandedToolRuns.has(run.id);
    const card = document.createElement("article");
    card.className = `tool-history-card ${toolRunStatus(run)}${isExpanded ? " expanded" : ""}`;

    const header = document.createElement("div");
    header.className = "tool-history-card-header";
    header.style.cursor = "pointer";

    const titleWrap = document.createElement("div");
    titleWrap.className = "tool-history-card-title-wrap";

    // const title = document.createElement("strong");
    // title.className = "tool-history-card-title";
    // title.textContent = run.tool_name || "tool";

    const descText = getToolDescription(run);
    if (!descText && hasLLMConfig()) {
        enqueueToolDescription(run);
    }

    const desc = document.createElement("span");
    desc.className = "tool-history-card-desc";
    desc.textContent = descText || toolRunSummary(run) || "No description available";

    titleWrap.append(desc);

    const rightWrap = document.createElement("div");
    rightWrap.className = "tool-history-card-right-wrap";
    rightWrap.style.display = "flex";
    rightWrap.style.alignItems = "center";
    rightWrap.style.gap = "8px";

    const status = document.createElement("span");
    status.className = `tool-history-status ${toolRunStatus(run)}`;
    status.textContent = toolRunStatus(run);

    const caret = document.createElement("span");
    caret.className = "tool-history-caret";
    caret.textContent = isExpanded ? "▼" : "▶";

    rightWrap.append(status, caret);
    header.append(titleWrap, rightWrap);

    const body = document.createElement("div");
    body.className = "tool-history-card-body";
    body.style.display = isExpanded ? "grid" : "none";

    const callMeta = document.createElement("div");
    callMeta.className = "tool-history-meta";
    callMeta.textContent = `Tool: ${run.tool_name || "tool"} | Call: ${run.id || "n/a"}`;

    const inputLabel = document.createElement("span");
    inputLabel.className = "tool-history-label";
    inputLabel.textContent = "Input";
    const input = document.createElement("pre");
    input.className = "tool-history-pre";
    input.textContent = formatToolValue(run.input);

    const outputLabel = document.createElement("span");
    outputLabel.className = "tool-history-label";
    outputLabel.textContent = "Output";
    const output = document.createElement("pre");
    output.className = "tool-history-pre";
    output.textContent = formatToolValue(run.output);

    body.append(callMeta, inputLabel, input, outputLabel, output);
    card.append(header, body);

    header.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleToolRun(run.id);
    });

    return card;
}

function renderToolHistory(container, emptyEl, countEl, node) {
    const runs = getNodeToolRuns(node);
    if (countEl) countEl.textContent = String(runs.length);
    container.replaceChildren();
    if (!runs.length) {
        if (emptyEl) emptyEl.classList.remove("hidden");
        return;
    }
    if (emptyEl) emptyEl.classList.add("hidden");
    runs.forEach((run) => {
        container.appendChild(createToolHistoryCard(run));
    });
}

function closeAgentModal() {
    state.modalNodeId = null;
    state.modalRenderKey = null;
    els.agentModal.classList.add("hidden");
    els.agentModal.setAttribute("aria-hidden", "true");
}

function openConfigModal() {
    state.configModalOpen = true;
    els.configModal.classList.remove("hidden");
    els.configModal.setAttribute("aria-hidden", "false");
    renderLLMConfigUI();
    requestAnimationFrame(() => {
        els.llmBaseUrl?.focus();
        els.llmBaseUrl?.select();
    });
}

function closeConfigModal() {
    state.configModalOpen = false;
    els.configModal.classList.add("hidden");
    els.configModal.setAttribute("aria-hidden", "true");
}

function buildAgentModalRenderKey(node) {
    const presentation = getNodePresentation(node);
    return JSON.stringify({
        id: node?.id,
        label: node?.label,
        role: node?.role,
        status: node?.status,
        toolCount: node?.tool_count,
        lastAction: node?.last_action,
        prompt: node?.spawn_prompt,
        summaryName: presentation.name,
        summaryDescription: presentation.description,
        summaryStatus: presentation.status,
        runs: getNodeToolRuns(node).map((run) => [
            run.id,
            run.status,
            run.sequence,
            summarize(run.input, 80),
            summarize(run.output, 80),
            state.expandedToolRuns.has(run.id),
            getToolDescription(run),
        ]),
    });
}

function openAgentModal(node) {
    if (!node) return;
    const presentation = getNodePresentation(node);
    const nextRenderKey = buildAgentModalRenderKey(node);
    const isAlreadyOpen = !els.agentModal.classList.contains("hidden");
    state.modalNodeId = node.id;
    if (isAlreadyOpen && state.modalRenderKey === nextRenderKey) {
        return;
    }
    state.modalRenderKey = nextRenderKey;
    els.agentModalTitle.textContent = presentation.name || "Agent Details";
    const subtitleParts = [trim(node.id, 44), node.role || "agent"];
    if (node.label && node.label !== presentation.name) {
        subtitleParts.push(trim(node.label, 28));
    }
    els.agentModalSubtitle.textContent = subtitleParts.join(" | ");
    els.agentModalRole.textContent = node.role || "agent";
    els.agentModalStatus.textContent = normalizeStatus(node.status);
    els.agentModalElapsed.textContent = formatElapsed(node.elapsed_seconds);
    els.agentModalTools.textContent = String(node.tool_count || 0);
    els.agentModalAction.textContent = node.last_action || "Waiting";
    setSummaryBadge(els.agentModalSummaryBadge, presentation.status);
    els.agentModalSummaryDescription.textContent = presentation.description;
    els.agentModalPrompt.textContent =
        node.spawn_prompt || "No spawn prompt captured.";
    renderToolHistory(
        els.agentModalToolHistory,
        els.agentModalToolHistoryEmpty,
        els.agentModalToolHistoryCount,
        node,
    );
    els.agentModal.classList.remove("hidden");
    els.agentModal.setAttribute("aria-hidden", "false");
}

function drawNode(node) {
    const presentation = getNodePresentation(node);
    const status = normalizeStatus(node.status);
    const isTerminal = ["complete", "failed"].includes(status);
    const isSelected = node.id === state.selectedId;

    // Create the main card container
    const card = document.createElement("div");
    card.className = `node-card-html ${status}${isSelected ? " selected" : ""}`;
    card.id = `card-${node.id}`;
    card.tabIndex = 0;

    // Click to select and open modal
    card.addEventListener("click", (e) => {
        // If clicking a link or interactive element inside the card, don't open the modal
        if (e.target.closest("a") || e.target.closest(".tool-run-item")) return;

        e.stopPropagation();
        state.selectedId = node.id;
        openAgentModal(node);
        render();
    });

    card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            state.selectedId = node.id;
            openAgentModal(node);
            render();
        }
    });

    // 1. Header
    const header = document.createElement("div");
    header.className = "card-header-html";

    const titleArea = document.createElement("div");
    titleArea.className = "card-title-area";

    const dot = document.createElement("div");
    dot.className = "card-running-dot";
    titleArea.appendChild(dot);

    const title = document.createElement("span");
    title.className = "card-title-text";
    title.textContent = presentation.name;
    titleArea.appendChild(title);

    const badges = document.createElement("div");
    badges.className = "card-badges";

    const roleBadge = document.createElement("span");
    roleBadge.className = "card-badge role";
    roleBadge.textContent = node.role || "agent";
    badges.appendChild(roleBadge);

    const statusBadge = document.createElement("span");
    statusBadge.className = "card-badge status";
    statusBadge.textContent = status;
    badges.appendChild(statusBadge);

    header.appendChild(titleArea);
    header.appendChild(badges);
    card.appendChild(header);

    // 2. Metadata (Model, Elapsed Time, Started At)
    const meta = document.createElement("div");
    meta.className = "card-meta-html";

    if (node.model) {
        const modelItem = document.createElement("div");
        modelItem.className = "card-meta-item";
        modelItem.innerHTML = `<strong>Model:</strong> <span>${node.model}</span>`;
        meta.appendChild(modelItem);
    }

    const elapsedItem = document.createElement("div");
    elapsedItem.className = "card-meta-item";
    elapsedItem.innerHTML = `<strong>Elapsed:</strong> <span>${formatElapsed(node.elapsed_seconds)}</span>`;
    meta.appendChild(elapsedItem);

    if (node.started_at) {
        const startedItem = document.createElement("div");
        startedItem.className = "card-meta-item";
        startedItem.innerHTML = `<strong>Started:</strong> <span>${formatDateTime(node.started_at)}</span>`;
        meta.appendChild(startedItem);
    }
    card.appendChild(meta);

    // 3. Spawning relationships (clickable links)
    const relations = [];
    if (node.parent_id) {
        const parentNode = state.graph.nodes.find(n => n.id === node.parent_id);
        const parentName = parentNode ? getNodePresentation(parentNode).name : humanize(node.parent_id);
        relations.push(`Spawned by parent agent: <a href="#card-${node.parent_id}" data-target-id="${node.parent_id}">${parentName}</a>`);
    }

    const childNodes = (state.graph.nodes || []).filter(n => n.parent_id === node.id);
    if (childNodes.length > 0) {
        const childLinks = childNodes.map(child => {
            const childName = getNodePresentation(child).name;
            return `<a href="#card-${child.id}" data-target-id="${child.id}">${childName}</a>`;
        }).join(", ");
        relations.push(`Spawned sub-agents: ${childLinks}`);
    }

    if (relations.length > 0) {
        const relationsDiv = document.createElement("div");
        relationsDiv.className = "card-relations-html";
        relationsDiv.innerHTML = relations.join("<br>");

        // Handle smooth scrolling on click
        relationsDiv.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const targetId = link.dataset.targetId;
                state.selectedId = targetId;
                render();
                const newTargetEl = document.getElementById(`card-${targetId}`);
                if (newTargetEl) {
                    newTargetEl.scrollIntoView({ behavior: "smooth", block: "center" });
                    newTargetEl.classList.add("highlight-flash");
                    setTimeout(() => newTargetEl.classList.remove("highlight-flash"), 1200);
                }
            });
        });
        card.appendChild(relationsDiv);
    }

    // 4. Spawn Prompt
    if (node.spawn_prompt) {
        const promptDiv = document.createElement("div");
        promptDiv.className = "card-prompt-html";

        const promptLabel = document.createElement("span");
        promptLabel.className = "card-prompt-label";
        promptLabel.textContent = "Spawn Prompt";

        const promptText = document.createElement("pre");
        promptText.className = "card-prompt-text";
        promptText.textContent = node.spawn_prompt;

        promptDiv.appendChild(promptLabel);
        promptDiv.appendChild(promptText);
        card.appendChild(promptDiv);
    }

    // 5. Description / Current Action
    const descriptionDiv = document.createElement("div");
    descriptionDiv.className = "card-description-html";
    descriptionDiv.textContent = presentation.description;
    card.appendChild(descriptionDiv);

    if (!isTerminal && node.last_action && node.last_action !== "Waiting") {
        const actionDiv = document.createElement("div");
        actionDiv.className = "card-action-html";
        actionDiv.textContent = node.last_action;
        card.appendChild(actionDiv);
    }

    // 6. Tool Activity List
    const runs = getNodeToolRuns(node);
    if (runs.length > 0) {
        const toolsContainer = document.createElement("div");
        toolsContainer.className = "card-tools-html";

        const toolsTitle = document.createElement("div");
        toolsTitle.className = "card-tools-title";
        toolsTitle.textContent = `Tool Activity (${runs.length})`;
        toolsContainer.appendChild(toolsTitle);

        runs.forEach((run) => {
            const isExpanded = state.expandedToolRuns.has(run.id);
            const descText = getToolDescription(run);

            const div = document.createElement("div");
            div.className = `tool-run-item ${toolRunStatus(run)}${isExpanded ? " expanded" : ""}`;
            div.dataset.runId = run.id;

            div.addEventListener("wheel", (e) => {
                e.stopPropagation();
            });
            div.addEventListener("pointerdown", (e) => {
                e.stopPropagation();
            });

            const runHeader = document.createElement("div");
            runHeader.className = "tool-run-header";

            const runDot = document.createElement("span");
            runDot.className = "tool-run-dot";

            const titleWrap = document.createElement("div");
            titleWrap.className = "tool-run-title-wrap";

            // const runTitle = document.createElement("span");
            // runTitle.className = "tool-run-title";
            // runTitle.textContent = run.tool_name || "tool";
            // titleWrap.appendChild(runTitle);

            if (descText) {
                const desc = document.createElement("span");
                desc.className = "tool-run-desc";
                desc.textContent = descText;
                div.title = descText;
                titleWrap.appendChild(desc);
            } else {
                enqueueToolDescription(run);
            }

            const caret = document.createElement("span");
            caret.className = "tool-run-caret";
            caret.textContent = isExpanded ? "▼" : "▶";

            runHeader.appendChild(runDot);
            runHeader.appendChild(titleWrap);
            runHeader.appendChild(caret);
            div.appendChild(runHeader);

            runHeader.addEventListener("click", (e) => {
                e.stopPropagation();
                toggleToolRun(run.id);
            });

            if (isExpanded) {
                const body = document.createElement("div");
                body.className = "tool-run-body";

                const infoBar = document.createElement("div");
                infoBar.className = "tool-run-info-bar";
                infoBar.style.fontSize = "9px";
                infoBar.style.fontWeight = "750";
                infoBar.style.color = "#94a3b8";
                infoBar.style.borderBottom = "1px solid #334155";
                infoBar.style.paddingBottom = "6px";
                infoBar.style.marginBottom = "4px";
                infoBar.textContent = `Tool: ${run.tool_name || "tool"} | Call: ${run.id || "n/a"}`;
                body.appendChild(infoBar);

                const inputSection = document.createElement("div");
                inputSection.className = "tool-run-section";
                const inputLabel = document.createElement("div");
                inputLabel.className = "tool-run-section-label";
                inputLabel.textContent = "Input";
                const inputVal = document.createElement("pre");
                inputVal.className = "tool-run-val";
                inputVal.textContent = formatToolValue(run.input);
                inputSection.appendChild(inputLabel);
                inputSection.appendChild(inputVal);

                const outputSection = document.createElement("div");
                outputSection.className = "tool-run-section";
                const outputLabel = document.createElement("div");
                outputLabel.className = "tool-run-section-label";
                outputLabel.textContent = "Output";
                const outputVal = document.createElement("pre");
                outputVal.className = "tool-run-val";
                outputVal.textContent = formatToolValue(run.output);
                outputSection.appendChild(outputLabel);
                outputSection.appendChild(outputVal);

                body.appendChild(inputSection);
                body.appendChild(outputSection);
                div.appendChild(body);
            }

            toolsContainer.appendChild(div);
        });

        card.appendChild(toolsContainer);
    }

    els.svg.appendChild(card);
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

let stageScrollTop = 0;
const savedScrolls = new Map();
function saveScrollPositions() {
    stageScrollTop = els.stage ? els.stage.scrollTop : 0;
    savedScrolls.clear();
    els.svg.querySelectorAll(".tool-run-item").forEach((item) => {
        const runId = item.dataset.runId;
        if (!runId) return;

        const body = item.querySelector(".tool-run-body");
        const vals = item.querySelectorAll(".tool-run-val");

        savedScrolls.set(runId, {
            bodyTop: body ? body.scrollTop : 0,
            valsScrolls: Array.from(vals).map((v) => ({
                top: v.scrollTop,
                left: v.scrollLeft,
            })),
        });
    });
}

function restoreScrollPositions() {
    if (els.stage) {
        els.stage.scrollTop = stageScrollTop;
    }
    els.svg.querySelectorAll(".tool-run-item").forEach((item) => {
        const runId = item.dataset.runId;
        if (!runId) return;

        const scrollData = savedScrolls.get(runId);
        if (!scrollData) return;

        const body = item.querySelector(".tool-run-body");
        if (body && scrollData.bodyTop) {
            body.scrollTop = scrollData.bodyTop;
        }

        const vals = item.querySelectorAll(".tool-run-val");
        vals.forEach((val, idx) => {
            if (scrollData.valsScrolls && scrollData.valsScrolls[idx]) {
                const s = scrollData.valsScrolls[idx];
                if (s.left !== undefined) val.scrollLeft = s.left;
                if (s.top !== undefined) val.scrollTop = s.top;
            }
        });
    });
}

function renderGraph() {
    const nodes = state.graph.nodes || [];
    saveScrollPositions();
    els.svg.replaceChildren();

    els.empty.classList.toggle("hidden", nodes.length > 0);
    if (!nodes.length) {
        return;
    }

    nodes.forEach((node) => {
        drawNode(node);
    });

    restoreScrollPositions();
}

function renderFeed() {
    if (!els.feed || !els.sequence) return;
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
    if (!els.selectedTitle) return;
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
        setSummaryBadge(els.selectedSummaryBadge, "pending");
        els.selectedSummaryDescription.textContent =
            "Configure an LLM to generate a readable task summary for this agent.";
        els.selectedPrompt.textContent = "No spawn prompt captured.";
        renderToolHistory(
            els.selectedToolHistory,
            els.selectedToolHistoryEmpty,
            els.selectedToolHistoryCount,
            null,
        );
        return;
    }

    const presentation = getNodePresentation(selected);
    els.selectedTitle.textContent = presentation.name;
    els.selectedStatus.textContent = normalizeStatus(selected.status);
    els.selectedRole.textContent = selected.role || "agent";
    els.selectedElapsed.textContent = formatElapsed(selected.elapsed_seconds);
    els.selectedTools.textContent = String(selected.tool_count || 0);
    els.selectedAction.textContent = selected.last_action || "Waiting";
    setSummaryBadge(els.selectedSummaryBadge, presentation.status);
    els.selectedSummaryDescription.textContent = presentation.description;
    els.selectedPrompt.textContent =
        selected.spawn_prompt || "No spawn prompt captured.";
    renderToolHistory(
        els.selectedToolHistory,
        els.selectedToolHistoryEmpty,
        els.selectedToolHistoryCount,
        selected,
    );
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
    els.logPath.textContent = details.current_path
        ? details.current_path
        : mode === "replay"
          ? "Viewing uploaded replay log."
          : state.backendAvailable
            ? "Current log path will appear here after the first hook event."
            : "Static host mode. Drop a saved JSONL log to visualize it locally.";
    const canDownloadLiveLog =
        state.backendAvailable &&
        mode === "live" &&
        Boolean(details.current_path);
    if (canDownloadLiveLog) {
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

function renderLLMConfigUI() {
    const configured = hasLLMConfig();
    els.llmConfigButton.textContent = configured
        ? `LLM: ${trim(state.llmConfig.model, 18)}`
        : "Configure LLM";
    els.llmConfigButton.classList.toggle("is-active", configured);
    const editingConfigForm =
        state.configModalOpen && els.configModal.contains(document.activeElement);
    if (!editingConfigForm) {
        els.llmBaseUrl.value = state.llmConfig.baseUrl || "";
        els.llmApiKey.value = state.llmConfig.apiKey || "";
        els.llmModel.value = state.llmConfig.model || "";
    }
    const status = state.llmStatus
        ? state.llmStatus
        : configured
          ? `Saved locally. Model ${state.llmConfig.model} at ${state.llmConfig.baseUrl} with key ${maskSecret(state.llmConfig.apiKey)}.`
          : "No LLM credentials saved yet.";
    els.llmConfigStatus.textContent = status;
    els.llmConfigStatus.classList.toggle(
        "is-error",
        /failed|error|missing/i.test(status),
    );
    els.llmConfigClear.disabled = !configured;
}

function render() {
    renderMetrics();
    syncSelectedNode();
    renderGraph();
    renderFeed();
    renderSelected();
    renderLogDetails();
    renderLLMConfigUI();
    if (state.modalNodeId) {
        const activeNode = (state.graph.nodes || []).find(
            (node) => node.id === state.modalNodeId,
        );
        if (activeNode) {
            openAgentModal(activeNode);
        } else {
            closeAgentModal();
        }
    }
}

async function syncLiveDetailedGraph(graph) {
    const details = graph?.log || {};
    const mode = details.mode || "live";
    if (
        replay.active ||
        !state.backendAvailable ||
        mode !== "live" ||
        !details.current_path ||
        state.liveDetailSyncing ||
        state.liveDetailSequence === graph?.sequence
    ) {
        return;
    }

    state.liveDetailSyncing = true;
    try {
        const response = await fetch("/log/current", { cache: "no-store" });
        if (!response.ok) return;
        const text = await response.text();
        const entries = parseLogEntries(text);
        const events = extractEventsFromEntries(entries);
        if (!events.length) return;
        state.graph = buildGraphFromEvents(events, details);
        state.liveDetailSequence = graph.sequence;
        render();
        queueCompletedAgentSummaries();
    } catch {
        // Keep the backend summary graph if the current log cannot be reloaded.
    } finally {
        state.liveDetailSyncing = false;
    }
}

function loadState() {
    state.backendAvailable = false;
    state.graph = createEmptyGraph({
        mode: "static",
        replay_source: null,
        current_path: null,
        file_name: null,
    });
    state.liveDetailSequence = null;
    setConnection(false);
    render();
    queueCompletedAgentSummaries();
}

async function postCommand(path) {
    if (!state.backendAvailable) {
        if (path === "/reset") {
            replayStop();
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
    replayStop();
    await fetch(path, { method: "POST" });
}

function saveLLMConfigFromForm(event) {
    event.preventDefault();
    const nextConfig = normalizeLLMConfig({
        baseUrl: els.llmBaseUrl.value,
        apiKey: els.llmApiKey.value,
        model: els.llmModel.value,
    });
    if (!nextConfig.baseUrl || !nextConfig.apiKey || !nextConfig.model) {
        state.llmStatus =
            "Base URL, API key, and model are all required before saving.";
        renderLLMConfigUI();
        return;
    }
    state.llmConfig = nextConfig;
    persistLLMConfig(nextConfig);
    Object.keys(state.agentSummaries).forEach((agentId) => {
        if (state.agentSummaries[agentId]?.status === "error") {
            delete state.agentSummaries[agentId];
        }
    });
    persistAgentSummaries();
    state.llmStatus = `Saved locally. Using ${nextConfig.model} at ${nextConfig.baseUrl}.`;
    closeConfigModal();
    render();
    queueCompletedAgentSummaries();
    queueAllPossibleReplaySummaries();
}

function clearSavedLLMConfig() {
    state.llmConfig = normalizeLLMConfig({});
    state.llmStatus = "Saved LLM credentials cleared from local storage.";
    safeLocalStorageRemove(LLM_CONFIG_STORAGE_KEY);
    safeLocalStorageRemove(TOOL_DESCRIPTION_STORAGE_KEY);
    state.toolDescriptions = {};
    state.toolQueue.length = 0;
    Object.keys(state.agentSummaries).forEach((agentId) => {
        if (state.agentSummaries[agentId]?.status === "error") {
            delete state.agentSummaries[agentId];
        }
    });
    persistAgentSummaries();
    state.summaryQueue.length = 0;
    render();
}

/* ═══════════════════════════════════════════════════════════ */
/* Timed Replay Engine                                        */
/* ═══════════════════════════════════════════════════════════ */

const replay = {
    allEvents: [], // all parsed events sorted by timestamp
    currentIndex: 0, // how many events have been "played" so far
    playing: false,
    speed: 1,
    filename: null,
    logDetails: {},
    // timing
    firstTimestamp: 0, // ms of the earliest event
    lastTimestamp: 0, // ms of the latest event
    totalDuration: 0, // ms span
    simTimeMs: 0, // current simulation time offset from first event
    wallAnchor: 0, // performance.now() when we last started/resumed
    simAnchorMs: 0, // simTimeMs at the moment we started/resumed
    rafId: null,
    active: false, // true when a log is loaded for replay
};

function replayFormatTime(date) {
    return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function replayFormatDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    if (totalSec < 60) return `${totalSec}s`;
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    if (minutes < 60) return `${minutes}m ${seconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainMin = minutes % 60;
    return `${hours}h ${remainMin}m`;
}

function replayBuildAndRender() {
    const eventsToPlay = replay.allEvents.slice(0, replay.currentIndex);
    state.graph = buildGraphFromEvents(eventsToPlay, replay.logDetails);
    state.selectedId = state.selectedId || ROOT_AGENT_ID;
    render();
    queueCompletedAgentSummaries();
}

function replayUpdateUI() {
    const total = replay.allEvents.length;
    const idx = replay.currentIndex;

    // Event counter
    els.replayEvtCurrent.textContent = String(idx);
    els.replayEvtTotal.textContent = String(total);

    // Scrubber
    els.replayScrubber.max = String(total);
    els.replayScrubber.value = String(idx);
    const pct = total > 0 ? (idx / total) * 100 : 0;
    els.replayScrubber.style.setProperty("--progress", `${pct}%`);

    // Simulation clock
    const simDate = new Date(replay.firstTimestamp + replay.simTimeMs);
    els.replayClockTime.textContent = replayFormatTime(simDate);

    // Elapsed / total
    const elapsedStr = replayFormatDuration(replay.simTimeMs);
    const totalStr = replayFormatDuration(replay.totalDuration);
    els.replayElapsed.textContent = `${elapsedStr} / ${totalStr}`;

    // Play button icon
    const isPlay = !replay.playing;
    els.replayPlay.classList.toggle("is-playing", replay.playing);
    els.replayPlayIcon.innerHTML = isPlay
        ? '<polygon points="5,3 15,9 5,15"/>'
        : '<rect x="4" y="3" width="3.5" height="12" rx="1"/><rect x="10.5" y="3" width="3.5" height="12" rx="1"/>';
}

function replayAdvanceTo(targetSimMs) {
    replay.simTimeMs = Math.min(targetSimMs, replay.totalDuration);
    // Advance currentIndex to include all events at or before simTimeMs
    while (replay.currentIndex < replay.allEvents.length) {
        const evt = replay.allEvents[replay.currentIndex];
        const evtOffset =
            parseDate(evt.timestamp).getTime() - replay.firstTimestamp;
        if (evtOffset <= replay.simTimeMs) {
            replay.currentIndex++;
        } else {
            break;
        }
    }
}

function replayTick() {
    if (!replay.playing) return;
    const now = performance.now();
    const wallElapsed = now - replay.wallAnchor;
    const simElapsed = wallElapsed * replay.speed;
    const targetSimMs = replay.simAnchorMs + simElapsed;

    const prevIndex = replay.currentIndex;
    replayAdvanceTo(targetSimMs);

    if (replay.currentIndex !== prevIndex) {
        replayBuildAndRender();
    }
    replayUpdateUI();

    if (replay.simTimeMs >= replay.totalDuration) {
        // Reached the end
        replay.playing = false;
        replay.simTimeMs = replay.totalDuration;
        replay.currentIndex = replay.allEvents.length;
        replayBuildAndRender();
        replayUpdateUI();
        return;
    }
    replay.rafId = requestAnimationFrame(replayTick);
}

function replayStart() {
    if (!replay.active || replay.allEvents.length === 0) return;
    // If at end, rewind first
    if (replay.currentIndex >= replay.allEvents.length) {
        replaySeekTo(0);
    }
    replay.playing = true;
    replay.wallAnchor = performance.now();
    replay.simAnchorMs = replay.simTimeMs;
    replay.rafId = requestAnimationFrame(replayTick);
    replayUpdateUI();
}

function replayPause() {
    replay.playing = false;
    if (replay.rafId) {
        cancelAnimationFrame(replay.rafId);
        replay.rafId = null;
    }
    replayUpdateUI();
}

function replayToggle() {
    if (replay.playing) {
        replayPause();
    } else {
        replayStart();
    }
}

function replaySeekTo(index) {
    const wasPlaying = replay.playing;
    replayPause();
    replay.currentIndex = clamp(index, 0, replay.allEvents.length);
    if (replay.currentIndex === 0) {
        replay.simTimeMs = 0;
    } else if (replay.currentIndex >= replay.allEvents.length) {
        replay.simTimeMs = replay.totalDuration;
    } else {
        const evt = replay.allEvents[replay.currentIndex - 1];
        replay.simTimeMs =
            parseDate(evt.timestamp).getTime() - replay.firstTimestamp;
    }
    replayBuildAndRender();
    replayUpdateUI();
    if (wasPlaying) {
        replayStart();
    }
}

function replayRewind() {
    replayPause();
    replaySeekTo(0);
}

function replayStepForward() {
    replayPause();
    if (replay.currentIndex < replay.allEvents.length) {
        replay.currentIndex++;
        if (replay.currentIndex > 0) {
            const evt = replay.allEvents[replay.currentIndex - 1];
            replay.simTimeMs =
                parseDate(evt.timestamp).getTime() - replay.firstTimestamp;
        }
        replayBuildAndRender();
        replayUpdateUI();
    }
}

function replaySetSpeed(speed) {
    const wasPlaying = replay.playing;
    if (wasPlaying) replayPause();
    replay.speed = speed;
    if (wasPlaying) replayStart();
}

function replayStop() {
    replayPause();
    replay.active = false;
    replay.allEvents = [];
    replay.currentIndex = 0;
    replay.simTimeMs = 0;
    replay.totalDuration = 0;
    state.liveDetailSequence = null;
    els.replayPlayer.classList.remove("active");
}

function replayLoadEvents(events, filename, logDetails = {}) {
    replayStop();

    // Sort events by timestamp
    const sorted = events.slice().sort((a, b) => {
        return (
            parseDate(a.timestamp).getTime() - parseDate(b.timestamp).getTime()
        );
    });

    replay.allEvents = sorted;
    replay.filename = filename;
    replay.logDetails = {
        mode: "replay",
        replay_source: filename || "uploaded log",
        current_path: null,
        file_name: filename || null,
        ...logDetails,
    };

    const first = parseDate(sorted[0].timestamp).getTime();
    const last = parseDate(sorted[sorted.length - 1].timestamp).getTime();
    replay.firstTimestamp = first;
    replay.lastTimestamp = last;
    replay.totalDuration = Math.max(0, last - first);
    replay.currentIndex = 0;
    replay.simTimeMs = 0;
    replay.active = true;

    els.replayPlayer.classList.add("active");
    els.replayScrubber.max = String(sorted.length);
    els.replayScrubber.value = "0";
    els.replaySpeed.value = "1";
    replay.speed = 1;

    // Show empty graph initially
    state.graph = createEmptyGraph(replay.logDetails);
    state.selectedId = ROOT_AGENT_ID;
    userHasInteracted = false;
    state.liveDetailSequence = null;
    setConnection(false);
    render();
    replayUpdateUI();
    queueAllPossibleReplaySummaries();
}

// Wire up replay player controls
els.replayPlay.addEventListener("click", replayToggle);
els.replayRewind.addEventListener("click", replayRewind);
els.replayStep.addEventListener("click", replayStepForward);
els.replaySpeed.addEventListener("change", (e) => {
    replaySetSpeed(parseFloat(e.target.value) || 1);
});
els.replayScrubber.addEventListener("input", (e) => {
    const idx = parseInt(e.target.value, 10);
    replaySeekTo(idx);
});
// Keyboard shortcut: Space to toggle play when replay is active
document.addEventListener("keydown", (e) => {
    if (!replay.active) return;
    if (
        e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.tagName === "SELECT"
    )
        return;
    if (e.code === "Space") {
        e.preventDefault();
        replayToggle();
    }
});

async function replayLogContent(content, filename) {
    const entries = parseLogEntries(content);
    const events = extractEventsFromEntries(entries);
    if (!events.length) {
        throw new Error("No workflow events were found in the supplied log.");
    }

    if (state.backendAvailable) {
        const response = await fetch("/replay-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, filename }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.detail || "Replay failed.");
        }
    }

    replayLoadEvents(events, filename);
}

els.demoButton?.addEventListener("click", () => postCommand("/demo"));
els.resetButton?.addEventListener("click", () => postCommand("/reset"));
els.llmConfigButton?.addEventListener("click", openConfigModal);
els.configModalClose?.addEventListener("click", closeConfigModal);
els.configModalBackdrop?.addEventListener("click", closeConfigModal);
els.configModal?.addEventListener("click", (event) => {
    if (event.target === els.configModal) {
        closeConfigModal();
    }
});
els.llmConfigForm?.addEventListener("submit", saveLLMConfigFromForm);
els.llmConfigClear?.addEventListener("click", clearSavedLLMConfig);
els.pickLogFiles?.addEventListener("click", () => els.replayFile.click());
els.pickLogFolder?.addEventListener("click", () => els.replayFolder.click());

// Populate the replay drop-note with the OS-appropriate sessions path.
{
    const ua = navigator.userAgent || "";
    let sessionsPath;
    if (/windows/i.test(ua)) {
        sessionsPath = "`%USERPROFILE%\\.codex\\sessions`";
    } else if (/macintosh|mac os|iphone|ipad|ipod/i.test(ua)) {
        sessionsPath = "`~/.codex/sessions`";
    } else {
        // Linux and other Unix-like systems
        sessionsPath = "`~/.codex/sessions`";
    }
    replayDropnoteBaseText =
        `Load files from ${sessionsPath}. ` +
        "Primary sessions are listed here; matching sub-agent " +
        "logs stay hidden and are merged into the replay automatically.";
    setReplayDropnote();
}

async function handleSelectedFiles(fileList) {
    try {
        await handleReplaySelection(fileList, "files");
    } catch (error) {
        window.alert(error instanceof Error ? error.message : "Replay failed.");
    }
}

els.replayFile.addEventListener("change", async (event) => {
    try {
        await handleSelectedFiles(event.target.files || []);
    } finally {
        event.target.value = "";
    }
});
els.replayFolder.addEventListener("change", async (event) => {
    try {
        await handleReplaySelection(event.target.files || [], "folder");
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
    await handleSelectedFiles(Array.from(event.dataTransfer?.files || []));
});
els.agentModalClose.addEventListener("click", closeAgentModal);
els.agentModalBackdrop.addEventListener("click", closeAgentModal);
els.agentModal.addEventListener("click", (event) => {
    if (event.target === els.agentModal) {
        closeAgentModal();
    }
});
els.svg.addEventListener("click", (e) => {
    if (!e.target.closest(".node")) {
        state.selectedId = null;
        render();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.configModal.classList.contains("hidden")) {
        closeConfigModal();
        return;
    }
    if (event.key === "Escape" && !els.agentModal.classList.contains("hidden")) {
        closeAgentModal();
    }
});

setInterval(() => {
    const hasActiveAgents = !replay.active && state.graph.active_count > 0;
    if (hasActiveAgents) {
        render();
    }
}, 1000);

// Resizing Logic for Panes
function setupResizers() {
    const workspace = document.querySelector(".workspace");
    const workspaceResizer = document.getElementById("workspace-resizer");
    const inspector = document.querySelector(".inspector");
    const toggleButton = document.querySelector("#sidebar-toggle-button");

    if (!workspace || !workspaceResizer || !inspector) return;

    // Load initial width of workspace columns
    const savedWidth = localStorage.getItem("awv-inspector-width");
    if (savedWidth) {
        workspace.style.gridTemplateColumns = `1fr 14px ${savedWidth}px`;
    }

    // Sidebar collapse state helper
    function setSidebarCollapsed(collapsed) {
        const arrow = document.getElementById("sidebar-toggle-arrow");
        const replayPanel = document.querySelector(".replay-panel");
        const replayPlayer = document.getElementById("replay-player");
        if (collapsed) {
            workspace.classList.add("sidebar-collapsed");
            if (replayPlayer) {
                workspace.appendChild(replayPlayer);
            }
            if (toggleButton) {
                toggleButton.classList.add("is-active");
                toggleButton.setAttribute("title", "Show Sidebar");
            }
            if (arrow) {
                arrow.setAttribute("d", "M13 9l-3 3 3 3");
            }
            localStorage.setItem("awv-sidebar-collapsed", "true");
        } else {
            workspace.classList.remove("sidebar-collapsed");
            if (replayPanel && replayPlayer) {
                replayPanel.appendChild(replayPlayer);
            }
            if (toggleButton) {
                toggleButton.classList.remove("is-active");
                toggleButton.setAttribute("title", "Hide Sidebar");
            }
            if (arrow) {
                arrow.setAttribute("d", "M10 9l3 3-3 3");
            }
            localStorage.setItem("awv-sidebar-collapsed", "false");
        }
        // Fit graph to view if user hasn't panned or zoomed manually
        if (
            typeof userHasInteracted !== "undefined" &&
            !userHasInteracted &&
            typeof fitToView === "function"
        ) {
            fitToView(false);
        }
    }

    // Toggle sidebar on button click
    if (toggleButton) {
        toggleButton.addEventListener("click", () => {
            const isCollapsed = workspace.classList.contains("sidebar-collapsed");
            setSidebarCollapsed(!isCollapsed);
        });
    }

    // Load initial sidebar collapsed state
    const savedSidebarCollapsed = localStorage.getItem("awv-sidebar-collapsed") === "true";
    setSidebarCollapsed(savedSidebarCollapsed);

    function getClientX(e) {
        return e.touches ? e.touches[0].clientX : e.clientX;
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

    // Window Resize Handler: Trigger fitToView(false) when window resizes and user hasn't panned/zoomed
    window.addEventListener("resize", () => {
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

/* ═══════════════════════════════════════════════════════════ */
/* Session Library                                             */
/* ═══════════════════════════════════════════════════════════ */

els.sessionLibraryList.addEventListener("click", (e) => {
    const card = e.target.closest("[data-session-id], [data-file-id]");
    if (!card) return;
    if (card.dataset.sessionId) {
        replayCodexSession(card.dataset.sessionId);
        return;
    }
    if (card.dataset.fileId) {
        void replayFileEntry(card.dataset.fileId);
    }
});

els.sessionLibraryList.addEventListener("keydown", (e) => {
    if (e.code !== "Enter" && e.code !== "Space") return;
    const card = e.target.closest("[data-session-id], [data-file-id]");
    if (!card) return;
    e.preventDefault();
    if (card.dataset.sessionId) {
        replayCodexSession(card.dataset.sessionId);
        return;
    }
    if (card.dataset.fileId) {
        void replayFileEntry(card.dataset.fileId);
    }
});

els.sessionLibraryToggle.addEventListener("click", () => {
    const section = els.sessionLibrarySection;
    const isCollapsed = section.classList.toggle("collapsed");
    els.sessionLibraryToggle.setAttribute("aria-expanded", String(!isCollapsed));
});

renderSessionLibrary();
void loadIndexedLogs();

loadState();
