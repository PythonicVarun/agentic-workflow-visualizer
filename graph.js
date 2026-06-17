const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_EVENT_HISTORY = 80;
const ROOT_AGENT_ID = "primary_agent";
const LLM_CONFIG_STORAGE_KEY = "awv-llm-config";
const AGENT_SUMMARY_STORAGE_KEY = "awv-agent-summaries";
const TOOL_DESCRIPTION_STORAGE_KEY = "awv-tool-descriptions";

async function loadModelPricing() {
    try {
        const response = await fetch("./model_pricing.json");
        if (!response.ok) {
            throw new Error(
                `Failed to load model pricing: ${response.status} ${response.statusText}`,
            );
        }
        return await response.json();
    } catch (error) {
        console.error(
            "Error loading model pricing, using empty fallback:",
            error,
        );
        return {};
    }
}

const MODEL_PRICING = await loadModelPricing();

function getModelPricing(modelName) {
    if (!modelName) return [0, 0];
    let normalized = modelName.toLowerCase().trim();
    normalized = normalized.replace(
        /^(openai|anthropic|google|deepseek|meta|cohere|mistral)\//,
        "",
    );
    if (MODEL_PRICING[normalized]) {
        return MODEL_PRICING[normalized];
    }
    for (const key of Object.keys(MODEL_PRICING)) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return MODEL_PRICING[key];
        }
    }
    return [0, 0];
}

function priceTokens(inputTokens, outputTokens, modelName) {
    const [inputRate, outputRate] = getModelPricing(modelName);
    if (inputRate === 0 && outputRate === 0) return null;
    return (
        (Number(inputTokens || 0) / 1000000) * inputRate +
        (Number(outputTokens || 0) / 1000000) * outputRate
    );
}

function normalizeProjectPath(cwd) {
    const value = String(cwd || "")
        .trim()
        .replace(/\\/g, "/");
    if (!value) return "Unknown project";
    return value.replace(/\/+$/, "") || "/";
}

function escapeHtml(value) {
    return String(value ?? "").replace(
        /[&<>"']/g,
        (character) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[character],
    );
}

function getSessionUsage(entries) {
    let usage = null;
    entries.forEach((entry) => {
        const tokenUsage =
            entry?.type === "event_msg" && entry.payload?.type === "token_count"
                ? entry.payload.info?.total_token_usage
                : null;
        if (!tokenUsage) return;
        usage = {
            inputTokens: Number(tokenUsage.input_tokens || 0),
            outputTokens: Number(tokenUsage.output_tokens || 0),
            totalTokens: Number(tokenUsage.total_tokens || 0),
        };
    });
    return usage;
}

function buildAnalyticsRecord(session) {
    const usage = getSessionUsage(session.entries || []);
    const model =
        session.meta?.model ||
        extractModelFromEntries(session.entries) ||
        "Unknown";
    const cost = usage
        ? priceTokens(usage.inputTokens, usage.outputTokens, model)
        : null;
    return {
        id: session.id,
        projectPath: normalizeProjectPath(session.cwd),
        title: session.title || session.fileName || session.id,
        model,
        startedAt: session.startedAt,
        endedAt: session.updatedAt || session.startedAt,
        inputTokens: usage?.inputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
        totalTokens: usage?.totalTokens || 0,
        cost,
        costProvenance: usage ? "actual" : "estimated",
        source: session.filePath || session.fileName || "uploaded log",
    };
}

function buildProjectAnalytics(sessions) {
    const projects = new Map();
    sessions.map(buildAnalyticsRecord).forEach((record) => {
        const project = projects.get(record.projectPath) || {
            path: record.projectPath,
            sessions: [],
            actualCost: 0,
            estimatedSessions: 0,
            unpricedActualSessions: 0,
            inputTokens: 0,
            outputTokens: 0,
            start: record.startedAt,
            end: record.endedAt,
        };
        project.sessions.push(record);
        project.start =
            parseDate(record.startedAt) < parseDate(project.start)
                ? record.startedAt
                : project.start;
        project.end =
            parseDate(record.endedAt) > parseDate(project.end)
                ? record.endedAt
                : project.end;
        if (record.costProvenance === "actual") {
            if (record.cost === null) {
                project.unpricedActualSessions += 1;
            } else {
                project.actualCost += record.cost;
            }
            project.inputTokens += record.inputTokens;
            project.outputTokens += record.outputTokens;
        } else {
            project.estimatedSessions += 1;
        }
        projects.set(record.projectPath, project);
    });
    return Array.from(projects.values()).sort((a, b) =>
        a.path.localeCompare(b.path),
    );
}

function runProjectAnalyticsChecks() {
    const actualSession = {
        id: "actual",
        cwd: "/work/demo/",
        title: "Actual session",
        meta: { model: "gpt-5" },
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
        entries: [
            {
                type: "event_msg",
                payload: {
                    type: "token_count",
                    info: {
                        total_token_usage: {
                            input_tokens: 1000000,
                            output_tokens: 1000000,
                            total_tokens: 2000000,
                        },
                    },
                },
            },
        ],
    };
    const estimatedSession = {
        ...actualSession,
        id: "estimated",
        cwd: "/work/demo",
        entries: [],
    };
    const [project] = buildProjectAnalytics([actualSession, estimatedSession]);
    console.assert(
        project.path === "/work/demo" &&
            project.sessions.length === 2 &&
            project.estimatedSessions === 1,
        "Project analytics grouping check failed.",
    );
    if (getModelPricing("gpt-5")[0] !== 0) {
        console.assert(
            priceTokens(1000000, 1000000, "gpt-5") === 11.25,
            "Project analytics scenario pricing check failed.",
        );
    }
}

const state = {
    activeTab: "summary",
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
    collapsedSubagents: new Set(),
    toolDescriptions: loadToolDescriptions(),
    toolQueue: [],
    toolProcessing: false,
    toolInflight: new Set(),
    analyticsProjectFilter: "",
    analyticsScenarioModels: [],
    analyticsCompareMenuOpen: false,
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
    importedParsedFiles: [],
    appendFolderUpload: false,
    initialSessionId: null,
    searchQuery: "",
    analyticsRecords: [],
};

const els = {
    svg: document.querySelector("#linear-flow"),
    sessionSummary: document.querySelector("#session-summary"),
    projectDashboard: document.querySelector("#project-dashboard"),
    viewGraphBtn: document.querySelector("#view-graph-btn"),
    viewSummaryBtn: document.querySelector("#view-summary-btn"),
    viewAnalyticsBtn: document.querySelector("#view-analytics-btn"),
    themeToggle: document.querySelector("#theme-toggle"),
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
    sessionSearchContainer: document.querySelector("#session-search-container"),
    sessionSearchInput: document.querySelector("#session-search-input"),
    sessionSearchClear: document.querySelector("#session-search-clear"),
    subagentPromptBanner: document.querySelector("#subagent-prompt-banner"),
    subagentPromptText: document.querySelector("#subagent-prompt-text"),
    subagentUploadFiles: document.querySelector("#subagent-upload-files"),
    subagentUploadFolder: document.querySelector("#subagent-upload-folder"),
    subagentPromptDismiss: document.querySelector("#subagent-prompt-dismiss"),
    subagentFileInput: document.querySelector("#subagent-file-input"),
    subagentWarningModal: document.querySelector("#subagent-warning-modal"),
    subagentWarningModalClose: document.querySelector(
        "#subagent-warning-modal-close",
    ),
    subagentWarningModalBackdrop: document.querySelector(
        "#subagent-warning-modal-backdrop",
    ),
    subagentWarningModalText: document.querySelector(
        "#subagent-warning-modal-text",
    ),
    subagentWarningModalUpload: document.querySelector(
        "#subagent-warning-modal-upload",
    ),
    subagentWarningModalFolder: document.querySelector(
        "#subagent-warning-modal-folder",
    ),
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
    agentModalSummaryBadge: document.querySelector(
        "#agent-modal-summary-badge",
    ),
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
const zoomPan = {
    vx: 0,
    vy: 0,
    vw: 960,
    vh: 520,
    contentW: 960,
    contentH: 520,
};

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
    if (
        meta.source &&
        typeof meta.source === "object" &&
        meta.source.subagent
    ) {
        return "subagent";
    }
    if (meta.source === "exec") return "subagent";
    return "user";
}

function stripCodexSystemBlocks(text) {
    return String(text || "")
        .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, " ")
        .replace(
            /<subagent_notification>[\s\S]*?<\/subagent_notification>/gi,
            " ",
        )
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

function extractSessionIdFromEvents(events) {
    if (!Array.isArray(events)) return null;
    for (const evt of events) {
        if (!evt) continue;
        const sid =
            evt.data?.session_id ||
            evt.session_id ||
            evt.data?.payload?.session_id ||
            evt.payload?.session_id;
        if (sid) return String(sid);
    }
    return null;
}

function getPrimaryAgentStorageKey() {
    const activeSessionId =
        sessionLibrary.selectedSessionId ||
        replay.logDetails?.session_id ||
        state.graph?.log?.session_id ||
        null;
    return activeSessionId || ROOT_AGENT_ID;
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
        safeLocalStorageSet(AGENT_SUMMARY_STORAGE_KEY, JSON.stringify(cleaned));
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
    const cleaned = String(value || "")
        .replace(/^["']|["']$/g, "")
        .trim();
    const compact = cleaned.replace(/\s+/g, " ");
    const words = compact.split(" ").filter(Boolean).slice(0, 3);
    const text = trim(words.join(" "), 42);
    return text || trim(fallback, 42);
}

function sanitizeSummaryDescription(value, fallback) {
    const text = String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    const fallbackText = String(fallback || "")
        .replace(/\s+/g, " ")
        .trim();
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
    return sanitizeSummaryDescription(
        fallback,
        "No task summary available yet.",
    );
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
        .map((run) =>
            [
                run.tool_name || "tool",
                normalizeToolValue(run.input),
                normalizeToolValue(run.output),
            ].join("|"),
        )
        .join("||");

    const historySource = (node.history || []).map((h) => ({
        event_type: h.event_type,
        timestamp: h.timestamp,
        data: h.data,
    }));

    const signatureSource = JSON.stringify({
        id: node.id,
        label: node.label,
        role: node.role,
        status: node.status,
        prompt: node.spawn_prompt,
        model: node.model,
        tools,
        history: historySource,
        toolCount: node.tool_count,
        eventCount: node.event_count,
    });
    return hashString(signatureSource);
}

function getNodeSummaryEntry(node) {
    if (!node?.id) return null;
    const key =
        node.id === ROOT_AGENT_ID ? getPrimaryAgentStorageKey() : node.id;
    const summary = state.agentSummaries[key];
    if (!summary) return null;
    if (replay.active) {
        return summary;
    }

    return summary.signature === buildNodeSummarySignature(node)
        ? summary
        : null;
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
    const key =
        node.id === ROOT_AGENT_ID ? getPrimaryAgentStorageKey() : node.id;
    const existing = state.agentSummaries[key];
    if (existing?.signature === signature && existing.status === "ready")
        return;
    if (existing?.signature === signature && existing.status === "error")
        return;
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
    const existingNames = [node?.label, node?.nickname, humanize(node?.id)]
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

async function requestNodeSummariesBatch(nodes, retryMode = false) {
    if (!hasLLMConfig()) throw new Error("No LLM config");
    const { baseUrl, apiKey, model } = state.llmConfig;
    const url = `${baseUrl}/chat/completions`;

    const nodeMap = new Map();
    const payloadItems = nodes.map((node) => {
        const randomId = "req_" + Math.random().toString(36).substring(2, 11);
        nodeMap.set(randomId, node);
        return {
            id: randomId,
            context: buildSummaryRequestContext(node),
        };
    });

    const systemPrompt = `You label software agents by the task they actually performed.
Given a JSON list of agent context objects, each with a unique "id", return a label ("name") and "description" for each.
${
    retryMode
        ? "Your previous answer for some agents reused the existing agent label, which is incorrect. Make sure the name does NOT repeat, paraphrase, or closely resemble the existing UI label, nickname, or agent id."
        : ""
}
The name must describe the completed task, must not repeat, paraphrase, or closely resemble the existing UI label, nickname, or agent id, and must be short: 1 to 3 words only.
The description should be one short sentence describing what the agent did.

Return your response as a single JSON object where the keys are the "id"s of the requests, and the values are JSON objects with exactly two keys: "name" and "description". Do not wrap the object in markdown. Do not add commentary.

Example input:
[
  {
    "id": "req_xyz987",
    "context": "Agent id: subagent_1\nRole: researcher\nStatus: complete\nSpawn prompt: Find all python files\nObserved tools:\n1. list_dir | input: {}"
  }
]

Example response:
{
  "req_xyz987": {
    "name": "Locate Python Files",
    "description": "Searched the workspace directory to find all Python source files."
  }
}
`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: JSON.stringify(payloadItems, null, 2),
                },
            ],
        }),
    });

    if (!response.ok) {
        const detail = trim(await response.text(), 180);
        throw new Error(
            detail || `LLM request failed with ${response.status}.`,
        );
    }

    const payload = await response.json();
    const choice = payload?.choices?.[0];
    const content = String(choice?.message?.content || "").trim();
    const objectMatch = content.match(/\{[\s\S]*\}/);
    const parsed = objectMatch ? safeJsonParse(objectMatch[0]) : null;
    if (!parsed) {
        throw new Error("LLM response did not contain valid JSON.");
    }

    const results = {};
    for (const [randomId, node] of nodeMap.entries()) {
        const itemResult = parsed[randomId];
        if (
            itemResult &&
            typeof itemResult === "object" &&
            itemResult.name &&
            itemResult.description
        ) {
            results[node.id] = {
                name: sanitizeSummaryName(
                    itemResult.name,
                    fallbackNodeName(node),
                ),
                description: sanitizeSummaryDescription(
                    itemResult.description,
                    fallbackNodeDescription(node),
                ),
            };
        } else {
            results[node.id] = null;
        }
    }
    return results;
}

async function processSummaryQueue() {
    if (state.summaryProcessing || !hasLLMConfig()) return;
    if (state.summaryQueue.length === 0) return;

    state.summaryProcessing = true;

    const batchSize = 5;
    const batchJobs = [];
    const batchNodes = [];

    while (state.summaryQueue.length > 0 && batchJobs.length < batchSize) {
        const nextJob = state.summaryQueue.shift();
        if (!nextJob) continue;

        let node;
        if (replay.active && replay.allEvents.length > 0) {
            const fullGraph = buildGraphFromEvents(
                replay.allEvents,
                replay.logDetails,
            );
            node = (fullGraph.nodes || []).find(
                (item) => item.id === nextJob.nodeId,
            );
        } else {
            node = (state.graph.nodes || []).find(
                (item) => item.id === nextJob.nodeId,
            );
        }

        if (!node) continue;

        const currentSignature = buildNodeSummarySignature(node);
        if (currentSignature !== nextJob.signature) {
            enqueueNodeSummary(node);
            continue;
        }

        batchJobs.push(nextJob);
        batchNodes.push(node);
        state.summaryInflight.add(node.id);
    }

    if (batchJobs.length === 0) {
        state.summaryProcessing = false;
        return;
    }

    render();

    try {
        const firstResults = await requestNodeSummariesBatch(batchNodes, false);
        const nodesToRetry = [];
        const finalResults = {};

        for (const node of batchNodes) {
            const res = firstResults[node.id];
            if (res && !mirrorsExistingAgentLabel(node, res.name)) {
                finalResults[node.id] = res;
            } else {
                nodesToRetry.push(node);
            }
        }

        if (nodesToRetry.length > 0) {
            try {
                const secondResults = await requestNodeSummariesBatch(
                    nodesToRetry,
                    true,
                );
                for (const node of nodesToRetry) {
                    const res = secondResults[node.id];
                    if (res && !mirrorsExistingAgentLabel(node, res.name)) {
                        finalResults[node.id] = res;
                    } else {
                        finalResults[node.id] = {
                            error: "LLM summary name mirrored the existing agent label instead of the completed task.",
                        };
                    }
                }
            } catch (retryError) {
                console.error("Retry batch failed:", retryError);
                for (const node of nodesToRetry) {
                    finalResults[node.id] = {
                        error:
                            retryError instanceof Error
                                ? retryError.message
                                : "Summary generation failed during retry.",
                    };
                }
            }
        }

        for (const job of batchJobs) {
            const res = finalResults[job.nodeId];
            const key =
                job.nodeId === ROOT_AGENT_ID
                    ? getPrimaryAgentStorageKey()
                    : job.nodeId;
            if (res && !res.error) {
                state.agentSummaries[key] = {
                    signature: job.signature,
                    status: "ready",
                    name: res.name,
                    description: res.description,
                    updated_at: isoNow(),
                };
            } else {
                state.agentSummaries[key] = {
                    signature: job.signature,
                    status: "error",
                    error: res?.error || "Summary generation failed.",
                    updated_at: isoNow(),
                };
            }
        }
        persistAgentSummaries();
    } catch (error) {
        console.error("Batch summary generation failed:", error);
        for (const job of batchJobs) {
            const key =
                job.nodeId === ROOT_AGENT_ID
                    ? getPrimaryAgentStorageKey()
                    : job.nodeId;
            state.agentSummaries[key] = {
                signature: job.signature,
                status: "error",
                error: trim(
                    error instanceof Error
                        ? error.message
                        : "Summary generation failed.",
                    150,
                ),
                updated_at: isoNow(),
            };
        }
        persistAgentSummaries();
    } finally {
        for (const job of batchJobs) {
            state.summaryInflight.delete(job.nodeId);
        }
        state.summaryProcessing = false;
        render();
        if (state.summaryQueue.length) {
            void processSummaryQueue();
        }
    }
}

async function requestToolDescriptionsBatch(batch) {
    if (!hasLLMConfig()) throw new Error("No LLM config");
    const url = `${state.llmConfig.baseUrl}/chat/completions`;

    const runMap = new Map();
    const payloadItems = batch.map((run) => {
        const randomId = "req_" + Math.random().toString(36).substring(2, 11);
        runMap.set(randomId, run);
        const truncatedInput = trim(formatToolValue(run.input), 1000);
        return {
            id: randomId,
            tool_name: run.tool_name,
            tool_input: truncatedInput,
        };
    });

    const systemPrompt = `You are a helpful coding assistant. Given a JSON list of tool runs, each with a unique "id", generate a very short, single-sentence summary of the action being performed (maximum 10 words) for each.
Return your response as a single JSON object where the keys are the "id"s of the requests, and the values are JSON objects with a single key "description". Do not output markdown, wrap it in a raw JSON string.

Example input:
[
  {"id": "req_a1b2c3", "tool_name": "list_dir", "tool_input": "{\\"DirectoryPath\\": \\"/workspace/project\\"}"}
]

Example response:
{
  "req_a1b2c3": {"description": "Listing files in project"}
}
`;

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
                {
                    role: "user",
                    content: JSON.stringify(payloadItems, null, 2),
                },
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
    if (!parsed) {
        throw new Error("Invalid JSON response from LLM");
    }

    const results = {};
    for (const [randomId, run] of runMap.entries()) {
        const itemResult = parsed[randomId];
        if (
            itemResult &&
            typeof itemResult === "object" &&
            itemResult.description
        ) {
            results[run.id] = itemResult.description;
        } else {
            results[run.id] = null;
        }
    }
    return results;
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
    if (state.toolQueue.length === 0) return;

    state.toolProcessing = true;

    const batchSize = 20;
    const batch = [];
    while (state.toolQueue.length > 0 && batch.length < batchSize) {
        const run = state.toolQueue.shift();
        if (run && run.id) {
            batch.push(run);
            state.toolInflight.add(run.id);
        }
    }

    if (batch.length === 0) {
        state.toolProcessing = false;
        return;
    }

    render();

    try {
        const results = await requestToolDescriptionsBatch(batch);
        for (const run of batch) {
            const desc = results[run.id];
            if (desc) {
                state.toolDescriptions[run.id] = {
                    status: "ready",
                    description: desc,
                };
            } else {
                state.toolDescriptions[run.id] = {
                    status: "error",
                    description: "Failed to generate tool description.",
                };
            }
        }
        persistToolDescriptions();
    } catch (error) {
        console.error("Batch tool description generation failed:", error);
        for (const run of batch) {
            state.toolDescriptions[run.id] = {
                status: "error",
                description: "Failed to generate tool description.",
            };
        }
        persistToolDescriptions();
    } finally {
        for (const run of batch) {
            state.toolInflight.delete(run.id);
        }
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
    const toolName = run.tool_name || "tool";
    const inputSummary = summarize(run.input, 90);
    return inputSummary ? `${toolName} | ${inputSummary}` : toolName;
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
    const model = node.model || "gpt-4o-mini";
    const pricing = getModelPricing(model);
    let input_tokens = node.input_tokens || 0;
    let output_tokens = node.output_tokens || 0;

    // Simulate token count fallback for demo logs / offline captures lacking token_count events
    if (input_tokens === 0 && output_tokens === 0) {
        let hash = 0;
        const idStr = String(node.id || "agent");
        for (let i = 0; i < idStr.length; i++) {
            hash = (hash << 5) - hash + idStr.charCodeAt(i);
            hash |= 0;
        }
        const absHash = Math.abs(hash);
        const multiplier = Math.max(1, node.tool_count || 0);
        input_tokens = (1500 + (absHash % 1000)) * multiplier;
        output_tokens = (150 + (absHash % 150)) * multiplier;
    }

    const cost =
        (input_tokens / 1000000) * pricing[0] +
        (output_tokens / 1000000) * pricing[1];

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
        spawn_sequence: node.spawn_sequence || null,
        input_tokens,
        output_tokens,
        total_tokens: node.total_tokens || input_tokens + output_tokens,
        cost,
        tool_runs: (node.tool_runs || []).map((run) => ({
            ...run,
            input: normalizeToolValue(run.input),
            output: normalizeToolValue(run.output),
        })),
        history: (node.history || []).map((h) => ({
            event_type: h.event_type,
            timestamp: h.timestamp,
            data: h.data,
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
    let sessionCwd = null;
    let sessionId = null;

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
                history: [],
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: 0,
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

        if (!node.history) {
            node.history = [];
        }
        node.history.push({
            event_type: event.event_type,
            timestamp: event.timestamp,
            data: event.data,
        });

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

        if (event.event_type === "session_start") {
            sessionCwd =
                data.cwd || (rawEvent.payload && rawEvent.payload.cwd) || null;
            sessionId =
                data.session_id ||
                (rawEvent.payload && rawEvent.payload.session_id) ||
                null;
        }

        switch (event.event_type) {
            case "token_count": {
                const node = touch(event, {
                    status: "running",
                    action: "Tokens updated",
                });
                node.input_tokens = data.input_tokens || 0;
                node.output_tokens = data.output_tokens || 0;
                node.total_tokens = data.total_tokens || 0;
                break;
            }
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
                    label:
                        data.label || (isPrimaryAgent ? "Primary Agent" : null),
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
                const run = createToolRun(
                    toolName,
                    event,
                    data,
                    sequence,
                    args,
                );
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
                    existingRun.completed_at = parseDate(
                        event.timestamp,
                    ).toISOString();
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
                    child.spawn_sequence = sequence;
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
                if (!node.spawn_sequence) {
                    node.spawn_sequence = sequence;
                }
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
        cwd: sessionCwd,
        session_id: sessionId,
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
    els.replayDropnote.innerHTML = detail
        ? `${detail} ${replayDropnoteBaseText}`.trim()
        : replayDropnoteBaseText;
    els.replayDropnote.classList.toggle("is-warning", tone === "warning");
}

function combineReplayNotes(...parts) {
    return parts
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join(" ");
}

function formatManualReplaySelectionNote(label, count) {
    const noun = count === 1 ? label : `${label}s`;
    return `Imported ${count} ${noun}. Select one from the sidebar to load it.`;
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
        throw new Error(
            "Select one or more .jsonl, .ndjson, or .json log files.",
        );
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
    if (!Array.isArray(entries) || entries.length === 0) return [];

    // 1. Check if they are standard visualizer hook events (either direct or nested)
    const events = [];
    for (const entry of entries) {
        if (!entry) continue;
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
    if (events.length > 0) {
        return events;
    }

    // 2. Check if they are Codex session entries (e.g. they have type: "event_msg", "response_item", etc.)
    const hasCodexEntries = entries.some(
        (entry) =>
            entry &&
            (entry.type === "event_msg" ||
                entry.type === "response_item" ||
                entry.type === "session_meta"),
    );
    if (hasCodexEntries) {
        const meta = getCodexSessionMeta(entries) || {
            id: "temp_session_" + Math.random().toString(36).substring(2, 11),
            timestamp: entries[0]?.timestamp || isoNow(),
        };
        const session = {
            id: meta.id,
            parentSessionId: meta.forked_from_id || null,
            nickname: meta.agent_nickname || null,
            role: meta.agent_role || "primary",
            startedAt: meta.timestamp || entries[0]?.timestamp || isoNow(),
            entries,
            meta,
        };
        const spawnHints = new Map();
        if (meta.source?.subagent?.thread_spawn) {
            const spawnInfo = meta.source.subagent.thread_spawn;
            spawnHints.set(meta.id, {
                nickname: spawnInfo.agent_nickname,
                prompt: spawnInfo.message,
            });
        }
        return translateCodexSession(session, session.id, spawnHints);
    }

    // 3. Check if they are standard agent transcript entries (e.g. step_index, type: "USER_INPUT"/"PLANNER_RESPONSE")
    const hasTranscriptEntries = entries.some(
        (entry) =>
            entry &&
            (entry.step_index !== undefined ||
                entry.source !== undefined ||
                (entry.type &&
                    [
                        "USER_INPUT",
                        "PLANNER_RESPONSE",
                        "SYSTEM",
                        "TOOL_RESPONSE",
                        "TOOL_OUTPUT",
                    ].includes(entry.type))),
    );
    if (hasTranscriptEntries) {
        const trEvents = [];
        const baseTime = entries[0]?.timestamp
            ? new Date(entries[0].timestamp).getTime()
            : Date.now();

        trEvents.push({
            event_type: "session_start",
            agent_id: ROOT_AGENT_ID,
            timestamp: new Date(baseTime).toISOString(),
            data: {
                source: "transcript",
                label: "Primary Agent",
                role: "primary",
            },
        });

        entries.forEach((entry, idx) => {
            if (!entry) return;
            const timestamp = entry.timestamp
                ? new Date(entry.timestamp).toISOString()
                : new Date(baseTime + idx * 1000).toISOString();

            if (entry.type === "USER_INPUT") {
                trEvents.push({
                    event_type: "user_input",
                    agent_id: ROOT_AGENT_ID,
                    timestamp,
                    data: {
                        prompt: entry.content || "User message",
                        label: "Primary Agent",
                        role: "primary",
                    },
                });
            } else if (entry.type === "PLANNER_RESPONSE") {
                if (
                    Array.isArray(entry.tool_calls) &&
                    entry.tool_calls.length > 0
                ) {
                    entry.tool_calls.forEach((call) => {
                        trEvents.push({
                            event_type: "tool_call",
                            agent_id: ROOT_AGENT_ID,
                            timestamp,
                            data: {
                                tool_name:
                                    call.name || call.function?.name || "tool",
                                args:
                                    call.arguments ||
                                    call.function?.arguments ||
                                    {},
                                call_id: call.id,
                            },
                        });
                    });
                }
                if (entry.content) {
                    trEvents.push({
                        event_type: "agent_output",
                        agent_id: ROOT_AGENT_ID,
                        timestamp,
                        data: {
                            output: entry.content,
                            status: "running",
                        },
                    });
                }
            } else if (
                entry.type === "TOOL_RESPONSE" ||
                entry.type === "TOOL_OUTPUT"
            ) {
                trEvents.push({
                    event_type: "tool_output",
                    agent_id: ROOT_AGENT_ID,
                    timestamp,
                    data: {
                        tool_name: entry.tool_name || "tool",
                        output: entry.content || "",
                        call_id: entry.tool_use_id || entry.id,
                    },
                });
            } else if (entry.type === "SYSTEM") {
                trEvents.push({
                    event_type: "agent_output",
                    agent_id: ROOT_AGENT_ID,
                    timestamp,
                    data: {
                        output: entry.content || "System event",
                        status: "running",
                    },
                });
            }
        });
        return trEvents;
    }

    return [];
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
        if (
            entry?.type !== "event_msg" ||
            entry?.payload?.type !== "user_message"
        ) {
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

function getMissingSubagents(sessions) {
    const loadedSessionIds = new Set(sessions.map((s) => s.id));
    const spawnedAgentIds = new Set();
    const spawnedAgentLabelMap = new Map();

    sessions.forEach((session) => {
        const pendingCalls = new Map();

        (session.entries || []).forEach((entry) => {
            if (!entry) return;

            // Handle Codex session entries (type === "response_item")
            if (entry.type === "response_item" && entry.payload) {
                const payload = entry.payload;
                if (
                    (payload.type === "function_call" ||
                        payload.type === "custom_tool_call") &&
                    payload.call_id
                ) {
                    const parsedArgs = parseToolPayload(
                        payload.arguments || payload.input,
                    );
                    pendingCalls.set(payload.call_id, {
                        name: payload.name || "tool",
                        args: parsedArgs,
                    });
                } else if (
                    payload.call_id &&
                    (payload.type === "function_call_output" ||
                        payload.type === "custom_tool_call_output" ||
                        payload.type === "tool_search_output")
                ) {
                    const pending = pendingCalls.get(payload.call_id);
                    const output = parseToolPayload(payload.output);
                    const toolName = codexToolOutputName(
                        payload.type,
                        pending?.name,
                    );
                    if (toolName === "spawn_agent" && output?.agent_id) {
                        spawnedAgentIds.add(output.agent_id);
                        const label =
                            output.nickname ||
                            pending?.args?.agent_nickname ||
                            null;
                        if (label) {
                            spawnedAgentLabelMap.set(output.agent_id, label);
                        }
                    }
                }
            }

            let event = entry;
            if (
                entry.event &&
                typeof entry.event === "object" &&
                entry.event.event_type
            ) {
                event = entry.event;
            }
            if (event.event_type === "tool_output" && event.data) {
                const data = event.data;
                const toolName = data.tool_name || "";
                if (
                    (toolName === "spawn_agent" || data.spawned_agent_id) &&
                    data.spawned_agent_id
                ) {
                    spawnedAgentIds.add(data.spawned_agent_id);
                    if (data.spawned_agent_label) {
                        spawnedAgentLabelMap.set(
                            data.spawned_agent_id,
                            data.spawned_agent_label,
                        );
                    }
                }
            }
            if (event.event_type === "subagent_spawn" && event.agent_id) {
                spawnedAgentIds.add(event.agent_id);
                if (event.data?.name || event.data?.label) {
                    spawnedAgentLabelMap.set(
                        event.agent_id,
                        event.data.name || event.data.label,
                    );
                }
            }
        });
    });

    const missing = [];
    spawnedAgentIds.forEach((id) => {
        if (!loadedSessionIds.has(id)) {
            missing.push({
                id,
                label: spawnedAgentLabelMap.get(id) || humanize(id),
            });
        }
    });

    return missing;
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
                parseDate(b.updatedAt).getTime() -
                parseDate(a.updatedAt).getTime(),
        );
    sessionLibrary.analyticsRecords =
        sessionLibrary.sessions.map(buildAnalyticsRecord);
    sessionLibrary.sessionMap = new Map(
        sessionLibrary.sessions.map((session) => [session.id, session]),
    );
    sessionLibrary.childMap = new Map();
    sessionLibrary.sessions.forEach((session) => {
        if (!session.parentSessionId) return;
        const existing =
            sessionLibrary.childMap.get(session.parentSessionId) || [];
        existing.push(session.id);
        sessionLibrary.childMap.set(session.parentSessionId, existing);
    });
}

function extractSessionIdFromEntries(entries) {
    if (!Array.isArray(entries)) return null;
    for (const entry of entries) {
        if (!entry) continue;
        if (entry.type === "session_meta" && entry.payload?.id) {
            return String(entry.payload.id);
        }
        const sid =
            entry.payload?.session_id ||
            entry.event?.data?.session_id ||
            entry.data?.session_id ||
            entry.session_id;
        if (sid) return String(sid);
    }
    return null;
}

function extractModelFromEntries(entries) {
    if (!Array.isArray(entries)) return null;
    for (const entry of entries) {
        if (!entry) continue;
        const model =
            entry.payload?.model ||
            entry.event?.data?.model ||
            entry.data?.model ||
            entry.model;
        if (model) return String(model);
    }
    return null;
}

function extractChatTitleFromEntries(entries, fallbackName) {
    if (!Array.isArray(entries)) return fallbackName;
    for (const entry of entries) {
        if (!entry) continue;
        const prompt =
            entry.event?.data?.prompt ||
            entry.payload?.prompt ||
            entry.data?.prompt ||
            entry.prompt;
        if (
            prompt &&
            (entry.event_type === "user_input" ||
                entry.event?.event_type === "user_input" ||
                entry.hook_name === "UserPromptSubmit")
        ) {
            return trim(String(prompt).trim(), 58);
        }
        if (
            entry.type === "event_msg" &&
            entry.payload?.type === "user_message"
        ) {
            const codexPrompt = normalizeCodexPrompt(entry.payload.message);
            if (codexPrompt) return trim(codexPrompt, 58);
        }
    }
    return fallbackName;
}

function countUniqueAgentsInEntries(entries) {
    if (!Array.isArray(entries)) return 0;
    const agents = new Set();
    for (const entry of entries) {
        if (!entry) continue;
        const agentId =
            entry.agent_id ||
            entry.payload?.agent_id ||
            entry.event?.agent_id ||
            entry.event?.data?.agent_id ||
            entry.data?.agent_id;
        if (agentId) agents.add(String(agentId));
    }
    return agents.size;
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
            const sessionId = extractSessionIdFromEntries(entries);
            const model = extractModelFromEntries(entries);
            const title = extractChatTitleFromEntries(entries, file.name);
            const agents = countUniqueAgentsInEntries(entries);
            return {
                id: `file-${index}-${file.name}`,
                file,
                text,
                entries,
                fileName: file.name,
                filePath: fileDisplayPath(file),
                updatedAt,
                eventCount: events.length,
                title,
                model,
                sessionId,
                agents,
            };
        })
        .sort(
            (a, b) =>
                parseDate(b.updatedAt).getTime() -
                parseDate(a.updatedAt).getTime(),
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
            const fileName = basename(
                item.file || item.path || `log-${index}.jsonl`,
            );
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
    const allPrimary = sessionLibrary.sessions.filter(
        (session) => session.threadSource !== "subagent",
    );
    if (sessionLibrary.initialSessionId) {
        return allPrimary.filter(
            (session) => session.id === sessionLibrary.initialSessionId,
        );
    }
    return allPrimary;
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

    if (!sessionLibrary.loaded) {
        list.innerHTML = "";
        list.style.display = "none";
        empty.style.display = "";
        empty.textContent = "Load one or more log files to inspect them here.";
        els.sessionSearchContainer?.classList.add("hidden");
        return;
    } else {
        els.sessionSearchContainer?.classList.remove("hidden");
    }

    const query = sessionLibrary.searchQuery || "";
    let sessions = isCodexMode ? primarySessions() : [];
    let files = isCodexMode ? [] : sessionLibrary.files;

    if (query) {
        if (isCodexMode) {
            sessions = sessions.filter((session) => {
                const titleMatch = String(session.title || "")
                    .toLowerCase()
                    .includes(query);
                const modelMatch = String(session.meta?.model || "")
                    .toLowerCase()
                    .includes(query);
                const idMatch = String(session.id || "")
                    .toLowerCase()
                    .includes(query);
                const roleMatch = String(session.role || "")
                    .toLowerCase()
                    .includes(query);
                const nicknameMatch = String(session.nickname || "")
                    .toLowerCase()
                    .includes(query);
                const cwdMatch = String(session.cwd || "")
                    .toLowerCase()
                    .includes(query);
                return (
                    titleMatch ||
                    modelMatch ||
                    idMatch ||
                    roleMatch ||
                    nicknameMatch ||
                    cwdMatch
                );
            });
        } else {
            files = files.filter((file) => {
                const titleMatch = String(file.title || "")
                    .toLowerCase()
                    .includes(query);
                const pathMatch = String(file.filePath || "")
                    .toLowerCase()
                    .includes(query);
                const idMatch =
                    String(file.id || "")
                        .toLowerCase()
                        .includes(query) ||
                    String(file.sessionId || "")
                        .toLowerCase()
                        .includes(query);
                const modelMatch = String(file.model || "")
                    .toLowerCase()
                    .includes(query);
                return titleMatch || pathMatch || idMatch || modelMatch;
            });
        }
    }

    els.sessionLibraryTitle.textContent = isCodexMode
        ? "Codex Sessions"
        : sessionLibrary.importedParsedFiles.length > 0
          ? "Log Files"
          : "Demo Logs";
    count.textContent = String(isCodexMode ? sessions.length : files.length);

    if (isCodexMode && !sessions.length) {
        list.innerHTML = "";
        list.style.display = "none";
        empty.style.display = "";
        empty.textContent = query
            ? `No sessions matching "${query}" were found.`
            : "No primary Codex sessions were found in the selected files.";
        return;
    }

    if (!isCodexMode && !files.length) {
        list.innerHTML = "";
        list.style.display = "none";
        empty.style.display = "";
        empty.textContent = query
            ? `No files matching "${query}" were found.`
            : "No replayable log files were found.";
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

            if (entry.sessionId) {
                const idPill = document.createElement("span");
                idPill.className = "demo-log-pill";
                idPill.textContent = `ID: ${entry.sessionId.substring(0, 8)}`;
                idPill.title = entry.sessionId;
                meta.appendChild(idPill);
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

        if (session.id) {
            const idPill = document.createElement("span");
            idPill.className = "demo-log-pill";
            idPill.textContent = `ID: ${session.id.substring(0, 8)}`;
            idPill.title = session.id;
            meta.appendChild(idPill);
        }

        if (session.meta?.model) {
            const modelPill = document.createElement("span");
            modelPill.className = "demo-log-pill model-pill";
            modelPill.textContent = session.meta.model;
            meta.appendChild(modelPill);
        }

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

    const modelName =
        session.meta?.model || extractModelFromEntries(session.entries) || null;

    if (session.id === rootSessionId) {
        events.push({
            event_type: "session_start",
            agent_id: ROOT_AGENT_ID,
            timestamp: session.startedAt,
            data: {
                source: session.meta.source || session.threadSource,
                label: "Primary Agent",
                role: "primary",
                model: modelName,
                cwd: session.cwd || null,
                session_id: session.id,
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
                name:
                    spawnHint?.nickname ||
                    session.nickname ||
                    humanize(agentId),
                label:
                    spawnHint?.nickname ||
                    session.nickname ||
                    humanize(agentId),
                prompt: spawnHint?.prompt || null,
                role: session.role || "subagent",
                purpose: spawnHint?.prompt || `${humanize(session.role)} task`,
                model: modelName,
            },
        });
    }

    session.entries.forEach((entry) => {
        if (!entry || !entry.type) return;
        if (entry.type === "event_msg") {
            const payload = entry.payload || {};
            if (payload.type === "token_count") {
                events.push({
                    event_type: "token_count",
                    agent_id: agentId,
                    parent_id: parentId,
                    timestamp: entry.timestamp,
                    data: {
                        input_tokens:
                            payload.info?.total_token_usage?.input_tokens || 0,
                        output_tokens:
                            payload.info?.total_token_usage?.output_tokens || 0,
                        total_tokens:
                            payload.info?.total_token_usage?.total_tokens || 0,
                    },
                });
                return;
            }
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
                        role:
                            session.role ||
                            (agentId === ROOT_AGENT_ID
                                ? "primary"
                                : "subagent"),
                    },
                });
                return;
            }
            if (
                payload.type === "agent_message" &&
                payload.phase === "commentary"
            ) {
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
                            output:
                                payload.last_agent_message || "Task complete",
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
                                payload.last_agent_message ||
                                "Sub-agent complete",
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
                        error:
                            payload.error || payload.message || "Task failed",
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
            const parsedArgs = parseToolPayload(
                payload.arguments || payload.input,
            );
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
                parseDate(a.startedAt).getTime() -
                parseDate(b.startedAt).getTime(),
        );
    const spawnHints = collectSpawnHints(sessions);
    const events = sessions.flatMap((session) =>
        translateCodexSession(session, sessionId, spawnHints),
    );
    if (!events.length) {
        throw new Error(
            "No replayable events were found in the selected session.",
        );
    }
    sessionLibrary.selectedSessionId = sessionId;
    renderSessionLibrary();
    replayLoadEvents(events, root.title, {
        mode: "replay",
        replay_source: root.title,
        current_path: root.filePath,
        file_name: root.fileName,
        session_id: sessionId,
        cwd: root.cwd || null,
    });
}

function replayFileEntry(fileId, showPopup = false) {
    const entry = sessionLibrary.files.find((item) => item.id === fileId);
    if (!entry) return;
    sessionLibrary.selectedFileId = fileId;
    renderSessionLibrary();
    if (entry.text) {
        return replayLogContent(entry.text, entry.fileName, showPopup);
    }
    if (!entry.fetchUrl) {
        throw new Error(
            `No replay content is available for ${entry.fileName}.`,
        );
    }
    return fetch(entry.fetchUrl, { cache: "no-store" }).then(
        async (response) => {
            if (!response.ok) {
                throw new Error(
                    `Failed to load ${entry.fileName} from logs folder.`,
                );
            }
            entry.text = await response.text();
            return replayLogContent(entry.text, entry.fileName, showPopup);
        },
    );
}

function triggerSidebarToggleHighlight() {
    if (localStorage.getItem("awv-sidebar-toggle-highlight-seen") === "true") {
        return;
    }
    const toggleButton = document.querySelector("#sidebar-toggle-button");
    if (!toggleButton) return;

    toggleButton.classList.add("pulse-highlight");
    localStorage.setItem("awv-sidebar-toggle-highlight-seen", "true");

    const clearHighlight = () => {
        toggleButton.classList.remove("pulse-highlight");
        toggleButton.removeEventListener("click", clearHighlight);
    };
    toggleButton.addEventListener("click", clearHighlight);

    setTimeout(() => {
        toggleButton.classList.remove("pulse-highlight");
        toggleButton.removeEventListener("click", clearHighlight);
    }, 12000);
}

async function handleReplaySelection(
    fileList,
    source = "files",
    append = false,
) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    const { parsedFiles, report } = await readReplayImport(files, source);
    const importSummary = summarizeReplayImportIssues(report, source);
    setReplayDropnote(importSummary, importSummary ? "warning" : "default");

    if (source === "folder") {
        sessionLibrary.importedParsedFiles = [...parsedFiles];
    } else {
        if (append) {
            const mergedMap = new Map();
            sessionLibrary.importedParsedFiles.forEach((item) => {
                mergedMap.set(item.file.name, item);
            });
            parsedFiles.forEach((item) => {
                mergedMap.set(item.file.name, item);
            });
            sessionLibrary.importedParsedFiles = Array.from(mergedMap.values());
        } else {
            sessionLibrary.importedParsedFiles = [...parsedFiles];
        }
    }

    const codexSessions = sessionLibrary.importedParsedFiles
        .map(({ file, entries }) => buildCodexSessionDescriptor(file, entries))
        .filter(Boolean);

    if (codexSessions.length) {
        sessionLibrary.mode = "codex";
        if (files.length === 1 && !append) {
            sessionLibrary.initialSessionId = codexSessions[0].id;
        } else if (!append) {
            sessionLibrary.initialSessionId = null;
        }
        rebuildSessionLibrary(codexSessions);
        renderSessionLibrary();

        // Check for missing subagents
        const missingSubagents = getMissingSubagents(codexSessions);
        if (missingSubagents.length > 0) {
            const labelStr = missingSubagents.map((s) => s.label).join(", ");
            const mainFile =
                files[0] ||
                (codexSessions[0] ? { name: codexSessions[0].fileName } : null);
            const mainFilename = mainFile ? mainFile.name : "rollout.jsonl";
            const fileStr = missingSubagents
                .map((s) => getSubagentExpectedFilename(mainFilename, s.id))
                .join(", ");

            if (els.subagentPromptText) {
                els.subagentPromptText.innerHTML = `This log file spawned subagent(s) (${labelStr}) whose execution details are missing (expected: ${fileStr}). Please upload the subagent log file(s), or upload the whole sessions folder.`;
            }
            els.subagentPromptBanner?.classList.remove("hidden");

            if (files.length === 1 || append) {
                openSubagentWarningModal(
                    `This log file spawned subagent(s) (${labelStr}) whose execution details are missing.\n\nPlease upload the subagent log file(s) (expected: ${fileStr}).`,
                );
            }
        } else {
            els.subagentPromptBanner?.classList.add("hidden");
        }

        const firstSession = primarySessions()[0];
        if (firstSession) {
            replayCodexSession(firstSession.id);
        }
        triggerSidebarToggleHighlight();
        return;
    }

    els.subagentPromptBanner?.classList.add("hidden");
    sessionLibrary.mode = "files";
    rebuildFileLibrary(sessionLibrary.importedParsedFiles);
    renderSessionLibrary();
    const firstFile = sessionLibrary.files[0];
    if (firstFile) {
        await replayFileEntry(firstFile.id, files.length === 1);
    }
    triggerSidebarToggleHighlight();
}

async function handleDirectorySelection(fileList) {
    const allFiles = Array.from(fileList || []).filter(Boolean);
    if (!allFiles.length) return;
    const appendFolderUpload = sessionLibrary.appendFolderUpload;
    const previousSessionId = sessionLibrary.selectedSessionId;
    const previousFileId = sessionLibrary.selectedFileId;

    // Filter files: must end with .jsonl
    const targetFiles = allFiles.filter((file) => {
        const name = String(file.name || "").toLowerCase();
        return name.endsWith(".jsonl");
    });

    if (!targetFiles.length) {
        throw new Error(
            "No valid Codex history/log files were found in the selected directory.",
        );
    }

    const settled = await Promise.allSettled(
        targetFiles.map(async (file) => {
            const text = await file.text();
            const entries = parseLogEntries(text);
            return { file, text, entries };
        }),
    );

    const parsedFiles = [];
    const report = {
        unreadable: [],
        invalid: [],
        unsupported: [],
    };

    settled.forEach((result, index) => {
        const file = targetFiles[index];
        if (result.status === "fulfilled") {
            const { text, entries } = result.value;
            try {
                const events = extractEventsFromEntries(entries);
                if (events && events.length > 0) {
                    parsedFiles.push({ file, text, entries });
                } else {
                    report.invalid.push({
                        file,
                        reason: "No valid Codex history or visualizer events found.",
                    });
                }
            } catch (error) {
                report.invalid.push({
                    file,
                    reason:
                        error instanceof Error ? error.message : String(error),
                });
            }
        } else {
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
        }
    });

    if (!parsedFiles.length) {
        throw new Error(
            "No valid Codex history/log files were found in the selected directory.",
        );
    }

    const importSummary = summarizeReplayImportIssues(report, "folder");
    setReplayDropnote(importSummary, importSummary ? "warning" : "default");

    if (appendFolderUpload) {
        const mergedMap = new Map();
        sessionLibrary.importedParsedFiles.forEach((item) => {
            mergedMap.set(item.file.name, item);
        });
        parsedFiles.forEach((item) => {
            mergedMap.set(item.file.name, item);
        });
        sessionLibrary.importedParsedFiles = Array.from(mergedMap.values());
    } else {
        sessionLibrary.importedParsedFiles = [...parsedFiles];
    }

    const codexSessions = sessionLibrary.importedParsedFiles
        .map(({ file, entries }) => buildCodexSessionDescriptor(file, entries))
        .filter(Boolean);

    if (codexSessions.length) {
        sessionLibrary.mode = "codex";
        rebuildSessionLibrary(codexSessions);
        renderSessionLibrary();

        // Check for missing subagents
        const missingSubagents = getMissingSubagents(codexSessions);
        if (missingSubagents.length > 0) {
            const labelStr = missingSubagents.map((s) => s.label).join(", ");
            const mainFile =
                parsedFiles[0]?.file ||
                (codexSessions[0] ? { name: codexSessions[0].fileName } : null);
            const mainFilename = mainFile ? mainFile.name : "rollout.jsonl";
            const fileStr = missingSubagents
                .map((s) => getSubagentExpectedFilename(mainFilename, s.id))
                .join(", ");

            if (els.subagentPromptText) {
                els.subagentPromptText.innerHTML = `This log file spawned subagent(s) (${labelStr}) whose execution details are missing (expected: ${fileStr}). Please upload the subagent log file(s), or upload the whole sessions folder.`;
            }
            els.subagentPromptBanner?.classList.remove("hidden");
            openSubagentWarningModal(
                `This log file spawned subagent(s) (${labelStr}) whose execution details are missing.\n\nPlease upload the subagent log file(s) (expected: ${fileStr}).`,
            );
        } else {
            els.subagentPromptBanner?.classList.add("hidden");
        }

        if (appendFolderUpload) {
            const firstSession = primarySessions()[0];
            const nextSessionId =
                previousSessionId &&
                sessionLibrary.sessionMap.has(previousSessionId)
                    ? previousSessionId
                    : firstSession?.id || null;
            if (nextSessionId) {
                replayCodexSession(nextSessionId);
            }
        } else {
            clearReplayWorkspace();
            setReplayDropnote(
                combineReplayNotes(
                    importSummary,
                    formatManualReplaySelectionNote(
                        "session",
                        primarySessions().length,
                    ),
                ),
                importSummary ? "warning" : "default",
            );
        }
        triggerSidebarToggleHighlight();
        return;
    }

    els.subagentPromptBanner?.classList.add("hidden");
    sessionLibrary.mode = "files";
    rebuildFileLibrary(sessionLibrary.importedParsedFiles);
    renderSessionLibrary();
    if (appendFolderUpload) {
        const firstFile = sessionLibrary.files[0];
        const nextFileId = sessionLibrary.files.some(
            (file) => file.id === previousFileId,
        )
            ? previousFileId
            : firstFile?.id || null;
        if (nextFileId) {
            await replayFileEntry(nextFileId, parsedFiles.length === 1);
        }
    } else {
        clearReplayWorkspace();
        setReplayDropnote(
            combineReplayNotes(
                importSummary,
                formatManualReplaySelectionNote(
                    "log file",
                    sessionLibrary.files.length,
                ),
            ),
            importSummary ? "warning" : "default",
        );
    }
    triggerSidebarToggleHighlight();
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
    const lines = Math.max(
        1,
        wrapNodeText(presentation.description, 34).length,
    );
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
        const runHeight = isExpanded ? 208 : hasDesc ? 44 : 36;
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
    const entry = state.toolDescriptions[run.id];
    if ((!entry || entry.status !== "ready") && hasLLMConfig()) {
        enqueueToolDescription(run);
    }

    const desc = document.createElement("span");
    desc.className = "tool-history-card-desc";
    desc.textContent =
        descText || toolRunSummary(run) || "No description available";

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

function openSubagentWarningModal(message) {
    if (els.subagentWarningModalText) {
        els.subagentWarningModalText.innerHTML = message;
    }
    els.subagentWarningModal?.classList.remove("hidden");
    els.subagentWarningModal?.setAttribute("aria-hidden", "false");
}

function closeSubagentWarningModal() {
    els.subagentWarningModal?.classList.add("hidden");
    els.subagentWarningModal?.setAttribute("aria-hidden", "true");
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

function createSubagentItem(node) {
    const presentation = getNodePresentation(node);
    const status = normalizeStatus(node.status);
    const isExpanded = !state.collapsedSubagents.has(node.id);
    const isSelected = node.id === state.selectedId;

    const item = document.createElement("div");
    item.className = `subagent-item ${status}${isExpanded ? " expanded" : ""}${isSelected ? " selected" : ""}`;
    item.id = `card-${node.id}`;

    // Prevent scrolling parent card when using wheel/pointer
    item.addEventListener("wheel", (e) => e.stopPropagation());
    item.addEventListener("pointerdown", (e) => e.stopPropagation());

    // Header
    const header = document.createElement("div");
    header.className = "subagent-header";

    const dot = document.createElement("span");
    dot.className = "subagent-dot";

    const titleWrap = document.createElement("div");
    titleWrap.className = "subagent-title-wrap";

    const title = document.createElement("span");
    title.className = "subagent-title";
    title.textContent = presentation.name;

    const subtitle = document.createElement("span");
    subtitle.className = "subagent-subtitle";
    const subtitleParts = [node.role || "subagent"];
    if (node.model) subtitleParts.push(node.model);
    subtitleParts.push(formatElapsed(node.elapsed_seconds));
    subtitle.textContent = subtitleParts.join(" | ");

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const actions = document.createElement("div");
    actions.className = "subagent-actions";

    const selectBtn = document.createElement("button");
    selectBtn.className = "subagent-select-btn";
    selectBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 2px;">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>Details
    `;
    selectBtn.title = "View sub-agent details";
    selectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.selectedId = node.id;
        openAgentModal(node);
        render();
    });
    actions.appendChild(selectBtn);

    const caret = document.createElement("span");
    caret.className = "subagent-caret";
    caret.textContent = isExpanded ? "▼" : "▶";

    header.appendChild(dot);
    header.appendChild(titleWrap);
    header.appendChild(actions);
    header.appendChild(caret);
    item.appendChild(header);

    // Toggle expand/collapse
    header.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.collapsedSubagents.has(node.id)) {
            state.collapsedSubagents.delete(node.id);
        } else {
            state.collapsedSubagents.add(node.id);
        }
        render();
    });

    if (isExpanded) {
        const body = document.createElement("div");
        body.className = "subagent-body";

        // Agent Summary
        const summarySec = document.createElement("div");
        summarySec.className = "subagent-section";
        const summaryLabel = document.createElement("div");
        summaryLabel.className = "subagent-section-label";
        summaryLabel.textContent = "Agent Summary";
        const summaryVal = document.createElement("div");
        summaryVal.className = "subagent-desc";
        summaryVal.textContent = presentation.description;
        if (presentation.status !== "ready") {
            summaryVal.style.color = "var(--muted)";
            summaryVal.style.fontStyle = "italic";
        }
        summarySec.appendChild(summaryLabel);
        summarySec.appendChild(summaryVal);
        body.appendChild(summarySec);

        // Spawn prompt if any
        if (node.spawn_prompt) {
            const promptSec = document.createElement("div");
            promptSec.className = "subagent-section";
            const label = document.createElement("div");
            label.className = "subagent-section-label";
            label.textContent = "Spawn Prompt";
            const val = document.createElement("pre");
            val.className = "subagent-val prompt-val";
            val.textContent = node.spawn_prompt;
            promptSec.appendChild(label);
            promptSec.appendChild(val);
            body.appendChild(promptSec);
        }

        // Current Action / Last Action
        if (node.last_action && node.last_action !== "Waiting") {
            const actionSec = document.createElement("div");
            actionSec.className = "subagent-section";
            const actionLabel = document.createElement("div");
            actionLabel.className = "subagent-section-label";
            actionLabel.textContent = "Last Action";
            const actionVal = document.createElement("div");
            actionVal.className = "subagent-desc";
            actionVal.textContent = node.last_action;
            actionSec.appendChild(actionLabel);
            actionSec.appendChild(actionVal);
            body.appendChild(actionSec);
        }

        // Subagent's own tool runs and nested subagents interleaved!
        const childRuns = getNodeToolRuns(node);
        const subagents = (state.graph.nodes || []).filter(
            (n) => n.parent_id === node.id,
        );
        const subActivities = [];
        childRuns.forEach((run) => {
            subActivities.push({
                type: "tool",
                sequence: run.sequence,
                data: run,
            });
        });
        subagents.forEach((childSub) => {
            subActivities.push({
                type: "subagent",
                sequence: childSub.spawn_sequence || 0,
                data: childSub,
            });
        });
        subActivities.sort((a, b) => b.sequence - a.sequence);

        if (subActivities.length > 0) {
            const activitySec = document.createElement("div");
            activitySec.className = "subagent-section";
            const label = document.createElement("div");
            label.className = "subagent-section-label";
            label.textContent = `Activity (${subActivities.length})`;
            activitySec.appendChild(label);

            subActivities.forEach((subItem) => {
                if (subItem.type === "tool") {
                    const run = subItem.data;
                    const isRunExpanded = state.expandedToolRuns.has(run.id);
                    const descText = getToolDescription(run);

                    const runDiv = document.createElement("div");
                    runDiv.className = `tool-run-item ${toolRunStatus(run)}${isRunExpanded ? " expanded" : ""}`;
                    runDiv.dataset.runId = run.id;

                    runDiv.addEventListener("wheel", (e) =>
                        e.stopPropagation(),
                    );
                    runDiv.addEventListener("pointerdown", (e) =>
                        e.stopPropagation(),
                    );

                    const runHeader = document.createElement("div");
                    runHeader.className = "tool-run-header";

                    const runDot = document.createElement("span");
                    runDot.className = "tool-run-dot";

                    const runTitleWrap = document.createElement("div");
                    runTitleWrap.className = "tool-run-title-wrap";

                    const desc = document.createElement("span");
                    desc.className = "tool-run-desc";
                    desc.textContent = descText;
                    runDiv.title = descText;
                    runTitleWrap.appendChild(desc);

                    const entry = state.toolDescriptions[run.id];
                    if (!entry || entry.status !== "ready") {
                        enqueueToolDescription(run);
                    }

                    const runCaret = document.createElement("span");
                    runCaret.className = "tool-run-caret";
                    runCaret.textContent = isRunExpanded ? "▼" : "▶";

                    runHeader.appendChild(runDot);
                    runHeader.appendChild(runTitleWrap);
                    runHeader.appendChild(runCaret);
                    runDiv.appendChild(runHeader);

                    runHeader.addEventListener("click", (e) => {
                        e.stopPropagation();
                        toggleToolRun(run.id);
                    });

                    if (isRunExpanded) {
                        const runBody = document.createElement("div");
                        runBody.className = "tool-run-body";

                        const infoBar = document.createElement("div");
                        infoBar.className = "tool-run-info-bar";
                        infoBar.style.fontSize = "9px";
                        infoBar.style.fontWeight = "750";
                        infoBar.style.color = "#94a3b8";
                        infoBar.style.borderBottom = "1px solid #334155";
                        infoBar.style.paddingBottom = "6px";
                        infoBar.style.marginBottom = "4px";
                        infoBar.textContent = `Tool: ${run.tool_name || "tool"} | Call: ${run.id || "n/a"}`;
                        runBody.appendChild(infoBar);

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

                        runBody.appendChild(inputSection);
                        runBody.appendChild(outputSection);
                        runDiv.appendChild(runBody);
                    }

                    activitySec.appendChild(runDiv);
                } else if (subItem.type === "subagent") {
                    const childSub = subItem.data;
                    activitySec.appendChild(createSubagentItem(childSub));
                }
            });
            body.appendChild(activitySec);
        }

        item.appendChild(body);
    }

    return item;
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
        if (
            e.target.closest("a") ||
            e.target.closest(".tool-run-item") ||
            e.target.closest(".subagent-item")
        )
            return;

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
        const parentNode = state.graph.nodes.find(
            (n) => n.id === node.parent_id,
        );
        const parentName = parentNode
            ? getNodePresentation(parentNode).name
            : humanize(node.parent_id);
        relations.push(
            `Spawned by parent agent: <a href="#card-${node.parent_id}" data-target-id="${node.parent_id}">${parentName}</a>`,
        );
    }

    const childNodes = (state.graph.nodes || []).filter(
        (n) => n.parent_id === node.id,
    );
    if (childNodes.length > 0) {
        const childLinks = childNodes
            .map((child) => {
                const childName = getNodePresentation(child).name;
                return `<a href="#card-${child.id}" data-target-id="${child.id}">${childName}</a>`;
            })
            .join(", ");
        relations.push(`Spawned sub-agents: ${childLinks}`);
    }

    if (relations.length > 0) {
        const relationsDiv = document.createElement("div");
        relationsDiv.className = "card-relations-html";
        relationsDiv.innerHTML = relations.join("<br>");

        // Handle smooth scrolling on click
        relationsDiv.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const targetId = link.dataset.targetId;
                state.selectedId = targetId;
                render();
                const newTargetEl = document.getElementById(`card-${targetId}`);
                if (newTargetEl) {
                    newTargetEl.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                    });
                    newTargetEl.classList.add("highlight-flash");
                    setTimeout(
                        () => newTargetEl.classList.remove("highlight-flash"),
                        1200,
                    );
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

    // 6. Activity List (Tool Runs & Nested Sub-agents)
    const runs = getNodeToolRuns(node);
    const subAgentChildNodes = (state.graph.nodes || []).filter(
        (n) => n.parent_id === node.id,
    );
    const activities = [];
    runs.forEach((run) => {
        activities.push({ type: "tool", sequence: run.sequence, data: run });
    });
    subAgentChildNodes.forEach((child) => {
        activities.push({
            type: "subagent",
            sequence: child.spawn_sequence || 0,
            data: child,
        });
    });
    activities.sort((a, b) => b.sequence - a.sequence);

    if (activities.length > 0) {
        const activityContainer = document.createElement("div");
        activityContainer.className = "card-tools-html";

        const activityTitle = document.createElement("div");
        activityTitle.className = "card-tools-title";
        activityTitle.textContent = `Activity (${activities.length})`;
        activityContainer.appendChild(activityTitle);

        activities.forEach((item) => {
            if (item.type === "tool") {
                const run = item.data;
                const isExpanded = state.expandedToolRuns.has(run.id);
                const descText = getToolDescription(run);

                const div = document.createElement("div");
                div.className = `tool-run-item ${toolRunStatus(run)}${isExpanded ? " expanded" : ""}`;
                div.dataset.runId = run.id;

                div.addEventListener("wheel", (e) => e.stopPropagation());
                div.addEventListener("pointerdown", (e) => e.stopPropagation());

                const runHeader = document.createElement("div");
                runHeader.className = "tool-run-header";

                const runDot = document.createElement("span");
                runDot.className = "tool-run-dot";

                const titleWrap = document.createElement("div");
                titleWrap.className = "tool-run-title-wrap";

                const desc = document.createElement("span");
                desc.className = "tool-run-desc";
                desc.textContent = descText;
                div.title = descText;
                titleWrap.appendChild(desc);

                const entry = state.toolDescriptions[run.id];
                if (!entry || entry.status !== "ready") {
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

                activityContainer.appendChild(div);
            } else if (item.type === "subagent") {
                const subagentNode = item.data;
                activityContainer.appendChild(createSubagentItem(subagentNode));
            }
        });

        card.appendChild(activityContainer);
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

    // A node is a root node if it has no parent, or if its parent is not present in the graph
    const rootNodes = nodes.filter(
        (node) =>
            !node.parent_id || !nodes.some((n) => n.id === node.parent_id),
    );

    rootNodes.forEach((node) => {
        drawNode(node);
    });

    restoreScrollPositions();
}

function renderSummary() {
    if (!els.sessionSummary) return;

    let nodes = state.graph.nodes || [];
    let events = state.graph.events || [];

    if (replay.active && replay.allEvents && replay.allEvents.length > 0) {
        const fullGraph = buildGraphFromEvents(
            replay.allEvents,
            replay.logDetails,
        );
        nodes = fullGraph.nodes || [];
        events = fullGraph.events || [];
    }

    if (nodes.length === 0) {
        els.sessionSummary.innerHTML = `
            <div class="empty-state">
                <span>No active session loaded</span>
            </div>
        `;
        return;
    }

    let start = null;
    let end = null;
    if (events.length > 0) {
        const times = events.map((e) => new Date(e.timestamp).getTime());
        start = new Date(Math.min(...times));
        end = new Date(Math.max(...times));
    }
    const durationMs = start && end ? end.getTime() - start.getTime() : 0;

    const subagentsCount = nodes.filter((n) => n.parent_id !== null).length;
    const totalToolCalls = nodes.reduce(
        (sum, n) => sum + (n.tool_count || 0),
        0,
    );
    const totalCost = nodes.reduce((sum, n) => sum + (n.cost || 0), 0);
    const totalInputTokens = nodes.reduce(
        (sum, n) => sum + (n.input_tokens || 0),
        0,
    );
    const totalOutputTokens = nodes.reduce(
        (sum, n) => sum + (n.output_tokens || 0),
        0,
    );
    const totalTokens = totalInputTokens + totalOutputTokens;

    const toolCounts = {};
    nodes.forEach((node) => {
        (node.tool_runs || []).forEach((run) => {
            const name = run.tool_name || "unknown";
            toolCounts[name] = (toolCounts[name] || 0) + 1;
        });
    });

    const toolRows = Object.entries(toolCounts)
        .map(
            ([name, count]) => `
            <tr>
                <td><strong>${name}</strong></td>
                <td>${count} call${count > 1 ? "s" : ""}</td>
            </tr>
        `,
        )
        .join("");

    const agentRows = nodes
        .map((node) => {
            const displayName =
                node.nickname || node.label || humanize(node.id);
            const pricing = getModelPricing(node.model || "gpt-4o-mini");
            const nodeCost = node.cost || 0;
            return `
            <tr>
                <td>
                    <div style="font-weight: 700; color: var(--accent);">${displayName}</div>
                    <div style="font-size: 0.75rem; color: var(--muted);">${node.role || "agent"}</div>
                </td>
                <td>
                    <span class="model-badge">${node.model || "gpt-4o-mini"}</span>
                </td>
                <td>
                    <div class="token-info"><strong>Input:</strong> ${node.input_tokens || 0}</div>
                    <div class="token-info"><strong>Output:</strong> ${node.output_tokens || 0}</div>
                </td>
                <td>
                    <span style="font-weight: 600; color: var(--ink);">${formatElapsed(node.elapsed_seconds || 0)}</span>
                </td>
                <td>
                    <span class="cost-text">$${nodeCost.toFixed(5)}</span>
                </td>
            </tr>
        `;
        })
        .join("");

    const sessionId =
        state.graph.session_id || state.graph.log?.session_id || "N/A";
    const logFile =
        state.graph.log?.file_name ||
        state.graph.log?.filename ||
        "No log loaded";
    const sessionCwd = state.graph.cwd || "Unknown";

    els.sessionSummary.innerHTML = `
        <div class="summary-header-row">
            <div class="summary-metric-card">
                <span class="metric-lbl">Total Duration</span>
                <span class="metric-val">${formatElapsed(Math.floor(durationMs / 1000))}</span>
            </div>
            <div class="summary-metric-card">
                <span class="metric-lbl">Sub-Agents Spawned</span>
                <span class="metric-val">${subagentsCount}</span>
            </div>
            <div class="summary-metric-card">
                <span class="metric-lbl">Tool Calls Made</span>
                <span class="metric-val">${totalToolCalls}</span>
            </div>
            <div class="summary-metric-card">
                <span class="metric-lbl">Estimated Cost (USD)</span>
                <span class="metric-val" style="color: var(--complete);">$${totalCost.toFixed(5)}</span>
            </div>
        </div>

        <div class="summary-grid">
            <div class="summary-table-card">
                <h3 class="summary-section-title">Agent & Cost Breakdown</h3>
                <table class="summary-table">
                    <thead>
                        <tr>
                            <th>Agent / Role</th>
                            <th>Model</th>
                            <th>Token Usage</th>
                            <th>Duration</th>
                            <th>Cost (USD)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${agentRows}
                        <tr class="total-row">
                            <td><strong>Total Session</strong></td>
                            <td>-</td>
                            <td>
                                <div class="token-info"><strong>Input:</strong> ${totalInputTokens}</div>
                                <div class="token-info"><strong>Output:</strong> ${totalOutputTokens}</div>
                            </td>
                            <td><strong>${formatElapsed(Math.floor(durationMs / 1000))}</strong></td>
                            <td><span class="cost-text">$${totalCost.toFixed(5)}</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style="display: flex; flex-direction: column; gap: 20px;">
                <div class="summary-table-card">
                    <h3 class="summary-section-title">Tool Activity Summary</h3>
                    ${
                        Object.keys(toolCounts).length > 0
                            ? `
                        <table class="summary-table">
                            <thead>
                                <tr>
                                    <th>Tool Name</th>
                                    <th>Calls</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${toolRows}
                            </tbody>
                        </table>
                    `
                            : `
                        <div style="font-size: 0.82rem; color: var(--muted); text-align: center; padding: 12px 0;">
                            No tool calls recorded in this session.
                        </div>
                    `
                    }
                </div>

                <div class="summary-table-card">
                    <h3 class="summary-section-title">Session Details</h3>
                    <div class="metadata-list">
                        <div class="metadata-item">
                            <strong>Session ID</strong>
                            <span style="font-family: var(--font-mono, monospace); font-size: 0.75rem;">${sessionId}</span>
                        </div>
                        <div class="metadata-item">
                            <strong>Log File</strong>
                            <span>${logFile}</span>
                        </div>
                        <div class="metadata-item">
                            <strong>Working Dir</strong>
                            <span style="font-size: 0.75rem;">${sessionCwd}</span>
                        </div>
                        <div class="metadata-item">
                            <strong>Start Time</strong>
                            <span>${start ? formatDateTime(start.toISOString()) : "N/A"}</span>
                        </div>
                        <div class="metadata-item">
                            <strong>End Time</strong>
                            <span>${end ? formatDateTime(end.toISOString()) : "N/A"}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function formatCost(cost) {
    if (cost === null || cost === undefined) return "Unavailable";
    if (cost === 0) return "$0.00";
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
}

function projectLabel(path) {
    return path === "Unknown project" ? path : basename(path);
}

function sessionDuration(session) {
    return Math.max(
        0,
        Math.floor(
            (parseDate(session.endedAt).getTime() -
                parseDate(session.startedAt).getTime()) /
                1000,
        ),
    );
}

function renderProjectDashboard() {
    if (!els.projectDashboard) return;
    const projects = buildProjectAnalytics(sessionLibrary.sessions);
    if (!projects.length) {
        els.projectDashboard.innerHTML = `<div class="analytics-empty"><h2>Import Codex sessions to begin</h2><p>Choose a Codex sessions directory to group imports by working directory and compare project costs.</p></div>`;
        return;
    }

    const filteredProjects = state.analyticsProjectFilter
        ? projects.filter(
              (project) => project.path === state.analyticsProjectFilter,
          )
        : projects;
    const allRecords = projects.flatMap((project) => project.sessions);
    const actualRecords = allRecords.filter(
        (record) => record.costProvenance === "actual",
    );
    const actualCost = actualRecords.reduce(
        (total, record) => total + (record.cost ?? 0),
        0,
    );
    const actualTokens = actualRecords.reduce(
        (total, record) => total + record.inputTokens + record.outputTokens,
        0,
    );
    const unpricedActualSessions = actualRecords.filter(
        (record) => record.cost === null,
    ).length;
    const scenarios = state.analyticsScenarioModels;
    const selectedProject = projects.find(
        (project) => project.path === state.analyticsProjectFilter,
    );
    const projectOptions = projects
        .map(
            (project) =>
                `<option value="${escapeHtml(project.path)}"${project.path === state.analyticsProjectFilter ? " selected" : ""}>${escapeHtml(projectLabel(project.path))}</option>`,
        )
        .join("");
    const modelChecklist = Object.keys(MODEL_PRICING)
        .sort()
        .map(
            (model) =>
                `<label class="analytics-model-option"><input data-scenario-model="${escapeHtml(model)}" type="checkbox"${scenarios.includes(model) ? " checked" : ""}><span>${escapeHtml(model)}</span></label>`,
        )
        .join("");
    const scenarioChips = scenarios.length
        ? scenarios
              .map(
                  (model) =>
                      `<button class="analytics-chip" data-remove-scenario="${escapeHtml(model)}" type="button">${escapeHtml(model)} <span aria-hidden="true">×</span></button>`,
              )
              .join("")
        : `<span class="analytics-hint">Select models to compare token costs.</span>`;
    const projectRows = filteredProjects
        .map((project) => {
            const scenarioCosts = scenarios
                .map((model) => {
                    const cost = priceTokens(
                        project.inputTokens,
                        project.outputTokens,
                        model,
                    );
                    return `<span><strong>${escapeHtml(model)}</strong>${formatCost(cost)}</span>`;
                })
                .join("");
            return `<tr>
                <td class="analytics-project-cell"><button class="analytics-project-link" data-project="${escapeHtml(project.path)}" type="button">${escapeHtml(projectLabel(project.path))}</button><span title="${escapeHtml(project.path)}">${escapeHtml(project.path)}</span></td>
                <td>${project.sessions.length}</td>
                <td>${formatDateTime(project.start)}<br><span class="analytics-muted">to ${formatDateTime(project.end)}</span></td>
                <td><strong>${formatCost(project.actualCost)}</strong>${project.unpricedActualSessions ? `<span class="analytics-muted">${project.unpricedActualSessions} unpriced</span>` : ""}</td>
                <td>${project.estimatedSessions || "-"}</td>
                <td class="scenario-values">${scenarioCosts || "-"}</td>
            </tr>`;
        })
        .join("");
    const sessions = filteredProjects
        .flatMap((project) => project.sessions)
        .sort(
            (a, b) =>
                parseDate(b.startedAt).getTime() -
                parseDate(a.startedAt).getTime(),
        );
    const sessionRows = sessions
        .map(
            (session) => `<tr>
                <td><strong>${escapeHtml(session.title)}</strong></td>
                <td><span class="model-badge">${escapeHtml(session.model)}</span></td>
                <td>${formatDateTime(session.startedAt)}</td>
                <td>${formatElapsed(sessionDuration(session))}</td>
                <td>${session.costProvenance === "actual" ? session.totalTokens.toLocaleString() : "Not recorded"}</td>
                <td><span class="cost-provenance ${session.costProvenance}">${session.costProvenance}</span></td>
                <td>${session.costProvenance === "actual" ? formatCost(session.cost) : "Excluded"}</td>
                <td><button class="analytics-replay" data-session-id="${escapeHtml(session.id)}" type="button">Replay</button></td>
            </tr>`,
        )
        .join("");
    const sessionCards = sessions
        .map(
            (session) => `<article class="analytics-session-card">
                <div><strong>${escapeHtml(session.title)}</strong><span class="model-badge">${escapeHtml(session.model)}</span></div>
                <div class="analytics-session-status"><span class="cost-provenance ${session.costProvenance}">${session.costProvenance}</span><strong>${session.costProvenance === "actual" ? formatCost(session.cost) : "Excluded"}</strong></div>
                <dl><div><dt>Started</dt><dd>${formatDateTime(session.startedAt)}</dd></div><div><dt>Duration</dt><dd>${formatElapsed(sessionDuration(session))}</dd></div><div><dt>Tokens</dt><dd>${session.costProvenance === "actual" ? session.totalTokens.toLocaleString() : "Not recorded"}</dd></div></dl>
                <button class="analytics-replay" data-session-id="${escapeHtml(session.id)}" type="button">Replay session</button>
            </article>`,
        )
        .join("");

    els.projectDashboard.innerHTML = `
        <section class="analytics-header">
            <div><span class="eyebrow">Imported Codex portfolio</span><h2>Cost intelligence</h2><p>Actual spend is calculated from recorded token usage. Estimated-only sessions remain visible but are excluded from comparisons.</p></div>
            <span class="analytics-import-status">${allRecords.length} sessions imported</span>
        </section>
        <section class="analytics-toolbar" aria-label="Analytics filters">
            <label>Project<select id="analytics-project-filter"><option value="">All projects</option>${projectOptions}</select></label>
            <div class="analytics-compare"><button id="analytics-compare-toggle" class="analytics-compare-trigger" type="button" aria-expanded="${state.analyticsCompareMenuOpen}">Compare models <span>${scenarios.length}</span></button>${state.analyticsCompareMenuOpen ? `<div class="analytics-model-menu">${modelChecklist}</div>` : ""}</div>
            ${selectedProject ? `<button id="analytics-clear-project" class="analytics-clear-filter" type="button">Clear project filter</button>` : ""}
            <div class="analytics-chip-list">${scenarioChips}</div>
        </section>
        <div class="analytics-kpis">
            <article><span>Projects</span><strong>${projects.length}</strong></article>
            <article><span>Imported sessions</span><strong>${allRecords.length}</strong></article>
            <article><span>Actual cost</span><strong>${formatCost(actualCost)}</strong>${unpricedActualSessions ? `<small>${unpricedActualSessions} unpriced session${unpricedActualSessions === 1 ? "" : "s"}</small>` : ""}</article>
            <article><span>Actual tokens</span><strong>${actualTokens.toLocaleString()}</strong></article>
            <article><span>Estimated-only</span><strong>${allRecords.length - actualRecords.length}</strong></article>
        </div>
        <section class="analytics-card">
            <div class="analytics-card-heading"><div><span class="eyebrow">Portfolio</span><h3>Projects</h3></div><span>Choose a project to inspect its sessions.</span></div>
            <div class="analytics-table-wrap"><table class="analytics-table analytics-project-table"><thead><tr><th>Project</th><th>Sessions</th><th>Activity</th><th>Actual spend</th><th>Estimated</th><th>What-if cost</th></tr></thead><tbody>${projectRows}</tbody></table></div>
        </section>
        <section class="analytics-card">
            <div class="analytics-card-heading"><div><span class="eyebrow">${selectedProject ? "Project drill-down" : "Portfolio activity"}</span><h3 title="${selectedProject ? escapeHtml(selectedProject.path) : ""}">${selectedProject ? escapeHtml(projectLabel(selectedProject.path)) : "All sessions"}</h3></div><span>${sessions.length} session${sessions.length === 1 ? "" : "s"} · actual-token sessions can be compared.</span></div>
            <div class="analytics-table-wrap analytics-session-table"><table class="analytics-table"><thead><tr><th>Session</th><th>Model</th><th>Started</th><th>Duration</th><th>Tokens</th><th>Usage</th><th>Cost</th><th>Action</th></tr></thead><tbody>${sessionRows}</tbody></table></div>
            <div class="analytics-session-cards">${sessionCards}</div>
        </section>`;
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
        state.configModalOpen &&
        els.configModal.contains(document.activeElement);
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

    const nodes = state.graph.nodes || [];

    if (state.activeTab === "analytics") {
        if (els.svg) els.svg.classList.add("hidden");
        if (els.sessionSummary) els.sessionSummary.classList.add("hidden");
        if (els.projectDashboard)
            els.projectDashboard.classList.remove("hidden");
        if (els.empty) els.empty.classList.add("hidden");
        if (els.viewGraphBtn) els.viewGraphBtn.classList.remove("active");
        if (els.viewSummaryBtn) els.viewSummaryBtn.classList.remove("active");
        if (els.viewAnalyticsBtn) els.viewAnalyticsBtn.classList.add("active");
        renderProjectDashboard();
    } else if (state.activeTab === "summary") {
        if (els.svg) els.svg.classList.add("hidden");
        if (els.sessionSummary) els.sessionSummary.classList.remove("hidden");
        if (els.projectDashboard) els.projectDashboard.classList.add("hidden");
        if (els.empty) els.empty.classList.add("hidden");
        if (els.viewGraphBtn) els.viewGraphBtn.classList.remove("active");
        if (els.viewSummaryBtn) els.viewSummaryBtn.classList.add("active");
        if (els.viewAnalyticsBtn)
            els.viewAnalyticsBtn.classList.remove("active");
        renderSummary();
    } else {
        if (els.svg) els.svg.classList.remove("hidden");
        if (els.sessionSummary) els.sessionSummary.classList.add("hidden");
        if (els.projectDashboard) els.projectDashboard.classList.add("hidden");
        if (els.empty) els.empty.classList.toggle("hidden", nodes.length > 0);
        if (els.viewGraphBtn) els.viewGraphBtn.classList.add("active");
        if (els.viewSummaryBtn) els.viewSummaryBtn.classList.remove("active");
        if (els.viewAnalyticsBtn)
            els.viewAnalyticsBtn.classList.remove("active");
        renderGraph();
    }

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

        const sessionId =
            extractSessionIdFromEntries(entries) ||
            extractSessionIdFromEvents(events);
        state.graph = buildGraphFromEvents(events, {
            ...details,
            session_id: sessionId,
        });

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

function clearReplayWorkspace() {
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

async function postCommand(path) {
    if (!state.backendAvailable) {
        if (path === "/reset") {
            clearReplayWorkspace();
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
    speed: "realtime",
    filename: null,
    logDetails: {},
    // timing
    firstTimestamp: 0, // ms of the earliest event
    lastTimestamp: 0, // ms of the latest event
    totalDuration: 0, // ms span
    simTimeMs: 0, // current simulation time offset from first event
    wallAnchor: 0, // performance.now() when we last started/resumed
    simAnchorMs: 0, // simTimeMs at the moment we started/resumed
    toolCallsAnchor: 0, // tool call count when we last started/resumed
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

function countToolCalls(endIndex) {
    const hasToolCalls = replay.allEvents.some(
        (evt) => evt.event_type === "tool_call",
    );
    let count = 0;
    for (let i = 0; i < endIndex; i++) {
        const isIncrement = hasToolCalls
            ? replay.allEvents[i] &&
              replay.allEvents[i].event_type === "tool_call"
            : true;
        if (isIncrement) {
            count++;
        }
    }
    return count;
}

function getIndexForToolCalls(targetToolCalls) {
    const hasToolCalls = replay.allEvents.some(
        (evt) => evt.event_type === "tool_call",
    );
    let count = 0;
    for (let i = 0; i < replay.allEvents.length; i++) {
        const isIncrement = hasToolCalls
            ? replay.allEvents[i] &&
              replay.allEvents[i].event_type === "tool_call"
            : true;
        if (isIncrement) {
            count++;
        }
        if (count > targetToolCalls) {
            return i;
        }
    }
    return replay.allEvents.length;
}

function replayTick() {
    if (!replay.playing) return;
    const now = performance.now();
    const wallElapsed = now - replay.wallAnchor;

    const prevIndex = replay.currentIndex;

    if (replay.speed === "slow" || replay.speed === "fast") {
        const rate = replay.speed === "slow" ? 1 / 500 : 4 / 500;
        const targetToolCalls =
            replay.toolCallsAnchor + Math.floor(wallElapsed * rate);
        replay.currentIndex = getIndexForToolCalls(targetToolCalls);

        // Update simTimeMs to match current index
        if (replay.currentIndex === 0) {
            replay.simTimeMs = 0;
        } else if (replay.currentIndex >= replay.allEvents.length) {
            replay.simTimeMs = replay.totalDuration;
        } else {
            const evt = replay.allEvents[replay.currentIndex - 1];
            replay.simTimeMs =
                parseDate(evt.timestamp).getTime() - replay.firstTimestamp;
        }
    } else {
        // Realtime mode (10x speed)
        const speedVal = 10;
        const simElapsed = wallElapsed * speedVal;
        const targetSimMs = replay.simAnchorMs + simElapsed;
        replayAdvanceTo(targetSimMs);
    }

    if (replay.currentIndex !== prevIndex) {
        replayBuildAndRender();
    }
    replayUpdateUI();

    if (
        replay.currentIndex >= replay.allEvents.length ||
        replay.simTimeMs >= replay.totalDuration
    ) {
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
    replay.toolCallsAnchor = countToolCalls(replay.currentIndex);
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

    let session_id = logDetails.session_id;
    if (!session_id) {
        session_id = extractSessionIdFromEvents(sorted);
    }

    replay.logDetails = {
        mode: "replay",
        replay_source: filename || "uploaded log",
        current_path: null,
        file_name: filename || null,
        session_id,
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
    els.replaySpeed.value = "realtime";
    replay.speed = "realtime";

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
    replaySetSpeed(e.target.value);
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

function getSubagentExpectedFilename(mainFilename, spawnedAgentId) {
    return `<code class="inline-code">*${spawnedAgentId}.jsonl</code>`;
}

async function replayLogContent(content, filename, showPopup = false) {
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

    const sessionId =
        extractSessionIdFromEntries(entries) ||
        extractSessionIdFromEvents(events);
    replayLoadEvents(events, filename, { session_id: sessionId });

    // Check for missing subagents in individual uploaded file mode
    const spawnedAgentIds = new Set();
    const spawnedAgentLabelMap = new Map();

    events.forEach((event) => {
        if (!event) return;
        if (event.event_type === "tool_output" && event.data) {
            const data = event.data;
            if (data.spawned_agent_id) {
                spawnedAgentIds.add(data.spawned_agent_id);
                if (data.spawned_agent_label) {
                    spawnedAgentLabelMap.set(
                        data.spawned_agent_id,
                        data.spawned_agent_label,
                    );
                }
            }
        }
        if (event.event_type === "subagent_spawn" && event.agent_id) {
            spawnedAgentIds.add(event.agent_id);
            if (event.data?.name || event.data?.label) {
                spawnedAgentLabelMap.set(
                    event.agent_id,
                    event.data.name || event.data.label,
                );
            }
        }
    });

    const loadedFileNames = new Set(
        sessionLibrary.files.map((f) => f.fileName.toLowerCase()),
    );

    const missingSubagents = [];
    spawnedAgentIds.forEach((spawnedId) => {
        const isLoaded = Array.from(loadedFileNames).some((name) =>
            name.includes(spawnedId.toLowerCase()),
        );
        if (!isLoaded) {
            missingSubagents.push({
                id: spawnedId,
                label:
                    spawnedAgentLabelMap.get(spawnedId) || humanize(spawnedId),
                expectedFilename: getSubagentExpectedFilename(
                    filename,
                    spawnedId,
                ),
            });
        }
    });

    if (missingSubagents.length > 0) {
        const labelStr = missingSubagents.map((s) => s.label).join(", ");
        const fileStr = missingSubagents
            .map((s) => s.expectedFilename)
            .join(", ");

        // Show banner in the UI
        if (els.subagentPromptText) {
            els.subagentPromptText.innerHTML = `This log file spawned subagent(s) (${labelStr}) whose execution details are missing (expected: ${fileStr}). Please upload the subagent log file(s), or upload the whole sessions folder.`;
        }
        els.subagentPromptBanner?.classList.remove("hidden");

        if (showPopup) {
            openSubagentWarningModal(
                `This log file spawned subagent(s) (${labelStr}) whose execution details are missing.\n\nPlease upload the subagent log file(s) (expected: ${fileStr}).`,
            );
        }
    } else {
        els.subagentPromptBanner?.classList.add("hidden");
    }
}

els.demoButton?.addEventListener("click", () => postCommand("/demo"));
els.resetButton?.addEventListener("click", () => postCommand("/reset"));
els.viewGraphBtn?.addEventListener("click", () => {
    state.activeTab = "graph";
    render();
});
els.viewSummaryBtn?.addEventListener("click", () => {
    state.activeTab = "summary";
    render();
});
els.viewAnalyticsBtn?.addEventListener("click", () => {
    state.activeTab = "analytics";
    render();
});
els.themeToggle?.addEventListener("click", (event) => {
    const toggleTheme = () => {
        const isLight =
            document.documentElement.classList.toggle("light-theme");
        localStorage.setItem("awv-theme", isLight ? "light" : "dark");
    };
    const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!document.startViewTransition || reducedMotion) {
        toggleTheme();
        return;
    }
    const x = event.clientX || window.innerWidth / 2;
    const y = event.clientY || window.innerHeight / 2;
    const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
    );
    const transition = document.startViewTransition(toggleTheme);
    transition.ready.then(() => {
        document.documentElement.animate(
            {
                clipPath: [
                    `circle(0 at ${x}px ${y}px)`,
                    `circle(${radius}px at ${x}px ${y}px)`,
                ],
            },
            {
                duration: 500,
                easing: "ease-out",
                pseudoElement: "::view-transition-new(root)",
            },
        );
    });
});
els.projectDashboard?.addEventListener("change", (event) => {
    const target = event.target;
    if (
        target instanceof HTMLSelectElement &&
        target.id === "analytics-project-filter"
    ) {
        state.analyticsProjectFilter = target.value;
        render();
    }
    if (target instanceof HTMLInputElement && target.dataset.scenarioModel) {
        const model = target.dataset.scenarioModel;
        state.analyticsScenarioModels = target.checked
            ? [...new Set([...state.analyticsScenarioModels, model])]
            : state.analyticsScenarioModels.filter(
                  (selectedModel) => selectedModel !== model,
              );
        render();
    }
});
els.projectDashboard?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const projectButton = target.closest("[data-project]");
    if (projectButton instanceof HTMLElement) {
        state.analyticsProjectFilter = projectButton.dataset.project || "";
        render();
        return;
    }
    const compareToggle = target.closest("#analytics-compare-toggle");
    if (compareToggle) {
        state.analyticsCompareMenuOpen = !state.analyticsCompareMenuOpen;
        render();
        return;
    }
    const removeScenario = target.closest("[data-remove-scenario]");
    if (removeScenario instanceof HTMLElement) {
        const model = removeScenario.dataset.removeScenario;
        state.analyticsScenarioModels = state.analyticsScenarioModels.filter(
            (selectedModel) => selectedModel !== model,
        );
        render();
        return;
    }
    if (target.closest("#analytics-clear-project")) {
        state.analyticsProjectFilter = "";
        render();
        return;
    }
    const replayButton = target.closest("[data-session-id]");
    if (replayButton instanceof HTMLElement) {
        const sessionId = replayButton.dataset.sessionId;
        if (!sessionId) return;
        state.activeTab = "graph";
        replayCodexSession(sessionId);
    }
});
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
els.pickLogFolder?.addEventListener("click", () => {
    sessionLibrary.appendFolderUpload = false;
    sessionLibrary.initialSessionId = null;
});

// Populate the replay drop-note with the OS-appropriate sessions path.
{
    const ua = navigator.userAgent || "";
    let sessionsPath;
    if (/windows/i.test(ua)) {
        sessionsPath =
            '<code class="inline-code">%USERPROFILE%\\.codex\\sessions</code>';
    } else if (/macintosh|mac os|iphone|ipad|ipod/i.test(ua)) {
        sessionsPath = '<code class="inline-code">~/.codex/sessions</code>';
    } else {
        // Linux and other Unix-like systems
        sessionsPath = '<code class="inline-code">~/.codex/sessions</code>';
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
        await handleDirectorySelection(event.target.files || []);
    } catch (error) {
        window.alert(error instanceof Error ? error.message : "Replay failed.");
    } finally {
        event.target.value = "";
    }
});
els.subagentUploadFiles?.addEventListener("click", () =>
    els.subagentFileInput?.click(),
);
els.subagentUploadFolder?.addEventListener("click", () => {
    sessionLibrary.appendFolderUpload = true;
    els.replayFolder?.click();
});
els.subagentPromptDismiss?.addEventListener("click", () => {
    els.subagentPromptBanner?.classList.add("hidden");
});
els.subagentWarningModalClose?.addEventListener(
    "click",
    closeSubagentWarningModal,
);
els.subagentWarningModalBackdrop?.addEventListener(
    "click",
    closeSubagentWarningModal,
);
els.subagentWarningModal?.addEventListener("click", (event) => {
    if (event.target === els.subagentWarningModal) {
        closeSubagentWarningModal();
    }
});
els.subagentWarningModalUpload?.addEventListener("click", () => {
    closeSubagentWarningModal();
    els.subagentFileInput?.click();
});
els.subagentWarningModalFolder?.addEventListener("click", () => {
    closeSubagentWarningModal();
    sessionLibrary.appendFolderUpload = true;
    els.replayFolder?.click();
});
els.subagentFileInput?.addEventListener("change", async (event) => {
    try {
        await handleReplaySelection(event.target.files || [], "files", true);
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

async function getFilesFromEntry(entry) {
    if (entry.isFile) {
        return new Promise((resolve) => {
            entry.file(
                (file) => resolve([file]),
                () => resolve([]),
            );
        });
    } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const files = [];

        const readEntriesBatch = () => {
            return new Promise((resolve) => {
                dirReader.readEntries(
                    async (entries) => {
                        if (entries.length === 0) {
                            resolve([]);
                        } else {
                            const childFilesPromises = entries.map((child) =>
                                getFilesFromEntry(child),
                            );
                            const results =
                                await Promise.all(childFilesPromises);
                            results.forEach((childFiles, index) => {
                                const child = entries[index];
                                childFiles.forEach((f) => {
                                    if (!f.webkitRelativePath) {
                                        Object.defineProperty(
                                            f,
                                            "webkitRelativePath",
                                            {
                                                value:
                                                    entry.name +
                                                    "/" +
                                                    (
                                                        child.fullPath ||
                                                        child.name
                                                    ).replace(/^\//, ""),
                                                writable: false,
                                                enumerable: true,
                                                configurable: true,
                                            },
                                        );
                                    }
                                });
                                files.push(...childFiles);
                            });
                            const nextBatch = await readEntriesBatch();
                            files.push(...nextBatch);
                            resolve(files);
                        }
                    },
                    () => resolve([]),
                );
            });
        };

        await readEntriesBatch();
        return files;
    }
    return [];
}

els.replayDropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    els.replayDropzone.classList.remove("dragover");

    const items = Array.from(event.dataTransfer?.items || []);
    if (items.length > 0) {
        const files = [];
        let hasFolder = false;
        for (const item of items) {
            if (item.kind === "file") {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    if (entry.isDirectory) {
                        hasFolder = true;
                    }
                    const entryFiles = await getFilesFromEntry(entry);
                    files.push(...entryFiles);
                }
            }
        }
        if (files.length > 0) {
            if (hasFolder) {
                try {
                    await handleDirectorySelection(files);
                } catch (error) {
                    window.alert(
                        error instanceof Error
                            ? error.message
                            : "Replay failed.",
                    );
                }
            } else {
                await handleSelectedFiles(files);
            }
        }
    } else {
        await handleSelectedFiles(Array.from(event.dataTransfer?.files || []));
    }
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
    if (
        event.key === "Escape" &&
        !els.configModal.classList.contains("hidden")
    ) {
        closeConfigModal();
        return;
    }
    if (
        event.key === "Escape" &&
        els.subagentWarningModal &&
        !els.subagentWarningModal.classList.contains("hidden")
    ) {
        closeSubagentWarningModal();
        return;
    }
    if (
        event.key === "Escape" &&
        !els.agentModal.classList.contains("hidden")
    ) {
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
                toggleButton.setAttribute(
                    "data-tooltip",
                    "Show Sidebar (Ctrl+B)",
                );
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
                toggleButton.setAttribute(
                    "data-tooltip",
                    "Hide Sidebar (Ctrl+B)",
                );
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
            const isCollapsed =
                workspace.classList.contains("sidebar-collapsed");
            setSidebarCollapsed(!isCollapsed);
        });
    }

    // Keyboard shortcut: Ctrl+B / Cmd+B to toggle sidebar
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
            e.preventDefault();
            const isCollapsed =
                workspace.classList.contains("sidebar-collapsed");
            setSidebarCollapsed(!isCollapsed);
        }
    });

    // Load initial sidebar collapsed state
    const savedSidebarCollapsed =
        localStorage.getItem("awv-sidebar-collapsed") === "true";
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
    els.sessionLibraryToggle.setAttribute(
        "aria-expanded",
        String(!isCollapsed),
    );
});

els.sessionSearchInput?.addEventListener("input", (event) => {
    sessionLibrary.searchQuery = event.target.value.toLowerCase().trim();
    if (sessionLibrary.searchQuery) {
        els.sessionSearchClear?.classList.remove("hidden");
    } else {
        els.sessionSearchClear?.classList.add("hidden");
    }
    renderSessionLibrary();
});

els.sessionSearchClear?.addEventListener("click", () => {
    if (els.sessionSearchInput) {
        els.sessionSearchInput.value = "";
    }
    sessionLibrary.searchQuery = "";
    els.sessionSearchClear?.classList.add("hidden");
    renderSessionLibrary();
});

renderSessionLibrary();
runProjectAnalyticsChecks();
void loadIndexedLogs();

loadState();
