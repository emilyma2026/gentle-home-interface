# 插画资产生成日志

风格基准：`Assets/reference/landing-page-background.png`（水獭一家，松弛手绘铅笔线 + 纸纹 + 彩铅淡铺色，米白/雾绿/灰玫瑰/浅棕/雾蓝）。
生成方式：OpenAI，`images/edits` 以参考图做角色 + 风格锚定。脚本见 scratchpad `gen-image.mjs`（`IMG_MODEL` 环境变量切模型）。

**v1 = `gpt-image-1` medium；v2 = `gpt-image-2` high（当前定稿，手绘线条明显更细更自然）。** v2 用 `regen-parallel.sh` 5 张并行生成（每张 gpt-image-2 high ~7-10 分钟，串行太慢）。v1 文件全部保留。

共用风格串（STYLE）：
> same otter family characters and the same loose hand-drawn colored-pencil illustration style as the reference image; thin relaxed slightly wobbly pencil linework, not vector; visible paper grain, soft colored-pencil shading; muted palette limited to cream, light khaki, sage green, soft brown, misty blue, low saturation, no harsh gradients; rounded simplified cute shapes with a naive childlike touch; clean plain cream background, generous empty space; quiet healing gentle family mood; no text, no buttons, no UI, no cards, no phone frame, no page layout — illustration only.

---

## hero（入口页 hero，替换 hero-care-centered.png，方形）

ref 实际用 `_ref_small.jpg`（原图 1.7MB 上传超时，缩到 640px/99KB）。

### v1
- size 1024x1024, quality medium, ref: _ref_small.jpg
- prompt: STYLE + "Centered cozy scene: the grandparent otter wearing round glasses and a dusty-rose cardigan sitting in a soft sage-green armchair, two or three family otters in sweaters gathered close around leaning in warmly, one small otter child sitting on the floor. A small potted plant to one side, a hint of an arched window behind. Square composition, subject filling most of the frame with a little breathing room."
- 输出: hero/hero_v1.png
- 结果: 风格对，构图偏满，奶奶造型自成一派

### v2
- STYLE（linework 加 "a bit of visible pencil texture in the outlines"，palette 补 dusty rose）+ "Warm scene of the whole otter family gathered close together, the grandparent otter with round glasses seated in a soft armchair at the center, family otters of different ages leaning in around, everyone calm and content. Small simplified life details: one little potted plant, a hint of an arched window with soft light. Slightly wider shot with a comfortable margin of empty cream space around the group, especially above."
- 输出: hero/hero_v2.png
- 结果: 最接近参考图，留白足；用户反馈：**手绘感不够，太工整**

### v3（用户反馈后：加重手绘）
- STYLE 改为强调 "CRITICAL - linework must look genuinely drawn by hand: thin loose relaxed outlines in a single quick pass, wobbly, uneven pressure, casual, corners slightly open, tiny overshoots, faint double strokes. NOT clean NOT even NOT vector NOT polished digital painting. Shading = visible colored-pencil strokes + hatching over grainy paper, matte dry, no airbrush no gradients."
- 输出: hero/hero_v3.png
- 结果: 填色纸感够了，线条还是偏工整

### v4（再加重）
- prompt 改为 "A quick affectionate pencil sketch lightly colored... outlines must be THIN LOOSE SKETCHY - relaxed quick strokes as if casually doodled in a sketchbook, searching and random, not tracing forms perfectly, overshoot / not meeting, unfinished-looking rather than clean final render. Lots of bare paper showing through. Only 4-5 colors. Otters a bit wonky."
- 输出: hero/hero_v4.png
- 结果: 线条松弛随性到位，手绘感够；角色略糙（獭脸/比例）
- 对比图: hero/_contact_v1-v4.png

### v5（用户："喂参考图，别写这么多描述"）
- ref 换成 `_ref_1024.jpg`（1024px jpg q94，比之前 640px 清晰）
- prompt 极简: "Same style, characters, colors. Square composition, otter family around grandparent otter in armchair, more empty cream space. No text."
- 输出: hero/hero_v5.png
- 结果: 角色干净了，但线条又回到工整/矢量感 —— 极简 prompt 反而漂回"干净"

### v6（双参考图）
- ref A = `_ref_1024.jpg`（角色/配色/构图），ref B = `hero_v4.png`（线条松度）
- quality high
- prompt: "Keep the characters, colors and composition of the first image. Match the loose thin sketchy hand-drawn pencil linework and rough paper texture of the second image. Square, a bit more empty space around the family. No text."
- 输出: hero/hero_v6.png
- 结果: **角色稳 + 线条松 + 纸感足**，接近目标；略偏淡
- 对比图: hero/_contact_v4-v6.png

---

## character（单角色）

### granny_front_v1（水獭奶奶正脸）
- ref: _ref_1024.jpg, size 1024x1024, quality medium
- prompt: "In this exact art style, a front-facing portrait of the grandmother otter from this image: white fluffy hair, round glasses, dusty-rose cardigan, gentle warm smile, looking straight at the viewer. Head and shoulders. Plain cream background. No text."
- 输出: character/granny_front_v1.png
- 结果: **用户认可**。单角色时「参考画风 + 描述主体」够用，正脸、和参考图角色一致

定稿打法：ref A = `_ref_1024.jpg`（画风+角色），单角色场景再加 ref B = `granny_front_v1.png`（钉住 nana），prompt 只描述"画什么"，开头 "In this exact art style"。

---

## landing（入口两宫格，左右排布，方形）

### family-pick_v1（左，家人端）
- ref: _ref_1024.jpg
- prompt: "In this exact art style, a square group portrait of the four otter family members from this image, NOT the white-haired grandmother: the two grown otters (sage-green sweater, cream sweater) and the two otter children (yellow jacket, pink hoodie with ponytail). Head and shoulders, arranged close together like a warm family photo, all facing the viewer with gentle smiles. Plain cream background. No text."
- 输出: landing/family-pick_v1.png

### elder-pick_v1（右，老人端 = nana）
- ref A = _ref_1024.jpg, ref B = family-pick_v1.png（对齐取景/比例）
- prompt: "…a square portrait of the white-haired grandmother otter…same drawing scale and framing as the second image so the two can sit side by side as a pair. Plain cream background. No text."
- 输出: landing/elder-pick_v1.png
- 预览: landing/_preview_side-by-side.png

---

## background（全屏竖版背景）

### landing-bg_v1
- ref: _ref_1024.jpg, size 1024x1536
- prompt: "…a tall portrait background illustration. The otter family scene sits in the upper third…lower two-thirds calm empty cream paper with only a few tiny scattered leaf doodles…subtle so text can sit over the empty area. No text, no UI."
- 输出: background/landing-bg_v1.png

### 背景图（用户直接给的 ChatGPT 图，非本项目生成）
- `family-bg.jpg` ← `Assets/background/family-bg_v1.png`（獭奶奶坐椅喝茶，已手机比例）→ **familyStart + code 两页**背景
- `onboard-bg.jpg` ← `Assets/background/onboard-bg_v1.png`（无角色，四角叶子涂鸦 + 色块；原 941×1672，中间灌米白 pad 到手机比例）→ **obElder / obMe / join 三页**背景
- 按 route 挂：`render()` 里加 `screen.dataset.route`，CSS `.screen[data-route="..."]` 分别贴图
- `viewCode` 重构成 `<section class="family-start codepage">`：去掉重复的 eyebrow "Family code"，h1 金色，加 Back（`data-go="obMe"`，router 里补 editingPerson 回填）
- Back 固定页面最底部（`.family-start .link{margin-top:auto}` + 半透明磨砂底 pill，压在插画上也看得清）
- 每个 onboarding 步骤都有 Back：familyStart→entry / obElder→familyStart / obMe→backPerson / code→obMe / join→entry

### family-start（家庭页 create/join 按钮）
- 用户：去掉重复的小标题 "Family"，配色改协调（去绿色 eyebrow + 绿脸圈 + 绿屏底），create/join 改左右布局
- `viewFamilyStart` 去 eyebrow，`.roles` 改 2 列，`.role` 改成图上字下卡（同入口 `.pick`），`.screen:has(.family-start)` 底色改暖色渐变
- `join_v1.png`：gpt-image-2 high 1024²，ref _ref_1024 + family-pick_v2。prompt = STYLE + "小女孩海獭（粉卫衣、马尾 + 蝴蝶结）双手把金钥匙举高，仰头看它，开心"。**已采用**
- `create_sapling_v1.png`：同参数，prompt = "雾绿毛衣 + 米白毛衣两只成年獭一起把树苗种进陶盆，旁边小洒水壶"。**候选，用户还没定 create 用啥图**

### cover_phone_v1 / v2（入口全屏封面，手机比例 1168×2528）
- 用户要"底图平铺到底部 + 上面放两个入口按钮"，且旧图比例不对（landing-bg 是 0.667，手机屏 390×844 是 0.462）
- gpt-image-2 high，size **1168x2528**（手机屏 @3x 附近，宽高都 ÷16），ref A=_ref_1024.jpg + ref B=landing-bg_v2.png
- prompt：场景压在上 45%，下半留干净米白 + 少量叶子涂鸦 + 角落柔和色块，给按钮留位
- 输出：background/cover_phone_v1.png（已采用）、cover_phone_v2.png（备选，场景略大）
- App 里 `.entry` padding-top 322px 把标题+按钮压到场景正下方

---

## elder-scenes（老人端场景图，方形，ref A=_ref_1024.jpg + ref B=granny_front_v1.png）

- standby_v1 — 早晨窗边，双手捧杯，闭眼微笑，旁边小盆栽
- arrived_v1 — 到家开门，暖色门厅灯光，门口盆栽 + 地垫（背景略深，可微调）
- guide_v1 — 户外小路散步，简化鼠尾草绿树，不含地图/箭头

总览: `_ALL_v1.png`

---

## 接入 App（public/app/index.html）

v2 资产压成 JPEG 放进 `public/app/`：
- `otter-bg.jpg` ← **`cover_phone_v1.png`**（见下）→ 入口页全屏封面（`.screen:has(.entry)` background，`top center / 100% 100%`，780×1688）
- `otter-family.jpg` ← `landing/family-pick_v2` 整张方形（460×460）→ 入口页「家人端」按钮配图
- `otter-nana.jpg` ← `landing/elder-pick_v2` 整张方形（460×460）→ 入口页「老人端」按钮配图
- `otter-join.jpg` ← `family-start/join_v1`（见下）→ 家庭页「Join family」按钮配图
- `otter-create.jpg` ← `family-start/create_sapling_v1`（见下，**候选，用户未定稿**）→ 家庭页「Create family」按钮配图
- `otter-standby.jpg` ← elder-scenes/standby_v2 → 老人端待机首页顶部 banner（`.e-banner`，128px 满宽）
- `otter-arrived.jpg` ← elder-scenes/arrived_v2 → 老人端"到家"页（`.e-scene`，186×186，替换原 ✓ ring）
- `otter-guide.jpg` ← elder-scenes/guide_v2 → 老人端"回家引导"的 `.visuals-panel` 底图（street view 失败时 onerror 露出）

入口 `viewEntry` 迭代：单 hero → 左右方形 pick 卡 → landing-bg 全屏 + 纯文字按钮 → **最终：`cover_phone_v1` 全屏封面（手机比例）+ 两个带插画的按钮**（`.pick` = 插画横条 96px + 标题 + 副标题，半透明磨砂卡；`.entry` padding-top 322px 把内容压到场景下方）。用户要"底图铺到底 + 按钮用生成的素材图"。
`hero-care-centered.png` / `hero-care.jpg` 变成死资源（没删）。
`tests/entry-homepage.test.mjs` 4 条断言按新设计更新。135 测试全过，build 通过。
入口 / 待机 banner / 引导图 已浏览器实测；到家页因 Supabase 连接不稳没复测（尺寸按旧 `.entry-art` 同款 186px，低风险）。
