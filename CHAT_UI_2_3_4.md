# 2.3.4 移动聊天界面适配

基于 a6ce053 的 UI 补丁。只修改聊天组件、消息展示、管理菜单及视口/名称读取辅助函数，未修改数据库、生成服务、Prompt、有效路径、版本/分支操作、世界书或 Provider 引擎。IndexedDB 仍为 v5，没有迁移、清理或重新初始化。

## 导航和头像

实际会话采用 44px / minmax(0,1fr) / 44px 对称三段导航，返回原角色列表、居中角色名称、管理菜单。名称单行省略，不受按钮宽度影响；顶部不放头像、在线状态、模式说明卡片。

当前 Character 只有 name，没有备注字段；WorldCharacterProfile 也没有独立名称覆盖字段。`chatPresentation.ts` 仅使用当前 conversation.characterId 对应角色的 name，空名称回退“未命名角色”。本阶段没有提供备注设置，也不覆盖原名或添加字段。

AI 消息左侧读取当前角色 avatar 对应的既有 Asset.data，缺失或图片加载失败时使用名称首字占位。用户消息右侧使用 UserRound 占位，因为项目没有用户头像/资料配置，不会拿另一个角色的头像冒充用户。头像 34px；顶部无头像。多版本选择器在气泡表面下方，仍保留原有操作与可访问标签。

## 管理功能

右上角“会话管理”面板包含会话信息、会话 API、真实连接测试、历史快照/恢复、底部危险删除。Daily/World 的说明只在主动打开信息时显示，按实际 conversation.mode/worldId 读取。

API 选择仍只更新当前 conversation.apiConfigId；连接测试使用原 resolveApi 优先级及 testConnection，真实发送当前配置模型的极短请求，不模拟成功、不展示 Key。测试可能计费。快照/修订仍走原消息管理逻辑。删除需要两次确认，只作用于当前会话。

面板复用已有 MessageSheet 的空白/Escape 关闭、焦点管理、VisualViewport 和内部滚动。普通聊天不常驻 API 状态、测试结果、开发提示或快照入口；必要错误可关闭，成功反馈 4 秒后消失。

## 单一滚动与输入

会话布局为普通 Flex 流中的导航、flex:1/min-height:0 消息区和紧凑底部输入区。原 app-scroll 在实际会话中不再滚动，消息区为唯一主滚动容器；长输入和长弹窗拥有必要的内部滚动。

输入默认 40px 单行，随内容增长，最大取 120px 与可见视口 28% 的较小值；超过后输入框内部滚动。发送/取消按钮始终在侧边，取消请求仍使用原 AbortController。底栏不覆盖消息区，底部安全区只添加一次。

打开会话和主动发送定位到底部；收到回复时，仅当用户仍接近底部才跟随。用户浏览历史时保持位置。版本切换、本地编辑/删除不请求强制滚底，保持原 scrollTop 并在必要时由滚动边界截断。

返回角色列表会取消当前请求、使 UI 回调序号失效；旧读取/请求完成后不能把旧角色消息绘制进新角色界面。没有改动底层生成锁与数据写入。

## Safari 视口和状态栏

仅实际会话加上 chat-conversation/chat-stage 类：隐藏应用自绘状态栏与旧通用 App 标题栏，并同步移除原预留高度。桌面、角色列表和其他 App 保留原状态栏和布局。不会尝试隐藏 iPhone 系统状态栏或 Safari 工具栏。

移动端/触摸设备只固定一个外层聊天视口壳到 VisualViewport 的 height/offsetTop；导航、消息和输入区不分别 fixed，避免互相覆盖。CSS 使用 vh/svh/dvh 回退，内层有 min-height:0；同时监听 resize、orientationchange、VisualViewport resize/scroll 及输入焦点变化。

顶部安全区应用一次，底部安全区只在输入区应用一次；检测键盘缩小时不再叠加无意义底部安全留白。横屏触摸设备同样使用全宽聊天布局，不误入桌面侧栏布局。浏览器缩放比例不为 1 时暂停强行重设视口，不设置禁止缩放或全局 touch-action:none，不禁止消息正常滚动。退出聊天会移除类、CSS 变量与事件监听。

## 修改文件

- src/Chat.tsx：三段导航、管理入口、单一滚动、输入/导航 UI 状态。
- src/MessageUI.tsx：消息侧边头像和气泡/版本展示，不改消息操作实现。
- src/ChatManagement.tsx：收纳已有管理功能，连接测试调用原服务。
- src/useChatViewport.ts：聊天专用动态视口与输入高度。
- src/chatPresentation.ts：现有名称的只读回退解析。
- src/style.css：仅聊天类作用域的布局与样式。
- tests/chat-ui.spec.ts：新 UI/几何/导航回归。
- tests/messages.spec.ts：快照入口测试改为先打开管理菜单，保留旧断言。

## 测试和真机边界

自动化覆盖标题居中/省略、无顶部头像与多余状态栏、实际 World 角色与名称回退、左右头像和图片错误回退、菜单/API 选择/真实请求构建、快照入口、删除二次确认、消息主滚动、输入自增高、末条不遮挡、320px 窄屏、视口缩小、横竖屏、浏览历史不强制滚底、版本切换位置、缩小视口下编辑保存取消可见，以及生成中返回后 UI 不串角色。

保留原有全部 40 个自动化用例。API 网络验证使用合成凭据与模拟响应，不代替付费 Provider 线上测试。

**仍需真实 iPhone Safari 人工验收**：地址栏展开/收起的连续动画；系统键盘弹出与收起、输入法候选栏和听写；刘海/灵动岛与主屏幕 PWA 安全区；横竖屏切换；长按和文本选择；剪贴板权限；键盘与编辑/管理弹窗同时显示；系统缩放/双指缩放与后台恢复。Playwright 触摸视口及 setViewportSize 不等同真实 iOS 系统键盘，不声称真机验收完成。

验证结果：`npm run typecheck` 通过；`npm run build` 通过；`npm test` 全部 46 项通过（原有 40 项 + 新增 6 项）。测试环境为 Playwright Chromium / iPhone 13 触摸视口，未执行真实 iPhone Safari 测试。
