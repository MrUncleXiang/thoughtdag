<div align="center">

<img src="public/favicon.svg" width="72" alt="ThoughtDAG logo"/>

# ThoughtDAG

**让 AI 对话在画布上展开。**

问答是节点，**连线即上下文。**<br/>
沿着支线追问，把有用的思路接在一起，决定模型下一次看到什么。

[下载](https://chenxiachan.github.io/thoughtdag/?lang=zh#download) · [官网](https://chenxiachan.github.io/thoughtdag/?lang=zh) · [文档](https://chenxiachan.github.io/thoughtdag/docs/zh/) · [English](./README.md)

![License](https://img.shields.io/badge/许可-MIT-green)

</div>

[0.5 更新](#05-更新--thoughtdag--jev) · [CLI](#从命令行找回历史上下文) · [Harness](#在-deepseek-harness-里使用) · [桌面版](#桌面版) · [连线规则](#唯一法则) · [产品对比](#与其他工具有什么不同) · [研究](#-研究为什么上下文需要可编辑)

## 0.5 更新 · ThoughtDAG × Jev

**从旧对话中，找出当前问题用得上的内容。**

- **找回旧讨论。** 本地索引检索已支持的 Agent 会话和 ThoughtDAG 画布；主题档案整理已有决定和待解决的问题，保留出处。
- **筛选相关内容。** 可选的 **Jev 判断层**识别主题、筛选相关片段，你选择的语言模型负责展开回答。
- **核对后继续。** 开启回忆后，上下文面板会列出本轮引入的档案和片段。可以打开原文，也可以排除不想带入的内容。

<img src="docs/jev-relevance-en.gif" width="100%" alt="相关性筛选小样本测试的动画回放：Jev 中位耗时 391 毫秒，开启默认推理的 GLM 判断适配器为 24,813 毫秒；结尾为历史节点汇入 Jev。不代表端到端检索耗时。"/>

在一组小样本相关性筛选测试中，Jev 的中位耗时为 **391 毫秒**，GLM 适配器为 **24,813 毫秒**。这里测的是筛选这一步，不是从搜索到生成回答的总耗时。

<details>
<summary>这组速度数字测了什么？</summary>

同一组 14 条合成片段，每个引擎运行 6 次。筛选中位耗时：Jev-1.13 为 **391 毫秒**；开启默认推理的 GLM-5.3-Flash 判断适配器为 **24,813 毫秒**。两者推理路径不同，不是严格控制变量的模型速度排名。计时不含检索和回答生成，也不代表整个产品的加速或准确率提升。

不开启判断模型时，回忆按规则筛选。这里的 **System 1 / System 2 式分工**，指快速判断层筛选材料，语言模型展开回答、整理主题档案；是软件职责的划分，不代表复现了人的认知。

</details>

[设置历史索引与回忆](https://chenxiachan.github.io/thoughtdag/docs/zh/guides/memory) · [配置 Jev](https://chenxiachan.github.io/thoughtdag/docs/zh/setup#decision-model)

## 从命令行找回历史上下文

记得一个文件、一句话或网址，却忘了在哪次对话里？不必打开桌面版，也能从本地历史中找到对应的原始轮次。

```bash
npx thoughtdag why src/lib/api.ts           # 哪些对话讨论过这个文件
npx thoughtdag find "记得的一句话"            # 找到对应的对话轮次
npx thoughtdag topics                       # 查看本地索引中的主题
```

经常使用可以 `npm install -g thoughtdag`，再运行 `thoughtdag setup mcp`，让 Agent 调用只读历史工具。找回需要的几轮，而不是重新塞入整段会话。[CLI 说明 →](cli/README.md)

## 在 DeepSeek Harness 里使用

在 Harness 内切换对话与思维图：用画布选择上下文，再由 Harness 执行下一轮。

桌面版 Harness（0.2.0-rc.2 起）：打开「插件」页，搜索 `dsh-thoughtdag` 安装，装完重启 Harness。刚发布的版本要写明版本号 `dsh-thoughtdag@<版本号>`（pnpm 默认压住发布不满 24 小时的版本）。网页版用命令行：

```bash
dsh plugin --profile web add dsh-thoughtdag
dsh web
```

插件自带画布和记忆层。需要 Node 22.19+（22.x）或 24+，以及 DeepSeek Harness 0.1.2-rc.1 或更新版本。[插件说明 →](https://chenxiachan.github.io/thoughtdag/docs/zh/guides/deepseek-harness)

<img src="docs/harness-plugin-zh.gif" alt="在 DeepSeek Harness 中切换到 ThoughtDAG 画布，提问并从回答继续展开新节点。" width="100%"/>

## 桌面版

一边看资料，一边展开对话。从一段原文追问，把需要一起考虑的支线接起来；模型由你选择。

```bash
brew install --cask thoughtdag
```

或[下载 macOS、Windows、Linux 版本](https://chenxiachan.github.io/thoughtdag/?lang=zh#download)，连接模型后打开示例画布。

<img src="docs/hero-demo-zh.gif" width="100%" alt="ThoughtDAG 实际操作：从资料提问、展开对话支线，并修改传递上下文的连线。"/>

<p align="center"><a href="https://github.com/user-attachments/assets/f0362497-0e80-4caa-8214-cdbac92ab77c"><img src="https://img.youtube.com/vi/-8BqAyaoNXQ/maxresdefault.jpg" alt="ThoughtDAG 官方视频缩略图，点击观看中文讲解" width="640"/></a></p>

<p align="center"><a href="https://github.com/user-attachments/assets/f0362497-0e80-4caa-8214-cdbac92ab77c">▶ 观看 33 秒中文讲解</a></p>

## 唯一法则

> **连线即上下文。** 把需要的对话路径接入下一问；断开连线，不必删除之前的探索。

从回答里的一个细节另开支线，想清楚以后，再把有用的部分接回后面的提问。你修改的不只是画布布局，还有模型收到的内容。

**发送前，检查模型实际会收到什么。** 连线选择对话路径，显式引用和开启的回忆还会补充材料。[上下文操作说明 →](https://chenxiachan.github.io/thoughtdag/docs/zh/guides/context-control)

## 它长什么样

<table><tr>
<td width="45%"><img src="docs/illus/prune-zh.svg" alt="研究路径仍连接到总结节点，无关的晚餐支线已断开，但节点仍留在画布上。"/></td>
<td width="55%">

### ✂️ 调整上下文，保留探索

选中回答中的文字，另开支线追问。不想让这条支线参与后面的回答，就断开对应连线，再生成一次作比较。节点仍在画布上，可以继续探索，也可以重新接回。

</td></tr></table>

<table><tr><td width="55%">

### 📖 边读、边摘、边问

在对话旁打开 PDF、图片或 HTML。选一段原文提问，或把一张图摘成独立节点。PDF 摘录保留页码，讨论到哪里，都能回到原文核对。

</td>
<td width="45%"><img src="docs/illus/reading-zh.svg" alt="选中 PDF 中的一段原文提问，并保留第 3 页的出处。"/></td>
</tr></table>

<table><tr>
<td width="45%"><img src="docs/illus/map-zh.svg" alt="对话节点缩成简洁的要点卡片，显示决定、排除和方向变化。"/></td>
<td width="55%">

### 💎 凝练对话，编织成文

**凝练**把对话路径缩成更短的副本，原始探索仍然保留；**编织**把选中的高光整理成带引用的文字。结果可以接着聊，也可以导出 Markdown。缩放只改变展示，不改变上下文。

</td></tr></table>

<table><tr><td width="55%">

### 🧭 Session Atlas：接着以前的对话往下想

把已支持的本地 Agent 会话打开成图，选择从哪里分叉、继续。需要其他会话里的内容时，再用历史索引找回。Atlas 负责看清会话，回忆帮你找到要带进来的内容。

*目前支持本地 Claude Code、Codex、DeepSeek Harness 和 Pi 会话，原始会话保持只读。*

</td>
<td width="45%"><img src="docs/illus/atlas-zh.svg" alt="按项目整理本地 Agent 会话，打开成上下文图，再从选定的位置继续。"/></td>
</tr></table>

## 与其他工具有什么不同

看起来都在用节点和连线，解决的问题却不一样：

| 产品类别 | ThoughtDAG 侧重什么 |
|---|---|
| 线性聊天 | 同时保留几条探索路径，选择哪些进入下一问。 |
| 思维导图、白板 | 连线不仅整理思路，也改变模型收到的内容。 |
| 分支聊天画布 | 把多条支线接入同一问，或断开某条路径而保留节点。 |
| Agent 工作流画布 | 随着讨论修改上下文，而不是编排自动执行的任务流程。 |
| 检索与自动记忆 | 核对带出处的档案和片段，编辑或排除下一轮不需要的内容。 |
| 代码关系图、对话搜索 | 跨已支持的 Agent 找到文件或主题背后的讨论，再从那里继续。 |
| Harness 上下文查看器 | 不止查看本轮内容，还能组合并发送下一轮。 |

这些类别并不互斥，具体产品也可能有相似能力。ThoughtDAG 不是自主研究 Agent，也不替代你的编程 Harness。检索可能遗漏信息，模型整理的档案仍需要核对。

## 🗺️ 导出你的思路地图

把画布导出为 Thought Map：保留节点、连线和结构统计，不包含完整问答正文。可以用它分享一次探索如何分叉、收敛，又在哪里汇合。

<img src="docs/thought-map-four-zh.png" alt="四张思路地图，展示从单线追问到多分支文献探索的不同结构。" width="100%"/>

## 更多运行方式

### 从源码运行

```bash
npm install
npm run server    # 模型代理 :3001
npm run dev       # 前端 :5173
```

在应用内或通过环境变量配置模型。[本地配置 →](docs/setup_ZH.md)

### 在线体验

[浏览器 Demo](https://app.thoughtdag.workers.dev) 的示例画布免 API key。它是功能子集：本机会话发现、Session Atlas 和本地历史／记忆层需要桌面版或本地环境。

## 🧪 研究：为什么上下文需要可编辑

### 上下文干预基准 · Pilot v2

`9 个模型端点` · `1,485 次测试` · `精确匹配评分`

删掉错误源头，不代表后续回答里的错误也消失了。在这组合成任务中，162 组原本答对、被污染后答错的测试里，只删源头修复了 **152 组**，删除受污染子图修复了 **162 组**，重算后续节点修复了 **161 组**。报告公开了方法、结果与局限；这是上下文干预实验，不是通用模型排行榜。

[阅读案例](https://chenxiachan.github.io/thoughtdag/stories/context-repair/?lang=zh) · [方法与结果（英文）](https://chenxiachan.github.io/thoughtdag/research/context-repair-pilot-v2/) · [建议下一批测试模型](https://github.com/chenxiachan/thoughtdag/issues/new?template=suggest-next-model.yml)

## 更多能力

| 能力 | 如何帮助你继续工作 |
|---|---|
| 请求预览 | 发送前查看本轮组装的对话、引用和回忆材料。 |
| 过期标记与重算 | 修改上游内容后，检查依赖它的回答，按依赖顺序重新生成。 |
| 节点级模型选择 | 在一条支线上换模型，不必更改整张画布。 |
| 只读分享 | 让别人查看图中的探索；发布前可以检查分享内容。 |
| 文件夹备份 | 把画布保存为本地文件，在浏览器存储之外保留可恢复的副本。 |

[完整功能与路线图 →](docs/features_ZH.md)

## 模型、成本与隐私

画布、文档、索引和档案保存在本机。**调用远程模型时，相关内容会发送到你配置的服务**，判断和档案生成也不例外。服务商可能收费，关闭 Jev 不等于关闭普通模型调用。

可以接入本地 Ollama 或兼容 OpenAI 协议的端点；在 DeepSeek Harness 内，推理由 Harness 的服务配置和密钥处理。支持备份和 Markdown 导出，公开分享前请检查正文及元数据。[配置与隐私说明 →](docs/setup_ZH.md)

## 贡献者

<a href="https://github.com/KehanLiu" title="@KehanLiu"><img src="https://github.com/KehanLiu.png?size=80" width="40" height="40" alt="@KehanLiu" /></a>
<a href="https://github.com/nasodaengineer" title="@nasodaengineer"><img src="https://github.com/nasodaengineer.png?size=80" width="40" height="40" alt="@nasodaengineer" /></a>
<a href="https://github.com/hexu321" title="@hexu321"><img src="https://github.com/hexu321.png?size=80" width="40" height="40" alt="@hexu321" /></a>
<a href="https://github.com/Moya-Doc" title="@Moya-Doc"><img src="https://github.com/Moya-Doc.png?size=80" width="40" height="40" alt="@Moya-Doc" /></a>
<a href="https://github.com/nanami-0713" title="@nanami-0713"><img src="https://github.com/nanami-0713.png?size=80" width="40" height="40" alt="@nanami-0713" /></a>
<a href="https://github.com/LHN-xiao-hai-tun" title="@LHN-xiao-hai-tun"><img src="https://github.com/LHN-xiao-hai-tun.png?size=80" width="40" height="40" alt="@LHN-xiao-hai-tun" /></a>
<a href="https://github.com/HarveyZed" title="@HarveyZed"><img src="https://github.com/HarveyZed.png?size=80" width="40" height="40" alt="@HarveyZed" /></a>
<a href="https://github.com/Pireirik" title="@Pireirik"><img src="https://github.com/Pireirik.png?size=80" width="40" height="40" alt="@Pireirik" /></a>
<a href="https://github.com/suhyungJang" title="@suhyungJang"><img src="https://github.com/suhyungJang.png?size=80" width="40" height="40" alt="@suhyungJang" /></a>

欢迎参与贡献，从 [CONTRIBUTING_ZH.md](./CONTRIBUTING_ZH.md) 开始。

## 支持者

感谢首位支持者 **@andreilaiter**，也感谢每一位帮助这个独立开源项目继续成长的人。

<a href="https://buymeacoffee.com/chatchan92"><img src="docs/supporters/support-thoughtdag.svg" alt="支持 ThoughtDAG" width="252" /></a>

---

<div align="center">

[MIT](./LICENSE) © 2026 Xia Chen · [Roadmap](docs/features_ZH.md#roadmap) · [反馈](https://github.com/chenxiachan/thoughtdag/issues) · [引用](https://github.com/chenxiachan/thoughtdag#cite-this-repository)

</div>
