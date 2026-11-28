# 📡 API 文档

本地文件浏览器（local-file-browser）的全部 HTTP 接口说明。服务默认运行于 `http://localhost:3002`。

> 维护约定：**新增或修改任何 API 时，必须同步更新本文件**（与 config.example.json、README.md 的配置说明同步维护）。

## 通用说明

| 项 | 说明 |
|---|---|
| 前缀 | 所有接口均支持 `/local` 前缀（如 `/local/api/roots`），旧路径（`/api/roots`、`/file`）仍兼容 |
| 方法 | 仅允许 `GET` / `HEAD`；其他方法返回 `405 Method Not Allowed` |
| 响应格式 | API 返回 JSON（`Content-Type: application/json; charset=utf-8`） |
| 错误格式 | `{ "error": "错误说明" }` |
| 路径参数编码 | `root`/`path` 等含中文或特殊字符的参数需 URL 编码（浏览器前端已自动处理） |

## 接口总览

| 接口 | 功能 |
|---|---|
| `GET /` 或 `/index.html` | 前端页面 |
| `GET /api/roots` | 根目录列表 + 快捷访问 + 前端配置 |
| `GET /api/reload` | 手动重载 config.json（与自动热重载等效） |
| `GET /api/list` | 列目录 |
| `GET /api/search` | 递归搜索（可单根 / 全部根） |
| `GET /api/search-stream` | 流式递归搜索（NDJSON，边搜边出） |
| `GET /file` | 文件服务（播放/查看/下载） |
| `GET /api/transcode` | 启动视频转码（ffmpeg，不支持编码转 MP4） |
| `GET /api/transcode-cancel` | 取消转码（kill ffmpeg 进程 + 清理 .part） |
| `GET /api/transcode-status` | 查询转码状态（none/transcoding/done） |
| `GET /pdfjs/*` | PDF.js 查看器静态资源 |
| `GET /static/*` | `public/` 下的通用静态资源（白名单扩展名） |

---

## 1. `GET /` 或 `/index.html`

前端单页应用（内存缓存，启动时读入）。

**响应**：`200 OK`，`Content-Type: text/html; charset=utf-8`

---

## 2. `GET /api/roots`

返回根目录列表、快捷访问、前端配置项。

**响应**：`200 OK`

```json
{
  "roots": [
    { "index": 0, "name": "视频库", "path": "/Users/zhuhui/Movies" }
  ],
  "shortcuts": [
    { "index": 0, "name": "学习资料", "root": 2, "path": "/学习" }
  ],
  "pdfPreloadPages": 3
}
```

| 字段 | 说明 |
|---|---|
| `roots` | 配置的根目录数组（`index` 为索引，`name` 显示名，`path` 绝对路径） |
| `shortcuts` | 快捷访问数组（已校验、无效条目自动跳过） |
| `pdfPreloadPages` | PDF 预加载页数（前端滑动窗口用，来自 config.json） |

---

## 3. `GET /api/reload`

手动重载 `config.json`（与自动热重载等效，成功会清空目录/文件缓存）。

**响应**：
- `200 OK`：`{ "ok": true, "message": "配置已重载，当前 N 个根目录" }`
- `500`：`{ "ok": false, "error": "配置重载失败，请检查 config.json（服务保留旧配置）" }`

---

## 4. `GET /api/list?root=<i>&path=<rel>`

列出某根目录下某路径的文件列表。文件夹排最前，隐藏文件排最后。

**参数**：

| 参数 | 必填 | 说明 |
|---|---|---|
| `root` | 否 | 根目录索引，默认 `0` |
| `path` | 否 | 根目录内相对路径，默认根目录（如 `/学习`） |

**响应**：`200 OK`，响应头含 `X-Cache: HIT / MISS`（目录列表缓存命中标记）

```json
{
  "root": { "index": 0, "name": "视频库", "path": "/Users/zhuhui/Movies" },
  "current": { "path": "/" },
  "entries": [
    {
      "name": "学习",
      "isDir": true,
      "kind": "dir",
      "size": 0,
      "mtime": "2026-08-01T10:00:00.000Z",
      "path": "/学习"
    },
    {
      "name": "视频.mp4",
      "isDir": false,
      "kind": "video",
      "size": 1048576,
      "mtime": "2026-08-01T10:00:00.000Z",
      "path": "/视频.mp4"
    }
  ]
}
```

| entries 字段 | 说明 |
|---|---|
| `name` | 文件/文件夹名 |
| `isDir` | 是否文件夹 |
| `kind` | 类型：`dir`/`video`/`audio`/`pdf`/`image`/`text`/`file`/`hidden` |
| `size` | 字节数（文件夹为 0） |
| `mtime` | 修改时间（ISO 格式） |
| `path` | 相对根目录的路径（供前端拼接） |

**错误**：`400`（无效 root/不是文件夹）、`403`（路径越界）、`404`（路径不存在）、`500`（读取目录失败）

---

## 5. 搜索接口

### 5.1 `GET /api/search?root=<i>&q=<关键词>`

递归搜索文件名（不区分大小写、中文直接匹配、多关键词空格 AND、全角/半角归一化、按匹配度排序）。可用 `scope=all` 搜索全部根目录。

**参数**：

| 参数 | 必填 | 说明 |
|---|---|---|
| `root` | 否 | 根目录索引，默认 `0`（`scope=all` 时忽略） |
| `q` | 是 | 关键词（多词用空格分隔，AND 匹配） |
| `scope` | 否 | 搜索范围：`root`（默认，仅当前根）/ `all`（全部根目录） |
| `inPath` | 否 | `1`/`true` 时除文件名外也匹配上级目录路径（默认 `0`/`false`） |

**响应**：`200 OK`

```json
{
  "query": "学习",
  "scope": "all",
  "root": { "scope": "all", "roots": [ { "index": 0, "name": "视频库" }, { "index": 1, "name": "音乐库" } ] },
  "inPath": false,
  "total": 2,
  "matched": 2,
  "truncated": false,
  "results": [
    {
      "name": "学习",
      "isDir": true,
      "kind": "dir",
      "size": 0,
      "mtime": "2026-08-01T10:00:00.000Z",
      "path": "/学习",
      "rootIndex": 0,
      "rootName": "视频库",
      "pathOnly": false
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `scope` | 本次搜索范围：`root` / `all` |
| `root` | 单根时为 `{ index, name, path }`；`scope=all` 时为 `{ "scope":"all", "roots":[{index,name}] }` |
| `inPath` | 是否启用「含文件夹名」 |
| `total` | 返回的结果数量（已按 `searchMaxResults` 截断后的条数） |
| `matched` | 命中总数；`scope=all` 因每根配额到顶会提前停止，此时为「至少」的下界 |
| `truncated` | 是否被截断：超时 / 命中超过上限 / 多根配额已满 |
| `results` | 结果数组，字段同 `/api/list` 的 entries，并额外带 `rootIndex`、`rootName`（来源根）、`pathOnly`（是否为「仅路径命中」） |

**说明**：
- 多关键词空格 AND；全角/半角、大小写归一化；排序优先级：文件名命中 > 仅路径命中，文件夹优先，再按匹配度
- `scope=all`：**并行**遍历所有根，每根结果上限 `ceil(searchMaxResults / 根数)`，某根配额满即停止该根（其它根不受影响），既能覆盖多个根，也不会被单个超大根拖死

**限制**（来自 config.json，可配置）：
- `searchTimeoutMs`：整体超时（默认 10000ms），超时返回已找到部分 + `truncated: true`
- `searchMaxDepth`：最大递归深度（默认 8 层）
- `searchMaxResults`：结果上限（默认 200 条）

**错误**：`400`（无效 root）、`403`（路径越界）、`404`（路径不存在）、`500`（搜索失败）

---

### 5.2 `GET /api/search-stream?root=<i>&q=<关键词>`

流式搜索：边遍历边以 NDJSON（每行一个 JSON）下发，首屏很快就能看到结果。参数与 5.1 相同（`root`、`q`、`scope`、`inPath`）。前端实际使用的就是该接口。

**响应**：`200 OK`，`Content-Type: application/x-ndjson; charset=utf-8`，逐行输出以下帧：

```jsonc
{"type":"batch","results":[ /* 单条结果，字段同 5.1 results */ ]}
{"type":"done","query":"学习","scope":"all","root":{...},"inPath":false,"results":[ /* 最终排序+截断后的完整列表 */ ],"total":2,"matched":2,"truncated":false,"timedOut":false}
{"type":"error","error":"搜索失败: ..."}
```

| 帧 | 说明 |
|---|---|
| `batch` | 每积累约 20 条或静默 150ms 下发一批；流式阶段顺序为遍历顺序，请以 `done` 帧的 `results` 为最终列表 |
| `done` | 结束帧：`results` 为最终排序 + 截断后的列表，`timedOut` 标记是否因超时中断 |
| `error` | 搜索出错 |

**说明**：客户端断开（换关键词 / 关页面）时服务端会立即停止遍历；错误码同 5.1。

---

## 6. `GET /file?root=<i>&path=<rel>`

读取文件内容。按类型自动选择行为：

| 类型 | 行为 |
|---|---|
| 视频 / 音频 | `inline`，支持 HTTP Range 分片（`206 Partial Content`），可拖动进度条 |
| PDF | `inline`，支持 Range 分片（浏览器/PDF.js 按需加载，大文件秒开） |
| 图片 | `inline`（浏览器直接查看） |
| 文本 | `inline`（前端浮层预览，自动做 UTF-8/GBK 编码探测） |
| 其他 | `attachment`（强制下载） |

**参数**：

| 参数 | 必填 | 说明 |
|---|---|---|
| `root` | 否 | 根目录索引，默认 `0` |
| `path` | 是 | 文件相对路径（如 `/视频.mp4`） |

**响应（支持 Range 的文件，带 `Range: bytes=start-end` 请求头）**：

```
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 0-99/1048576
Content-Length: 100
Content-Type: video/mp4
Cache-Control: no-cache, no-transform
Content-Disposition: inline; filename="视频.mp4"
```

**响应（无 Range 请求 / 非 Range 文件）**：`200 OK` + `Content-Type` + `Content-Length` + `Content-Disposition`

**错误**：`400`（无效 root/是文件夹）、`403`（路径越界）、`404`（文件不存在）、`416`（Range 越界，返回 `Content-Range: bytes */<size>`）、`500`（读取失败）

---

## 7. `GET /pdfjs/*`

PDF.js 查看器静态资源（`public/pdfjs/` 目录，如 `pdf.min.mjs`、`pdf.worker.min.mjs`）。带路径安全校验（防越界），MIME 按扩展名识别。

**响应**：`200 OK` + 对应 `Content-Type`（如 `text/javascript; charset=utf-8`）

**错误**：`403`（越界）、`404`（文件不存在）

---

## 8. `GET /api/transcode?root=<i>&path=<rel>`

启动视频转码：浏览器无法直接播放的视频（如 VP6 编码的 .flv）用 ffmpeg 转成 H.264 MP4。产物与源文件同目录，先写 `.part` 临时文件，转码成功校验后 rename 为 `.mp4`（原子操作）。**默认转码成功且校验通过后会删除源文件以节省空间**（`config.json` 的 `deleteSourceAfterTranscode` 设为 `false` 可保留源文件）；完成/删源后该目录的列表缓存与搜索缓存会主动失效，接口立即反映最新内容。

**参数**：

| 参数 | 必填 | 说明 |
|---|---|---|
| `root` | 否 | 根目录索引，默认 `0` |
| `path` | 是 | 视频文件相对路径（如 `/视频.flv`） |

**响应**：`200 OK`

```json
{ "ok": true, "message": "转码已启动，完成前请勿重复操作", "dst": "/Users/.../视频.mp4" }
```

**说明**：
- 依赖 ffmpeg/ffprobe（config.json 的 `ffmpegPath`/`ffprobePath`，Windows 需填完整路径）
- 若同目录已存在转好的 `.mp4` 则直接复用，不重复转码
- 转码期间可调用 `/api/transcode-cancel` 取消（kill ffmpeg + 清理 .part，源文件始终保留）
- 崩溃/中断只会残留 `.part`，源文件不受影响，下次转码自动清理

**错误**：`400`（无效 root/不是文件）、`403`（路径越界）、`404`（文件不存在）

---

## 9. `GET /api/transcode-cancel?root=<i>&path=<rel>`

取消正在进行的转码：kill 对应的 ffmpeg 进程 + 清理残留 `.part` 文件，源文件不受影响。

**参数**：

| 参数 | 必填 | 说明 |
|---|---|---|
| `root` | 否 | 根目录索引，默认 `0` |
| `path` | 是 | 转码目标路径（同目录 `.mp4` 相对路径，如 `/视频.mp4`） |

**响应**：`200 OK`

```json
{ "ok": true, "cancelled": true }
```

**说明**：`cancelled` 为 `true` 表示找到并终止了对应转码任务；为 `false` 表示无进行中的任务（仍会兜底清理 .part）。

**错误**：`400`（无效 root/路径越界）

---

## 10. `GET /api/transcode-status?root=<i>&path=<rel>`

查询转码状态。

**参数**：

| 参数 | 必填 | 说明 |
|---|---|---|
| `root` | 否 | 根目录索引，默认 `0` |
| `path` | 是 | 转码目标路径（同目录 `.mp4` 相对路径） |

**响应**：`200 OK`

```json
{ "status": "transcoding", "exists": false, "progress": 45 }
```

**说明**：
- `status` 取值——`none`（无转码产物/未在转码）、`transcoding`（正在转码）、`done`（已有转码产物 `.mp4`）
- `exists` 与 `status === 'done'` 等价
- `progress` 转码进度百分比（0-100）：`transcoding` 时返回当前进度（实时递增），`done` 返回 `100`，`none` 返回 `0`

**错误**：`400`（无效 root/路径越界）

---

## 11. `GET /static/<相对路径>`

提供项目 `public/` 目录下的通用静态资源（如 `/static/maths/index.html`）。路径需 URL 编码；仅允许白名单扩展名：`.html`、`.htm`、`.css`、`.js`、`.mjs`、`.svg`、`.png`、`.ico`、`.xlsx`。带 realpath 越界校验，防止访问根目录外的文件；`.xlsx` 以 `attachment` 下载。

**响应**：`200 OK` + 对应 `Content-Type` + `Content-Length`（`HEAD` 只返回响应头）

**错误**：`400`（路径解码失败）、`403`（越界或扩展名不在白名单）、`404`（文件不存在）

---

## 状态码速查

| 状态码 | 含义 |
|---|---|
| `200` | 成功（含无 Range 的文件流） |
| `206` | Range 分片成功 |
| `400` | 参数错误（无效 root、请求路径是文件夹等） |
| `403` | 路径越界（目录穿越 / 符号链接逃逸 / pdfjs 越界） |
| `404` | 路径或文件不存在 |
| `405` | 方法不允许（仅 GET/HEAD） |
| `416` | Range 范围无效 |
| `500` | 服务器内部错误 |
