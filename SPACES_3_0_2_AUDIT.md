# Claudia Phone 3.0.2-A：独立存储审计与安全迁移方案

> 基线：`origin/main` 的 `550bd984821851ec90ee1670c11924be7523890f`（3.0.1）。本文件是待审核设计，不是已实现能力。本次不修改生产代码、不升数据库、不迁移/清理数据、不修改入口 UI 或 API Key，不进入 3.0.2-B。审计依据是代码与隔离测试，不代表已读取用户 iPhone 的实际数据库；“可能存在孤儿/损坏记录”不是对用户数据现状的断言。

## 1. 结论、范围与数据库版本历史

当前是**聊天按 Conversation 隔离、外观与桌面全局共享、导航身份独立**，不是完整空间存储。数据库名 `claudia-phone`，当前 Dexie 逻辑版本 **5**，共 **16 表**。本地锁定依赖为 Dexie **4.4.7**；当前逻辑 v5 对应原生 IndexedDB version 50，备份应记录实际读取值，不自行把二者混用。

推荐 **C 混合方案**：保留原 16 表与聊天结构，新建空间配置、冻结模板、资源引用和存储控制表，图片内容暂不重编码/复制。建议未来目标为**同一数据库逻辑 v6**，仅新增表；复杂复制放在可恢复的应用层阶段，不能塞进长时间 `versionchange` 图片处理。

**3.0.2-B 上线门槛**：先具备完整备份及读回校验、恢复演练、维护/多标签写入协调、可读 v6 的兼容恢复程序。以上未完成，不允许触发首次 v6 打开。原始全局记录至少在迁移与回滚验证保留期内不得删除。仅回滚 Vercel 不构成数据回滚。

| Dexie 版本 | 累计变化 | 旧数据处理 |
|---|---|---|
| v1 | worlds、characters、pages、items、themes、assets | 首次桌面默认值由 `usePhone.init()` 创建，不是空间初始化 |
| v2 | apiConfigs、apiCredentials | 追加两表，凭据与普通资料分开 |
| v3 | conversations、messages、worldProfiles | upgrade 从仍存在的 Character.worldId 建立世界关联；不复制 Character |
| v4 | lorebooks、loreEntries | 追加两表；2.3.1 字段扩展通过 normalizeEntry 读时默认，没有新增版本 |
| v5 | messageVariants、messageRevisions、conversationSnapshots | upgrade 为没有 activeVariantId 的 assistant Message 建立 legacy 版本并回填指针 |
| 3.0.1 | 数据库仍 v5 | localStorage 导航版本 1，不是 DB schema 版本，也不是存档版本 |

证据：[store.ts](src/store.ts) 的 PhoneDB、init/reload/saveDesktop/saveTheme/upload；[spaces.ts](src/spaces.ts)；[chatTypes.ts](src/chatTypes.ts)；[loreTypes.ts](src/loreTypes.ts)。已有 v3/v5 upgrade 使用 `toArray()` 和逐记录循环，大型历史数据跳级升级也有内存/时间风险，不能因 v6 不改聊天而忽略这些前置步骤。

## 2. 逐表结构、索引与读写路径

以下 `id` 均为当前非自增主键；`&` 是唯一索引，方括号为复合索引。普通外键**没有数据库外键约束**，不能靠 IndexedDB 自动级联或保证引用存在。

| 表 | 引入 | 主键 | 额外索引（精确） |
|---|---|---|---|
| worlds | 1 | id | createdAt |
| characters | 1 | id | worldId |
| pages | 1 | id | order |
| items | 1 | id | pageId, position |
| themes | 1 | id | worldId |
| assets | 1 | id | type |
| apiConfigs | 2 | id | provider |
| apiCredentials | 2 | configId | 无 |
| conversations | 3 | id | &scopeKey, characterId, worldId, updatedAt |
| messages | 3 | id | conversationId, [conversationId+createdAt] |
| worldProfiles | 3 | id | &[worldId+characterId], worldId, characterId |
| lorebooks | 4 | id | updatedAt |
| loreEntries | 4 | id | lorebookId |
| messageVariants | 5 | id | messageId, conversationId |
| messageRevisions | 5 | id | messageId, conversationId, variantId |
| conversationSnapshots | 5 | id | conversationId, createdAt |

### 2.1 世界、基础资料与桌面

| 表及结构 | 当前读取路径 | 当前写入路径 | 归属、共享/污染风险及兼容性 |
|---|---|---|---|
| worlds：id/name/description/rules?/background?/createdAt | store.reload 全表；SpaceSelection 列表；spaces.navigate 按 ID 校验；chatContext 读取当前世界 | Worlds 表单 put；chatService.deleteWorld | World ID 是空间的合法来源，但 World 记录不是桌面存档。删除会清世界会话/关联，不清桌面、素材或世界书绑定残留。保留原 ID |
| characters：id/name/persona/speakingStyle?/avatar?/apiConfigId?/旧 worldId? | store.reload、CharacterManager、Chat 头像、chatContext/resolveApi | CharacterManager 新增/编辑；ApiSettings 删除配置时清角色 apiConfigId；chatService.deleteCharacter | 基础角色全局共享是既定设计；worldId 为遗留关联，不等于头像/主题所有权。不得按空间复制角色。v3 兼容关联须保留 |
| pages：id/order | store.reload 按 order；main 页签、滑页、跨页拖拽 | init 默认 page-1；main 新增桌面页；saveDesktop 清空再 bulkPut | **无 spaceId，全局**。page-1 固定 ID 不能直接复用为新表全局主键。旧表须保留 |
| items：id/kind/app?/widget?/pageId/position/size/icon? | store.reload 全表；main 按 pageId 过滤，position 排序；moveItem | init defaultItems；saveDesktop；main 拖拽、跨页、图标上传、小组件增删/尺寸/类型 | **无 spaceId，全局**。app-0…、quote 固定 ID。widget 只有类型、尺寸、位置等，语录/日历/便签展示来自组件，不存在独立的用户便签正文表。不能虚构已有完整组件数据 |
| themes：id/worldId?/color/font/iconStyle/opacity/blur/wallpaper? | **只读 themes.get('global')**；main 直接使用 s.theme 渲染手机、玻璃、壁纸 | saveTheme.put；main 主题表单、壁纸上传/移除、恢复默认；init.put(defaultTheme) | **有 worldId 索引但没有按它选主题的生产读取逻辑**。defaultTheme.id='global'；字段存在不代表隔离。其他 ID 的主题记录可能未被 UI 使用，不能据此自动判归某世界 |
| assets：id/type/data/createdAt | store.reload 全量 data URL；main asset(id)、图标与壁纸；CharacterManager/Chat 按 Character.avatar 查 | upload 新 UUID 后 put；无现有自动回收服务 | **全局池，无 owner/spaceId/引用计数/内容摘要**。type 只是用途标签，不能代表空间所有权；读取也不以 type 做授权过滤。替换/取消上传可产生未引用行，不得直接删除 |

### 2.2 聊天、版本与世界书

| 表及结构 | 当前读取路径 | 当前写入路径 | 隔离/共享与兼容性 |
|---|---|---|---|
| conversations：id/scopeKey/characterId/mode/worldId?/apiConfigId?/createdAt/updatedAt/sendingToken?/sendingUntil? | chatService.getConversation/resolveApi/generate；Chat；SpaceSelection 进度计数 | getConversation 的稳定唯一 scopeKey；generate 的锁和更新时间；Chat 会话 API；删除服务 | daily / world + character + worldId 隔离；不是 spaceConfigs。API 引用优先级保留。锁字段是运行态，不是恢复后应继续执行的任务 |
| messages：id/conversationId/role/content/createdAt/activeVariantId?/archived?/userEdited?/regeneratedFrom?/editedFrom? | messagePath.activeMessages 过滤归档并排序，再读选中版本；上下文、UI、世界书扫描 | chatService 发言/回复；messageOperations 编辑、撤回、归档、恢复；删除服务级联 | 通过 conversationId 隔离。备份不能只导出有效路径，否则丢归档消息；分气泡不生成新消息 |
| worldProfiles：id/worldId/characterId/setting | CharacterManager、Chat 世界角色筛选、chatContext | v3 upgrade；CharacterManager 创建/关联/编辑/解除；世界/角色删除服务 | 世界特定覆盖；不要改为 Character 副本或给基础角色强塞 spaceId |
| messageVariants：id/conversationId/messageId/content/source/userEdited?/createdAt | activeMessages/variantsFor、Chat 分组、快照 | v5 upgrade；ensureVariant/addGeneratedVariant；编辑/恢复；删除服务 | 必须保留全部候选及 activeVariantId，不按当前 UI 显示数量裁剪 |
| messageRevisions：id/conversationId/messageId/variantId?/content/createdAt | MessageTools 修订列表、restoreRevision | editMessage 追加修订；删除服务 | 不是 Variant 的替代；完整备份须单独包含 |
| conversationSnapshots：id/conversationId/reason/createdAt/messages[]/variants[] | SnapshotTools；restoreSnapshot | snapshotPath；分支/编辑/撤回/删除前快照；删除服务 | 包含嵌套完整 Message/Variant，可能保留非当前路径内容。嵌套 ID 和归属须原样保存，不能遗漏或按空间重分配 |
| lorebooks：id/name/description/enabled/sourceType/global/worldIds[]/scanDepth/charBudget/createdAt/updatedAt/rawMetadata? | Lorebooks 管理；loreEngine 按 enabled 与 global 或当前 worldId 过滤 | Lorebooks CRUD/绑定/复制；loreImport.importLorebook | 全局或多世界引用是正常共享，不是“污染”。Daily 不因 worldIds 读取世界专书；global 本就可参与 Daily。World 删除不自动移除 worldIds 中的旧 ID |
| loreEntries：id/lorebookId/title/content/primaryKeys[]/secondaryKeys[]/enabled/constant/selective/selectiveLogic/priority/insertionPosition/insertionDepth?/role?/regex?/useProbability?/probability?/scanDepth/caseSensitive/createdAt/updatedAt/compatibilityIssues[]/rawMetadata? | loreEngine、管理/导出，normalizeEntry 补旧字段默认 | Lorebooks 编辑/复制/删除；importLorebook 事务 | 经 lorebookId 继承范围。scanDepth 与 insertionDepth 含义独立，备份/迁移不得混淆。未知 rawMetadata 必须保留 |

这些表的主要证据：[chatService.ts](src/chatService.ts)、[messageOperations.ts](src/messageOperations.ts)、[messagePath.ts](src/messagePath.ts)、[chatContext.ts](src/chatContext.ts)、[loreEngine.ts](src/loreEngine.ts)。3.0.2-B 不改这些表的主键、Conversation 语义、Prompt 作用域或版本路径算法。

### 2.3 API 配置与凭据

| 表及结构 | 读取 | 写入 | 风险与兼容 |
|---|---|---|---|
| apiConfigs：id/name/provider/baseUrl/model/temperature/maxTokens/enabled/isDefault/protocol?/createdAt/updatedAt | ApiSettings.reload；Chat/CharacterManager 选择；resolveApi | ApiSettings.persist 事务；启停/默认/删除 | 全局多配置是产品要求，不按空间复制。默认唯一由代码维护，非数据库唯一索引。删除配置只清角色引用，Conversation 原引用可能保留并提示无效；备份不能偷偷修复归属 |
| apiCredentials：configId/apiKey | ApiSettings 编辑/测试/模型列表；resolveApi | ApiSettings.persist、删除配置事务 | 客户端本地凭据，当前未加密，不是服务器秘密。审计/日志/默认备份不能输出 Key；3.0.2 桌面迁移不写此表 |

[ApiSettings.tsx](src/ApiSettings.tsx)、[api.ts](src/api.ts)。API Base URL、导入元数据或用户文本也可能被用户粘贴令牌，排除凭据表并不能宣称文件绝无敏感内容。

## 3. 当前共享状态与关键异步风险

### 3.1 Zustand、导航与页面路径

- `usePhone` 是单例：pages/items/theme/assets、pageId、editing、activeApp、worldId 管理筛选、worlds/characters/worldProfiles、ready/error 共用。未使用 Zustand persist 保存整份手机状态；配置持久化靠 Dexie。
- `reload()` 并行读全局表，然后一次 set；没有 originSpaceId、读请求序号或 revision 防旧结果。`safeWrite()` 和 `upload()` 完成后还会调用它。
- `useSpaces` 单独管理 route/space/type/worldId，导航有 sequence 防目的地校验乱序，并重置 activeApp/editing/worldId；**没有加载空间桌面配置**，pageId 也不是每空间持久化状态。
- URL hash 与 localStorage `claudia.navigation.v1` 仅导航。不能将最后打开的空间当成旧桌面所有者，不能把这个键当完整备份/存档。
- [SpaceSelection.tsx](src/SpaceSelection.tsx) 用 liveQuery 对世界会话消息计数提示进度；没有桌面迁移或存档写入。[Worlds.tsx](src/Worlds.tsx) 复用原 World CRUD，没有空间配置表。

### 3.2 上传、主题、布局、初始化

1. `main.fileChange()` 先 await upload，再调用事件创建时捕获的 done；壁纸 done 为 `saveTheme({...s.theme, wallpaper:id})`，图标 done 为 `saveDesktop(s.items.map(...))`。这不只是潜在空间 ID 问题：同一空间内，旧 theme/items 快照也可能覆盖期间发生的新设置。
2. upload 校验位图、拒 SVG、限制原文件20MiB；**先解码原图**，再把最长边缩至壁纸1600/其他400，canvas WebP quality .82 存 data URL。20MiB 不是完整备份大小限制，也不能保证高像素图解码不耗尽内存。迁移不得再次解码重压所有旧图。
3. assets.put 成功和配置关联不是一个事务；图片保存成功但后续配置失败/用户取消头像表单，可留下未引用资产。头像表单仅先 setForm，保存角色才形成持久引用。
4. 主题字段变动都是整对象 saveTheme；壁纸删除仅移除引用，不删资产。恢复默认先 saveDesktop 再 saveTheme，**两步不是同一事务**，失败可能只恢复一部分；未来应为单空间一次原子提交。
5. 拖拽/跨页 moveItem、添加页面、小组件增删/尺寸/类型、上传图标均汇入 saveDesktop；它 clear 全部 pages/items 后重建。未来仅加 spaceId 但保留这些 clear 会删除所有空间布局。
6. `init()` 只以 pages.count()==0 判断首次初始化，写 page-1/defaultItems/global theme。若 pages 缺失但其他表尚有用户数据，当前逻辑也可能插入默认项/覆盖 global theme。未来不能把“当前空间没页”当全库首次启动。
7. 图片读取全量 assets.data 带来内存压力；按资源 ID 惰性读取优于每次切空间 reload 全图。

### 3.3 还未建立的安全机制

没有应用级 versionchange/blocked 交互、桌面写入 CAS、多标签维护租约、空间资源引用图或 GC。Dexie 自带 versionchange 关闭/blocked 控制台提示，**不等于本项目已有维护锁或防旧代码写入协议**。`public/sw.js` 使用缓存名 claudia-v1、skipWaiting/clients.claim、同源 GET 网络优先，离线可回到缓存旧页面；不能用强制刷新当作所有旧标签/PWA 已停用的证明。

## 4. 方案比较与推荐目标模型

| 维度 | A：现有表加 spaceId | B：新空间配置表 | C：配置独立 + 不可变资源/引用管理 |
|---|---|---|---|
| 迁移安全 | 必须重键、处理旧查询和 clear；容易原地破坏/旧代码误写 | 可追加复制、留旧记录，易验证 | 同 B，另有引用事务与保留期；最符合无损与大图限制 |
| 代码复杂度 | 表面改字段少，实际需改全部无过滤读写、ID映射和回滚 | 仓储适配成本可控；记录内布局可整体提交 | 比 B 多资源服务/维护控制，但职责清晰，不碰聊天模型 |
| 数据量 | 配置按空间增量；若连图片复制会激增 | 配置复制少量；图片策略不明确 | 配置独立副本，图片内容只存一次，引用少量增长 |
| 查询性能 | spaceId 索引高效，桌面多表 join/事务更多 | spaceId 主键一次取整个桌面；大配置有写放大 | 同 B，图片按 ID 惰性查；引用索引支持审计/回收 |
| 扩展性 | 旧全局语义与新语义缠绕 | 适合空间偏好，资源生命周期欠缺 | 可扩展资源/备份引用，现有 Conversation 保持稳定 |

选择 **C，采用 B 式新表承载配置**。A 不选是因为现有 clear/固定 ID/旧代码风险；单纯 B 不足以安全回收资源。不同数据库 sidecar 也是备选：主库可留 v5，但跨库配置/资源/删除/备份没有原子事务，需要额外两阶段协议；本阶段建议同库追加新表，不以 sidecar 隐藏恢复复杂度。

### 4.1 建议的 v6 追加表（仅设计，尚未声明/创建）

| 新表 | 建议 schema 字符串 | 主要内容 |
|---|---|---|
| spaceConfigs | `spaceId,state,templateId,migrationRunId` | 主键就是 daily/world:<ID>；schemaVersion、revision、state、origin(migration/new-space)、templateId、migrationRunId?、theme、pages[]、items[]、timestamps |
| desktopTemplates | `id,sourceDigest` | 冻结原全局 pages/items/global theme、源 ID/引用清单、规范化结果/警告、capturedAt；不复制全部图像 data |
| assetRefs | `id,assetId,spaceId,[ownerKind+ownerId]` | 一个 slot 的权威引用边：assetId、ownerKind/ownerId、slot、spaceId?、pinReason?、createdAt |
| storageMeta | `id,kind,state` | 有区分类型的 control / migration-run / issue / lease 记录；活动 run、模式、写入 epoch、检查点、报告。不得放 API Key |

SpaceTheme 只含颜色/字体/iconStyle/opacity/blur/wallpaperAssetId?，不再复用含糊的 Theme.id/worldId 作为所有权。SpacePage 含重映射后的 id/order；SpaceItem 保留当前种类、app/widget、pageId、position、size、icon 引用。仅保留已有小组件设置，不在 B 顺便实现新便签 App；未来参数须有 per-kind schema/version。加载目标配置时必须把运行态 pageId 设为该配置中的有效页面（或首个有效页），不能继续硬编码旧 page-1；若选择持久化最后页，则字段归属该 spaceConfig 并验证引用。

配置数组适合当前小桌面：一次取、一次事务提交、避免跨表半布局。代价是大桌面全记录写放大，B 需测量尺寸/延迟、设置可见限制，不静默截断；规模确有需要时再拆空间页面/项目表。索引里不写 `&spaceId`，因为它已是主键。

### 4.2 资源与安全回收

- 暂保留现有 assets 作为不可变内容池：新上传新 ID，禁止覆盖同 ID 的内容；不把旧 data URL 批量转 Blob。内容摘要可补充到新引用/校验元数据，不能借此原地重写旧行。
- assetRefs.id 使用规范元组序列化，如 `JSON.stringify([ownerKind,ownerId,slot])`，避免字符串分隔歧义。ownerKind 区分空间主题、空间图标、全局角色、冻结模板、备份保留、隔离资料；Character.avatar 是全局引用，不随世界删除。
- 保存配置/绑定新图：资源 add、配置 revision 校验与 put、引用边更新在**同一事务**。导入 ID 冲突必须验证内容相同，否则生成新 ID 并完整映射，不能 put 覆盖别人内容。
- 删除世界先按原规则确认，再在同库事务内更新/墓碑化它的配置及引用；不得按 assets.type 或 worldId 猜测删除图片。不得删除其他空间、基础角色头像、模板和备份所需资产。
- 引用计数只能作缓存，不能当唯一真相。回收前重扫所有新配置、角色头像、旧 themes/items、模板、隔离数据、保留中的恢复副本；不认识的引用按保守 pin 处理。
- **B 初次迁移默认不物理 GC 旧资源**。先生成候选/隔离报告与保留 pin。只有已验证恢复、保留期/用户策略获确认、全部写入者使用新协议且最终事务复核零引用后，才可显式回收。老 PWA 可重新引用旧图，未退役时所有 legacy assets 保持 pin。

### 4.3 仓储与异步约束

B 新建 spaceRepository/assetRepository/migrationCoordinator/backup 层。UI 不直接对旧 pages/items/themes clear/put。global reload 与空间配置加载拆开，safeWrite 刷全局资料时不能再覆盖当前空间桌面。

所有操作在开始时捕获 `originSpaceId + loadEpoch + expectedRevision`，禁止 await 完成后从“当前空间”推导写入目标。加载只在当前 ID 和 epoch 都匹配时发布；切换时显示加载态，不能先把 A 的壁纸当 B 显示。上传可在切换时取消，已提交结果也只能属于原 A；未关联的新资产隔离待回收，不能挂到 B。图片处理/哈希放事务外；提交时再次校验 token、目标世界存在及 revision，用 CAS 冲突提示/重试，不能把旧快照整包覆盖新配置。新世界从冻结模板生成独立记录，不从用户当时打开的另一个空间复制。

## 5. 确定性旧数据归属与迁移规则

### 5.1 冻结规则与 ID

1. 维护窗口内取一个稳定源快照。**不使用当前空间、世界名称、最近访问时间或导航记录决定归属**。源桌面定义为旧全体 pages/items 与 `themes['global']` 的实际读取语义。
2. 初始空间清单为 daily + 当时确实存在的 World ID。每个空间获得这个**相同模板的独立可变配置副本**；预览明确告知初始外观相同，修改不互相影响。模板只读，不随 Daily 后续修改而变。
3. 非 global 的旧 Theme 即使含 worldId，也不证明 UI 曾使用它；原行留存、列入“无法确认归属”报告，不自动绑定。不把历史遗留 Character.worldId 当资源所有权。
4. 原 16 表行/ID/内容保持，资产只共享不可变内容。所有新页面/项目都重映射，建议 `JSON.stringify(['space',spaceId,'page',legacyPageId])` / `...,'item',legacyItemId]`；类型与空间参与编码，可重复生成且不冲突。item.pageId 依同一个映射改写；app 名、widget 参数、顺序、尺寸及图标引用保留。
5. templateId 以规范源桌面内容摘要命名；run 另记录 World 清单摘要。规范化规定排序、字段编码、缺失值和 Unicode/类型处理，不能用对象枚举偶然顺序或 Date.now/随机 UUID 作为可重入身份；摘要编码不对用户字符串做 Unicode 规范化/改写。
6. 同 spaceId 已有经验证 ready 配置时只检查来源/revision，不覆盖用户修改；相同 run 的已提交步骤重复执行为 no-op。来源不同、主键碰撞或摘要变化停止并报告，不能再自动“重迁移一次”。
7. 迁移后新建 World 从冻结的默认模板创建新副本，检查 worldId 存在且无墓碑；同名新 World 的新 ID 不继承已删除世界的配置。

### 5.2 缺损、残留与未知数据

| 情况 | 安全处理（设计） |
|---|---|
| global Theme 缺失 | 目标用代码默认主题，报告 missing-global；原 themes 表仍不补写/覆盖 |
| pages 空但 items/theme 尚在 | 不调用旧 init 判首次启动；原始记录先备份，生成明确标记的恢复页/默认目标布局并保留源映射，用户预览确认 |
| item.pageId 不存在、重复 order/position、未知 kind/size | 不丢行；原样归档/报告。确定性恢复页与稳定次排序（源 ID）可作为提案，未知不可显示项隔离待人工处理，不伪装全部兼容 |
| wallpaper/icon/avatar 引用缺失 | 不补猜别的图；目标显示缺图占位/默认外观，保留 missingRef 报告和源引用；不能把不存在的资源计为可回收 |
| 已删除世界的 Theme/Profile/Conversation/世界书 worldIds 残留 | 保留原始资料并隔离列出，不据此复活 World，不附着到 Daily 或同名新世界 |
| 无引用旧资产、取消上传遗留图 | 不自动删除；legacy-unassigned pin，等待用户与回收策略确认 |
| 非字符串/不合法 ID、未知字段 | 有类型的原始备份保留；不能可靠映射则该部分不能标为迁移成功。记录问题路径，不把文本/Key 塞入普通日志 |

“数据无损”指原始记录及完整可恢复备份保留；目标 UI 的必要修复/默认值必须有差异报告，不能声称损坏源数据被无差别原样显示。

## 6. 完整备份与恢复设计（B 必须先完成）

### 6.1 现有能力审计

仅发现 Lorebook Native JSON 导出与文件选择器/预览/事务导入，可复用下载/Files picker/预览的**交互模式**。没有全库备份、表清单校验、资源打包或完整恢复。不能复用 importLorebook 当恢复器：它会新建书/条目 ID、清 global/worldIds；世界书导出也不能代替聊天/资产备份。PWA Cache Storage 只是资源缓存，不是 IndexedDB 备份。

### 6.2 最小完整备份格式

格式建议 `claudia-phone-backup`，backupFormatVersion=1，manifest 至少有 backupId、createdAt、app commit、Dexie dependency version、logicalSchemaVersion、实际 nativeVersion、表定义/索引、表行数、分卷清单与 SHA-256、编码版本、凭据策略、已省略/脱敏字段、引用校验报告。v5 必须覆盖上述16表；v6 还覆盖全部新表，包含冻结模板、未完成 run 与隔离报告。localStorage 导航是可选元数据，不是恢复世界归属依据。

- 全表导出，不仅导出 UI 可见/当前选中的消息、Variant、快照或 enabled 世界书。快照中的嵌套结构也保留。
- 对当前 JSON/data URL 外仍出现的 Date/undefined/Blob/二进制/未知值，应使用明确带标签的可逆 codec，或拒绝并给出路径；不能直接 JSON.stringify 静默丢字段/转换类型。标签与用户 rawMetadata 冲突需要转义。
- 原始图像 data URL 按字节保留并校验，不通过 canvas 再压缩。可分块存其 UTF-8 编码，恢复时重建原字符串；不可擅改为另一张“相似图片”。
- 默认排除 apiCredentials 的 Key 值并标注实际缺省范围，API 配置与引用 ID 保留。配置 URL 的 userinfo/query/fragment 默认进入敏感省略清单，脱敏配置标 needsReview，重设确认前不得发起测试/模型调用；若需要无损保留这些部分，放用户另选的加密敏感部分。
- 用户可显式选择包含凭据，使用独立加密部分/整包加密（Web Crypto、随机盐/nonce、经验证的密码派生与认证加密格式，参数版本化）；密码不保存、不上传。需提示忘记密码不可恢复。API Key 也可能被手动粘贴到消息/rawMetadata，自动识别不能保证覆盖，因此普通备份仍是敏感文件，不能称“绝无密钥”。
- 没有应用自动上传。标准 Blob/download 或用户主动 Web Share → Files；用户自己选择 iCloud 等 Files 提供方可能按其系统设置同步，这不等于应用后台上传。

### 6.3 一致性、文件大小与 Safari

先停生成并等既有 finally 释放锁；暂停全部写入者，再按主键分页只读导出。数据量小可单文件；超过真机验证的内存预算，必须分卷/分块并有总 manifest。不依赖桌面 File System Access API，不一次 toArray 全部图片再 stringify/zip。每卷大小阈值要用真机确定（如10MiB仅作初始实验值，不是 Safari 上限）；单条巨型记录仍可能超出工作集，须明确阻止升级而不是漏掉它。

多批只读事务只有在所有写入者被冻结时才是一致备份。哈希/加密/文件操作放事务外，避免 transaction inactive；同一只读事务内不能等待文件下载/异步加密。租约和源 epoch 前后复核，失去维护锁即废弃本次完成标记，不以“行数一样”冒充一致性证明。

Safari 容量随设备、可用空间、是否安装 PWA、浏览器策略变化，没有可承诺固定 MB 数。storage.estimate/persist 仅参考/请求，不保证不会被系统回收。data URL 有 base64、JS字符串、JSON/Blob/加密等多份内存成本；图片解码与导出处理不得并行堆积。隐私模式、低空间、后台冻结/杀进程、下载预览未保存、Files 无法写入都可能失败。**触发下载不等于已落盘**：必须让用户从 Files 重新选中完整文件/分卷，逐块读回验证摘要、计数、引用与版本，才记为“已验证备份”。没有完整备份就留在 v5，不自动升级。

### 6.4 恢复流程

1. HTTPS 正式应用的标准 file input（必要时 multiple）选择；不以 iPhone 文件预览页面当运行环境。
2. 校验 magic、格式/版本、分卷齐全、摘要、解密认证、主键重复/类型、schema 与全部跨表/嵌套引用。未知未来 schema 拒绝，不强行降级；允许的孤儿只能隔离并明确预览，不默默丢失。
导入文件不可信：校验对象深度、记录/分卷大小、资源MIME与data URL，未知资源隔离，不能绕过既有拒绝SVG等限制；不执行脚本、不把__proto__/未知字段合并到运行对象，不为解析而发起远端资源请求。SHA-256用于发现损坏，并不证明未经加密的文件来自可信作者。

3. 展示将恢复的表/行数/资产体积/缺失引用/凭据策略。先备份并读回当前数据；正常 UI 不提供默认静默覆盖。恢复全库需明确二次确认，合并模式不列为最小能力，避免冲突映射伤到 scopeKey/快照。
4. 在隔离候选数据库完整恢复并验证。真实 canonical 库尚不变；候选建库是未来恢复演练，不是本次审计操作。恢复数据保持 Conversation/Message/Variant/修订/快照/世界书 IDs，不走会重命名的业务导入器。
5. 默认无凭据备份不等于授权清空当前 API Key。候选中默认不激活 Key；如保留当前凭据，须仅对 ID 和 Provider/Base URL 身份一致的配置显式确认。冲突或无对应配置的凭据保留在受保护恢复副本中，暂停/交由用户选择，不自动绑定给另一个 Provider、不静默删除。
6. 候选确认后在维护模式提交/替换，验证成功后才恢复业务写入。运行时 sendingToken/sendingUntil 与维护租约不能被当成活任务恢复；清理这些运行态字段的规则列入恢复差异报告，原备份仍保存原值，不修改消息正文。

最小安全能力不是“导出JSON按钮”，而是全表/资源完整覆盖 + 可逆编码 + 文件读回 + 校验预览 + 候选恢复 + 凭据选择 + 失败回退。大数据暂无法完整导出/恢复的设备必须阻止迁移，不能以忽略图片换取成功提示。

## 7. v5 → v6 升级、失败、并发与真正回滚

### 7.1 两层迁移状态机

旧库盘点/升级前备份应使用不指定版本的原生 IndexedDB 只读打开并枚举实际 stores，不能导入会自动运行新 schema 的正常启动流程。如果数据库不存在而触发 oldVersion=0 的建库事件，盘点工具应中止该事务并报告“无旧库”，不为了备份创建假旧库。主入口必须先做兼容/维护引导，再允许 normal store.init 或任何未来v6查询。

**层一：短 schema 升级。** 仅追加四表、保留原16表/全部索引；不在 versionchange 中 canvas、哈希全图、下载、模型请求或跨网络。原生升级事务失败应整体回滚 schema；不能因此认定应用层已复制成功。直接从 v1–v4 跳入时仍要按原升级链执行 v3/v5，预备备份须先由兼容旧 schema 的工具完成，不能先无提示升级后再说“升级前备份”。

**层二：应用层可恢复复制。** 维护锁 → 冻结/备份校验 → 记录 run 与源摘要/World 清单 → 模板 → 按空间事务复制配置+引用+检查点 → 完整校验 → 单个最终事务将 control.activeRunId/mode 切到 spaces。初次迁移只有 active run 且 config ready 的配置可读为正式空间；激活后新建世界的 origin=new-space 配置通过正常仓储初始化并标 ready，不要求它属于旧 run 的冻结 World 清单。部分 staging 不进入 UI，也不写回旧源表。

每个空间提交是短事务（配置、assetRefs、run checkpoint 同时提交）。关闭 Safari 后凭检查点继续，已成功步骤跳过；没有创建多份随机ID的“再来一次”。最终激活失败保持旧源与 staging，重试或进入恢复流程。用户选择放弃时标 run abandoned、保留报告及源；通过**声明完整v6结构的旧布局兼容程序**运行旧全局模式，不能假装数据库已退回v5。再次迁移必须新 run/新源摘要，不覆盖上一次有效的用户配置。

### 7.2 故障处置表

| 故障 | 处理 |
|---|---|
| 跳级升级 | 旧 schema 兼容备份先行；保留原 v3/v5 upgrade 测试与真实旧夹具，所有新增复制只发生一次 |
| 中途关闭/后台冻结 | schema事务按平台原子语义提交或回滚；应用run按已提交检查点恢复；不把 started 当 completed |
| QuotaExceeded/巨大图片 | 升级前估算剩余空间及备份/候选双份余量；不复制大图、不靠删除原数据腾空间。失败停止并保留旧库，允许用户先自行导出、释放非本应用文件后重试 |
| 源摘要变化/重复初始化 | 停止旧run；调查旧标签或并发写入。用 manifest/revision/ID映射验证幂等，不再次覆盖已修改配置 |
| 缺失/孤立引用、已删世界残留 | 隔离/保守pin并出报告；不猜所属、不复活世界、不清理旧资产 |
| 其他标签占连接 | 显示 blocked/等待关闭提示，不循环删库。versionchange 默认关闭只是起点，还需应用维护交互 |
| 活跃/离线旧PWA | 暂停升级或要求关闭所有旧标签/独立PWA，确认客户端构建版本；缓存旧代码可能重开数据库，不能仅靠一次广播或部署成功推断已退役 |

v5 预备阶段不能为了保存维护租约就先升级主库。可用独立的轻量协调库保存许可/epoch（仅维护元数据，不是空间数据侧库）；所有写入者先取得许可，维护者阻止新许可并等待已许可写入结束。不得仅凭 TTL 过期推断暂停中的 Safari 标签不再写入：无法确认的旧写入者需要用户关闭，否则不继续。进入 v6 后控制元数据与业务表同库，可在写事务内原子复核 epoch。备份的多批事务之间不能依赖一个未受全体客户端遵守的本地标志来保证一致性。

维护协议建议 IDB lease/epoch + BroadcastChannel（必要时 storage 事件）+ 所有写入口复核，Web Locks 可作增强，不能当 Safari 必备。先发布仍用v5的兼容/备份维护版本，给全局写入、API/世界书直写和聊天事务**外层**加维护门禁，不重写聊天算法。未获旧客户端确认时要求手动关闭并暂停升级；旧代码不遵守租约，无法靠新代码远程强制其安全。旧资源因此默认保持 pin。

### 7.3 旧代码为什么不能等同于恢复工具

原生 `indexedDB.open(name,较低版本)` 会 VersionError，不能就地降版本。当前 Dexie 4.4.7 还包含 VersionError 后不指定版本重开的兼容行为（见 node_modules/dexie/dist/dexie.mjs），因此也**不能**简单断言所有旧 Dexie 构建必然打不开：某些旧代码可能打开更高库，继续运行全局 clear/put，反而更危险。

现有 `tests/chat.spec.ts` 中标题含“2.1回退”的用例实际仍声明到v5，只证明同v5结构可打开，并没有证明真正旧v2/v5部署可安全读写未来v6。B须针对真实历史构建及锁定依赖做兼容测试，不能拿此标题当降级保障。

### 7.4 两条可执行恢复路线（B 需先实现/演练）

**首选：前向兼容回退。** 保留一个懂v6所有表、但可选择旧全局布局的兼容构建。将run标为停用/abandoned，旧16表及聊天仍可使用；新空间配置不删除。它是“旧体验+新schema兼容”，不是重新部署原3.0.1就完成恢复。迁移后新配置与后续聊天须先完整备份，旧全局表可能停留在模板时代，不能伪称显示了最新每空间外观。

**必须回到真正v5时：显式重建恢复，不是原地降级。**

1. 导出并读回验证**当前v6完整备份**（含升级后新聊天、版本、Key选择等），不能只拿升级前备份覆盖最近进度；保留新空间配置作为旁路归档。
2. 在同源维护恢复程序中建立独立的只读救援副本/经过校验的候选v5库，抽取原16表；所有聊天等ID原样保留。每空间外观无法无损塞回一个旧global主题：默认取保留的旧全局模板；用户可明确选择某空间投影为global，其他空间完整留在v6备份，不能据当前空间自动选。
3. IndexedDB库不能重命名。原3.0.1硬编码claudia-phone，所以只建立另名候选库还不能让原代码使用它。
4. 关闭所有标签/独立PWA，停止后台生成，进入不会调用原init的恢复页面；协调/停用旧缓存客户端，确认无不受控写入者。独立维护标记保存在canonical库之外。当前库与外部文件/救援副本均验证后，用户二次确认才允许删除canonical库并以v5结构重建，再从候选拷回16表，事务写入、计数/摘要/引用再校验。**本次A绝不执行这些操作。**
5. 若在删除之后、恢复之前崩溃，维护标记与外部备份/救援库仍存在；下次只进入恢复程序继续，不自动启动原应用建立默认空库。没有可用副本则不能进行第4步。
6. v5读回验证完成后才允许启用真正旧部署。关闭/更新PWA与缓存只针对应用资源，不应顺带清除IndexedDB。整个流程在同一个Production origin内执行；换预览域名会得到另一个本地数据库，不能当恢复成功。

这是需要明确用户批准的破坏性恢复流程设计，不是日常自动回滚。B若尚未提供上述工具与演练证据，就不得承诺原部署回滚安全，也不得推送触发全员自动升级的代码。

## 8. 建议实施顺序与3.0.2-B代码范围

### 8.1 严格顺序/放行条件

1. 用户审核本方案，确认模板/归属、敏感备份、保留期与回退政策；A到此止步。
2. **B-准备发布（仍v5）**：全量只读盘点与损坏报告；完整备份/读回/候选恢复；同源维护入口与旧库兼容读取；多标签写门禁及客户端版本确认。真机做备份和恢复演练，失败保留v5。
3. 用已验证的外部备份建立v5夹具/真实历史构建回归，不访问生产用户数据；测试v6兼容桥与真正v5重建恢复。
4. **B-升级发布**：仅追加schema，用户确认且备份已读回后才打开v6；应用层幂等复制/校验/一次激活。禁止 module import 时未提示就触发db.open造成升级。
5. 接入空间仓储与上下文加载屏障；逐个替换全部桌面/主题/上传写入口与重置默认路径。全球资料刷新与空间状态刷新分离。
6. 新建/删除世界与配置、资源引用事务接合；先保留GC候选不物理删旧图；全部自动化与真机通过后再逐步启用，不顺便开发其他App。
7. 保留只读旧数据/恢复包，经过约定保留期与回滚验收后再单独审核清理政策；不是升级成功即删源。

### 8.2 预计代码修改范围（尚未修改）

- store.ts：追加schema声明与类型、分离legacy/global读取、禁用新路径的全表clear；原v1–v5定义与既有迁移不删。
- 新spaceRepository、assetRepository、migrationCoordinator、backup codec/export/restore/maintenance模块及独立恢复入口。
- spaces.ts、SpaceSelection.tsx：确保空间配置ready后再激活，导航序号与配置loadEpoch衔接；本次A不改入口UI。
- main.tsx：图片/主题/图标/页/拖拽/组件/恢复默认全部捕获originSpaceId并走仓储；fileChange不再整包写闭包快照。
- Worlds.tsx、chatService.deleteWorld的存储事务边界：接入配置墓碑/资源引用，保留原会话删除确认与业务语义；不是重写聊天链。
- CharacterManager/全局角色头像写入：全局资源引用维护，不能因世界删除而删基础头像；Chat/MessageUI资源读取适配惰性资产缓存，不改消息结构/Prompt。
- ApiSettings、Lorebooks、messageOperations/chatService等直写点：仅维护门禁/备份协调，避免迁移中写入；不改变API字段、Key值、世界书作用域或版本/撤回/重生规则。
- PWA/启动：版本/维护/恢复标记处理、blocked交互，防旧缓存不受控升级。Playwright夹具、兼容历史构建、故障注入与Safari验收。

## 9. 自动化与真机测试计划

以下是**B计划**，不表示A已实现或通过迁移/隔离测试。

| 层级 | 必须用例与关键断言 |
|---|---|
| 单元 | spaceId编码与稳定页/项映射、重复源ID拒绝；模板深拷贝不共享对象；规范摘要与未知类型codec；资源引用delta、missingRef/孤儿判定；backup默认排除Key/URL敏感部分与认证解密失败；目标字段默认值和差异报告 |
| 集成-迁移 | 真实v1/v2/v3/v4/v5夹具跳级到候选v6，旧16表除原历史升级应有变化外逐行保留；day/A/B独立主题和壁纸；重复初始化/迁移不重复生成、不覆盖用户revision；重命名世界不改ID，删世界残留不复活 |
| 集成-配置 | A/B分别拖拽、跨页、图标、组件尺寸/类型，另一空间及模板不变；刷新恢复同space；重置只作用目标空间且一次事务；缺页但存其他数据不触发全库默认覆盖 |
| 集成-资源 | 二进制只保留一份且内容不变；A/B、角色、模板、旧表、备份共用引用；删除A不删B图/角色头像；提交失败无半配置/半引用；GC候选、保留pin及最终复核；未知引用不删除 |
| 集成-异步/并发 | 延迟load/upload/reload后切A→B→A，旧结果不发布到B、不写错space；同空间双标签revision冲突；生成中导航仍取消/释放锁；维护期间所有旧/新写入口被拦；租约失效、blocked和不配合旧PWA阻止升级 |
| 集成-故障 | 每一步注入QuotaExceeded/事务abort/关闭标签，schema或每空间事务原子；checkpoint和ready状态准确；激活前中断不可见半成品；中途关闭后重试幂等；源摘要变化停止；所有源记录与可验证备份仍可恢复 |
| 集成-备份/恢复 | 全表及嵌套快照/归档/资产往返；损坏/缺卷/未知版本/重复主键拒绝，目标不变；默认无Key不静默清除现Key，冲突不绑定错Provider；原地恢复前当前数据先备份；候选验证与canonical重建中断恢复；v6完整归档→v5投影→真正旧构建读回 |
| 原有回归 | Daily/World上下文隔离、世界书匹配/角色/概率/位置、API测试/模型获取、消息编辑/修订/撤回/删除/重生/版本与快照、桌面触摸、存储失败提示全部继续通过 |
| iPhone Safari真机 | 小/大图、实际低容量、私密模式/PWA与普通Safari、Files下载/读回/多选分卷、加密错误、后台冻结/关闭、离线旧PWA与多标签、地址栏/安全区/键盘、恢复页面在同源可达；确认长备份可取消且无白屏/无假成功 |

本次另修正两个旧世界UI测试夹具：等待3.0.1正常启动桌面后才直接设置世界路由，避免启动恢复与测试注入竞态；不改任何生产导航逻辑，也不减少断言。

A新增的storage-audit.spec.ts只做当前v5表/索引只读核对，以及导航/刷新前后全表只读快照相等；没有未来schema声明或复制代码。测试在新的本地Playwright浏览器上下文运行，不连接Production或iPhone数据库。按要求运行的既有迁移回归只使用一次性旧版本测试夹具，不迁移任何用户数据库。

## 10. 风险清单、待确认决策与审核门槛

| 风险 | 等级 | 放行前措施 |
|---|---|---|
| 保留saveDesktop全表clear、global主题键 | 阻断 | 全部新桌面写路径换空间仓储，旧表只读保留 |
| 异步闭包/全局reload/CAS缺失 | 阻断 | originSpaceId、epoch、revision、原子引用提交与乱序故障测试 |
| 无完整备份、备份未真正保存、全量图片内存峰值 | 阻断 | 全库分批覆盖、Files读回和候选恢复；容量不足不升级 |
| 把Vercel回滚当数据库降级 | 阻断 | v6兼容桥 + 明确确认的v5重建流程，保留升级后的新数据 |
| 旧标签/离线PWA写入、维护锁不被旧代码遵守 | 高 | 版本确认、blocked处理、人工关闭；legacy资产不物理GC |
| worldId字段被误当Theme归属 | 高 | 仅旧global读取语义作为共享模板，其他行隔离报告 |
| 头像/模板/快照/未知引用误删 | 高 | 引用图与保留pin；删除空间只释放自己的配置引用 |
| 默认备份泄露Key或文本秘密 | 高 | 默认省略已知凭据、敏感URL单列、可选加密、告知普通备份仍敏感 |
| 多份备份/救援库自身占容量 | 高 | 估算与真实写入验证、明确停止/取消，不自动删源腾空间 |

**待用户审核的产品/运维决策（A不代为批准）**：

1. 是否同意选择C与未来同库v6，先发布仍v5的备份/维护兼容版本，再准入升级？
2. 是否同意所有现有空间初始复制同一旧全局模板，未来新世界仍从该冻结模板初始化，而不是继承当前空间？
3. 无法确认归属/损坏项默认隔离与保守保留，是否接受先报告、人工处理后才完成激活？
4. 默认不含API Key、敏感URL信息，含凭据需另选加密；是否接受恢复后部分API需要重新输入？不得把密码或Key交给开发者。
5. 源数据与legacy资产保留期：本方案默认不自动删除，何时允许用户显式回收须另行确认；本次不给未经授权的自动清理期限。
6. 是否把原部署回退限制为兼容桥优先；真正回到v5需要外部完整备份、维护窗口与明确二次确认？
7. 首批备份/分卷大小和设备支持范围须以真机实测确定，超过能力保持v5，不能静默降质/丢数据。

**实施顺序结论：审核 → v5备份/维护能力 → 真机恢复演练 → 历史构建兼容验证 → 追加v6空表 → 幂等复制并验证 → 一次激活空间配置 → 回归/真机验收 → 另审回收。未获用户审核，不自动进入3.0.2-B。**

## 本次A交付验证

`npm run typecheck`、`npm run build`通过；最终`npm test`全部72项通过（原有70项 + 新增2项只读审计合同）。首轮发现的两个旧世界UI夹具启动竞态仅通过等待正常启动完成修正，未修改生产逻辑。

变更仅包括本文件、tests/storage-audit.spec.ts、tests/bubble-boundaries.spec.ts与tests/message-entry.spec.ts的夹具等待。src/、public/、数据库schema、依赖与入口UI均未改动。未读取或迁移用户真机数据库；未实现B的备份、v6 schema或任何复制/回收代码。Safari备份/恢复/升级验收仍属B计划，不能以本轮72项通过宣称未来迁移已验证。
