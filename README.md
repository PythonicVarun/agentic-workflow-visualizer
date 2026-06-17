# Agentic Workflow Visualizer (Static Web Replay)

A browser-based, client-side visualizer for agentic workflows. Reconstruct user prompts, tool calls, tool outputs, sub-agent spawning, and final outputs in an interactive SVG graph by simply dragging and dropping a captured JSONL log file.

This branch (`gh-pages`) contains the standalone static web assets. No python backend, FastAPI server, or build step is required.

## 🚀 Features

- **📊 Interactive SVG Graph**: Visualizes branching, non-linear sub-agent workflows.
- **🪙 Token & Cost Summarization**: Displays a comprehensive **Session Summary** tab showing token counts and USD costs calculated client-side.
- **📁 Project Cost Dashboard**: Groups imported Codex sessions by working directory, shows per-project spend, and compares actual token usage against selected what-if model prices.
- **💾 Drag & Drop Replay**: Load any workflow log (.jsonl format) directly in the browser to replay it.
- **✨ Sleek Aesthetics**: Modern dark/light modes and smooth SVG interactions.

## 📂 File Structure

This static branch contains the following core files:

- `index.html`: The main user interface template.
- `graph.js`: The visualizer client logic, parser, and pricing engine.
- `model_pricing.json`: The model token pricing configurations.
- `style.css`: The styling system.
- `logs/`: Sample branching workflow log files for demonstration.

## 🖥️ How to Host & Run

Since the visualizer runs entirely in the browser, you can view it in two ways:

### Option A: Local File Browser

Simply open the `index.html` file in any modern web browser.

### Option B: Local Web Server

If you prefer to run a local web server (e.g. to avoid CORS warnings on some browsers):

```bash
# Using Python
python -m http.server 8000

# Using Node.js / npm
npx http-server -p 8000
```

Then visit `http://localhost:8000` in your browser.

## 🪙 Token & Cost Summarization

The visualizer supports tracking token usage and estimating the session cost in USD for the main agent and all spawned sub-agents. You can toggle the main playground view to the **Session Summary** tab to view the complete breakdown.

Model costs are calculated based on the token pricing defined in `model_pricing.json` (loaded dynamically by `graph.js`) using the following developer pricing structures:

- **OpenAI Models**: Pricing is retrieved from the official [OpenAI Developer Pricing](https://developers.openai.com/api/docs/pricing).
- **Google Gemini Models**: Pricing is retrieved from the official [Google Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing).
- **Anthropic Claude Models**: Pricing is retrieved from the official [Anthropic Claude Pricing](https://platform.claude.com/docs/en/about-claude/pricing).

For custom or local models where pricing is not known, the estimated cost defaults to `$0.00000`. You can configure or override custom model costs by editing the `model_pricing.json` file.

## Project Cost Dashboard

Choose **Choose Directory** and select a folder containing Codex session logs (typically `~/.codex/sessions`). Open **Project Analytics** to see every imported project and its sessions. A project is the normalized `cwd` recorded by Codex; sessions without a working directory are grouped under **Unknown project**.

The dashboard deliberately separates data quality:

- **Actual** sessions contain native Codex `token_count` records. Their costs contribute to project totals and the what-if model comparison.
- **Estimated-only** sessions do not contain token usage. They are listed for visibility but excluded from total and what-if costs, rather than presenting synthesized values as spend.

Select one or more models in the dashboard to price each project's recorded input and output token totals using `model_pricing.json`. These comparisons cover token rates only. They do not include cached-input, reasoning, tool, regional, batch, priority, or other provider-specific charges. Imported data stays in the current browser session; this static app does not upload logs or provide a shared team database.

## 🔄 Replaying a Workflow

To visualize a saved log file:

1. Open `index.html` in your browser.
2. Drag and drop any `.jsonl` log file (such as the sample logs in the `logs/` folder) directly onto the visualizer.
3. The graph and summary will load immediately.
