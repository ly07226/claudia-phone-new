# PR #109 全项目扫描失败清单

扫描代码：`77e04f19d2b61e525ff54d7a43d30d26bc2ec168`。命令：`npm test -- --workers=4 --reporter=list,json`。完整退出码 1：1352 通过、153 失败、0 跳过。

这不是最终运行代码 `0f221ac` 的全量结果。最后请求调度修复及测试同步后，最终 471 项集成全部通过；其中包括完整 284 项聊天回归和 187 项受影响专项。未将不同运行的重复用例累加。

分类：完整基线也失败 38 项；中断基线曾观察到失败 40 项；尚无同名独立基线失败证据 75 项。

“完整基线”指同名用例在未修改生产源码的 main `13e9431` 完整测试组中也失败；不自动证明所有失败的断言完全相同。“中断观察”只有逐项失败记录、没有完整组退出码，不能冒充完成的基线验收。“待归因”不能直接认定为本次回归，也不能直接认定为旧问题。

| 文件 | 用例 | main 对照证据 |
|---|---|---|
| `tests/api.spec.ts` | v1 到 v2 迁移完整保留旧世界、角色、主题、桌面和资源 | 完整基线也失败 |
| `tests/backup-app-e2e.spec.ts` | 真实ZIP文件UI覆盖恢复 375px：重启后角色、聊天、世界、身份和API实际出现 | 中断基线曾观察到失败 |
| `tests/backup-zip-stream-compat.spec.ts` | new backup screen exports one ZIP without a password setup step | 完整基线也失败 |
| `tests/backup-zip.spec.ts` | 打包超限在读取数据前停止，中断不返回半份ZIP，密码错误不能降级成未加密 | 完整基线也失败 |
| `tests/backup-zip.spec.ts` | ZIP手机流程 375px：单次保存、读回预览、确认前不替换数据及分享状态准确 | 完整基线也失败 |
| `tests/backup-app-e2e.spec.ts` | 真实ZIP文件UI覆盖恢复 390px：重启后角色、聊天、世界、身份和API实际出现 | 中断基线曾观察到失败 |
| `tests/backup-zip.spec.ts` | ZIP手机流程 390px：单次保存、读回预览、确认前不替换数据及分享状态准确 | 尚无同名独立基线失败证据 |
| `tests/bubble-layout.spec.ts` | 只收起边界空行，正文内部换行、用户文本和存储原文不变 | 完整基线也失败 |
| `tests/backup-zip.spec.ts` | ZIP手机流程 430px：单次保存、读回预览、确认前不替换数据及分享状态准确 | 尚无同名独立基线失败证据 |
| `tests/backup-app-e2e.spec.ts` | 真实ZIP文件UI覆盖恢复 430px：重启后角色、聊天、世界、身份和API实际出现 | 中断基线曾观察到失败 |
| `tests/backup-zip.spec.ts` | 加密开关只保护数据不选择Key，密码确认必需，主界面支持加密ZIP读回 | 完整基线也失败 |
| `tests/character-avatar-layout.spec.ts` | 头像固定边界：375px 纵图、横图与编辑回显均不覆盖表单 | 中断基线曾观察到失败 |
| `tests/character-avatar-unified.spec.ts` | 统一头像与角色卡片：375px 三种构图、展开、编辑及聊天 | 中断基线曾观察到失败 |
| `tests/backup-app-e2e.spec.ts` | 真实导出UI：密钥主动开启强制加密，ZIP v2强KDF、错误密码失败，默认配置与身份不丢失 | 中断基线曾观察到失败 |
| `tests/character-avatar-layout.spec.ts` | 头像固定边界：390px 纵图、横图与编辑回显均不覆盖表单 | 中断基线曾观察到失败 |
| `tests/character-avatar-unified.spec.ts` | 统一头像与角色卡片：390px 三种构图、展开、编辑及聊天 | 中断基线曾观察到失败 |
| `tests/chat-friends.spec.ts` | 清空仅当前会话，删除归档/版本/修订/快照和可重建诊断；无长期记忆表，不删固定资料 | 完整基线也失败 |
| `tests/chat-friends.spec.ts` | 好友关系和申请备份候选恢复无损，v6/18表，原数据库与原角色资料保留 | 完整基线也失败 |
| `tests/character-manager.spec.ts` | 空白角色可重新编辑，更新原ID、取消不保存，长列表编辑会定位表单 | 中断基线曾观察到失败 |
| `tests/character-avatar-unified.spec.ts` | 统一头像与角色卡片：430px 三种构图、展开、编辑及聊天 | 中断基线曾观察到失败 |
| `tests/character-manager.spec.ts` | 完整资料回显，编辑保留头像/API/世界绑定/聊天版本与快照，删除保留确认 | 中断基线曾观察到失败 |
| `tests/chat-hub-polish.spec.ts` | 发表先保存再自动评论，回复自动续接；每事件一次、三轮上限、刷新不付费重发 | 完整基线也失败 |
| `tests/chat-hub-polish.spec.ts` | 发布失败零API；评论API失败保留已发动态且不自动重试 | 完整基线也失败 |
| `tests/character-manager.spec.ts` | 卡片默认折叠、独立展开、长文完整且不改数据，手机无横向溢出 | 中断基线曾观察到失败 |
| `tests/chat-hub-polish.spec.ts` | 自动互动收据兼容ZIP恢复、合并与旧数据；只读取Daily作用域且不同角色互不代发 | 完整基线也失败 |
| `tests/chat-hub-polish.spec.ts` | 连续发表先保留两条动态，自动评论串行且每条只写一次 | 完整基线也失败 |
| `tests/character-manager.spec.ts` | 顶部头像选择、更换、取消、移除与格式失败保持兼容 | 中断基线曾观察到失败 |
| `tests/chat-settings.spec.ts` | 聊天设置 375px：独立页面、备注、草稿滚动、定位、背景和持久化 | 中断基线曾观察到失败 |
| `tests/chat-settings.spec.ts` | 聊天设置 390px：独立页面、备注、草稿滚动、定位、背景和持久化 | 中断基线曾观察到失败 |
| `tests/chat-ui.spec.ts` | 浏览历史时回复不强制滚底，多版本切换保持位置，菜单在缩小视口可用 | 尚无同名独立基线失败证据 |
| `tests/chat-settings.spec.ts` | 聊天设置 430px：独立页面、备注、草稿滚动、定位、背景和持久化 | 中断基线曾观察到失败 |
| `tests/chat-settings.spec.ts` | 搜索只读有效分支、选中版本和当前会话；置顶排序稳定、取消恢复原序 | 中断基线曾观察到失败 |
| `tests/chat-settings.spec.ts` | 备注不进入 Prompt；会话设置及背景资源备份候选恢复无损，正式库保持不变 | 中断基线曾观察到失败 |
| `tests/character-manager.spec.ts` | 迟到上传不覆盖输入或恢复取消的表单；已删除角色不可被保存复活 | 中断基线曾观察到失败 |
| `tests/image-send.spec.ts` | 附件菜单、选择移除、图片草稿刷新、图片加文字发送持久化及大图：375 | 中断基线曾观察到失败 |
| `tests/image-send.spec.ts` | 附件菜单、选择移除、图片草稿刷新、图片加文字发送持久化及大图：390 | 中断基线曾观察到失败 |
| `tests/image-send.spec.ts` | 附件菜单、选择移除、图片草稿刷新、图片加文字发送持久化及大图：430 | 中断基线曾观察到失败 |
| `tests/identity-input-search.spec.ts` | 用户身份 375px：旧字段、头像、取消、刷新、聊天同步与世界隔离 | 中断基线曾观察到失败 |
| `tests/identity-input-search.spec.ts` | 用户身份 390px：旧字段、头像、取消、刷新、聊天同步与世界隔离 | 中断基线曾观察到失败 |
| `tests/lore-editor.spec.ts` | iPhone 点击明确导入按钮触发文件选择器并预览确认 | 中断基线曾观察到失败 |
| `tests/lore-fold.spec.ts` | 默认折叠、开关独立、展开状态不因持久化丢失，刷新仍保留启停 | 中断基线曾观察到失败 |
| `tests/identity-input-search.spec.ts` | 用户身份 430px：旧字段、头像、取消、刷新、聊天同步与世界隔离 | 中断基线曾观察到失败 |
| `tests/identity-input-search.spec.ts` | 身份备份候选无损、主题保存保留身份、未知旧字段及空间独立，v6/18表 | 中断基线曾观察到失败 |
| `tests/lore.spec.ts` | 手机原生世界书与条目 CRUD、启停、关键词编辑、导出 | 中断基线曾观察到失败 |
| `tests/lore-editor.spec.ts` | 完整编辑器保存、折叠摘要、复制、非法正则提示和普通 v4 默认值 | 中断基线曾观察到失败 |
| `tests/lore-fold.spec.ts` | 搜索筛选、分页、书复制与二次确认删除，筛选不清除展开状态 | 中断基线曾观察到失败 |
| `tests/lore.spec.ts` | 常驻、命中、未命中、辅助逻辑、禁用、预算和世界隔离 | 中断基线曾观察到失败 |
| `tests/lore-editor.spec.ts` | 纯函数激活、稳定排序、概率边界、正则安全、位置与扫描深度独立 | 中断基线曾观察到失败 |
| `tests/lore-fold.spec.ts` | 导入后仍折叠，禁用后 Prompt 立即不注入且绑定和条目不变 | 中断基线曾观察到失败 |
| `tests/memory-magnet-concurrency.spec.ts` | interrupted claim never auto-retries; explicit recovery requires failed status | 完整基线也失败 |
| `tests/memory-magnet-outgoing-request.spec.ts` | message-level recall reaches actual model request and removing tag stops return: openai-compatible | 完整基线也失败 |
| `tests/memory-magnet-outgoing-request.spec.ts` | message-level recall reaches actual model request and removing tag stops return: gemini | 完整基线也失败 |
| `tests/lore.spec.ts` | ST 适配、未知字段、预览确认、失败保护与 Native 往返 | 中断基线曾观察到失败 |
| `tests/lore-editor.spec.ts` | 最终 API 请求保留 Role，Gemini 安全降级并保留位置内容 | 完整基线也失败 |
| `tests/lore.spec.ts` | v3 到 v4 增量迁移保留每张旧表，事务失败不留下半本世界书 | 中断基线曾观察到失败 |
| `tests/lore-editor.spec.ts` | 明确角色不支持时安全降级一次，异常正则不会冻结聊天 | 中断基线曾观察到失败 |
| `tests/memory-v2-concurrency.spec.ts` | 容量保护在API前生效；策略放宽后恢复且不删除原记录 | 完整基线也失败 |
| `tests/memory-v2-management.spec.ts` | 20轮自动总结真实路径更新短期UI且只调用一次，手动核心原样保护 | 完整基线也失败 |
| `tests/messages.spec.ts` | v4 消息无损迁移为单版本，其他表逐条保持不变 | 中断基线曾观察到失败 |
| `tests/phone.spec.ts` | 全部入口可点击，主题与壁纸持久化，世界角色隔离 | 中断基线曾观察到失败 |
| `tests/private-notes.spec.ts` | generation timeout does not save; lock released for manual recovery | 尚无同名独立基线失败证据；后续已修复超时模拟清理，最终复测通过 |
| `tests/phone.spec.ts` | 长按、拖动、跨页移动及刷新保存 | 中断基线曾观察到失败 |
| `tests/phone.spec.ts` | 真实触摸事件排序、小组件及存储故障提示 | 完整基线也失败 |
| `tests/raw-history-input.spec.ts` | 30000条索引确实在构建时输入中文草稿 390 | 完整基线也失败 |
| `tests/raw-history-input.spec.ts` | 30000条索引确实在构建时输入中文草稿 430 | 尚无同名独立基线失败证据 |
| `tests/raw-history-responsiveness.spec.ts` | 冷索引与帧响应、连续发送及移动端输入 daily/30000 | 尚无同名独立基线失败证据 |
| `tests/real-time.spec.ts` | 默认关闭、按聊天独立保存、刷新保留，真实请求随开关动态包含日期分钟与设备时区 | 完整基线也失败 |
| `tests/real-time.spec.ts` | 原始时间戳、明确的本轮前间隔与无效时间安全降级，不读取版本生成时间 | 尚无同名独立基线失败证据 |
| `tests/real-time.spec.ts` | 会话设置通过现有备份与候选恢复保留，不修改正式库和数据库结构 | 尚无同名独立基线失败证据 |
| `tests/real-time.spec.ts` | 17:40现实问时优先设备时间；时段阈值、跨日、明确继续意图及剧本时间边界 | 尚无同名独立基线失败证据 |
| `tests/real-time.spec.ts` | 实际请求时段边界：openai-compatible / A 跨夜早安 | 尚无同名独立基线失败证据 |
| `tests/real-time.spec.ts` | 实际请求时段边界：openai-compatible / B 六小时后晚间问候 | 尚无同名独立基线失败证据 |
| `tests/real-time.spec.ts` | 实际请求时段边界：openai-compatible / C 十分钟继续点餐 | 尚无同名独立基线失败证据 |
| `tests/real-time.spec.ts` | 实际请求时段边界：openai-compatible / D 八小时后明确续写 | 尚无同名独立基线失败证据 |
| `tests/real-time.spec.ts` | 实际请求时段边界：gemini / A 跨夜早安 | 尚无同名独立基线失败证据 |
| `tests/script-config.spec.ts` | 旧世界编辑不隐式配置，原聊天及关联保持，版本增量及并发保护 | 尚无同名独立基线失败证据 |
| `tests/real-time.spec.ts` | 实际请求时段边界：gemini / B 六小时后晚间问候 | 尚无同名独立基线失败证据 |
| `tests/real-time.spec.ts` | 实际请求时段边界：gemini / C 十分钟继续点餐 | 尚无同名独立基线失败证据 |
| `tests/raw-history-recall.spec.ts` | 4至14天旧事件按相关话题召回，较新明确态度优先于旧偏好 | 完整基线也失败 |
| `tests/real-time.spec.ts` | 实际请求时段边界：gemini / D 八小时后明确续写 | 尚无同名独立基线失败证据 |
| `tests/script-wizard-creation.spec.ts` | 原子创建、并发幂等、身份独立与角色关联，无聊天和主线写入 | 完整基线也失败 |
| `tests/real-time.spec.ts` | 实际请求信号与可靠性：30分钟问候优先新时段 | 尚无同名独立基线失败证据 |
| `tests/script-wizard.spec.ts` | 五步导航、返回、刷新、真实创建及身份静态复制；无模型调用 | 完整基线也失败 |
| `tests/storage-audit.spec.ts` | 3.0.2-A 只读核对现有v7全部20表及主键索引 | 完整基线也失败 |
| `tests/spaces.spec.ts` | 复用世界 CRUD，重命名保持稳定ID，删除活动世界安全回到列表 | 完整基线也失败 |
| `tests/spaces.spec.ts` | 生成中切换空间保留原请求，回复只写入原空间，另一空间不受影响 | 尚无同名独立基线失败证据 |
| `tests/spaces.spec.ts` | 日常角色管理默认基础角色不自动关联首世界，世界入口仍选中对应世界 | 尚无同名独立基线失败证据 |
| `tests/spaces.spec.ts` | 三级路由、刷新/后退及真实存档入口保留全部数据：standalone=false | 尚无同名独立基线失败证据 |
| `tests/spaces.spec.ts` | 三级路由、刷新/后退及真实存档入口保留全部数据：standalone=true | 尚无同名独立基线失败证据 |
| `tests/story-reading-settings.spec.ts` | 背景上传更换移除、透明度仅影响图片，保存刷新与恢复默认不丢数据 | 完整基线也失败 |
| `tests/story-round-cards.spec.ts` | 回合正文/已提交行动分卡，contain/cover及旧偏好不丢失 375 | 完整基线也失败 |
| `tests/story-round-cards.spec.ts` | 回合正文/已提交行动分卡，contain/cover及旧偏好不丢失 390 | 尚无同名独立基线失败证据 |
| `tests/story-storage.spec.ts` | v6→v7 增量升级保留所有表与记录，旧聊天原 ID 不变 | 完整基线也失败 |
| `tests/story-storage.spec.ts` | 旧 v5 真实格式覆盖恢复至 v7，新表安全为空 | 尚无同名独立基线失败证据 |
| `tests/story-round-cards.spec.ts` | 回合正文/已提交行动分卡，contain/cover及旧偏好不丢失 430 | 尚无同名独立基线失败证据 |
| `tests/story-storage.spec.ts` | 旧 v6 真实格式覆盖恢复至 v7，新表安全为空 | 尚无同名独立基线失败证据 |
| `tests/story-segments.spec.ts` | 结构化片段 ZIP overwrite 及 ID 冲突映射 | 完整基线也失败 |
| `tests/story-segments.spec.ts` | 结构化片段 ZIP merge 及 ID 冲突映射 | 尚无同名独立基线失败证据 |
| `tests/story-storage.spec.ts` | 升级前 v6 回退副本核验后可恢复，新表必须为空 | 尚无同名独立基线失败证据 |
| `tests/theme-backup.spec.ts` | 主题调色板与受限 CSS ZIP 往返 overwrite | 完整基线也失败 |
| `tests/theme-core.spec.ts` | 受限 CSS 语法、选择器、数值界限与注入拒绝 | 完整基线也失败 |
| `tests/theme-backup.spec.ts` | 主题调色板与受限 CSS ZIP 往返 merge | 尚无同名独立基线失败证据 |
| `tests/theme-core.spec.ts` | 保存合并当前记录，保护身份、媒体、字体及并发设置，不升级数据库 | 尚无同名独立基线失败证据 |
| `tests/theme-backup.spec.ts` | 旧 v5 备份保持原主题，不补写调色板 | 尚无同名独立基线失败证据 |
| `tests/theme-backup.spec.ts` | 旧 v6 备份保持原主题，不补写调色板 | 尚无同名独立基线失败证据 |
| `tests/theme-global.spec.ts` | 全局页面配色 white 390 | 完整基线也失败 |
| `tests/theme-priority.spec.ts` | 全局/会话背景、壁纸、气泡与受限 CSS 优先级；编辑器及安全恢复隔离 | 完整基线也失败 |
| `tests/theme-global.spec.ts` | 全局页面配色 white 430 | 尚无同名独立基线失败证据 |
| `tests/theme-global.spec.ts` | 全局页面配色 midnight 390 | 尚无同名独立基线失败证据 |
| `tests/theme-editor.spec.ts` | 预设二次编辑、HEX/取色器、草稿预览不写库、取消/退出 390 | 完整基线也失败 |
| `tests/theme-global.spec.ts` | 全局页面配色 midnight 430 | 尚无同名独立基线失败证据 |
| `tests/theme-global.spec.ts` | 全局页面配色 sage 390 | 尚无同名独立基线失败证据 |
| `tests/viewport-diagnostics.spec.ts` | 默认关闭，无测量探针、不持久保存任何诊断记录 | 完整基线也失败 |
| `tests/theme-global.spec.ts` | 全局页面配色 sage 430 | 尚无同名独立基线失败证据 |
| `tests/theme-global.spec.ts` | 全局页面配色 pink 390 | 尚无同名独立基线失败证据 |
| `tests/theme-chat-acceptance.spec.ts` | 切换即时同步、刷新与独立背景/气泡/媒体优先级 390 | 完整基线也失败 |
| `tests/theme-global.spec.ts` | 全局页面配色 pink 430 | 尚无同名独立基线失败证据 |
| `tests/theme-chat-acceptance.spec.ts` | 切换即时同步、刷新与独立背景/气泡/媒体优先级 430 | 尚无同名独立基线失败证据 |
| `tests/theme-editor.spec.ts` | 预设二次编辑、HEX/取色器、草稿预览不写库、取消/退出 430 | 尚无同名独立基线失败证据 |
| `tests/theme-global.spec.ts` | 全局页面配色 blue 390 | 尚无同名独立基线失败证据 |
| `tests/visual-polish.spec.ts` | 阅读排版、45–55%原抽屉、D选项、草稿及键盘 390 | 完整基线也失败 |
| `tests/visual-polish.spec.ts` | 阅读排版、45–55%原抽屉、D选项、草稿及键盘 430 | 尚无同名独立基线失败证据 |
| `tests/theme-global.spec.ts` | 全局页面配色 blue 430 | 尚无同名独立基线失败证据 |
| `tests/visual-polish.spec.ts` | 真实状态链路、短详情紧凑与成功恢复 daily 390 | 尚无同名独立基线失败证据 |
| `tests/viewport-diagnostics.spec.ts` | 记录完整祖先、样式、内联高度与空白命中元素，不改布局、不导出私密内容 | 尚无同名独立基线失败证据 |
| `tests/theme-global.spec.ts` | 全局页面配色 purple 390 | 尚无同名独立基线失败证据 |
| `tests/visual-polish.spec.ts` | 真实状态链路、短详情紧凑与成功恢复 world 390 | 尚无同名独立基线失败证据 |
| `tests/theme-global.spec.ts` | 全局页面配色 purple 430 | 尚无同名独立基线失败证据 |
| `tests/visual-polish.spec.ts` | 真实状态链路、短详情紧凑与成功恢复 story 390 | 尚无同名独立基线失败证据 |
| `tests/theme-global.spec.ts` | 全局页面配色 caramel 390 | 尚无同名独立基线失败证据 |
| `tests/visual-polish.spec.ts` | 真实状态链路、短详情紧凑与成功恢复 daily 430 | 尚无同名独立基线失败证据 |
| `tests/theme-global.spec.ts` | 全局页面配色 caramel 430 | 尚无同名独立基线失败证据 |
| `tests/visual-polish.spec.ts` | 真实状态链路、短详情紧凑与成功恢复 world 430 | 尚无同名独立基线失败证据 |
| `tests/theme-editor.spec.ts` | 保存实际颜色及 CSS，刷新恢复，不按预设重置自定义；恢复默认只重置配色 | 尚无同名独立基线失败证据 |
| `tests/visual-polish.spec.ts` | 真实状态链路、短详情紧凑与成功恢复 story 430 | 尚无同名独立基线失败证据 |
| `tests/visual-polish.spec.ts` | 长错误滚动、脱敏与主题切换 story | 尚无同名独立基线失败证据 |
| `tests/viewport-diagnostics.spec.ts` | 复制可在手机点击使用，复制失败可展开只读文本；关闭清理只影响诊断 | 尚无同名独立基线失败证据 |
| `tests/visual-polish.spec.ts` | 取消立即移除状态且不追加请求 daily | 尚无同名独立基线失败证据 |
| `tests/visual-polish.spec.ts` | 取消立即移除状态且不追加请求 world | 尚无同名独立基线失败证据 |
| `tests/visual-polish.spec.ts` | 取消立即移除状态且不追加请求 story | 尚无同名独立基线失败证据 |
| `tests/visual-polish.spec.ts` | 重新进入剧本：历史失败不伪造HTTP，取消不误报失败 | 尚无同名独立基线失败证据 |
| `tests/theme-editor.spec.ts` | 无效 HEX/CSS 不可保存、有效 CSS 不影响编辑器和外层，支持清空恢复 | 尚无同名独立基线失败证据 |
| `tests/viewport-diagnostics.spec.ts` | 显式开启标记跨刷新记录启动、模式及高度，后台恢复采样且不自动写数据库 | 尚无同名独立基线失败证据 |
| `tests/wizard-automatic.spec.ts` | 文件归档期间离开向导，不在卸载后启动付费理解请求 | 尚无同名独立基线失败证据 |
| `tests/theme-editor.spec.ts` | 安全模式不删除配置，直接进入受保护编辑器并可恢复默认 | 尚无同名独立基线失败证据 |
| `tests/viewport-diagnostics.spec.ts` | 简短诊断保留首次布局及首次滚动对照，后续设置和采样不覆盖，复制不超过1200字符 | 尚无同名独立基线失败证据 |
| `tests/theme-editor.spec.ts` | 存储写入失败保留草稿、不伪报成功 | 尚无同名独立基线失败证据 |
| `tests/viewport-diagnostics.spec.ts` | 异常首次高度与滚动后恢复可对照，动作前采样只读且不遗漏内联高度 | 尚无同名独立基线失败证据 |
| `tests/theme-editor.spec.ts` | 气泡配色应用于实际聊天；会话背景与媒体引用保持独立，CSS不越过手机 | 尚无同名独立基线失败证据 |
| `tests/theme-editor.spec.ts` | 恢复默认配色保留壁纸、上传图标、布局及独立字体设置 | 尚无同名独立基线失败证据 |
| `tests/theme-editor.spec.ts` | 损坏的可选主题配置可降级并通过安全编辑器恢复，不自动改写 | 尚无同名独立基线失败证据 |
| `tests/theme-editor.spec.ts` | 全局变量在空间列表、剧情世界与日常之间切换后保留，不复制世界身份 | 尚无同名独立基线失败证据 |
| `tests/theme-editor.spec.ts` | 语义颜色预览确实覆盖旧通用样式，互不串色 | 尚无同名独立基线失败证据 |
