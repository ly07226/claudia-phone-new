# 2.3.4.6 统一聊天内容边界

基于3f77637。生产代码仅修改src/style.css，不修改MessageUI、分段函数、原始内容、IndexedDB v5、API、Prompt、世界书、版本/分支或Daily/World逻辑。

消息行统一为三列Grid：34px头像、minmax(0,1fr)内容、34px头像，列间距8px。参数由CSS变量共享，内容列随消息区可用宽度伸缩，现有12px消息区内边距及安全区继续生效。AI头像明确放第1列、用户头像放第3列，全部消息内容固定第2列，不需要创建空头像或占位节点。

消息内容列是宽度100%的弹性容器；AI消息组靠左、用户消息组靠右。气泡保留fit-content与max-width:100%、min-width:0，长文本依靠原有overflow-wrap:anywhere/word-break:break-word换行。所有AI子气泡共用内容列约束。版本控件留在组下方并限制max-width:100%，AI版本组左对齐。短用户气泡的键盘操作入口从右侧锚定，聚焦时也不跨入头像列。

头像尺寸、颜色、圆角、6px组内及16px组间间距、长按与可访问操作入口均保留。

新增tests/bubble-boundaries.spec.ts：Daily/World均检查280/320/360/375/390/414/430px及844px横屏；逐个测量长中文、长英文、URL、连续字符、短气泡、所有子气泡与版本控件的左右边界、头像位置和溢出情况；验证长按完整消息、版本切换、用户键盘入口边界及末条不被输入框遮挡。原测试保留。

自动化为Chromium触摸视口，不等同真实iPhone Safari。仍需真机复核实际横竖屏、安全区、键盘与长按体验。

验证结果：`npm run typecheck`、`npm run build`通过；`npm test`全部62项通过（原有59项 + 新增3项）。
