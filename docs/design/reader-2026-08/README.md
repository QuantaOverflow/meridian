# Handoff: Meridian 读者端 UI/UX 重设计（第一版）

## Overview

Meridian 是一个自动化情报简报系统：抓取新闻源 → 聚类 → LLM 分析 → 每日生成一份简报。现有前端（Nuxt 3 + Tailwind）把后端产出的结构化情报压成一整块 markdown 渲染，读者看不到重要度、来源数、可信度判定，长文没有导航，归档页无法检索。

这次重设计只覆盖**读者每天会用的公开页面**，目标是：

1. 让一份 15 分钟的简报同时支持 5 分钟速读和 15 分钟深读；
2. 把后端已有但前端丢失的信息（分歧点、溯源、跨期线索）以不打断阅读的方式还原；
3. 归档可检索；
4. 中文排版真正落地（现有版本中文掉到系统默认衬线）。

Admin / 运行监控 / 质量看板**不在**本次范围内。

## About the Design Files

本包内的 `.dc.html` 文件是**设计参考稿**，用 HTML 表达最终视觉与交互意图，**不是可直接搬运的生产代码**。它们使用了一套自定义的模板运行时（`<x-dc>` + 内联样式），不要试图把这些标签或 `support.js` 搬进产品。

任务是：**在目标代码库既有环境中重建这些设计**。本项目的目标环境已确定：

- **Nuxt 3 + Vue 3 SFC**（`apps/frontend/src/`）
- **Tailwind CSS v4**（`@import 'tailwindcss'`，配置在 `apps/frontend/tailwind.config.ts`，全局样式 `src/assets/css/main.css`）
- 已有 `@heroicons/vue`、`date-fns`、`zod`
- 路由为文件式路由（`src/pages/`），布局在 `src/layouts/default.vue`

请用 Vue SFC + Tailwind 工具类实现，不要引入新的 UI 框架。

**关于现有 `main.css` 的重要提示**：该文件目前有 40+ 条形如 `.bg-white { @apply bg-slate2 }` 的反向覆盖，用来给 Radix 色系打补丁。本次重设计引入了自己的 CSS 变量令牌体系（见「Design Tokens」），**请删除这些反向覆盖**，改为在 `:root` / `[data-theme="dark"]` 上定义变量，并在 Tailwind 配置里把令牌暴露为主题色。两套体系并存会互相打架。

## Fidelity

**High-fidelity（hifi）**。颜色、字号、行高、字距、间距均为最终值，请按文档中的数值精确实现。文案也是最终中文文案（示例数据除外——简报内容来自数据库）。

唯一未定稿的部分：
- 配图（当前设计通篇无图，是否引入地图/图表待定）
- 移动端断点以下的布局（未设计，见「Responsive」）
- 用户账号体系（当前设计仅有邮箱订阅，无登录态）

## Screens / Views

共 4 个视图，全部在公开侧，共用同一个顶栏。

---

### 1. 今日简报（`/` 或 `/briefs/:slug`）

**Purpose**：读者每天的主页面。读完当天全部事件，或只扫标题。

**Layout**

- 页面容器：`max-width: 1160px; margin: 0 auto; padding: 0 32px; position: relative`
- 正文列：`max-width: 668px; margin: 0 auto; padding: 70px 0 140px` —— **正文在视口正中**，这是关键，不要因为侧栏而让正文偏移
- 侧栏目录：`position: absolute; top: 74px; left: 0; width: 186px`，内部 `position: sticky; top: 106px`
  - 视口宽度 `< 1120px` 时整个侧栏 `display: none`
  - 侧栏是绝对定位浮在左侧留白里，**不占据文档流**，所以正文列不会被推动

**Components**

**1.1 顶栏（全站共用）**

- 容器：`position: sticky; top: 0; z-index: 60; background: var(--bg); border-bottom: 1px solid var(--rule-soft)`
- 内层：`max-width: 1160px; margin: 0 auto; padding: 0 32px; height: 58px; display: flex; align-items: center; gap: 22px`
- 品牌名 "Meridian"：`font-family: var(--serif); font-size: 22px; font-weight: 600; letter-spacing: -0.01em; color: var(--text)`
- 分隔竖线：`width: 1px; height: 18px; background: var(--rule)`
- 导航（`display: flex; gap: 20px; font-size: 14px`）：今日简报 / 归档 / 事件追踪
  - 当前页 `color: var(--text)`，非当前页 `color: var(--text3)`
  - 「事件追踪」在索引页和详情页都算激活态
- 弹性占位 `flex: 1`
- 速读/深读分段控件：外框 `border: 1px solid var(--rule); border-radius: 100px; overflow: hidden; font-size: 13px`
  - 每段 `padding: 5px 14px; cursor: pointer`
  - 选中段：`background: var(--text); color: var(--bg)`
  - 未选中段：`background: transparent; color: var(--text3)`
- 深浅色切换按钮：`width: 30px; height: 30px; border-radius: 100px; color: var(--text2)`，内含 17×17 的太阳/月亮 SVG（`stroke-width: 1.5; stroke-linecap: round`，`fill: none`）。浅色态显示月亮，深色态显示太阳。
- 订阅按钮：`background: var(--accent); color: #fff; border: none; border-radius: 100px; padding: 7px 16px; font-size: 13.5px`
- 阅读进度条：顶栏底部 `height: 2px`，内填充 `background: var(--accent); width: <scroll%>; transition: width .1s linear`

**1.2 侧栏目录**

- 标题「本期 7 条」：`font-size: 11.5px; letter-spacing: 0.12em; color: var(--text3); margin-bottom: 14px`
- 列表容器：`display: flex; flex-direction: column; gap: 2px; border-left: 1px solid var(--rule-soft)`
- 每项：`font-size: 13px; line-height: 1.45; padding: 6px 0 6px 14px; cursor: pointer`
  - 默认 `color: var(--text3)`，hover `color: var(--text)`
  - 当前项：`color: var(--text); box-shadow: inset 2px 0 0 var(--text)`（用 inset shadow 画激活竖条，不要用 border 以免抖动）
- **待实现**：滚动高亮跟随（设计稿是静态的）。用 IntersectionObserver 观察各 `<article>`，把最靠上的可见项设为激活；点击平滑滚动到对应锚点。**注意：禁止使用 `scrollIntoView`**，用 `window.scrollTo({ top, behavior: 'smooth' })` 自行计算偏移（需减去顶栏 58px + 余量）。

**1.3 简报头部**

- 期号行：`font-size: 12.5px; letter-spacing: 0.1em; color: var(--text3); margin-bottom: 16px`，文案格式「每日情报简报 · 第 412 期」
- 大标题 `<h1>`：`font-family: var(--serif); font-size: 44px; line-height: 1.24; letter-spacing: -0.01em; font-weight: 600; margin: 0 0 18px`
  - **行高 1.24 是为中文调过的值**，不要沿用拉丁字体常用的 1.1
- 元信息行：`display: flex; gap: 11px; font-size: 13.5px; color: var(--text3); margin-bottom: 42px; padding-bottom: 20px; border-bottom: 1px solid var(--rule-soft)`
  - 内容「2026 年 6 月 3 日 · 7 条事件 · 15 分钟阅读」，分隔符是独立的 `<span>·</span>`
- TLDR 段落：`font-family: var(--serif); font-size: 21px; line-height: 1.9; letter-spacing: 0.01em; margin: 0 0 52px; color: var(--text)`
  - 对应后端 `reports.tldr`

**1.4 板块分隔（section header）**

```
display: flex; align-items: center; gap: 14px; margin: 0 0 30px
  h2  → font-family: var(--sans); font-size: 16px; font-weight: 600;
        letter-spacing: 0.02em; color: var(--text); white-space: nowrap
  span → height: 1px; flex: 1; background: var(--rule)   (延伸横线)
```

文案示例：「地缘 · 中东」「美国政治」「科技 & AI」。板块由后端 story 的分类字段驱动。

**1.5 事件条目（`<article>`）**

两级规格 —— 头条与常规条目：

| | 头条（重要度高） | 常规条目 |
|---|---|---|
| 标题字号 | 30px | 25px |
| 标题行高 | 1.36 | 1.40 |
| 标题字距 | -0.005em | 默认 |
| 底部间距 | 62px | 58–70px |

- 标题：`font-family: var(--serif); font-weight: 600; color: var(--text); margin: 0 0 14~16px`
- 正文段落：`font-family: var(--serif); font-size: 19.5px; line-height: 1.9; letter-spacing: 0.01em; color: var(--text); margin: 0 0 24px`
- **条目上不显示任何元信息**（无重要度分数、无来源数量、无可信度徽章）。这是明确的产品决定：保持最干净的阅读体验。这些字段仍从后端取，只用于排序和分组。
- **深读专属内容**：第二段起、引文块、时间线块、来源行整体包在一个容器里，速读模式 `display: none`
- 正文内实体链接：`border-bottom: 1px solid var(--text3)`，无 `text-decoration`（下划线颜色要够深，浅灰会被误认为拼写错误标记）

**1.6 引文块 / 分歧点提示**

用于呈现被 judge 剔除或存疑的说法：

```
background: var(--quote-bg); border-left: 2px solid var(--rule);
padding: 18px 22px; margin: 0 0 24px
  p → font-family: var(--serif); font-size: 17.5px; line-height: 1.82;
      letter-spacing: 0.01em; color: var(--text2); margin: 0 0 8px
  a → font-size: 12.5px; color: var(--text3); border-bottom: 1px solid var(--rule)
```

**严禁使用 `font-style: italic`** —— 中文没有斜体字形，浏览器会做机械倾斜，效果很差。层级差异靠字号、颜色、底色表达。

**1.7 内嵌时间线（事件内部）**

```
background: var(--quote-bg); padding: 18px 22px; margin: 0 0 26px;
display: flex; flex-direction: column; gap: 11px
  每行 → display: grid; grid-template-columns: 54px 1fr; gap: 16px;
          font-size: 15px; line-height: 1.6; color: var(--text2)
  日期 → color: var(--text3)
  最新一行 → 文字 color: var(--text)，日期 color: var(--accent)
```

**1.8 来源行（深读模式，条目末尾）**

```
display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
font-size: 13px; color: var(--text3)
  "来源" 标签 → 纯文本
  各来源链接 → border-bottom: 1px solid var(--rule)
  溢出计数 → "+5" 纯文本
  flex: 1 占位
  "追踪此事件 →" → color: var(--accent); cursor: pointer
```

来源链接对应 `brief_stories.article_ids` 反查的文章 URL。

**1.9 页脚订阅区**

```
border-top: 1px solid var(--rule-soft); padding-top: 34px
  h4 → font-family: var(--serif); font-size: 21px; font-weight: 600; margin: 0 0 8px
        文案「明早 7 点，同样一封」
  p  → font-size: 14px; line-height: 1.7; color: var(--text2); margin: 0 0 16px
        文案「邮件版和这里读到的内容完全一致。」
  表单 → display: flex; gap: 8px; max-width: 390px
    input  → flex: 1; padding: 11px 15px; border: 1px solid var(--rule);
             border-radius: 100px; background: transparent; color: var(--text);
             font-size: 13.5px; placeholder "your@email.com"
    button → background: var(--accent); color: #fff; border-radius: 100px;
             padding: 11px 22px; font-size: 13.5px; white-space: nowrap
```

复用现有 `SubscriptionForm.vue` 的提交逻辑与 `meridian_subscribed` cookie 行为，只换视觉。

---

### 2. 归档（`/briefs`）

**Purpose**：检索历史简报。现有版本只有标题+日期的裸列表，20 行下来看不出哪天重要。

**Layout**：`max-width: 740px; margin: 0 auto; padding: 70px 32px 140px`。无侧栏。

**Components**

- `<h1>`「归档」：`font-family: var(--serif); font-size: 38px; line-height: 1.26; letter-spacing: -0.01em; font-weight: 600; margin: 0 0 8px`
- 副标题：`font-size: 14px; color: var(--text3); margin: 0 0 34px`，文案「412 期 · 覆盖 2025 年 3 月至今」
- 搜索框：`display: flex; align-items: center; gap: 9px; border: 1px solid var(--rule); border-radius: 100px; padding: 10px 17px; margin-bottom: 6px`
  - 放大镜 SVG 15×15，`stroke-width: 1.6; color: var(--text3)`
  - input 无边框透明底，`font-size: 13.5px`，placeholder「搜索事件、人物、地区…」
  - **后端需要新增全文检索接口**（现有 API 无此能力）
- 分类标签栏：`display: flex; gap: 24px; border-bottom: 1px solid var(--rule-soft); font-size: 14px`
  - 每项 `padding: 14px 0`；激活项 `box-shadow: inset 0 -1px 0 var(--text); color: var(--text)`；非激活 `color: var(--text3)`
- 每期条目：`padding: 28px 0; border-bottom: 1px solid var(--rule-soft); cursor: pointer`
  - 元信息行：`font-size: 12.5px; color: var(--text3); margin-bottom: 9px`，格式「6 月 3 日 · 第 412 期 · 7 条 · 15 分钟」
  - 标题 `<h3>`：`font-family: var(--serif); font-size: 23px; line-height: 1.42; font-weight: 600; margin: 0 0 9px`
  - 摘要：`font-size: 15px; line-height: 1.75; color: var(--text2); margin: 0 0 14px`（取 `reports.tldr` 截断）
  - 主题标签：`display: flex; gap: 8px; flex-wrap: wrap`，每个 `font-size: 12.5px; border: 1px solid var(--rule); border-radius: 100px; padding: 4px 12px; color: var(--text2)`
- 加载更多按钮：`font-size: 13.5px; border: 1px solid var(--rule); border-radius: 100px; padding: 10px 24px; color: var(--text2)`，hover 时 `border-color: var(--text); color: var(--text)`

---

### 3. 事件追踪 · 索引（`/stories`）

**Purpose**：列出跨期存续的线索，避免读者每天从零读起。

> ⚠️ **此视图依赖后端新增能力**，详见文末「后端前置条件」。

**Layout**：`max-width: 740px; margin: 0 auto; padding: 70px 32px 140px`

**Components**

- `<h1>`「事件追踪」：同归档页 h1 规格，`margin: 0 0 12px`
- 引导语：`font-family: var(--serif); font-size: 19px; line-height: 1.85; letter-spacing: 0.01em; color: var(--text2); margin: 0 0 36px`
- 状态筛选栏：同归档页分类栏规格。**标签文案需要修正**：
  - 当前设计稿写的是「进行中 5 / 已平息 23 / 全部」
  - **「已平息」必须改成「暂无更新」**——系统只知道"最近没有新报道并入"，不知道现实中的冲突是否平息。用前者是对世界下判断，会误导读者。
  - 判定规则：**进行中** = 最近 7 天内有新条目并入；**暂无更新** = 连续 7 天以上无新条目。阈值放在配置里，别写死。
  - 在筛选栏下方加一行 `font-size: 12px; color: var(--text3)` 的规则说明：「7 天内有新进展的线索列为进行中」。阈值要对读者可见。
- 每条线索：`padding: 26px 0; border-bottom: 1px solid var(--rule-soft); cursor: pointer`
  - 标题行：`display: flex; align-items: baseline; gap: 10px; margin-bottom: 9px`
    - `<h3>` `font-family: var(--serif); font-size: 24px; line-height: 1.42; font-weight: 600`
    - 「升级中」标记：`font-size: 12.5px; color: var(--accent)`
      - 判定规则：连续 3 天以上每天都有新条目，**或**最新条目重要度高于该线索历史均值。不满足则不显示任何标记（不要「平稳」这类填充词）。
  - 概要：`font-size: 15.5px; line-height: 1.78; color: var(--text2); margin: 0 0 12px`
  - 元信息：`font-size: 12.5px; color: var(--text3)`，格式「持续 11 天 · 8 期简报 · 今日更新」

---

### 4. 事件追踪 · 详情（`/stories/:id`）

**Purpose**：把散落在多期简报里的同一条线索合成一条时间线，并保留被剔除的说法备查。

**Layout**：`max-width: 700px; margin: 0 auto; padding: 70px 32px 140px`

**Components**

- 返回链接：`font-size: 13px; color: var(--text3); margin-bottom: 22px; cursor: pointer`，文案「← 全部追踪」，hover 转 `var(--text)`
- 状态行：`font-size: 12.5px; letter-spacing: 0.1em; color: var(--text3); margin-bottom: 16px`，格式「事件追踪 · 持续 11 天 · 升级中」
- `<h1>`：`font-family: var(--serif); font-size: 42px; line-height: 1.26; letter-spacing: -0.01em; font-weight: 600; margin: 0 0 18px`
- 导语：`font-family: var(--serif); font-size: 20.5px; line-height: 1.9; letter-spacing: 0.01em; margin: 0 0 22px`
- 统计行：`font-size: 13px; color: var(--text3); padding-bottom: 28px; border-bottom: 1px solid var(--rule-soft); margin-bottom: 44px`
- 时间线条目：

```
display: grid; grid-template-columns: 58px 1fr; gap: 20px;
padding: 0 0 34px 24px; border-left: 1px solid var(--rule-soft);
margin-left: 5px; position: relative

节点圆点 → position: absolute; left: -4px; top: 8px;
           width: 7px; height: 7px; border-radius: 50%
           最新条目 background: var(--accent)；其余 background: var(--rule)
日期     → font-size: 12.5px; color: var(--text3); padding-top: 6px
标题 h3  → font-family: var(--serif); font-size: 22px; line-height: 1.42;
           font-weight: 600; margin: 0 0 9px
描述     → font-family: var(--serif); font-size: 18px; line-height: 1.85;
           letter-spacing: 0.01em; color: var(--text2); margin: 0 0 9px
期号     → font-size: 12.5px; color: var(--text3)
```

最后一条去掉 `border-left` 和底部 padding。

- **存疑条目**特殊处理：整块内容包在引文块样式里（`background: var(--quote-bg); border-left: 2px solid var(--rule); padding: 16px 20px`），标题降为 `font-size: 19px; font-weight: 500; color: var(--text2)`，底部标注「未进入简报」。节点圆点用 `var(--rule)`。

---

## Interactions & Behavior

**导航**
- 顶栏三个入口切换视图；切换后 `window.scrollTo(0, 0)`
- 「事件追踪」入口 → 索引页；索引页条目点击 → 详情页；简报正文的「追踪此事件 →」直接跳详情页
- 详情页「← 全部追踪」回索引页
- 实现为 Nuxt 文件路由：`pages/index.vue`、`pages/briefs/index.vue`、`pages/briefs/[slug].vue`、`pages/stories/index.vue`、`pages/stories/[id].vue`

**速读 / 深读**
- 全局状态，影响所有事件条目的深读内容块
- 深读 = 默认值
- **应持久化到 localStorage**（设计稿未做）。注意：只读写自己的 key，不要清空其他条目。

**深浅色**
- 切换 `document.documentElement.dataset.theme = 'dark' | 'light'`
- 令牌全部走 CSS 变量，切换零重排
- `body` 上 `transition: background .2s ease`
- **应持久化**，并在首次访问时读 `prefers-color-scheme`
- 现有项目在 `layouts/default.vue` 里已有深浅色切换（heroicons 的 SunIcon/MoonIcon），复用其存储逻辑

**阅读进度**
- `scroll` 事件（`{ passive: true }`）计算 `scrollTop / (scrollHeight - clientHeight)`，写入进度条宽度
- 设计稿用 `transition: width .1s linear` 平滑

**Hover 状态**
- 侧栏目录项、归档条目、标签栏、按钮：文字色 `var(--text3)` → `var(--text)`
- 加载更多按钮：`border-color` 与文字色一起转深
- 无位移、无阴影变化

**响应式**
- `< 1120px`：侧栏目录隐藏（当前设计通过 resize 监听 + `display` 控制，产品实现请改用 Tailwind 的 `xl:` 断点类，更省事）
- **`< 768px` 未设计**。需要补：正文列改 `padding: 0 20px`，h1 降到 28–32px，正文降到 17–18px，顶栏导航需要折叠（现有 `[slug].vue` 里那个折叠式目录按钮可以参考），速读/深读控件可能要移出顶栏。**建议单独出一版移动端设计再实现。**

**可访问性（设计稿的欠账，实现时请补）**
- 设计稿里大量可点元素是 `<span>` —— 实现时改成 `<button>` 或 `<NuxtLink>`
- 补 `:focus-visible` 描边（用 `var(--accent)`）
- 分段控件用 `role="radiogroup"`，主题切换按钮加 `aria-label`
- 时间线用 `<ol>`/`<li>` 语义

**未做的状态（需要实现）**
- 加载态：建议正文列骨架屏（标题条 + 3 行文本条），别用转圈
- 空态：归档搜索无结果、事件追踪无进行中线索
- 错误态：简报加载失败
- 表单校验：订阅邮箱格式（现有 `SubscriptionForm.vue` 已有逻辑，沿用）

## State Management

```
screen        'today' | 'archive' | 'stories' | 'story'    → 由路由替代
mode          'skim' | 'deep'                              → 全局 + localStorage
theme         'light' | 'dark'                             → 全局 + localStorage + prefers-color-scheme
progress      0–100                                        → 局部，scroll 派生
activeStory   当前激活的目录项 id                            → 局部，IntersectionObserver 派生
viewportWidth number                                        → 改用 CSS 断点，不需要 JS 状态
```

数据获取（沿用现有 `useSEO` / Nuxt `useFetch` 模式）：

- 今日简报：`reports` 最新一条 + 其 `brief_stories`
- 归档：`reports` 分页列表（含 `tldr`、story 数、分类）+ 全文检索（**待新增**）
- 事件追踪索引 / 详情：**待新增**（见下）

## Design Tokens

### 颜色

```css
:root {
  --bg:         #ffffff;
  --text:       #1b1b1b;   /* 正文与标题 */
  --text2:      #4a4a4a;   /* 次级正文、引文 */
  --text3:      #8a8a8a;   /* 元信息、占位 */
  --rule:       #e2e2e2;   /* 可见分隔线、边框 */
  --rule-soft:  #f0f0f0;   /* 极淡分隔线 */
  --accent:     #9c3a2c;   /* 深朱红：强调色、进度条、订阅按钮 */
  --quote-bg:   #faf9f7;   /* 引文/时间线底色 */
}

[data-theme="dark"] {
  --bg:         #131313;
  --text:       #e9e7e4;
  --text2:      #b3afaa;
  --text3:      #84807b;
  --rule:       #2e2e2e;
  --rule-soft:  #222222;
  --accent:     #e07a63;   /* 深色模式下提亮，保证对比度 */
  --quote-bg:   #191919;
}
```

强调色是深朱红，**不是**现有项目的 Radix blue，也不是 Medium 绿。

### 字体

```css
--serif: 'Newsreader', 'Noto Serif SC', Georgia, serif;
--sans:  'Archivo', 'Noto Sans SC', ui-sans-serif, system-ui, sans-serif;
```

Google Fonts 引入：

```
Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400
Noto+Serif+SC:wght@400;500;600
Noto+Sans+SC:wght@400;500
Archivo:wght@400;500;600
```

**字体栈的设计意图**：拉丁字母与数字命中 Newsreader / Archivo，汉字回落到 Noto Serif SC / Noto Sans SC。这是本次重设计要解决的核心问题之一——现有版本只声明了拉丁字体，中文掉到系统默认衬线，跨平台表现不可控且与拉丁部分骨架不一致。

**生产环境注意**：Noto Serif SC 全量字重体积很大（单字重 CJK 子集约 2–8MB）。建议自托管 + `unicode-range` 分片 + `font-display: swap`，或用字体子集化工具按实际用字裁剪。不要直接挂 Google Fonts 全量。

### 中文排版参数（重要）

这些值是为中文调过的，与拉丁排版常用值不同，请勿"优化"回去：

| 用途 | 字号 | 行高 | 字距 |
|---|---|---|---|
| 正文段落 | 19.5px | 1.9 | 0.01em |
| TLDR / 导语 | 20.5–21px | 1.9 | 0.01em |
| 引文块 | 17.5px | 1.82 | 0.01em |
| 页面 h1 | 42–44px | 1.26 | -0.01em |
| 事件头条 h3 | 30px | 1.36 | -0.005em |
| 常规事件 h3 | 25px | 1.40 | 默认 |
| 列表标题 h3 | 22–24px | 1.42 | 默认 |
| 板块标题 h2 | 16px（sans） | 默认 | 0.02em |
| 元信息 | 12.5–13.5px | 默认 | 0.1em（期号行） |

- 中文行高需要 1.9，拉丁常用的 1.6–1.7 会让汉字挤在一起
- 中文标题行高不能低于 1.24，1.1 会让上下行汉字几乎相触
- 正文加 0.01em 字距可显著改善中文观感；标题反向收紧
- **禁止对中文使用 `font-style: italic`**

### 间距

正文列内的纵向节奏（px）：`8 / 9 / 12 / 14 / 16 / 18 / 20 / 22 / 24 / 26 / 28 / 30 / 34 / 36 / 42 / 44 / 52 / 58 / 62 / 70 / 140`

关键值：段间距 24；事件条目间距 58–62；板块标题下 30；TLDR 下 52；页面底部 140。

### 圆角

- 药丸形（按钮、输入框、标签、分段控件）：`100px`
- 时间线节点：`50%`
- 其余一律 `0` —— 引文块、卡片、条目**都没有圆角**，这是有意的（报纸感）

### 阴影

不使用投影。唯一的 `box-shadow` 用途是画线：

- 目录激活竖条：`inset 2px 0 0 var(--text)`
- 标签栏激活下划线：`inset 0 -1px 0 var(--text)`

## Assets

- **无图片、无插画**。全部视觉由排版和分隔线构成。
- 图标：4 个内联 SVG（放大镜、太阳、月亮、时间线圆点用的是 div）。`stroke-width: 1.5–1.6`，`fill: none`，`stroke: currentColor`。现有项目已装 `@heroicons/vue`，实现时可直接用 `MagnifyingGlassIcon` / `SunIcon` / `MoonIcon` 替换，视觉差异可忽略。
- 字体：Google Fonts（见上）。

**关于配图的待决事项**：当前设计通篇无图。15 分钟的阅读、7 条事件、零图像，节奏偏单调。两个候选方向：地缘事件配程序化生成的地图（无版权问题），资本/数据类事件配简单图表。**这一项尚未设计，需要产品决策后再做。**

## 后端前置条件

有两项设计依赖后端新增能力，实现前请确认排期：

**1. 全文检索（归档页）**
现有 API 无检索能力。需要给 `reports` / `brief_stories` 建索引并开接口。

**2. 跨期线索聚合（事件追踪，两个视图都依赖）**
这是本次设计新增的功能，现有数据模型不支持：

- `brief_stories` 表主键绑 `workflow_id`，即**按天存储**，跨期之间没有任何关联字段
- 需要新增一步：把当天的 story 与历史 story 做实体/语义匹配，落一个 `story_cluster_id`
- 需要新增字段/表来支撑：线索创建时间、最近更新时间、关联的 story 列表、被 judge 剔除的说法（目前只写进日志和 `eval-reports/*.md`，前端拿不到）

**如果这两项来不及，建议的降级路径**：先只实现「今日简报」和「归档」（归档去掉搜索框，保留分类筛选），事件追踪入口从顶栏摘掉。简报条目末尾的「追踪此事件 →」也一并去掉——不要让界面承诺后端没有的能力。

同期内的溯源（来源链接展开原文）**零后端改动**，`article_ids` 已有数据，可以先做。

## 范围之外

以下明确不在本次设计内，不要顺手实现：

- **用户账号 / 登录鉴权**。公开侧维持匿名可读，唯一身份是订阅邮箱（`meridian_subscribed` cookie）。设计稿里没有登录入口、没有收藏、没有个人偏好。
- **Admin 面板**（源管理、运行监控、质量看板）。现有 `pages/admin/*` 保持不动。这三块需要单独设计。
- **邮件版排版**。
- **移动端**（见「响应式」）。

## Files

设计参考稿（本包内）：

- `Meridian 新设计 v3.dc.html` —— **实现依据，以此为准**。四个视图全在这个文件里，通过顶栏切换。
- `Meridian 新设计 v2.dc.html` —— 上一版，仅供追溯（白底 + Medium 绿、无深色模式、中文字体未落地）。
- `Meridian 现有界面复刻.dc.html` —— 现有线上界面的像素级复刻，用于对照改动幅度。

原始代码位置（用户本地 `meridian` 仓库；2026-08 交付时的状态）：

> 2026-09-24 注：reader v3 已按本稿实现，`SubscriptionForm.vue`、`BriefTableOfContents.vue` 已不在仓库里，
> 现组件见 `apps/frontend/src/components/`；本包按交付时原样保留，作为设计依据。

- `apps/frontend/src/pages/index.vue`、`pages/briefs/index.vue`、`pages/briefs/[slug].vue`
- `apps/frontend/src/layouts/default.vue`（顶栏与深浅色切换）
- `apps/frontend/src/components/SubscriptionForm.vue`、`BriefTableOfContents.vue`
- `apps/frontend/src/assets/css/main.css`（含需要清理的 40+ 条反向覆盖）
- `packages/database/src/schema.ts`（`$reports`、`$brief_runs`、`$brief_stories`）

## 打开设计稿

`.dc.html` 文件用浏览器直接打开即可，需要同目录下的 `support.js`（已包含在本包内）。顶栏可切换四个视图，右上的分段控件切速读/深读，月亮图标切深浅色。
