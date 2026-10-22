# 部署指南：把 OpenJetLag MCP 部署到 Cloudflare Workers

完成后你会得到一个公网地址，例如 `https://openjetlag-mcp.<你的子域名>.workers.dev/mcp`，可以直接添加到 Meta Muse、ChatGPT、Claude 等 agent。全程使用 Cloudflare 免费计划，约 20 分钟。

## 0. 准备

- **Node.js 20 或以上：** 终端运行 `node -v` 检查。没有的话从 https://nodejs.org 安装 LTS 版本。
- **Git：** 终端运行 `git --version` 检查。
- **Cloudflare 账号：** 在 https://dash.cloudflare.com/sign-up 用邮箱注册并完成邮箱验证。使用 Workers 免费计划不需要绑定信用卡。

## 1. 获取代码并本地验证

```sh
git clone https://github.com/willbuildtolast/openjetlag-mcp.git
cd openjetlag-mcp
npm install          # 安装依赖（只需第一次）
npm test             # 运行全部测试，应显示全部通过
```

**可选：在本地跑起来看看**

```sh
npm run dev
# 终端会显示：OpenJetLag MCP server listening on http://127.0.0.1:8787/mcp
```

另开一个终端，用官方调试工具 MCP Inspector 连接：

```sh
npx @modelcontextprotocol/inspector
```

在浏览器打开的页面里添加一个服务器，类型选 **Streamable HTTP**，URL 填 `http://127.0.0.1:8787/mcp`，然后连接并列出工具，就能看到三个工具并手动调用。界面因版本而异：

- **v2（服务器卡片界面）：** 点 **Add Servers** 手动添加；或者在自带的 HTTP 示例卡片上点 **Clone**，再点 **Edit** 改名字和 URL。然后拨动卡片右上角的开关连接，进入该服务器查看 Tools。
- **旧版：** 把 Transport Type 选为 **Streamable HTTP**，填 URL 后点 **Connect**，再到 **Tools** 标签点 **List Tools**。

测试完在运行 `npm run dev` 的终端按 `Ctrl+C` 停止本地服务。

## 2. 第一次部署

```sh
npx wrangler login
```

浏览器会打开 Cloudflare 授权页面，点 **Allow**，回到终端看到登录成功即可。然后在仓库根目录运行：

```sh
npm run deploy
```

- 如果这是账号的第一个 Worker，wrangler 可能会提示你先注册一个 `workers.dev` 子域名。按提示输入一个名字即可，也可以在 Cloudflare 控制台的 **Workers & Pages** 页面设置。
- 部署成功后，终端会输出网址，例如 `https://openjetlag-mcp.<你的子域名>.workers.dev`。
- **你的 MCP 地址就是这个网址加上 `/mcp`。**

## 3. 验证线上服务

```sh
curl https://openjetlag-mcp.<你的子域名>.workers.dev/health
# 应返回 {"ok":true,"server":"0.1.0","engine":"0.2.0"}
```

再用 MCP Inspector 连接线上地址（同第 1 步，URL 换成线上的 `/mcp` 地址），调用一次 `plan_jetlag_trip`，确认能正常返回计划。

## 4. 添加到你的 agent

| Agent | 操作 |
|---|---|
| Meta Muse | 设置 → Connectors → Add custom connector，粘贴 MCP 地址 |
| Claude | 设置 → Connectors → Add custom connector，粘贴 MCP 地址 |
| ChatGPT | 在设置中添加自定义 MCP 连接器（可能需要开启开发者模式，取决于套餐） |

添加后发一句："我下周四 11:30 从旧金山飞东京，周五 15:05 落地，平时 23:30 睡 7:30 起，帮我倒时差。"

## 5. 以后怎么更新

**方式 A：手动部署。** 改完代码后：

```sh
git pull             # 拉取最新代码
npm test
npm run deploy
```

**方式 B：推送即自动部署（推荐）。** 仓库已包含 `.github/workflows/deploy.yml`：每次推送到 `main`，测试通过后会自动部署。只需配置一次两个密钥：

1. **创建 API Token：** Cloudflare 控制台右上角头像 → **My Profile** → **API Tokens** → **Create Token** → 选择模板 **Edit Cloudflare Workers** → Account Resources 选你的账号 → **Continue to summary** → **Create Token**。复制生成的 token，它只显示一次。
2. **找到 Account ID：** 控制台进入 **Workers & Pages**，在页面右侧可以看到 **Account ID**，复制。
3. **填入 GitHub：** 打开仓库页面 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**，分别添加：
   - `CLOUDFLARE_API_TOKEN`：第 1 步的 token
   - `CLOUDFLARE_ACCOUNT_ID`：第 2 步的 Account ID
4. **验证：** 在仓库的 **Actions** 标签选择 **Deploy** → **Run workflow** 手动跑一次，看到绿色对勾即为成功。

没配置密钥时，这个流程会自动跳过，不会报错。

## 6. 日常运维

- **用量：** 控制台 → **Workers & Pages** → `openjetlag-mcp` → **Metrics**，可以看到请求数、错误率和 CPU 时间。免费计划每天 10 万次请求。一次完整的 agent 使用大约产生 3–5 次请求。
- **实时日志：** 终端运行 `npx wrangler tail`，或在控制台该 Worker 的 **Logs** 页面查看。服务器不会记录工具参数（航班、作息），日志里只有请求元数据。
- **回滚：** 控制台该 Worker 的 **Deployments** 页面可以回滚到之前的版本。
- **额度用完时：** 免费计划超出当日额度后请求会失败，不会产生费用，额度每天（UTC 0 点）重置。

## 7. 可选：自定义域名和限流

- **自定义域名：** 如果你的域名托管在 Cloudflare，可在该 Worker 的 **Settings** → **Domains & Routes** → **Add** → **Custom domain** 绑定，例如 `mcp.你的域名.com`。对外公布一个正式域名，比 `workers.dev` 地址更容易让陌生用户信任。
- **限流：** 绑定自定义域名后，可以在该域名的 **Security** → **WAF** → **Rate limiting rules** 中，按 IP 限制 `/mcp` 的请求频率（免费计划提供的规则数量有限）。注意：Muse、ChatGPT 等是从各自的云端连接，同一平台的大量用户可能共用 IP，限流阈值不要设得太低。

## 常见问题

- **`npm run deploy` 提示未登录：** 重新运行 `npx wrangler login`。
- **agent 添加连接器失败：** 确认地址以 `/mcp` 结尾，且是 `https://`；用第 3 步的 `curl` 检查服务是否在线。
- **想换 Worker 名称：** 修改 `packages/mcp-server/wrangler.toml` 里的 `name`，重新部署后地址会随之变化。
