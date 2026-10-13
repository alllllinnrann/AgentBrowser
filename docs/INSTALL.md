# 安装与启动

1. 下载 Release 中的 `AgentBrowser-Setup-版本号-x64.exe`。
2. 双击安装包，在安装向导中选择目录。默认文件夹名为 `AgentBrowser`，可改到其他磁盘或目录。
3. 完成安装后启动 AgentBrowser，也可以使用桌面或开始菜单快捷方式。
4. 点击 Agent 顶部的设置图标，填写 API 地址、模型名称和自己的密钥，保存并测试连接。本地无密钥模型可留空密钥。
5. 在左侧网页中登录需要使用的网站，再向 Agent 发送指令。

安装包离线包含程序运行所需文件，无需另外安装 Node.js、npm 或下载项目源码。网页访问与云端模型调用需要网络。当前发布版本面向 Windows x64。

程序文件放在所选安装目录。对话、网站登录状态和加密密钥存放在当前 Windows 用户的数据目录，不包含在安装包或源码仓库里。卸载默认保留这些用户数据。

## 从源码构建

需要 Windows x64、Node.js 24+。运行：

```powershell
npm ci
npx install-electron
npm run check
npm run package
```

安装包输出在 `outputs/releases/`。`npm run package:dir` 仅生成可运行目录，供本地调试。

仓库仅包含应用源码、依赖锁文件、构建配置和安装说明。测试、测试数据、本地项目笔记与生成结果不提交。
