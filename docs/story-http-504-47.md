# Issue #47：Story HTTP 504 证据保留与提示

基线：最新远程 main `0b1031cbb2fe8a1dcbcb25ffa697b415c0894cb6`。独立分支 `fix/story-http-504-47`；不合并main，不部署Production，不使用真实模型或生产数据。

## 请求链与实际能确认的来源

1. `storyStore.claimStory` 校验有效路径、行动、指导快照并取得租约；`storyGeneration.ts:38–40` 使用既有120000ms总期限及同一AbortController。
2. `storyGeneration.ts:60–81` 选择现有全局默认API与凭据、计算Story输出预算，然后调用 `requestReply(..., structured.transport, false)`。最后的false禁止角色适配二次请求；没有风格纠正循环。
3. `chatProvider.ts:48–110` 自己构造REST请求，并无Provider SDK。OpenAI类协议请求配置的Base URL `/chat/completions`，`stream:false`；Gemini请求 `:generateContent`，不是streamGenerateContent。模型返回SSE时 `storyJSONTransport` 可聚合读取，但本修复没有改成强制流式。
4. `api.ts:139–141` 的browserTransport直接fetch配置地址。`storyJSON.ts:19–20` 在读取错误正文前记录实际HTTP状态，已知错误只保存白名单代码。
5. `vercel.json` 只有静态SPA rewrite及sw缓存头，仓库无Netlify/Vercel Function或模型代理。`public/sw.js` 的fetch处理只接管同源GET静态资源，不接管模型POST。不能把504归因于托管站点Function超时。
6. `api.ts:174` 的20秒计时是连接测试，不是Story总期限。没有增加任何超时、重试或Token配置。

真实截图可以确认客户端收到了HTTP504，并非仅根据浏览器Abort推测。504表示所连接服务链的网关等待上游超时；仅凭截图及本地代码无法识别是用户Base URL后的转发网关、模型网关还是更深层服务，也无法确定服务端是否已生成或计费。没有该次上游日志、响应头或请求关联记录，不能声称已修复远端超时本身。7000是请求输出上限，不是已消耗Token，也不是超时原因的证据。

## 已复现的本地缺陷

- 普通HTML504在完整生成链仅显示“服务器错误”，没有明确服务响应超时。未修改main的模拟测试实际失败，期望“服务响应超时（HTTP 504）”，得到通用服务器错误。
- HTTP504响应体若含不一致的`invalid_api_key`代码，原映射把实际504改成auth。基线模拟实际得到 `{code:auth,httpStatus:504}`；这不是截图故障必然发生的原因，而是另一个可确定的映射缺陷。
- 已收到504响应头、但错误正文读取迟滞直到原有客户端期限时，原映射丢失已知响应阶段，显示 `{code:timeout,stage:request,httpStatus:504}`。模拟ReadableStream加虚拟时钟可复现。修复优先保存已知504；用户主动取消仍为cancelled，未收到504的本地超时仍为timeout。定时回调不会把已经取消的请求改标为超时。

## 最小修复与保护

- 仅改 `storyGeneration.ts` 的错误证据优先级和已取消计时保护；不改请求参数、正常解析、状态执行或提交事务。
- `storyFailure.ts` 对既有 `server + HTTP504` 显示“服务响应超时（HTTP 504）”，提示稍后手动重试，并明确是否完成/计费以服务商记录为准。没有声称未扣费。使用原错误码/字段，旧版记录和备份继续有效，无数据库升级。
- 失败只更新对应session失败元数据、释放pending，不写剧情节点，不消耗单次指导，不清除行动草稿。已有节点、重生旧版本和分支保持原样。用户主动重试成功后才提交和消耗指导，不自动重复请求。
- 原有非阻断风格记录、玩家行动优先协议、输入/输出预算、Provider配置完全保留。现有脱敏详情保留HTTP状态、阶段、输出上限等有限标量，不保存网关错误正文、密钥或请求头。

## 验证方法

19项新测试覆盖3种Provider的HTML/JSON/空504，冲突错误代码，390/430页面错误详情/刷新/手动重试，延迟正常响应/取消/原期限/并发，重生/回溯，以及已知504错误正文阻塞时的取消/期限区别。Mock均使用隔离数据库、合成角色与凭据；不调用付费API。

基线失败和最终测试日志保留在本地 `/tmp/story-504-47`，不把任何备份、用户数据或测试截图提交仓库。专项19项最终通过；TypeScript及Production build通过。全量测试和CI最终结果在PR中列明，不能把测试文件存在或单项通过当作全部通过。

## 限制

没有真实iPhone Safari或真实模型验收。Mock不能证明上游已恢复，也不能保证手动重试不会再次504或不计费。若服务端本身超时，此客户端修复只保证准确提示和安全恢复操作，不伪造成功剧情。
