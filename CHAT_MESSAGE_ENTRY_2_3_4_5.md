# 2.3.4.5 极简消息操作入口

基于8a77f7f。移除消息气泡中的名称、编辑标签和常显省略号按钮，不渲染 message-top，因此没有原28px标题区占位。聊天导航名称、左右头像、消息配色及6px组内/16px组间布局保留。

所有片段仍属于同一Message容器。沿用原MessageTools处理复制、编辑、重新生成、删除、条件撤回、修订和版本/分支操作。单版本没有选择器，多版本仍在消息组下方。未修改splitAssistantBubbles、API、Prompt、世界书、IndexedDB v5或聊天隔离逻辑。

长按仍为500ms。指针移动超过10px、实际滚动、pointerup、pointercancel和组件卸载均取消计时；只在正在等待长按时监听scroll，及时移除监听。保留pan-y/pinch-zoom。触屏原生contextmenu被取消，由定时器决定菜单开启；桌面右键打开同一菜单。

气泡内关闭user-select与iOS touch callout，以避免系统文字选择干扰长按。复制仍走原始完整Message与现有Clipboard API；拒绝授权时，原来的可选择textarea回退保持可用，编辑器和菜单没有禁止选择文本。

每条Message保留一个真正的可访问button，具有原有操作名称与aria-haspopup=dialog。它绝对定位、裁切至1px，不参与正常排版，屏幕阅读器可以通过按钮导航访问；键盘焦点时才显示“消息操作”，支持Enter/Space。Shift+F10/ContextMenu键也可打开操作菜单。编辑状态保留为aria-description，不绘制额外标题。键盘触发不会被长按后的触控点击抑制逻辑吞掉。

旧UI测试仅将常显按钮点击改为可访问键盘入口，保留原消息业务断言；新增message-entry.spec.ts覆盖Daily/World名称/按钮与占位消失、500ms长按、所有子气泡完整消息、用户菜单、移动/滚动/取消/短按不误触、右键、键盘与聚焦反馈、缩小视口、版本切换和手动复制回退。

自动化使用Playwright Chromium触摸视口，不等同真实iPhone Safari。仍需真机确认：系统长按菜单抑制、实际手势滚动、VoiceOver导航、键盘/候选栏与Safari地址栏及安全区中的弹窗可用性。

修改文件：src/MessageUI.tsx、src/useMessagePress.ts、src/style.css；新增tests/message-entry.spec.ts，更新tests/messages.spec.ts、tests/chat-ui.spec.ts、tests/bubbles.spec.ts、tests/bubble-layout.spec.ts的操作入口/布局稳定等待，保留原业务断言。

最终验证：TypeScript、Production build通过；全部59项自动化测试通过（原有55项 + 新增4项）。视口缩小后静止长按测试另连续运行3次通过。首轮开发服务器页面重载导致的旧入口超时、旧布局测试未等待滚动完成的时序问题已复核；最终固定文件的全量运行全部通过。
