# 在 iPhone 上通过 HTTPS 体验第一阶段

本项目没有开发第二阶段。localhost、127.0.0.1 和容器内网地址都不是公开部署地址。

## 1. GitHub：需要本人授权

下载源代码 ZIP，解压后在电脑终端进入包含 package.json 的 claudia-phone 文件夹。不要上传 node_modules、dist、.env 或令牌。

在 https://github.com/new 创建仓库，建议命名 claudia-phone，可设为 Private。不要勾选初始化 README、.gitignore 或 License（便于首次推送）。如果使用已有仓库且已有提交，应先克隆，再将项目文件复制进去；不要强制推送覆盖原有历史。

安装 Git；若使用 GitHub CLI，可运行 `gh auth login --hostname github.com --web` 并在本人浏览器完成授权。也可使用 GitHub Desktop 登录并发布本地仓库。密码和访问令牌不要发到聊天中。

对于从 ZIP 解压且尚未初始化 Git 的目录：

```sh
git init -b main
git add .
git commit -m "Build Claudia Phone phase one"
```

然后将下列地址替换为自己的真实仓库地址：

```sh
git remote add origin https://github.com/YOUR_USERNAME/claudia-phone.git
git push -u origin main
```

如果已存在 origin，先运行 `git remote -v` 确认，避免推错仓库。打开 GitHub 仓库页面，确认 main 分支包含 package.json、src、public、package-lock.json 和 vercel.json。

## 2. Vercel：需要本人登录和 GitHub 仓库授权

1. 打开 https://vercel.com/new ，登录本人 Vercel 账号。
2. 选择 Import Git Repository，授权 Vercel GitHub App 访问目标仓库；可仅授权这一个仓库。
3. 导入 claudia-phone，确认设置：

| 设置 | 值 |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | package.json 所在目录；本项目独立仓库通常为 ./ |
| Install Command | npm ci |
| Build Command | npm run build |
| Output Directory | dist |
| Environment Variables | 无需配置 |

4. 点击 Deploy，等待状态为 Ready。失败时查看 Build Logs，不要把含令牌的日志公开。
5. 打开项目 Production 域名，例如 `https://你的实际项目域名.vercel.app`。这只是域名格式示例，不是已存在的链接。
6. 如果链接提示 Vercel 登录，检查 Settings → Deployment Protection，按自己的访问需求设置生产部署保护。不要为此授权访问无关仓库。

仓库可保持私有，部署后的前端代码仍会被访问者下载；不要添加敏感 API 配置。每台设备、每个网站域名有独立的 IndexedDB，电脑本地数据不会自动迁移至 iPhone 或另一个域名。

## 3. iPhone 验收：需要真实设备手动操作

在 Safari 打开 Vercel 提供的实际 HTTPS 生产网址，确认可以直接访问。建议先在未登录 Vercel 的浏览器或无痕窗口检查访问权限。

- 检查时钟、桌面四列、Dock、安全区域及各应用入口。
- 长按图标进入编辑，拖到其他图标排序；添加页面后拖到分页圆点跨页移动。
- 添加、缩放、删除小组件，完成编辑后确认正常滚动和翻页。
- 上传壁纸、图标、头像，修改主题，刷新后确认设置保留。
- 创建、编辑、删除世界；在指定世界创建角色，确认切换世界不混入角色。
- Safari 分享 → 添加到主屏幕，检查独立窗口启动及底部安全区域。

本地自动化已通过，但不能代替上述真实 iPhone Safari / HTTPS 验收。Safari 私密浏览中的存储可能不长期保留；请使用普通浏览模式体验持久化。
