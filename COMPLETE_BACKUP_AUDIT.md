# 完整备份与导入审计、实现及验收

## 基线、证据与尚未证实的真机原因

审计基线是本地与远程 main `a6861ce8c67e1d97a09b75b000405a968fb6960b`，数据库 v6/18表，原有 `artifacts/desktop-mobile.png` 修改保留。没有重置用户浏览器或更改数据库版本。

已确认缺陷：

1. 原 `restoreService.replace` 在 `report` 存在时 `continue` 跳过 `apiConfigs`、`apiCredentials`，并将目标原摘要填回预期摘要。这能验证“保持本地 API 未变”，不能说明备份 API 已恢复；空手机必然丢失 API 配置。现已在隔离导入计划中按选择处理配置和凭据，正式原子事务提交完整的最终结果。
2. 原 `store.init` 在 pages 为空时无条件 `themes.put(defaultTheme)`。身份实际在 `themes.global.userIdentities`，因此缺失桌面页的旧数据初始化会覆盖身份。现仅在全局主题不存在时建立默认主题，并有专门回归。
3. 原恢复UI在busy期间无条件阻止beforeunload，成功提交后仍未放行自身reload。在支持该事件的浏览器会阻挡自身刷新；现在以同步提交标识放行自身重载，同时保持旧页写入锁。浏览器端到端断言成功重载事件未被阻止。这是已修复的导航风险，不能单独认定是原iPhone事件根因（iOS对该事件支持有限）。
4. 原预览只给总记录数，无法区分“112条记录但0个角色”与“2个角色已写入但UI未读到”。原恢复测试大多重开随机库后查表，未完整驱动来源应用→ZIP→空应用→启动→聊天列表。本次增加真实应用跨隔离浏览器存储容器的UI验收和启动复核。

不能将上述API/主题问题冒充“空列表”的已证实根因。**在任何产品代码修改前**，基线端到端测试已证明：来源含2角色、3会话、Daily/World消息和身份时，原恢复能够在空应用刷新后显示2个角色，但API数量为0。用户那份112条/9资源原文件及真机存储日志没有提供，无法判断其具体数据与运行容器，也不归咎用户选错文件。

代码证据与诊断边界：

- `backupService.createBackup` 遍历 `backupTables` 原库全部记录，没有按世界、好友或UI可见性过滤角色；默认唯一排除表是 `apiCredentials`，API配置仅脱敏潜在秘密。
- `store.reload` 直接读取 `db.characters.toArray()`；`Chat` 的“还没有角色”只在 `s.characters.length === 0` 时出现。好友被删除会显示不同的“暂无日常好友”提示，不能单凭该现象断言是好友状态。世界列表则使用 worldProfiles 过滤。
- 正式写入连接和应用连接均来自 `db.name`，当前为 `claudia-phone`；候选、计划和回退数据库拥有不同的随机前缀，不能作为运行库。
- Netlify与Vercel不同域名具有独立IndexedDB/localStorage/Service Worker。Safari与standalone容器也可能被平台分开存储；同名数据库不意味着同一存储容器。新备份记录来源origin，预览显示当前origin，启动复核只验证当前站点。
- `importReceipt` 在原子写入前保存预期计数以及角色/主题摘要；重启后由应用实际 `store.init/reload` 读回，核对18表计数、角色数据与主题身份，才显示“导入成功，启动复核通过”。不一致则显示复核失败和当前/预期角色数，不能用ZIP验证或候选成功替代。

## 真实数据范围

`backupFormat.backupSchemas` 是版本化表清单，不按16/18这个数字静默截断。v5对应16表，v6新增两表。全部表及用途：

|表|主键/关键索引|用户数据|
|---|---|---|
|worlds|id,createdAt|世界名称、背景、规则|
|characters|id,worldId|基础角色、头像、说话方式、API绑定、日常好友状态/申请|
|worldProfiles|id,唯一[worldId+characterId]|世界角色关系/专属设定|
|conversations|id,唯一scopeKey,characterId,worldId|Daily/World会话、设置、当前时间线、API绑定|
|messages|id,conversationId,[conversationId+createdAt]|消息、归档状态、当前版本|
|messageVariants|id,messageId,conversationId|回复版本|
|messageRevisions|id,messageId,conversationId,variantId|编辑修订|
|conversationSnapshots|id,conversationId,createdAt|历史快照与内嵌消息/版本|
|timelines|id,conversationId,parentTimelineId|时间线血缘、当前路径、修订|
|pathNodes|id,conversationId,[conversationId+parentNodeId+fingerprint]|不可变原文与内容指纹|
|lorebooks|id,updatedAt|世界书、全局/世界范围|
|loreEntries|id,lorebookId|内容、触发规则和高级参数|
|pages|id,order|桌面页面|
|items|id,pageId,position|图标/小组件、位置、尺寸、自定义图标|
|themes|id,worldId|外观、壁纸引用及global.userIdentities|
|assets|id,type|上传图片数据URL、头像/壁纸/图标|
|apiConfigs|id,provider|Provider、Base URL、模型、参数、启停、默认|
|apiCredentials|configId|独立API Key，默认不导出|

读写路径保持既有服务：角色由CharacterManager/store读取与保存；会话由chatService/messageOperations/timelines读取与写入；世界书由既有管理器/引擎使用；身份由userIdentity.saveIdentity/identityFor；API由既有API管理与apiSelection/resolveApi使用。本次不重写聊天、Prompt、世界书触发或API运行解析顺序。

**没有独立面具表、面具ID、角色面具绑定或长期记忆表。** 用户身份是 `themes.global.userIdentities["daily"|"world:<id>"]`，内容包含name/bio/customSetting/avatar及gender/age/occupation等可选、扩展字段。每空间当前只有一份身份；Chat按Conversation的mode/worldId读取，不注入第二份Prompt。本次保留全部字段，合并时重映射世界键与头像。独立面具计数明确为0，身份数量按真实对象统计，不把默认“你”占位算记录。

localStorage仅发现空间导航与备份/恢复的运行元数据，不存用户身份；导航不作为资料迁移，恢复后回到空间首页。Service Worker缓存、临时库、未保存表单与发送中UI草稿不导出。不存在的长期记忆或未来表不虚构；未知schema/version拒绝而非丢弃数据。

## 密钥与ZIP格式

非敏感API配置、参数、默认选择、角色/会话绑定默认包含。默认不含独立Key；现有无加密导出仍会移除Base URL中可能敏感的用户信息/query/hash并给出警告。从加密文件导入但选择“不导入密钥”时同样脱敏配置内的敏感字段及URL参数，不仅跳过独立Key表。需要完整敏感地址时，用户应选择加密密钥备份并在预览核对。

- ZIP v1明文与WinZip AES-256继续支持，旧分卷（含AES-GCM/HMAC格式）继续支持。
- “包含API密钥”必须主动开启，强制加密和密码确认。新含密钥ZIP使用v2标准ZIP容器：**数据文件复用经过验证的AES-256-GCM + PBKDF2-SHA256 600,000次 + HMAC-SHA256清单认证**。不再给相同密码额外套一层1000次KDF的WinZip密码检查，避免攻击者使用较便宜的检查暴力猜密码。
- 盐、每文件nonce、认证参数保存在已版本化的清单/格式信息中，密码不保存。常见ZIP工具能列出/解包v2，但内部数据需Claudia Phone解密；清单结构、计数等元数据可见，聊天、身份、Key及图片内容加密。库不打印Key，也不把Key写入源码、部署环境或报告。
- ZIP上限仍32MiB，导入变更编码64MiB上限；均非Safari峰值内存保证。逐条读写并使用ID映射/资源摘要，避免全量图片数组；按conversationId索引处理会话成员，避免反复扫描全库。失败、取消或后台中断清理本次临时计划，不触及当前用户数据。异常包/错密码/缺件/路径等原校验保留。

## 覆盖、合并与冲突

用户可分别选择：剧情完整关联组（角色/世界/会话/消息/版本/时间线/世界书）、桌面外观、用户身份、API。强关联组不拆成容易断链的单表。资源按内容摘要去重并保留本地资源，不做危险自动回收。部分范围会导致真实依赖缺失时拒绝计划并说明需选择的范围，不自动删引用。

覆盖使用备份替换所选范围，未选数据从一致性快照保留；界面展示来源/当前/结果。API默认安全导入（保留当前配置和Key，冲突配置作副本）；可另外明确选择替换API范围并预览将删除的不匹配配置与Key。API Key默认不导入，用户可选仅补缺失或明确允许替换对应凭据。这里的可用配置仅指本地字段与凭据完整，不等于服务器认证已验证。不同Provider/Base URL绝不复用原Key；选择保留当前端点时跳过来自不同端点的凭据并警告。

合并优先保留当前：

1. 同ID/同内容的数据去重。图片按资源内容去重；不因同名认定实体相同。
2. 同ID/不同内容使用由backupId、表名、原ID决定的稳定副本ID，完整映射全部已知外键；同一ZIP重复导入映射相同，不悄悄制造第二套副本。已有副本被改动则拒绝覆盖，而非再次复制掩盖冲突。
3. 同一角色+模式+世界的scopeKey具有唯一约束。只要不能确认整个会话路径相同，就独立复制角色及关联会话，不将来源消息接到当前未来。保持共同路径节点引用、时间线父子、fork/head及修订数；不可变消息的ID映射后重新计算指纹。
4. 快照内嵌消息、版本及好友删除/申请事件ID也处理映射。历史ID跨会话含义不明确时拒绝；不猜测血缘。v5只在临时库补空时间线表，按现有逻辑后续惰性初始化。
5. 世界书绑定随World ID映射，Global保持其真实含义，并在合并预览警告可能影响所有聊天。不会把World A绑定自动转成World B。日常/世界上下文引擎不改。
6. 冲突可选导入为副本，或保留当前并整组跳过剧情，避免只跳一条造成断链。用户身份在同空间只有一个槽，支持保留当前/明确替换；不伪造不可用的“第二个日常面具”。新世界身份独立加入。
7. 合并保留当前桌面，明确不将两套图标布局混排或假装支持多桌面主题选择；要替换外观可单独使用覆盖范围。

预览包含角色、会话、消息、世界、世界书、身份、API、时间线、图片，及新增、去重、冲突、变更编码大小、凭据数量和涉及配置名。数量来自已校验且实际写入隔离计划的记录；未输入的独立面具为0。

## 正式提交和回退

沿用已有维护门禁、Service Worker独占租约、前台保护、AI生成锁检查与回退副本。预览产生目标当前快照摘要；正式提交前要求当前数据仍与预览一致，变化就重新预览，不追认过时确认。新的完整候选（合并后的最终库也一样）先通过引用和时间线图校验，再以一个覆盖全部表的原子readwrite事务替换、读回逐表摘要并再次检查租约。故障整体回滚，不存在先清空提交再逐表导入。

成功提交后保持旧页写入锁直到重新加载。启动复核使用真实应用读取结果；不能仅凭候选计数声明成功。恢复前原始副本保留，可通过已有独立确认回退。空间不足、窗口未关闭、旧Worker未更新、失效预览或不支持的版本均失败关闭。没有数据库升级，没有清理真实数据或删除PWA。

## 验收与真机边界

新增端到端用随机映射的**实际App数据库**与独立浏览器上下文，完整驱动ZIP选择/密码/预览/确认/刷新，再检查真实角色和聊天列表、身份编辑、API管理及服务读取。包含专门的112记录/9图片非空来源到空手机、两个角色、Daily/World、版本/修订/快照/时间线/世界书/身份/API。合并检查原文不变、独立世界Prompt、重复导入、部分范围、Key策略、损坏历史、取消、Quota故障和重启结果。所有模型调用次数为0。

375/390/430px生成并检查截图。真实iPhone Safari/PWA的Files保存、系统分享、独立容器切换、Worker升级、系统强制挂起/杀进程、低容量和大库耗时仍待用户验收；不将Chromium模拟描述为真机通过。未取得用户原112条/9资源文件，特定真机空列表原因仍未证实，新版本以分层诊断和真实App验收避免重复假成功。启动角色摘要沿用原备份编码器的逐行摘要，支持BigInt/Date等扩展资料；不会用JSON.stringify将可恢复资料误报为失败。切换范围/模式会同步废弃旧预览并撤销确认，不能用旧候选提交新策略。首轮回归发现旧聊天设置测试只等数据库ready便打开聊天，被尚未结束的空间导航重置；测试现在等待booted/非transitioning，并点击实际聊天入口，未改聊天业务。
