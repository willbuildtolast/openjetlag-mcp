# OpenJetLag MCP

**让你的个人 AI 助手变成倒时差教练。**

OpenJetLag 是一个开源的 [MCP](https://modelcontextprotocol.io)（Model Context Protocol）服务器。把它连接到 Meta Muse、ChatGPT、Claude 或任何支持 MCP 的 agent，告诉它你的航班，它就能拿到一份基于生物节律科学的逐日计划：什么时候晒太阳或避光、什么时候睡觉、什么时候停止咖啡因、什么时候不要午睡，以及可选的褪黑素服用时机。计划从出发前几天开始，一直到你的生物钟和目的地对齐。每个事项都有精确时间，agent 可以主动提醒你。

```
你 ──▶ 你的 agent（Muse、ChatGPT、Claude……）──MCP──▶ OpenJetLag 服务器 ──▶ @openjetlag/core 引擎
       对话、记忆、提醒                            无状态，不存任何数据            纯计算
```

对话、记忆和提醒由你的 agent 负责，本项目只提供专业能力：一个确定性的计划引擎，以及告诉 agent 如何使用它的指引。

## 连接到你的 agent

**官方地址：**

```
https://openjetlag-mcp.willbuildtolast.workers.dev/mcp
```

这是本项目维护的唯一官方地址。你也可以[自己部署](#自行部署)（Cloudflare 免费额度即可）。

### Meta Muse 一句话安装

把下面这段发到 Muse 的对话框，Muse 请求确认时点同意即可：

```
请帮我添加一个自定义 MCP 连接器：
- 名称：OpenJetLag
- 传输方式：远程 Streamable HTTP
- URL：https://openjetlag-mcp.willbuildtolast.workers.dev/mcp
- 认证：无（不需要登录）
连接成功后，每当我提到长途航班或倒时差时都使用它。
```

然后试试：*"我 11 月 10 日 19:00 从纽约飞伦敦，11 日 07:00 落地，平时 23:00 睡 7:00 起，帮我倒时差，并设置好提醒。"* 以后想移除：设置 → Connectors。

| Agent | 方法 |
|---|---|
| **Meta Muse** | 设置 → Connectors → Add custom connector，粘贴地址。Muse 从 Meta 云端连接，地址必须是公网 HTTPS。 |
| **ChatGPT / Dots** | 在 ChatGPT 设置中添加自定义 MCP 连接器（app）；是否可用取决于你的套餐，可能需要开启开发者模式。Dots 使用账号上已连接的连接器。 |
| **Claude** | 设置 → Connectors → Add custom connector，粘贴地址。 |
| **其他 MCP 客户端** | Streamable HTTP 传输，地址以 `/mcp` 结尾，无需认证。 |

然后直接说：*"我 12 月 18 日 10 点从上海飞伦敦，当地 15 点落地，帮我倒时差。"*

**Agent Skill（可选，推荐）：** [`skills/openjetlag/SKILL.md`](skills/openjetlag/SKILL.md) 采用开放的 [Agent Skills](https://agentskills.io) 格式，教 agent 如何当好教练：该问什么、怎么呈现计划、怎么设置提醒和回访。支持 skill 的 agent 可以直接安装这个文件夹。服务器也会通过 MCP instructions 发送精简版指引，所以不支持 skill 的 agent 也能正确使用。

## 工具

所有工具都是只读、幂等的。

| 工具 | 作用 |
|---|---|
| `plan_jetlag_trip` | 根据航班和平时作息生成完整计划，以及 `scheduled_messages`：每天约 3-4 条主动消息（晨间简报、光照提醒、睡前收尾、登机提醒），带精确发送时间和每条背后的事实（旅程阶段、生物钟进度、做什么、为什么），由 agent 用自己的语气撰写并按时在对话中发送。传入 `starting_from` 可只返回之后的事项（用于"我现在该做什么？"）。可选参数 `origin_city`、`destination_city` 传入用户习惯的城市名。 |
| `get_plan_calendar_file` | 用户要求日历文件、或 agent 无法定时发消息时，把计划导出为带提醒的 iCalendar（.ics）文件。 |
| `explain_jetlag_topic` | 回答"为什么"的简短科普：原理概述、光照、褪黑素、咖啡因、午睡、飞行方向、飞行途中、安全。 |

## 隐私

- **无状态：** 每次请求算完即丢，没有数据库、账号或 cookie。
- **不记录内容：** 服务器不记录工具参数（航班、作息）和结果。
- 对话内容由你的 agent 提供方按其隐私政策处理，本服务器只能看到 agent 在工具调用中发送的行程信息。

本项目提供的是**教育性建议，不构成医疗建议**。计划不会给出褪黑素剂量，每次返回都附带安全提示供 agent 展示。

## 自行部署

**Cloudflare Workers**（免费计划每天 10 万次请求）：

```sh
git clone https://github.com/willbuildtolast/openjetlag-mcp && cd openjetlag-mcp
npm install
npx wrangler login
npm run deploy
```

MCP 地址为输出的网址加上 `/mcp`。**详细的图文步骤（含推送自动部署、用量查看、自定义域名）见 [docs/DEPLOY.zh-CN.md](docs/DEPLOY.zh-CN.md)。**

**Node.js**（Node 20+）：`npm install && npm run build`，然后 `PORT=8787 HOST=0.0.0.0 npm start -w @openjetlag/mcp-server`。连接云端 agent 前请配置 HTTPS。

## 开发

```sh
npm install
npm test          # 引擎单元测试 + 端到端 MCP 协议测试
```

更多细节见[英文 README](README.md) 和[引擎说明](packages/core/README.md)。

## 许可证

[MIT](LICENSE)
