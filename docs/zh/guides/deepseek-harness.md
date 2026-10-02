---
title: 在 DeepSeek Harness 中使用 ThoughtDAG
---

# 在 DeepSeek Harness 中使用 ThoughtDAG

插件把 ThoughtDAG 画布嵌入 Harness 网页界面。你在图上整理下一轮的上下文，Harness 负责执行；也可以通过 Agent 对话地图浏览 Claude Code、Codex、Pi 和 Harness 的会话。

## 安装

前提：已安装并配置 DeepSeek Harness **0.1.2-rc.1 或更新版本**，使用 Node.js **22.19+（22.x）或 24+**。

**桌面版 Harness**（0.2.0-rc.2 起）：打开「插件」页，在列表里搜索 `dsh-thoughtdag`，点安装。装完**重启一次 Harness**，插件在启动时加载。之后对话页的标签行（对话 · 轨迹 · 记忆系统）末尾多一个「对话 | 思维图」开关，切到思维图就是画布；mac 上画布打开时标题行里也有同一个开关。

**网页版**用命令行：

```bash
dsh plugin --profile web add dsh-thoughtdag
dsh web
```

打开 `dsh web` 输出的地址，在聊天顶部选择 **思维图**。需要返回聊天时，选择 **对话**。

**刚发布的版本要点名安装。** `dsh plugin` 底层运行 pnpm，pnpm 默认压住发布不满 24 小时的版本，桌面版和网页版都一样：插件列表里看得到新版本号，不点名却会装到前一天的版本。想在发版当天装到新版，直接写版本号：桌面版在添加插件处输入 `dsh-thoughtdag@<版本号>`，网页版 `dsh plugin --profile web add dsh-thoughtdag@<版本号>`（桌面版的配置名是 `desktop`，同一条命令换成 `--profile desktop` 也能从命令行给桌面版装）。每个 Release 的 GitHub 资产里也附带插件文件 `dsh-thoughtdag-<版本>.tgz`，同一条命令接受这个文件的链接或本地路径。

**更新**：桌面版在插件页重新添加 `dsh-thoughtdag@<版本号>`，然后重启 Harness；网页版 `dsh plugin --profile web add dsh-thoughtdag@latest`。画布里出现新版本提示时，提示里写的就是这一步。

插件已包含画布，**无需另装 ThoughtDAG 桌面版、CLI 或 MCP**。模型与工具沿用你的 Harness 配置。

## 运行方式字典

在画布的模型选择器中选择运行方式：

| 选择 | 执行方式 | 结果保存在哪里 |
|---|---|---|
| Harness 提供的普通模型 | 直接调用该模型生成回答，不运行完整 Agent 工具循环 | ThoughtDAG 画布 |
| **DeepSeek Harness · Agent** | 由 Harness 执行真实 Agent 轮次，可按 Harness 配置使用工具 | 画布与 Harness 会话日志 |
| 在已镜像的 Harness 会话链尾，以 Agent 方式继续追问 | 续接对应的 Harness 会话 | 原 Harness 会话新增轮次，画布同步结果 |

选择普通模型不等于执行 Harness Agent。若希望使用工具并保留真实会话轮次，请选择 **DeepSeek Harness · Agent**。

## 例子：从一个回答继续探索

下面是实际操作录屏：

<video controls playsinline muted preload="metadata" src="/media/harness-user-take-zh.mp4" style="width:100%;border-radius:8px" aria-label="在 Harness 中切换思维图、继续追问并选文探索"></video>

1. 在 Harness 顶部从 **对话** 切换到 **思维图**，打开已有节点。
2. 双击第一个问答节点，在右侧面板阅读完整回答。
3. 在面板下方输入追问并发送。回答会形成第二个节点，与上一节点相连。
4. 在第二个回答中选中想深入了解的文字，选择 **探索**。
5. 新问题与回答形成第三个节点。检查连线，确认后续问题要接收哪些上下文。

普通模型与 Agent 方式都可以生成画布节点；是否进入 Harness 会话日志，取决于上表中的运行方式，而不是节点是否出现。

## 上下文与会话

### 哪些内容进入下一轮

连到问题上的上游节点、已启用的材料和笔记会作为上下文。断开一条边，会将对应分支排除出该路径的下游模型上下文；节点仍留在画布上，可以继续生长或重新连接。

添加 PDF、在阅读器中摘取文字并连接材料的方法，与独立应用相同，参见[材料节点与阅读器](./materials)和[控制上下文](./context-control)。

### 新增轮次，不改写旧历史

编辑或删除镜像节点，只改变画布，不会改写已经存在的 Harness 会话日志。通过 Agent 方式发送追问，则是在 Harness 中执行并记录一个**新轮次**。

需要浏览其他会话时，从画布菜单进入 [Agent 对话地图](./session-atlas)。插件能访问的是运行 Harness 的机器上的受支持会话，不是任意浏览器客户端的文件。

## 查询历史

已发布的 `dsh-thoughtdag@0.5.3` 包含画布、会话集成和下面的原生历史查询工具。如果仍在使用 `0.4.4`，请更新插件以使用这些工具与 `/why` 命令。如果还需要独立的历史查询工具，参见 [Why 层：CLI 与 MCP](./why-layer)。

| 工具 / 命令 | 参数 | 作用 |
|---|---|---|
| `why_check` | `path` | 先检查对象是否有历史 |
| `why_file` | `path`，可选 `include_read`、`limit` | 返回相关轮次与观察到的改动 |
| `why_find` | `phrase`，可选 `in`、`limit` | 精确查找问题、回答或材料中的词句 |
| `why_recall` | `session`、`turn` | 读取一个完整轮次 |
| `/why <path\|url\|arxiv:id>` | 文件路径、网址或论文标识 | 直接查询，不额外发送模型消息 |

原生工具与 CLI 共享 `~/.thoughtdag` 索引。相对路径按当前 Harness 会话的工作目录解析；`why_find` 不是语义搜索，候选解释也不等于已核验的原因。

插件默认启用原生查询工具和“改文件前检查历史”的提示规则。插件配置中的 `whyPrompt: false` 可关闭提示规则；`whyTools: false` 则关闭这些工具、`/why` 及相关提示。具体输出标记参见 [Why 手册](./why-layer#输出标记字典)。

## 常见问题

| 问题 | 先检查什么 |
|---|---|
| 顶部没有“思维图” | 桌面版：安装后重启 Harness，并确认 Harness 不低于 0.2.0-rc.2。网页版：是否使用 `--profile web` 安装；安装后重新启动 `dsh web` 并刷新页面；检查 Harness 版本与启动日志 |
| 插件列表显示新版本，装上却是旧版本 | pnpm 的 24 小时保护，见「安装」一节，点名版本号安装 |
| 看不到预期模型 | Harness 中是否已配置相应模型和凭证 |
| 节点有回答，但 Harness 日志没有新轮次 | 是否选择了普通模型；需要日志与工具执行时选择 Agent 方式 |
| Atlas 没找到其他工具的会话 | 对应日志是否位于 Harness 所在机器上，且属于受支持格式 |
| 安装后没有 `/why` | `0.4.4` 不包含原生查询工具，见上面的发布状态说明 |

本地索引不代表检索结果永远不离开设备：当 Agent 把结果用于远程模型请求时，命中的历史内容可能随请求发送。存储与删除方式见[隐私与存储](../reference/privacy-storage)。
