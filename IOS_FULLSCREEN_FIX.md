# iPhone Safari / standalone 呈现兼容修复

## 审计与原因

基线 167947f，开始前工作区干净，与 origin/main 一致。IndexedDB v5 与业务表不变。

- `.status` 无环境判断，模拟时间、信号、电量与系统状态栏重复。原手机行高57px，移动端49px+安全区；返回按钮共用该行，因此不能直接删除整行。
- 移动端 `.phone` 设置640px最小高度，小视口会超出可用高度；760px以上横屏又可能落回390×844手机框及stage的40px外边距。standalone只有capable配置，缺少与安全区全屏布局配套的状态栏覆盖方式。
- `.phone` 无论当前App均使用全局壁纸，设置等面板仅半透明覆盖；html画布颜色又独立于当前屏幕。它们可产生壁纸透出和边缘色块。这不证明曾从其他世界读取了壁纸：当前桌面主题本来仍全局共享。
- 旧worker使用长期固定v1缓存，network-first本身不是cache-first；离线仍可能读旧壳，且cache.put没有waitUntil，不能保证写入完成。旧注册只在load执行，没有前台主动检查。没有证据证明用户的具体截图一定由旧缓存导致。

## 布局原则

统一`--safe-top/bottom/left/right`来自env，测试可显式覆写以检查非零安全区；不使用固定机型补偿或负margin。画布只负责背景，不负责padding。

- 桌面/普通App：空间返回行承担顶部安全区，桌面或App滚动容器各自承担底部安全区。App自己的标题不重复加顶部env。
- 沉浸聊天：外层状态行及App标题继续隐藏，只有chat-immersive负责顶部/左右、chat-footer负责底部；沿用已有visualViewport键盘机制，没有改聊天业务逻辑。
- 空间选择/剧本/创建/备份页面：外层space-selection负责安全区；landing高度减去的是已占用空间，不再次加padding。
- iOS Safari和iOS standalone均移除模拟系统时间/图标/底部横条，保留44px可点击导航行。其他平台保留现有模拟手机预览。iOS横屏也使用可用视口，非聊天手机采用svh/dvh，去除640px最小高度；长内容在自己的滚动容器内滚动。

## 背景与PWA

同步文档画布和当前屏幕：空间页用原渐变；桌面用当前全局主题/壁纸；设置等App用奶油色底；主题编辑器是有意的壁纸预览例外。使用原图和原有cover规则，没有改壁纸记录、透明度、模糊或字体数据。没有实现空间独立壁纸。

保留viewport-fit=cover、apple-mobile-web-app-capable=yes和Manifest的standalone及原色值；增加black-translucent，让已绘制的背景能延伸到系统区域，再由内容owner进行一次env补偿。网页无法隐藏或保证控制真实系统状态栏时间、图标和文字颜色；浅底上的系统文字对比必须真机确认。

worker升级为claudia-shell-v2，安装先验证并缓存文档引用的入口JS/CSS及图标、Manifest，成功后才提交文档；失败不激活，保留旧worker。只清理本应用claudia-*壳缓存，不删除IndexedDB、localStorage或其他应用缓存。网络优先，文档请求重新验证HTTP缓存，缓存写入受waitUntil保护；拒绝错误MIME。同源受控壳资源离线匹配使用ignoreVary，避免托管服务器Vary: Origin造成已缓存入口无法命中；此规则不用于API或第三方资源。API请求不走壳缓存。

注册使用updateViaCache:none，load/回到前台/pageshow主动检查更新，不强制reload，不打断输入或生成。在线正常重新打开/刷新获取新壳，无需默认卸载PWA。离线仅保证已缓存资源与入口；未访问过的插画/其他可选资源仍可能需联网。缓存失败会保留在线使用能力。

## 不能自动验证的部分

自动化是Chromium的iPhone视口、模拟standalone及注入安全区数值，不能等同真机iOS。须验证：Safari及主屏幕启动，日常/剧本桌面、设置、聊天、世界/创建/备份页；横竖屏和横向刘海；地址栏展开收起；真实键盘；滚动回弹；后台恢复；在线更新后离线启动；状态栏文字对比。

不默认要求重新添加图标。部分iOS版本可能保留安装时的Apple元数据，普通在线重开后若仍异常，应先记录iOS版本及真机表现确认原因。若未来有充分证据必须重新安装，须先导出、读回验证并完成候选恢复演练；不能保证删除PWA后本地数据仍保留。禁止以清理网站数据处理本次问题。

## 本次验证结果

TypeScript、Production build通过（仅主bundle超过500kB体积提示），全部89项测试通过。生产构建的真实Chromium检查确认worker安装激活、入口JS/CSS缓存、断网重载空间首页及进入日常手机正常。此前离线检查发现的Vary匹配失败已修正并复测通过；这仍不是iPhone Safari/PWA真机验收。没有新增依赖，Manifest未修改。
