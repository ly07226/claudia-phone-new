# 2.3.4.4 消息组布局补丁

基于 b0457b8。只调整 MessageUI 显示结构与聊天 CSS；未修改 splitAssistantBubbles、API、Prompt、IndexedDB v5、世界书、版本或历史分支逻辑。

## 问题与修复

- 原消息组上下 margin:10px 在正常块布局中折叠，实际组间只有10px；改为相邻消息组单侧16px，不重复叠加。
- 原分气泡是全宽块元素；改为纵向 Flex、align-items:flex-start、各气泡 fit-content/max-width:100%，长句受可用宽度限制并正常换行，短句自然收窄。
- 组内只由 gap:6px 控制；移除子气泡 margin。头像仍只出现一次，与首气泡顶部对齐；后续左边缘一致。
- 版本切换器作为同一 Flex 的最后一项，与最后气泡相距6px，不叠加 margin。单版本仍完全不渲染。
- 连续换行会在 pre-wrap 文本末尾额外撑出空白行（实测单个额外行约24px）。AssistantBubbleText 仅将片段边界换行包装为不参与布局的 span，字符仍保留在 DOM/textContent 与原始 Message 中；正文内部换行、缩进及用户消息显示不变。没有重分段或重写文本，复制/编辑继续使用原始 Message。

## 文件

- src/style.css：组间/组内间距、宽度和边界换行的显示样式。
- src/MessageUI.tsx：仅为 AI 片段的边界换行添加显示包装，沿用原组菜单、头像、长按与版本控件。
- tests/bubble-layout.spec.ts：布局和原文回归。

## 验证范围

新增测试覆盖390px、320px窄屏与844px横屏；测量每对气泡6px、消息组16px、版本距末气泡6px；短气泡小于长气泡、统一左边缘、一次头像和菜单、单版本无占位、横向无溢出。验证普通和缩小视口下末气泡及版本控件不被输入框遮挡、长按子气泡编辑完整消息，以及仅收起边界空行、内部换行和数据库原文不变。

Playwright 使用 iPhone 触摸视口，不等同真实 iOS Safari。仍需人工确认 Safari 地址栏、键盘、实际安全区和自然滚动体验。

验证结果：`npm run typecheck`、`npm run build` 通过；`npm test` 全部55项通过（原有52项 + 新增3项布局回归）。
