---
title: Use ThoughtDAG inside DeepSeek Harness
---

# Use ThoughtDAG inside DeepSeek Harness

The plugin embeds the ThoughtDAG canvas in the Harness web UI. Compose the next turn's context on the graph and let the harness execute it. Session Atlas also lets you explore Claude Code, Codex, Pi, and Harness conversations.

## Install

Prerequisites: a configured DeepSeek Harness installation, **0.1.2-rc.1 or later**, with Node.js **22.19+ (22.x) or 24+**.

**Desktop Harness** (0.2.0-rc.2 or later): open the **Plugins** page, search the list for `dsh-thoughtdag`, and install it. Then **restart Harness once**; plugins load at launch. A **Chat | Thought graph** switch then sits at the end of the conversation's tab row (chat · trajectory · memory), and the thought graph is the canvas; on macOS the same switch also lives in the title row while the canvas is open.

**Web profile**, from the command line:

```bash
dsh plugin --profile web add dsh-thoughtdag
dsh web
```

Open the address printed by `dsh web`. Above the chat, switch to the thought-graph view; select the chat view to return.

**A fresh release needs its version named.** `dsh plugin` runs pnpm, and pnpm holds back versions published within the last 24 hours, on the desktop as on the web: the plugin list shows the new version number, but an install without a version lands on the previous day's. To install a release the day it ships, write the version: on the desktop enter `dsh-thoughtdag@<version>` where you add the plugin; on the web run `dsh plugin --profile web add dsh-thoughtdag@<version>` (the desktop's profile is named `desktop`, so the same command with `--profile desktop` installs into the desktop app from the command line). Every release also carries the plugin as `dsh-thoughtdag-<version>.tgz` in its Assets on GitHub; the same command takes that file's URL or a local path.

**Updating**: on the desktop, add `dsh-thoughtdag@<version>` again from the Plugins page and restart Harness; on the web, `dsh plugin --profile web add dsh-thoughtdag@latest`. When the canvas shows an update notice, the notice carries this step.

The plugin includes the canvas. **No separate ThoughtDAG desktop app, CLI, or MCP installation is required.** Models and tools use your Harness configuration.

## Execution reference

Choose how to run a question in the canvas model picker:

| Selection | Execution | Where the result is stored |
|---|---|---|
| A regular model provided by Harness | Calls the model directly; does not run the full agent tool loop | ThoughtDAG canvas |
| **DeepSeek Harness · Agent** | Runs a real harness turn, with tools as configured in Harness | Canvas and Harness session log |
| An Agent follow-up at the tail of a mirrored Harness session | Continues the corresponding Harness session | A new turn in that session, with the result reflected on the canvas |

Selecting a regular model is not the same as running the Harness Agent. Choose **DeepSeek Harness · Agent** when you want tool execution and a recorded harness turn.

## Example: explore an answer

This is a recording of the actual interface:

<video controls playsinline muted preload="metadata" src="/media/harness-user-take-en.mp4" style="width:100%;border-radius:8px" aria-label="Switch to the thought graph, ask a follow-up, and explore selected text in Harness"></video>

1. Switch from chat to the thought graph in Harness and open an existing node.
2. Double-click the first question-and-answer node to read its full answer in the right panel.
3. Type a follow-up in the panel's lower input and send it. The answer grows into a second, connected node.
4. Select a passage in the second answer and choose **Explore**.
5. The new question and answer form a third node. Check its incoming wires to decide what the next question receives.

Both regular models and Agent mode can create canvas nodes. Whether a turn enters the Harness log depends on the execution mode above, not on whether a node appears.

## Context and sessions

### What reaches the next turn

Upstream nodes, enabled materials, and notes wired into the question become its context. Disconnecting an edge excludes that branch from downstream model context along that path. The nodes remain active on the canvas and can grow or reconnect.

PDF import, text extraction, and material wiring work as in the standalone app. See [Material nodes and reader](./materials) and [Control context](./context-control).

### Append a turn; do not rewrite history

Editing or deleting a mirror node changes the canvas, not an existing Harness session log. Sending through Agent mode executes and records a **new turn** in Harness.

Open [Session Atlas](./session-atlas) from the canvas menu to browse other conversations. The plugin accesses supported sessions on the machine running Harness, not arbitrary files on a browser client.

## Query history

The published `dsh-thoughtdag@0.5.3` includes the canvas, session integration, and native history-query tools below. If you still use `0.4.4`, update the plugin to use these tools and the `/why` command. For standalone history queries, see [Why layer: CLI and MCP](./why-layer).

| Tool / command | Parameters | Purpose |
|---|---|---|
| `why_check` | `path` | Check whether an object has history |
| `why_file` | `path`; optional `include_read`, `limit` | Retrieve related turns and observed changes |
| `why_find` | `phrase`; optional `in`, `limit` | Find exact words in questions, answers, or materials |
| `why_recall` | `session`, `turn` | Read one complete turn |
| `/why <path\|url\|arxiv:id>` | File path, URL, or paper identifier | Query directly without sending another model message |

Native tools share the CLI's `~/.thoughtdag` index. Relative paths resolve against the current Harness session's working directory. `why_find` is not semantic search, and candidate explanations are not verified causes.

The plugin enables native tools and a check-history-before-editing prompt by default. Plugin configuration `whyPrompt: false` disables the prompt; `whyTools: false` disables the tools, `/why`, and their prompt. See the [Why manual](./why-layer) for output markers.

## Troubleshooting

| Symptom | Check first |
|---|---|
| No thought-graph switch | Desktop: restart Harness after installing, and check that Harness is 0.2.0-rc.2 or later. Web: install with `--profile web`, restart `dsh web`, and refresh; check the Harness version and startup logs |
| The plugin list shows a new version, but an older one gets installed | pnpm's 24-hour hold; see Install above and name the version |
| A model is missing | Check its model configuration and credentials in Harness |
| An answer appears on the canvas but not in the Harness log | Check whether you selected a regular model; use Agent mode for tool execution and a recorded turn |
| Atlas cannot find another tool's sessions | Check that the logs are on the Harness host and use a supported format |
| `/why` is missing after installation | Version `0.4.4` does not include native query tools; see the release note above |

A local index does not mean retrieved content can never leave the device. When an agent uses results in a remote model request, the matching history may be sent with that request. See [Privacy and storage](../reference/privacy-storage).
