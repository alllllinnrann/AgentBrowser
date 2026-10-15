# Windows 自动构建

构建系统：GitHub Actions。工作流为 `.github/workflows/windows-build.yml`。

## 手动构建

1. 打开仓库的 Actions 页面，选择 **Windows installer**。
2. 点击 **Run workflow**，选择分支后运行。
3. 等待 **Build Windows x64** 成功，在本次运行底部的 **Artifacts** 下载 `AgentBrowser-版本-windows-x64`。
4. 解压后得到 exe、对应的 SHA256 校验文件和 `build-info.json`。
5. 将 exe 和同次构建的校验文件手动上传到 GitHub Release。不要混用本地构建的校验文件。

## 版本标签构建

推送 `v` 开头的版本标签也会启动构建，例如 `v0.3.6`。标签必须与该提交的 `package.json` 版本一致。
工作流需存在于标签对应的提交中；此前已发布的旧标签不会自动补跑，可从 main 手动启动。

## 构建范围

使用 GitHub 托管的 Windows 2025 环境和 Node.js 24，按 package-lock.json 安装依赖，进行类型检查并生成 NSIS x64 安装包。
产物保留 30 天，源码提交和运行链接记录在 `build-info.json` 中。长期分发请保存到 Release。

工作流只有仓库读取权限，不需要模型 API Key 或个人访问令牌，不自动发布 Release。
当前生成的程序仍未签名；接入 GitHub Actions 不代表已获得 SignPath 批准或已完成签名。
