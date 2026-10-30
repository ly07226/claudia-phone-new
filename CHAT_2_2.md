# 第二阶段 2.2：独立日常 / 世界聊天

## 数据模型与迁移

数据库 `claudia-phone` 升级为 v3，增量增加：

- `conversations`：稳定 UUID，characterId、mode、可选 worldId / apiConfigId、时间、发送租约。唯一 scopeKey 由 `[characterId, mode, worldId 或空]` 序列化而成，阻止重复创建同一空间。
- `messages`：稳定 UUID、conversationId、role、content、createdAt；预留 system/tool 和 regenerate/edit 引用字段，当前只发送 user/assistant。复合索引 `[conversationId+createdAt]` 支持严格范围查询。
- `worldProfiles`：WorldCharacterProfile，引用 worldId 和 characterId，唯一复合索引；setting 保存用户自行编写的本世界身份/关系/补充设定。

旧表和旧记录保持原值，不复制 Character。v3 迁移只为存在世界的旧 `Character.worldId` 建立关联，旧字段保留供兼容；旧基础资料不会自行拆解或改写。Character 的 worldId 变为可选，新增可选 speakingStyle；World 新增可选 rules、background。没有任何预设世界、角色或剧情数据。迁移测试逐表比对了 v2 全部八张旧表（包括 API 凭据）。

## 入口与隔离

聊天 App → 全部基础角色 → 日常聊天。不需要世界；角色管理的“全部基础角色 / 无世界”可以直接新建角色。

世界管理 → 查看角色 → 关联已有角色 / 编辑世界设定 → 进入世界聊天。新建世界中的角色也只创建一个基础角色及一个关联。编辑基础人设对该角色所有空间生效，世界专属设定只影响对应世界。

`src/chatContext.ts` 集中构建上下文：Daily 只加载基础角色与指定 conversationId 的消息，完全不查询世界或世界关联；World 只加载当前 worldId 和唯一世界角色关联，再读取该 conversationId 的消息。没有任何跨会话记忆、缓存历史复用或全文检索。界面持续标明日常或具体世界名。

每次最多最近 30 条、24000 字符历史；从最近消息向前保留，不切断单条消息，移除开头孤立 assistant。当前输入最多 8000 字符；基础与世界系统资料合计最多 24000 字符，超过则提示缩短。完整记录仍保存在 IndexedDB。字符预算不是精确 Token 计数，不保证适配所有模型上下文窗口。

## 请求与失败处理

`src/chatService.ts` 管理会话、API 解析、发送租约与消息写入。API 优先级：Conversation 显式配置 → Character 指定配置 → 全局已启用默认配置。显式选择不存在或停用时显示错误，不静默换用其他 Key。无可用 API 引导到设置。

用户消息先持久化，模型失败仍保留。可重试最后一条 user 而不重复插入；有发送中状态与取消。每会话持久化租约防止多标签重复发送，90 秒租约可在浏览器异常关闭后过期；请求 60 秒超时。局部内存限制每分钟 20 次请求，只是浏览器防误触，不是服务端限流，也不防恶意客户端。

`src/chatProvider.ts` 为 OpenAI Compatible、OpenAI、OpenRouter 构建 Chat Completions，为 Gemini 构建 systemInstruction / contents。Custom 必须明确选择这两种协议之一。使用保存的 Temperature/Max Tokens；具体模型可能不接受某些参数，需按错误调整。当前非流式文本回复，不含工具、图片、跨世界记忆等功能。

删除会话只删本会话和消息。删除世界二次确认，删除本世界关联、会话及消息，保留所有基础角色和日常/其他世界数据。解除关联不删除历史，重新关联后可继续。删除基础角色二次确认，明确会同时删除该角色所有空间会话。

## 安全架构决定

本阶段评估了 Serverless Proxy，但没有在缺少用户身份体系的现有产品中部署开放转发端点。正式聊天目前使用 `ApiTransport` 的浏览器直连实现，保持多 Provider / 多 Key UI 管理。没有服务端任意目标抓取接口，因此没有引入服务器 SSRF 面；不启用通配 CORS 绕过，不使用公共代理。

API Key 仍是 IndexedDB 客户端明文凭据。同源 XSS、恶意依赖/扩展、设备访问可能读取，浏览器开发工具也可看到发出的请求；代理也不能使已存在客户端的 Key 变成服务器秘密。只使用可信 HTTPS 目标。请求禁止 URL 账号、查询、片段，不发 Cookie、不跟随重定向、不发 Referer、不缓存。原始 Provider 错误不展示，不记录完整 Key；回复若包含当前 Key 原文会替换隐藏。没有真实 Key 写入源码或日志。

CORS 由目标服务授权本应用来源；不支持浏览器直连时会提示网络/CORS 错误，不能通过修改前端绕过。下一步若增加 Vercel Function，必须先有身份认证、按用户限流、可信目标 allowlist、公网地址/DNS 校验及重定向限制、私网/元数据地址阻断、凭据日志脱敏与无缓存，避免成为任意代理。服务端按用户管理加密凭据才能提供更强保密性。

## 验证范围

自动化模拟真实请求格式及服务响应，无真实付费 Key，因此没有声称任何真实 Provider 已线上验证。测试覆盖同角色 Daily / 两个用户创建测试世界的上下文隔离、历史持久化、截断、单会话和世界删除范围、无世界创建角色、无 API 提示、API 失败保留消息/重试、API 优先级、迁移和原阶段回归。

真实 iPhone Safari 的键盘、VisualViewport、安全区、长对话滚动、取消请求、相册及真实服务 CORS/参数兼容性待人工验证。页面用 VisualViewport 调整手机容器，输入 16px 避免键盘缩放。

## 部署和安全回退

正常提交到 main，不覆盖 1952e75 历史。Vercel 若保持 GitHub main 自动生产部署配置，应触发新部署，需检查实际 Ready 状态。

不要对已经升级到 v3 的设备直接部署完全未修改的 1952e75：旧版显式打开 v2 可能遇到 VersionError。**代码回退和数据版本回退是两件事，禁止清库或数据库降级。**

需要回退时，在保留当前完整提交后，对 2.2 提交使用 `git revert <2.2-commit>` 生成正常反向提交，不 reset / force push。推送之前，在恢复到 2.1 的 `src/store.ts` 构造器中保留以下兼容 schema（放在 v2 定义后）：

```ts
this.version(3).stores({
  conversations: "id,&scopeKey,characterId,worldId,updatedAt",
  messages: "id,conversationId,[conversationId+createdAt]",
  worldProfiles: "id,&[worldId+characterId],worldId,characterId",
});
```

这会恢复 2.1 界面/行为，同时保留 v3 表及聊天数据，不尝试降级 IndexedDB。运行类型检查、构建和回退烟雾测试，提交这项兼容修正后再推送。不能把未经兼容修正的 revert 中间状态推送上线。v3 新建的无 worldId 基础角色在旧 2.1 世界角色列表中不会显示，但数据仍存在，重新升级可恢复访问；回退期间不要用旧角色/世界删除功能管理这些新关联。完全精确的 1952e75 代码与已升级数据库不保证兼容，因此不建议直接使用 Vercel 旧部署 Promote 作为无损回退。

未自动执行任何回退，也未清空或删除任何用户数据库。

本次最终验证：TypeScript 与 Production build 通过，全部 13 个 Playwright 综合用例通过（31.5 秒），包含原有第一阶段与 2.1 的全部 6 个回归用例，以及回退兼容声明打开 v3 后所有表记录不变的测试。测试截图变化未纳入提交。
