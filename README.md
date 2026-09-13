# Remember Us

面向阿尔茨海默症家庭的双端陪伴界面。家人端用于维护老人信息与家庭设置，老人端通过六位家庭码配对后使用简化界面。

线上：https://alzheimer-assistant.yuxuan-zhou2003.workers.dev （Cloudflare Workers，手动 `wrangler deploy`）

## 项目仓库

[emilyma2026/gentle-home-interface](https://github.com/emilyma2026/gentle-home-interface)

## 本地运行

请先安装 Node.js 和 npm，然后执行：

```sh
git clone https://github.com/emilyma2026/gentle-home-interface.git
cd gentle-home-interface
npm install
npm run dev
```

启动后，按照终端显示的本地地址在浏览器中打开项目。

## 地图配置

家人端首次设置里的「家在哪里」用 Google 地图选点。把 key 放在项目根目录的 .env：

```
VITE_GOOGLE_MAPS_API_KEY=你的key
```

然后生成前端配置（该文件不会提交）：

```sh
node scripts/gen-maps-config.mjs
```

没有配置 key 时地图会自动降级为示意图，其余功能不受影响。

## AI 配置

通话抽取、老人端问答、口述整理都走服务端 `/api/ai`，API key 只留在服务端，不进浏览器。
在 .env 里配置其中一个即可，优先使用 Gemini：

```
GEMINI_API_KEY=你的key
# 或
OPENAI_API_KEY=你的key
# 可选，覆盖默认模型
AI_MODEL=gemini-2.5-flash
```

本地 `npm run dev` 时 Vite 会把 `/api/ai` 交给 `server/ai-provider.mjs` 处理。
部署时请在托管平台提供同路径的接口，或复用同一个模块。
没有配置任何 key 时，三处都会回落到不依赖模型的固定行为，功能不中断。

## Daytona 沙盒

产品里"跑不可信代码 / 跑 AI agent"的活都放进 Daytona 隔离沙盒。key 只留服务端。

```
DAYTONA_API_KEY=你的key      # app.daytona.io/dashboard/keys
DAYTONA_TARGET=us            # 可选，us / eu
DAYTONA_SANDBOX=Remember_Us  # 可选，复用固定沙盒（停了自动拉起、跑完不删）；不设则每次新建即删
```

### 记忆抽取 agent（主用途）

家人写的照护笔记 → 沙盒里跑 `server/sandbox/memory_agent.py`：

1. **extractor** — LLM 结构化抽取，拆成 facts（person/preference/routine/event/response_script/other）
   和 todos（today/tomorrow/this_week/unspecified）
2. **grounding critic** — 第二遍 LLM 逐条核对"是不是笔记里明确写到的"，没依据的丢掉
3. **sensitive filter** — 手机号 / 身份证 / 银行卡 / 密码类正则二次过滤

沙盒把 LLM 的不可信输出和外部 HTTP 调用关在隔离环境里，Worker / 主进程不直接碰。
只用 Python 标准库，沙盒无需 pip install。

- **可视化 demo**：`npm run dev` 后打开 `/sandbox`，粘一段笔记点运行，看沙盒 ID、
  pipeline 步骤、分类结果、grounding 丢弃项。
- **接口**：`POST /api/memory/extract`，body `{ "note": "…" }` →
  `{ ok, runtime, sandboxId, previewLink?, facts, todos, dropped, steps }`。
  - `runtime: "daytona"` —— 真沙盒（本地 dev / 有 Daytona key）
  - `runtime: "direct"` —— Cloudflare Worker 上 Daytona SDK 跑不起来时，回落到 AI 网关直跑
  - `runtime: "local-fallback"` —— 无 Daytona key 时在本机跑同一个 Python

### 自检端点

`POST /api/daytona`，body `{ "code": "print(1+1)" }` → 直接在沙盒里跑一段 Python，
返回 `{ ok, mode, sandboxId, exitCode, result }`。仅 `npm run dev` 挂载。

没配 `DAYTONA_API_KEY` 时相关端点返回 skipped / 回落，不影响其余功能。

## 构建

```sh
npm run build
```
