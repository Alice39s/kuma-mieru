---
name: kuma-mieru-docs-design
description: 用于 Kuma Mieru 文档站（apps/docs）的长文文档页、语言入口页、未找到页和构建生成的链接预览图。读者是部署和维护监控面板的运维与开发者，在桌面上对照命令和配置逐项操作，也会在手机上查阅；目标是沿用仪表盘的 HeroUI 色板与字体，中性表面、单一蓝色强调、心跳条装饰，中英双语，浅色与深色主题。
version: 2026-10-25.2
---

## 1. 范围与优先级

- [MUST] 本文件约束 `apps/docs/` 的全部页面与浮层，以及文档构建生成的链接预览图。
- [MUST] 本文件不约束仪表盘（`apps/web/`）、README 和 GitHub 仓库页面；仪表盘的视觉由 HeroUI 主题与其组件决定，本文件只引用它的色板和字体。
- [MUST] 冲突时按以下顺序取舍：用户要求、无障碍与可用性、读者当前的任务、本项目已有约定（仪表盘的外观）、品牌表达、装饰细节。
- [MUST] 页面写什么、有哪些页、命令与配置的取值，以文档内容和代码为准；本文件只规定它们的呈现方式。

## 2. 品牌与读者

读者一边读一边在终端或托管平台里操作，需要快速找到命令、变量名和取值；中英文混排，代码与原文保持原样。

- [SHOULD] 文档站与仪表盘是同一个产品：颜色、圆角和字体取自同一个 HeroUI 主题，读者从仪表盘跳到文档时不感到换了站点。（决策：文档站贴合主程序的设计风格。来源：2026-10-25 文档站初版设计决策。）
- [SHOULD] 中性工具感：表面、文字和边框只用灰阶 token；`primary` 蓝色只出现在链接、焦点环、当前导航、主要按钮和信息提示的图标上。
- [MUST] 心跳条是唯一的品牌装饰：入口页、未找到页和链接预览图使用 `HeartbeatStrip`，颜色取仪表盘的状态色。
- [SHOULD] 页面高度由内容决定，不放全屏宣传区、插画或背景图。（决策：这是查阅型文档，不是营销页。来源：2026-10-25 文档站初版设计决策。）
- [MUST] 文案语气直接、克制：写条件、步骤和结果，不写夸张的形容词。
- [MUST] 状态同时用文字和颜色表达，不只靠颜色。

## 3. 页面结构与构图

### 站点外壳

- [MUST] 所有文档页共用顶栏 `SiteHeader`：高 64px，吸顶，底部 1px 边框，背景为 70% 不透明的 background 加背景模糊；内容区最大宽度 1280px，左右内边距 640px 以下 16px、640px 起 24px。
- [MUST] 顶栏左侧是品牌标识：lucide `Activity` 图标（24px，success 色，线宽 1.75），右侧依次为粗体站名、16px 高的 1px 竖线、muted 小号的站点名“文档 / Docs”。品牌标识链接到当前语言的首页。
- [SHOULD] 顶栏右侧依次为仓库入口（lucide `GitBranch`，640px 起后接“GitHub”文字）、语言切换（`Languages`）和主题菜单（显示当前选项的 `Sun`、`Moon` 或 `Monitor`）；图标 18px，按钮带可读名称。
- [MUST] 语言切换保持当前页面，只替换路径中的语言段。
- [MUST] 主题菜单是“浅色 / 深色 / 跟随系统”三项单选，标出当前项，默认跟随系统。
- [MUST] 768px 以下，顶栏右侧的图标按钮至少 44×44px。

### 长文文档

- [SHOULD] 顶栏下为 1280px 框架：1024px 起左侧为页面树侧栏（顶部是搜索框），中间为正文，1280px 起右侧为本页目录。1024px 以下页面树改为抽屉，顶栏下方 48px 的 `DocsBar` 放目录和搜索按钮，本页目录收为可展开的条。
- [SHOULD] 正文自上而下：`text-h1` 标题、`text-body` muted 描述、页面操作行（复制 Markdown、打开方式菜单，底部 1px 分隔线和 24px 间距）、正文、最后更新时间。
- [SHOULD] 页面标题用 `text-h1`；描述、侧栏、目录用 `text-body`；h2 用 `text-section-title`，h3 用 `text-card-title`；正文段落 15px、行高 1.75；行内代码和代码块用等宽字体。（决策：长文行高高于控件的 1.6，只用于文档正文。来源：2026-10-25 文档站初版设计决策。）
- [SHOULD] `Card` 为 `--radius-card` 圆角、1px 边框、16px 内边距、无阴影，卡片间隔 16px；图标用 muted-foreground 放在标题左侧，不放图标底板。可点击的卡片悬停时边框变为 40% primary，底色变为 60% accent。
- [SHOULD] `Callout` 为 `--radius-card` 圆角、1px 边框：info 与 idea 用 primary 图标；warn 用 warning 的 10% 底色和 40% 边框；error 用 danger 的 10% 底色和 40% 边框；success 用 success 图标。标题 600 字重，正文 muted。
- [SHOULD] 代码块为 `--radius` 圆角、细边框、无阴影；Tabs 的标签栏和面板是同一张 `--radius-card` 卡片，面板内不再嵌套卡片。
- [SHOULD] 同一操作有多种包管理器写法时，用包管理器标签页展示，读者的选择在各页之间保持。
- [SHOULD] 表格撑满正文宽度，表头 600 字重、muted 底色；列宽之和超过正文时，表格在外层容器内横向滚动，字号不变。
- [SHOULD] 表头不换行；某列所有正文单元格都不超过 8 个汉字或 16 个拉丁字符时，整列 `whitespace-nowrap`。（决策：自动表格布局把剩余宽度分给最长的列，中文可在任意两字之间断行，短表头会被挤成一字一行。来源：2026-10-25 文档站初版设计决策。）
- [SHOULD] Mermaid 图居中，过宽时横向滚动；渲染完成前显示 13px muted 源码；图的配色随主题切换（浅色 `neutral`、深色 `dark`）。
- [SHOULD] 截图可点击放大查看。

### 语言入口页

- [SHOULD] 站点根路径是语言入口：页面加载后按浏览器首选语言跳到中文或英文首页，首选语言不是中文时进入英文。
- [SHOULD] 不执行脚本时显示居中的窄栏（最大宽度 448px）：心跳条、站名 `text-h1`、两张语言卡片（`text-card-title`，卡片表面与 `Card` 相同）。

### 未找到页

- [SHOULD] 居中窄栏（最大宽度 576px）：心跳条、`text-meta` muted 的“404”、中英文并列的 `text-h1` 标题、两行 muted 说明、两个返回按钮（中文为 primary 实心按钮，英文为描边按钮）。
- [MUST] 未找到页同时使用中英文，因为托管平台对所有不存在的路径返回同一个页面。

### 链接预览图

- [MUST] 1200×630，深色 HeroUI 色板。顶部一行：左侧粗体站名（30px）加 muted 的“文档 / Docs”（24px），右侧主机名与路径前缀（22px，muted）。中间垂直居中依次为分组行、标题、描述。底部为 112px 高的心跳条带，上边 2px divider 分隔，向左渐隐（`linear-gradient(90deg, transparent 10%, #000 60%)` 遮罩）。
- [SHOULD] 字号只用于预览图：分组行 24px、行高 1.4、muted；标题 68px、行高 1.12、700 字重、`text-wrap: balance`，最多 2 行；描述 30px、行高 1.5、muted、`text-wrap: pretty`，最多 2 行。（决策：预览图在链接卡片里约缩小到 0.4 倍，字号需要放大。来源：2026-10-25 文档站初版设计决策。）
- [MUST] 限制行数的文字同时使用 `lineClamp` 和 `textOverflow: ellipsis`，截断处显示省略号。
- [MUST] 文字框离左右边缘至少 64px，文字框之间不重叠，心跳条带不压在文字上。
- [SHOULD] 分组行显示页面所在的上级目录，用“ / ”连接；末级目录与标题相同时不显示它；没有分组或没有描述时，不输出对应的行。

## 4. 视觉规则

### 字体与颜色

- [SHOULD] 界面文字用 `--font-sans`：Noto Sans SC（拉丁字形）后接系统中文字体（PingFang SC、Hiragino Sans GB、Microsoft YaHei、Noto Sans CJK SC）；代码、命令、变量名和文件路径用 `--font-mono`（JetBrains Mono）。与仪表盘相同。
- [SHOULD] 字号只用以下角色。例外：按钮与菜单项用 14px；Fumadocs 组件自带的字号保持不变。

| 角色                 | 用途                        |
| -------------------- | --------------------------- |
| `text-h1`            | 页面标题，每页一个          |
| `text-section-title` | 文档 h2                     |
| `text-card-title`    | 卡片标题、文档 h3、语言卡片 |
| `text-body`          | 描述、正文、表格            |
| `text-meta`          | 日期、计数、次要说明        |

- [MUST] `text-meta` 不承载主要操作和限制说明。
- [SHOULD] 数值使用 tabular-nums（全局已开启）。
- [SHOULD] 颜色只用 `packages/theme/tokens.css` 的 token，它们全部取自 HeroUI 主题的 `--heroui-*` 变量；页面不写色值字面量。语义如下：

| token              | 含义                                       |
| ------------------ | ------------------------------------------ |
| `primary`          | 链接、焦点环、当前导航、主要按钮、信息提示 |
| `success`          | 正常、完成；品牌图标                       |
| `warning`          | 需要注意、等待中                           |
| `destructive`      | 失败、错误、不可用                         |
| `muted-foreground` | 次要文字、图标                             |

- [MUST] 文字与背景的对比度至少 4.5:1，包括 primary 文字在 10% primary 底色上（当前导航、标签页）。为此 `primary` 取 HeroUI primary 色阶的 600 档（HeroUI 在深色主题中反转色阶，浅色为较深的蓝、深色为较浅的蓝），primary 表面上的文字取 50 档。（决策：HeroUI 的 primary 默认档在深色表面和浅色底色上低于 4.5:1。来源：2026-10-25 无障碍检查。）
- [SHOULD] 代码高亮用 `github-light-default` 与 `github-dark-default` 主题，注释在代码块表面上达到 4.5:1。
- [SHOULD] 心跳条的颜色与仪表盘的状态色一致：正常为 success（按延迟分 100%、80%、60% 三档），等待为 warning，离线为 danger，维护为 60% primary。

### 布局与表面

- [SHOULD] 内容最大宽度 1280px，与仪表盘的 `max-w-7xl` 一致。
- [SHOULD] 区块间隔 24px；卡片间隔和卡片内边距 16px；行内元素间隔 8px。
- [SHOULD] 卡片、提示框、Tabs 和浮层用 `--radius-card`（HeroUI `radius-large`）；按钮、菜单项和代码块用 `--radius`（HeroUI `radius-small`）；边框为 1px `--border`（HeroUI divider）。普通卡片不加阴影，只有浮层使用 `--shadow-overlay`。
- [SHOULD] 卡片里不再嵌套卡片。
- [MUST] 页面不横向溢出：长文本先换行或在自身区域内滚动（代码块、表格、Mermaid），不隐藏整页溢出。
- [MUST] 全局预留滚动条空间（`scrollbar-gutter: stable`），内容不随滚动条出现而横移。
- [SHOULD] 断点只用以下四个：640px（顶栏内边距与仓库文字）、768px（触控尺寸）、1024px（文档侧栏，Fumadocs 的 `md` 断点设为 1024px）、1280px（本页目录）。

### 控件与状态

- [SHOULD] 图标按钮 `iconButton`：36px 方形，muted 图标，悬停和菜单展开时为 accent 底色；768px 以下至少 44px。
- [SHOULD] 每个操作区最多一个 primary 实心按钮；其余操作用描边或 ghost 按钮。
- [SHOULD] 复制操作在按钮上给出完成状态（图标短暂变为对勾）。
- [MUST] 每个可聚焦元素有可见的焦点样式：全局 2px `--ring` outline，偏移 2px；第三方控件去掉 outline 时补上同样的 outline。

### 动效

- [SHOULD] 只用 Fumadocs 自带的浮层进出动画和颜色过渡；不加滚动触发动画、视差或逐字动画。
- [SHOULD] 切换主题时不播放过渡（`disableTransitionOnChange`）。
- [MUST] 减少动效时：动画和 CSS 过渡立即完成。
- [MUST] 动效不阻挡输入和键盘导航。

### 心跳条

- [MUST] `HeartbeatStrip` 是一行等宽竖条：高 12px，条间隔 2px，条圆角 2px，条宽随容器均分；预览图中高 48px、间隔 6px、圆角 4px。
- [MUST] 心跳条是装饰：固定序列，不表示真实数据，对辅助技术隐藏（`aria-hidden`）。
- [SHOULD] 序列以正常为主，夹少量等待、离线和维护，最新的一端在右侧。

## 5. 可用原语

| 原语             | 位置                                        | 用途与变体                                                                                                |
| ---------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `SiteHeader`     | `components/site-header.tsx`                | 顶栏；`locale`                                                                                            |
| `ThemeMenu`      | `components/theme-menu.tsx`                 | 主题单选菜单（Base UI `Menu`）；`locale`                                                                  |
| `DocsBar`        | `components/docs-bar.tsx`                   | 1024px 以下的目录与搜索条，作为 `DocsLayout` 的 `header` 槽                                               |
| `iconButton`     | `components/icon-button.ts`                 | 图标按钮的类名                                                                                            |
| `Card`、`Cards`  | `components/card.tsx`、`components/mdx.tsx` | 卡片；`title`、`description`、`icon`、`href`、`external`                                                  |
| `Callout`        | `components/callout.tsx`                    | 提示框；`type`：`info`、`idea`、`warn`/`warning`、`error`、`success`；`title`                             |
| `Mermaid`        | `components/mermaid.tsx`                    | 图表；`chart`；由 Mermaid 代码块生成                                                                      |
| `HeartbeatStrip` | `components/heartbeat-strip.tsx`            | 品牌装饰；`count`（从最新一端起的条数）                                                                   |
| `OgImage`        | `lib/og-image.tsx`                          | 链接预览图模板                                                                                            |
| Fumadocs 组件    | `components/mdx.tsx`                        | `Steps`/`Step`、`Tabs`/`Tab`、`Files`/`Folder`/`File`、`Accordions`/`Accordion`、`TypeTable`、`ImageZoom` |
| 图标             | `lib/icons.tsx`                             | 侧栏与卡片可用的 lucide 图标；新图标先加入这张表                                                          |

## 6. 文案与数字格式

- [MUST] 界面文案按页面语言显示；命令、变量名、文件路径、日志和第三方产品名保持原文，不翻译。
- [SHOULD] 标题用名词短语；按钮用动词开头的短语；描述用一句话写这一页解决的问题，不重复标题。
- [SHOULD] 第三方平台、协议和 API 名称使用官方写法（Uptime Kuma、Vercel、Cloudflare Workers、EdgeOne Pages、GitHub Pages）。
- [MUST] 示例中的密钥、令牌和私有地址使用占位值，不写真实值。
- [SHOULD] 日期显示为年、月、日；最后更新时间按页面语言格式化。

## 7. 反模式

- [SHOULD] 不使用居中宣传标题加卡片网格的首页结构。
- [SHOULD] 不在卡片里嵌套卡片。
- [SHOULD] 不放装饰性图标底板或彩色图标背景。
- [SHOULD] 不使用原语之外的字号、字重或色值字面量。
- [SHOULD] 主要信息不用小号、低对比度的文字。
- [SHOULD] 不使用渐变；预览图心跳条带的渐隐遮罩除外。
- [MUST] 不用心跳条表示真实的服务状态。

## 8. 实现与接入

- [MUST] HeroUI 主题只在 `packages/theme/hero.ts` 定义；仪表盘由 `apps/web/tailwind.config.js` 加载它，文档站由 `apps/docs/app/globals.css` 的 `@plugin '@kuma-mieru/theme/hero'` 加载它。
- [MUST] 颜色 token 与字号角色只在 `packages/theme/tokens.css` 定义；文档站在 `@import 'tailwindcss'` 之后导入它，再由 Fumadocs 的 `shadcn.css` 把颜色映射为 `fd-*`。修改主题或 token 时同时检查两个应用和预览图。
- [SHOULD] 预览图不读 CSS 变量，颜色取 `packages/theme/palette.ts` 导出的 HeroUI 深色色板；字体由 `lib/og.server.ts` 注册 `@fontsource-variable/noto-sans-sc` 的全部子集（Takumi 不读系统字体）。
- [SHOULD] 字体用 `next/font/local` 加载 Fontsource 的拉丁变量字体文件（`@fontsource-variable/noto-sans-sc`、`@fontsource-variable/jetbrains-mono`），构建不访问字体服务；变量名 `--font-noto-sans` 与 `--font-jetbrains-mono`，由 `globals.css` 的 `@theme` 组成 `--font-sans` 与 `--font-mono`。
- [MUST] 主题由 next-themes 在 `html` 上切换 `dark` 类，默认跟随系统；原生控件和滚动条使用当前主题的 color-scheme。
- [SHOULD] 文档站的 MDX 组件映射在 `components/mdx.tsx`；表头与短列由 `lib/remark-label-columns.ts` 标记为不换行；内容链接由 `lib/remark-content-links.ts` 改写为页面地址。
- [SHOULD] 浮层与菜单用 Base UI（Fumadocs 默认的组件库）；图标用 lucide-react。不引入另一套组件系统。

## 词汇表

| 概念                               | 名称                    |
| ---------------------------------- | ----------------------- |
| 所有文档页共用的顶部条             | 顶栏 `SiteHeader`       |
| 顶栏左侧的图标与站名               | 品牌标识                |
| 侧栏、正文、本页目录组成的页面类型 | 长文文档                |
| 1024px 以下顶栏下方的目录与搜索条  | `DocsBar`               |
| 站点根路径的语言选择页             | 语言入口页              |
| 文档构建生成的 Open Graph 图片     | 链接预览图 `OgImage`    |
| 一行状态色竖条组成的装饰           | 心跳条 `HeartbeatStrip` |

## 待定事项

- [UNCONFIRMED] 仪表盘深色主题的 background 为纯黑；文档站长文在纯黑背景上的阅读舒适度是否需要单独的 content 色阶，尚未确认。（来源：2026-10-25 文档站初版设计决策。）
