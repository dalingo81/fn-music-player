# 🎵 小牛音乐播放器

一个轻量级的本地音乐播放器 FPK 应用，让您在 NAS 上通过浏览器畅听本地音乐。

## ✨ 功能特性

- **🎶 自动扫描音乐** — 自动索引所有音乐文件（含子目录）
- **📋 广泛格式支持** — MP3、FLAC、WAV、AAC、OGG、APE、WMA、M4A、OPUS、AIFF
- **🎨 现代化 Web 界面** — 深色主题，响应式设计，手机/平板/电脑全适配
- **▶️ 完整播放控制** — 播放/暂停/上下曲/进度拖拽/音量控制/播放模式切换
- **❤️ 收藏歌单** — 喜欢的歌曲一键收藏
- **🔍 智能搜索** — 按歌曲名、艺术家搜索
- **🎚️ 缓存播放** — 支持 HTTP Range 请求，大文件流畅播放
- **🔐 登录认证** — 使用 NAS 本地账号登录

## 🏗️ 项目结构

```
fn-music-player/
├── app/
│   ├── server/server.js    # Node.js 后端服务器
│   ├── ui/config           # 桌面入口配置
│   └── www/                # 前端页面（index.html + login.html）
├── cmd/                    # 生命周期管理脚本
├── config/                 # 权限和资源配置
├── wizard/                 # 安装/配置向导
├── ICON.PNG / ICON_256.PNG # 应用图标
├── manifest                # 应用元信息
└── build.sh                # 构建脚本
```

## 📦 打包

```bash
cd fn-music-player
fnpack build --directory .
# 输出: fn-music-player.fpk
```

## 📥 安装到 NAS

将生成的 `fn-music-player.fpk` 上传到 NAS 后：

```bash
# 标准安装（运行向导设置端口）
appcenter-cli install-fpk fn-music-player.fpk

# 静默安装
appcenter-cli install-fpk fn-music-player.fpk --env config.env
```

## 📋 使用

1. 安装完成后在桌面点击「小牛音乐播放器」图标
2. 使用 NAS 本地账号登录
3. **关键步骤**：前往「应用设置」→「授权文件夹」，选择您的音乐文件夹（只读权限即可）
4. 回到播放器点击「🔄 重新扫描」扫描音乐
5. 点击任意歌曲开始播放
6. 点击歌曲旁的 ♡ 收藏喜欢的歌

> 💡 可以授权多个音乐文件夹，扫描时会自动合并。

## 📄 许可证

MIT
