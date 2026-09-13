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

通话抽取、文字快捷问答、口述整理走服务端 `/api/ai`，API key 只留在服务端，不进浏览器。老人连续语音陪伴使用下述独立的 Live 接口。
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

## 记忆抽取

`POST /api/memory/extract` 接收 `{ "note": "…" }`，通过服务端 AI 适配层直接抽取，
返回 `{ ok, runtime, facts, todos, dropped, steps }`。
配置服务端 `OPENAI_API_KEY` 或 `GEMINI_API_KEY` 即可；不需要额外的执行环境。

当前流程执行结构化抽取、字段归一化和敏感信息过滤，不包含独立的二次 grounding 核查。
AI 调用失败时接口返回错误；空笔记直接返回空结果。

## 连续语音陪伴（GPT-Live-1）

老人端「陪我说一会儿」打开后，点击「开始陪我说一会儿」授权麦克风。
浏览器通过 WebRTC 将麦克风音频送入 `gpt-live-1`，直接播放模型音频，支持连续交谈和打断。
不使用浏览器语音识别或文字朗读来模拟实时对话。文字快捷问题仍保留。

- 服务端需要有 `gpt-live-1` 权限的 `OPENAI_API_KEY`；可选 `LIVE_LOOKUP_MODEL`（默认 `gpt-4o-mini`）负责家庭记录匹配。
- `/api/live/session` 创建实时会话；`/api/live/query` 查询已确认家庭记录。两个接口都检查 Supabase 用户会话与家庭访问权限。
- 未知问题成功保存后才告知老人已转给家人；家人答案在服务端核实后可回到当前语音会话。
- 点击结束、离开页面、切换角色或网络故障会关闭麦克风。每次连续会话最长 10 分钟，可重新开始。
- 浏览器需在 HTTPS 或 localhost 下运行并允许麦克风；若自动播放被阻止，点击「播放声音」。错误时明确提示，需手动重试。
- Vite 开发和 `src/server.ts` 生产入口均已接入。部署时配置服务端密钥及 Supabase 环境变量，绝不要把 OpenAI 密钥放入 `VITE_*`。

自动测试覆盖会话协议、鉴权、已确认记录查询、麦克风释放及保存失败。真实音质、停顿与打断体验需要使用麦克风端到端试听。

参考：[Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)、[客户端委派](https://developers.openai.com/api/docs/guides/live-delegation)。

## 构建与检查

```sh
npm run build
```
