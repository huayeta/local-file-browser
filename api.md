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
| `GET /api/search` | 递归搜索 |
| `GET /file` | 文件服务（播放/查看/下载） |
| `GET /pdfjs/*` | PDF.js 查看器静态资源 |

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

## 5. `GET /api/search?root=<i>&q=<关键词>`

在当前根目录内递归搜索文件名（不区分大小写、中文直接匹配、多关键词空格 AND、全角/半角归一化、按匹配度排序）。

**参数**：

| 参数 | 必填 | 说明 |
|---|---|---|
| `root` | 否 | 根目录索引，默认 `0` |
| `q` | 是 | 关键词（多词用空格分隔，AND 匹配） |

**响应**：`200 OK`

```json
{
  "query": "学习",
  "root": { "index": 0, "name": "视频库", "path": "/Users/zhuhui/Movies" },
  "total": 3,
  "truncated": false,
  "results": [
    {
      "name": "学习",
      "isDir": true,
      "kind": "dir",
      "size": 0,
      "mtime": "2026-08-01T10:00:00.000Z",
      "path": "/学习"
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `total` | 返回的结果数量 |
| `truncated` | 是否被截断：搜索超时（见 `searchTimeoutMs`）或结果超过上限（见 `searchMaxResults`）时为 `true` |
| `results` | 结果数组（字段同 `/api/list` 的 entries，文件夹优先、按匹配度排序） |

**限制**（来自 config.json，可配置）：
- `searchTimeoutMs`：整体超时（默认 10000ms），超时返回已找到部分 + `truncated: true`
- `searchMaxDepth`：最大递归深度（默认 8 层）
- `searchMaxResults`：结果上限（默认 200 条）

**错误**：`400`（无效 root）、`403`（路径越界）、`404`（路径不存在）、`500`（搜索失败）

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
