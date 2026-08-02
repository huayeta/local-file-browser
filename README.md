# 📂 本地文件浏览器 (local-file-browser)

一个零依赖、纯 Node.js 实现的本地文件夹浏览器：把本机多个文件夹变成网页，支持在线播放视频/音频、在线查看 PDF/图片/文本，其他文件一键下载。

## ✨ 功能特性

### 文件浏览
- 支持配置**多个根目录**，顶部一键切换
- 文件夹排最前，显示文件类型图标与大小
- 点击文件夹进入子目录，支持面包屑导航与返回上级
- 文件列表内存缓存（目录内容变化自动失效），浏览不重复读盘

### 在线查看 / 播放
| 文件类型 | 点击行为 |
|---|---|
| 文件夹 | 进入该文件夹列表 |
| 视频 (mp4/webm/mov/m4v/ogv…) | 页面内嵌播放，支持拖动进度条（HTTP Range 206 分片） |
| 音频 (mp3/wav/m4a/flac…) | 页面内嵌播放 |
| PDF | 浏览器内置阅读器在线查看，支持分片渐进加载（大文件秒开） |
| 图片 (jpg/png/gif/webp…) | 新标签页查看 |
| 文本 (txt/md/json/py/js 等 30+ 种) | 页面内浮层预览（超过 2MB 自动转下载） |
| 其他文件 | 直接下载 |

### 便捷体验
- **URL hash 路由**：当前所在目录写入 URL（`#/2/学习`），刷新不丢位置，浏览器前进/后退可用，链接可直接分享/收藏
- **滚动位置记忆**：刷新后自动回到之前的滚动位置（sessionStorage）
- **⭐ 快捷访问栏**：config.json 配置常用文件夹，一键直达

### 稳定性与安全
- 路径穿越防护：字符串前缀 + realpath 双重校验，符号链接也无法逃出根目录
- 文件流错误处理：读取失败不挂起，客户端断开自动停止磁盘 IO
- 配置热重载：修改 config.json 自动生效（无需重启），失败保留旧配置
- 端口占用检测：启动时端口被占用会给出清晰的清理指引
- 缓存：目录列表（mtime 失效 + TTL 兜底）、文件属性（5s）、前端页面（内存）

## 🚀 快速开始

要求：Node.js ≥ 18（无需安装任何 npm 依赖）

```bash
cd local-file-browser
node server.js
```

浏览器打开 `http://localhost:3002` 即可。

## ⚙️ 配置 (config.json)

```json
{
  "port": 3002,
  "cacheTtlSeconds": 60,
  "roots": [
    { "name": "视频库", "path": "/Users/zhuhui/Movies" },
    { "name": "音乐库", "path": "/Users/zhuhui/Music" },
    { "name": "文档库", "path": "/Users/zhuhui/Documents" }
  ],
  "shortcuts": [
    { "name": "学习资料", "root": 2, "path": "/学习" },
    { "name": "视频缓存", "root": 0, "path": "/bilibili" }
  ]
}
```

| 字段 | 说明 | 默认值 |
|---|---|---|
| `port` | 服务端口 | 3001 |
| `cacheTtlSeconds` | 目录列表缓存的兜底过期时间（秒） | 60 |
| `roots` | 根目录数组：`name` 显示名、`path` 本地绝对路径 | 必填 |
| `shortcuts` | 快捷访问：`root` 根目录索引（对应 roots 顺序）、`path` 该根目录内的相对路径 | 可选 |

> 修改 config.json 后自动热重载，无需重启进程。

## 📡 API

| 接口 | 说明 |
|---|---|
| `GET /` | 前端页面 |
| `GET /api/roots` | 根目录列表 + 校验后的快捷访问（无效条目自动跳过） |
| `GET /api/list?root=0&path=/子目录` | 列出某根目录下某路径的文件列表（JSON，文件夹排前） |
| `GET /file?root=0&path=/xxx.mp4` | 读取文件：视频/音频/PDF 支持 Range 206 分片，PDF/图片/文本 inline 查看，其他 attachment 下载 |
| `GET /api/reload` | 手动重载 config.json（与自动热重载等效） |

响应头 `X-Cache: HIT / MISS` 标识目录列表是否命中缓存。

## 🛠 常用命令

```bash
# 前台启动（Ctrl+C 正常退出）
node server.js

# 后台启动 / 关闭
nohup node server.js &
pkill -f "node server.js"

# 端口被占用时排查
lsof -nP -iTCP:3002 -sTCP:LISTEN
kill <PID>
```

## 📁 项目结构

```
local-file-browser/
├── server.js          # HTTP 服务：路由、缓存、路径安全、文件流（零依赖）
├── config.json        # 配置：端口、根目录、快捷访问、缓存参数
├── public/
│   └── index.html     # 单页前端：文件列表、播放器、文本预览、快捷栏
└── package.json       # 仅定义启动脚本（npm start）
```
