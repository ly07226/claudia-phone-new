# 3.0.1 空间入口与手机导航

永久daily空间与world:<worldId>空间复用原手机UI，不按世界复制Character。空间卡片进入桌面，始终不清除或重新初始化聊天。已有游戏进度在本阶段明确指已有世界聊天消息；空Conversation不算聊天进度。不实现新存档槽/覆盖新游戏。剧本管理直接复用抽出的Worlds组件与原有CRUD及删除二次确认。

spaces.ts是唯一空间身份/路由管理器。URL hash记录#spaces、#worlds或#phone/daily、#phone/world/<编码worldId>，世界名称不参与身份。独立localStorage键claudia.navigation.v1仅保存版本和导航route，不保存API Key、消息、外观或完整存档。启动优先恢复URL，其次轻量导航记录，并检查世界存在；损坏或已删除世界回到列表，绝不退到别的世界。导航保存失败有提示，不影响进入日常手机。

进入、退出和浏览器前后退都会重置App视图到当前空间桌面，卸载旧聊天后切换身份。手机状态栏提供返回空间列表，实际会话中由会话管理菜单提供同名入口。Chat在卸载时取消自己的pending请求并沿用现有取消广播、持久化token、finally释放及迟到响应保护；不清除其他会话，不改Provider/Prompt实现。角色管理的明确“进入世界聊天”捷径会先通过空间管理器切换空间。原worldId管理筛选字段不是空间身份，聊天仅取集中式当前空间worldId。

IndexedDB保持v5，没有升级或迁移，没有清库，没有更改API配置/凭据或任何记录的归属。Daily/World聊天、世界书作用域、版本、快照和消息业务继续使用原有引擎。进度提示通过liveQuery只读取世界Conversation与消息计数，不复制/拼接上下文。

尚未实现（留待3.0.2～3.0.5分别设计）：世界独立壁纸/主题、桌面图标/页面/小组件、资源库/头像素材、相册、手记/备忘录、音乐等App内容、独立API配置范围、空间级长期记忆及完整多存档。当前桌面/主题/Asset/API配置/Character基础资料仍共用，部分App仍是占位页。空间入口不等于这些数据已经独立。刷新恢复所选空间的桌面，不恢复打开的App/输入草稿，不宣称已有完整游戏存档系统。

回归配置为旧62项测试预置已保存的daily导航，使原测试仍以手机入口为基线；新spaces.spec.ts覆盖全新无保存记录的实际启动。旧世界聊天测试通过新管理器进入对应空间，保留原布局、数据与业务断言。自动化触摸视口不等同真实iPhone Safari；地址栏/安全区、系统返回手势、键盘和生成中退出仍需真机人工验收。

历史写入异常时不激活新身份，仍停留原路由并显示提示，避免地址栏与内存空间错位；连续目的地请求采用递增序号，只有最后一次校验结果能提交。导航失败与快速切换亦有自动化覆盖。原桌面长按计时器在手机卸载时清理，防止退出后延迟进入编辑模式。

主要文件：src/spaces.ts（统一身份与路由）、src/SpaceSelection.tsx（启动与入口）、src/Worlds.tsx（原CRUD抽出复用）、src/main.tsx（共享手机集成）、src/CharacterManager.tsx（世界聊天捷径）、src/ChatManagement.tsx（退出入口）、src/Chat.tsx（卸载取消与UI过期保护）、src/style.css；playwright.config.ts及旧3个世界入口fixture适配，新增tests/spaces.spec.ts。未修改store.ts数据库定义、chatContext、chatService、messageOperations、Lorebook或Provider。

日常手机的角色管理在没有明确管理筛选时默认全部基础角色，不再自动选第一个世界；新建日常角色不会因已有世界而自动关联。世界手机仍由进入空间时设置对应世界筛选，从世界管理明确“查看角色”的原流程保持可用。

最终验证：`npm run typecheck`与`npm run build`通过；`npm test`全部70项通过（原有62项 + 新增8项）。导航失败后的旧提示在成功导航后仅清理自身，不会清除其他API/存储错误。真实iPhone Safari验收仍待人工完成。
