# Remember Us

面向阿尔茨海默症家庭的双端陪伴界面。家人端用于维护老人信息与家庭设置，老人端通过六位家庭码配对后使用简化界面。

当前项目尚未部署线上版本。

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

## 构建

```sh
npm run build
```
