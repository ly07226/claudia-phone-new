# Claudia Phone · 第一阶段

原创浅灰绿玻璃拟态虚拟手机。React 19、TypeScript、Vite、Tailwind CSS 4、Zustand、Dexie、Lucide。尚未提供参考截图，当前视觉依据文字描述独立设计。

## 运行

```sh
npm install
npm run dev
npm run typecheck
npm run build
npx playwright install chromium
npm test
npm run preview
```

开发入口 http://localhost:5173，构建预览 http://localhost:4173。iPhone 应使用 HTTPS 部署地址；文件 App / file:// 预览不支持本应用。

## 操作

- 长按图标 550ms 进入编辑。普通模式移动超过 10px 取消长按，允许纵向滚动；编辑时图标使用 Pointer Events 和触摸拖动。
- 编辑时拖到其他图标可排序。点击「+ 页面」添加桌面；拖到下方分页圆点可跨页移动。完成退出编辑，左右滑动或点击圆点切页。
- 小组件可以添加、删除、切换语录/日历/便签，点击 ↔ 循环调整 1/2/4 列尺寸。内容为本阶段内置展示文本。
- 主题编辑器实时保存全局颜色、字体、图标形状、透明度、模糊、壁纸、应用图标。壁纸最长边 1600px，头像/图标 400px；单张原图最多 20MB，转换为 WebP 后存 IndexedDB。
- 世界支持增删改；角色必须属于已存在世界，列表仅查询所选世界。删除世界通过事务级联删除其角色。角色支持姓名、人设、头像和增删改。
- 设置可恢复桌面与主题，保留世界及角色。其余八个应用明确显示占位提示，没有 AI 能力。

## 文件结构

```text
src/
  main.tsx          桌面、应用框架、管理表单、触摸交互
  store.ts          实体、Dexie 数据表、Zustand 状态、图片处理
  style.css         原创响应式视觉与 Safari 适配
  vite-env.d.ts
public/
  icon.svg          原创图标
  manifest.webmanifest
  sw.js             基础同源离线缓存
 tests/phone.spec.ts 自动化验收
playwright.config.ts
vite.config.ts
vercel.json
```

## 数据边界

World、Character、DesktopPage、DesktopItem、Theme、Asset 均持久化在 Dexie。界面编辑态不持久化。Theme 的 `worldId` 预留单世界主题扩展，目前只读取 `global` 主题。上传资源通过 ID 引用，不含远端账号或 API 密钥。当前仅本机浏览器存储，无云同步、跨设备备份及 AI 请求。删除的资源引用暂不自动回收，避免误删仍被使用的图片；可在浏览器网站数据中整体清除。

存储失败会显示明确提示；无世界时展示创建引导。普通桌面保留滚动，编辑模式需要先完成编辑再滚动。桌面使用移动端全屏与安全区，宽屏提供 390×844 手机展示框。

## Vercel / HTTPS 验证

1. 将本目录推送到自己的 Git 仓库，在 Vercel 导入。
2. Framework 选 Vite，Build Command `npm run build`，Output Directory `dist`，无环境变量需求。
3. 使用 Vercel 生成的 HTTPS 地址在 iPhone Safari 打开，检查安全区、滑动、长按、拖动、相册上传、刷新保留及添加到主屏幕。
4. 本地 `npm run preview` 仅验证构建产物，不能代替 iPhone HTTPS 测试。

PWA 提供 manifest 和基础 Service Worker。正式生产建议添加 PNG 192/512 图标与 apple-touch-icon，进一步验证各 iOS 版本安装体验。

自动化执行结果见 TESTING.md。真实 iPhone Safari、HTTPS 部署和系统安装必须人工验收；未取得部署账号及链接，项目未发布到 Vercel。
