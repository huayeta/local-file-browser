const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ============================================================
// 配置加载
// ============================================================
function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  if (!Array.isArray(cfg.roots) || cfg.roots.length === 0) {
    throw new Error('config.json 中未配置任何根目录 roots，请先编辑 config.json');
  }
  // 校验根目录是否存在，并转成绝对路径
  cfg.roots = cfg.roots.map((r, i) => {
    const abs = path.resolve(r.path);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      console.error(`⚠️  根目录不存在或不是文件夹 [${i}] "${r.name}": ${abs}`);
      return null;
    }
    return { name: r.name || `根目录${i + 1}`, path: abs, realPath: fs.realpathSync(abs) };
  }).filter(Boolean);
  if (cfg.roots.length === 0) {
    throw new Error('所有配置的根目录都无效，请检查 config.json');
  }
  // shortcuts 未配置时为空数组
  if (!Array.isArray(cfg.shortcuts)) cfg.shortcuts = [];
  return cfg;
}

let CONFIG;
try {
  CONFIG = loadConfig();
} catch (e) {
  console.error('❌ ' + e.message);
  process.exit(1);
}
const PORT = CONFIG.port || 3001;

// ============================================================
// 缓存
//   · 目录列表缓存：目录自身 mtime/size 变化即失效 + TTL 兜底 + FIFO 上限
//   · 文件属性缓存：短 TTL，/file 分片播放（拖动进度条）时避免反复 stat
//   · index.html：启动时读入内存，不再每次请求读盘
// ============================================================
const LIST_CACHE_TTL_MS = (CONFIG.cacheTtlSeconds || 60) * 1000; // 默认 60s 兜底
const LIST_CACHE_MAX = 1000;  // 最多缓存 1000 个目录，超出按插入顺序淘汰
const listCache = new Map();  // key: `${rootIndex}:${rel}` → { entries, dirMtimeMs, dirSize, cachedAt }

const STAT_CACHE_TTL_MS = 5000; // 文件属性缓存 5 秒
const STAT_CACHE_MAX = 5000;
const statCache = new Map();    // key: 绝对路径 → { size, isDir, cachedAt }

const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

// 带缓存的文件 stat（供 /file 使用）
function statCached(full) {
  const now = Date.now();
  const hit = statCache.get(full);
  if (hit && now - hit.cachedAt < STAT_CACHE_TTL_MS) {
    return hit;
  }
  const s = fs.statSync(full);
  const info = { size: s.size, isDir: s.isDirectory(), cachedAt: now };
  statCache.set(full, info);
  if (statCache.size > STAT_CACHE_MAX) {
    const oldest = statCache.keys().next().value;
    statCache.delete(oldest);
  }
  return info;
}

// ============================================================
// 配置热重载：修改 config.json 后自动生效，无需重启
//   · 手动触发：GET /api/reload
//   · 自动触发：fs.watch 监听 config.json 变化（防抖 300ms）
//   重载成功会清空所有缓存（目录列表 + 文件属性）
// ============================================================
const CONFIG_PATH = path.join(__dirname, 'config.json');
let reloadTimer = null;

function reloadConfig() {
  try {
    const cfg = loadConfig();
    CONFIG = cfg;
    listCache.clear();
    statCache.clear();
    console.log(`🔄 配置已热重载: ${CONFIG.roots.length} 个根目录 (${new Date().toLocaleTimeString()})`);
    return true;
  } catch (e) {
    // 保留旧配置，不让一次坏配置把服务搞挂
    console.error(`❌ 配置重载失败（保留旧配置）: ${e.message}`);
    return false;
  }
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reloadConfig, 300);
}

fs.watch(CONFIG_PATH, scheduleReload);

// ============================================================
// 文件类型判定
// ============================================================
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mkv', '.avi']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus']);
const PDF_EXTS = new Set(['.pdf']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.ico']);
const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.log', '.json', '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',
  '.py', '.html', '.htm', '.css', '.xml', '.csv', '.ini', '.cfg', '.conf', '.yml', '.yaml',
  '.toml', '.sh', '.sql', '.java', '.c', '.cpp', '.h', '.hpp', '.go', '.rs', '.php', '.rb',
]);

function classify(name) {
  if (name.startsWith('.')) return 'hidden';
  const ext = path.extname(name).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'file';
}

// 视频/音频的 MIME 类型（浏览器播放必需）
const MIME = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.ogv': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.markdown': 'text/markdown; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8', '.jsx': 'text/plain; charset=utf-8', '.tsx': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.xml': 'text/xml; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8', '.cfg': 'text/plain; charset=utf-8', '.conf': 'text/plain; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8',
  '.toml': 'text/plain; charset=utf-8', '.sh': 'text/x-shellscript; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8', '.py': 'text/x-python; charset=utf-8',
  '.java': 'text/plain; charset=utf-8', '.c': 'text/plain; charset=utf-8',
  '.cpp': 'text/plain; charset=utf-8', '.h': 'text/plain; charset=utf-8',
  '.hpp': 'text/plain; charset=utf-8', '.go': 'text/plain; charset=utf-8',
  '.rs': 'text/plain; charset=utf-8', '.php': 'text/plain; charset=utf-8',
  '.rb': 'text/plain; charset=utf-8',
};

function mimeOf(name) {
  return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

// ============================================================
// 路径安全：确保解析后的路径落在根目录内（防 ../ 穿越）
// ============================================================
function safeResolve(rootAbs, relPath) {
  // path.join + normalize：确定性归一化，../ 会真实上跳，便于后续前缀校验拦截
  const full = path.normalize(path.join(rootAbs, relPath || ''));
  if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) {
    return null;
  }
  return full;
}

// ============================================================
// 路径安全：在字符串前缀校验基础上，再做 realpath 真实路径校验，
// 防止根目录内存在指向根目录外的符号链接（symlink 穿越）
// ============================================================
function resolveWithinRoot(root, relPath) {
  const full = safeResolve(root.path, relPath);
  if (!full) return { ok: false, status: 403, error: '路径越界，禁止访问' };

  let real;
  try { real = fs.realpathSync(full); }
  catch (e) { return { ok: false, status: 404, error: '路径不存在' }; }

  const realRoot = root.realPath;
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    return { ok: false, status: 403, error: '路径越界，禁止访问' };
  }
  return { ok: true, full, real };
}

// ============================================================
// API: /api/roots — 根目录列表
// ============================================================
function apiRoots(req, res) {
  // 逐条校验 shortcuts：root 索引必须有效，且路径必须真实存在于该根目录内（复用 resolveWithinRoot）
  // 无效条目直接跳过，不报错
  const shortcuts = (CONFIG.shortcuts || [])
    .map((s, i) => {
      const root = CONFIG.roots[s.root];
      if (!root) return null;
      const resolved = resolveWithinRoot(root, s.path || '');
      if (!resolved.ok) return null;
      return { index: i, name: s.name || `快捷${i + 1}`, root: s.root, path: s.path || '/' };
    })
    .filter(Boolean);

  sendJson(res, 200, {
    roots: CONFIG.roots.map((r, i) => ({ index: i, name: r.name, path: r.path })),
    shortcuts,
  });
}

// ============================================================
// API: /api/list?root=<i>&path=<rel> — 列目录
// ============================================================
function apiList(req, res, url) {
  const rootIndex = parseInt(url.searchParams.get('root') || '0', 10);
  const root = CONFIG.roots[rootIndex];
  if (!root) return sendJson(res, 400, { error: `无效的 root 索引: ${rootIndex}` });

  const rel = url.searchParams.get('path') || '';
  const resolved = resolveWithinRoot(root, rel);
  if (!resolved.ok) return sendJson(res, resolved.status, { error: resolved.error });
  const full = resolved.full;

  const cacheKey = `${rootIndex}:${rel}`;

  // 每次请求仅 1 次廉价 stat（目录自身），用于校验缓存是否仍然有效
  let stat;
  try { stat = fs.statSync(full); }
  catch (e) {
    listCache.delete(cacheKey);
    return sendJson(res, 404, { error: '路径不存在' });
  }
  if (!stat.isDirectory()) return sendJson(res, 400, { error: '不是文件夹' });

  const now = Date.now();

  // 命中：目录 mtime/size 未变（内容没变）且未超 TTL → 直接返回缓存
  const cached = listCache.get(cacheKey);
  if (
    cached &&
    cached.dirMtimeMs === stat.mtimeMs &&
    cached.dirSize === stat.size &&
    now - cached.cachedAt < LIST_CACHE_TTL_MS
  ) {
    res.setHeader('X-Cache', 'HIT');
    return sendJson(res, 200, {
      root: { index: rootIndex, name: root.name, path: root.path },
      current: { path: (rel || '/').split(path.sep).join('/') || '/' },
      entries: cached.entries,
    });
  }

  // 未命中：重新读盘构建列表
  let names;
  try { names = fs.readdirSync(full); }
  catch (e) { return sendJson(res, 500, { error: `读取目录失败: ${e.message}` }); }

  const entries = names
    .filter(n => n !== '.DS_Store')
    .map(n => {
      const childFull = path.join(full, n);
      let isDir = false, size = 0, mtime = null;
      try {
        const s = fs.statSync(childFull);
        isDir = s.isDirectory();
        size = isDir ? 0 : s.size;
        mtime = s.mtime;
      } catch (e) { /* 无法 stat 的文件跳过详情 */ }
      return {
        name: n,
        isDir,
        kind: isDir ? 'dir' : classify(n),
        size,
        mtime: mtime ? mtime.toISOString() : null,
        // 相对根目录的路径，供前端拼接
        path: path.join(rel || '/', n).split(path.sep).join('/'),
      };
    })
    // 隐藏文件排最后，文件夹排最前，其余按名称排序
    .sort((a, b) => {
      const ha = a.kind === 'hidden' ? 1 : 0;
      const hb = b.kind === 'hidden' ? 1 : 0;
      if (ha !== hb) return ha - hb;
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

  // 写入缓存（超出上限时按插入顺序淘汰最旧的一条）
  listCache.set(cacheKey, {
    entries,
    dirMtimeMs: stat.mtimeMs,
    dirSize: stat.size,
    cachedAt: now,
  });
  if (listCache.size > LIST_CACHE_MAX) {
    const oldest = listCache.keys().next().value;
    listCache.delete(oldest);
  }

  res.setHeader('X-Cache', 'MISS');
  sendJson(res, 200, {
    root: { index: rootIndex, name: root.name, path: root.path },
    current: { path: (rel || '/').split(path.sep).join('/') || '/' },
    entries,
  });
}

// ============================================================
// 文件服务: /file?root=<i>&path=<rel>
//   视频/音频 → 支持 Range 206 分片（可拖动进度条）
//   PDF/图片  → inline 在线查看
//   其他      → attachment 下载
// ============================================================
function serveFile(req, res, url) {
  const rootIndex = parseInt(url.searchParams.get('root') || '0', 10);
  const root = CONFIG.roots[rootIndex];
  if (!root) return sendJson(res, 400, { error: `无效的 root 索引: ${rootIndex}` });

  const rel = url.searchParams.get('path') || '';
  const resolved = resolveWithinRoot(root, rel);
  if (!resolved.ok) return sendJson(res, resolved.status, { error: resolved.error });
  const full = resolved.full;

  let stat;
  try { stat = statCached(full); }
  catch (e) { return sendJson(res, 404, { error: '文件不存在' }); }
  if (stat.isDir) return sendJson(res, 400, { error: '这是文件夹，不能直接下载' });

  const name = path.basename(full);
  const kind = classify(name);
  // 视频/音频/PDF 均支持 Range 分片：
  //   · 视频/音频 → 拖动进度条
  //   · PDF → 浏览器查看器按需拉取页面，大文件秒开
  const supportsRange = kind === 'video' || kind === 'audio' || kind === 'pdf';
  const isInline = kind === 'pdf' || kind === 'image' || kind === 'text';
  const fileSize = stat.size;

  // HEAD 请求：只返回响应头，不传输文件内容
  if (req.method === 'HEAD') {
    const disposition = (supportsRange || isInline)
      ? `inline; filename="${encodeURIComponent(name)}"`
      : `attachment; filename="${encodeURIComponent(name)}"`;
    res.statusCode = 200;
    res.setHeader('Content-Type', mimeOf(name));
    res.setHeader('Content-Length', fileSize);
    res.setHeader('Content-Disposition', disposition);
    if (supportsRange) res.setHeader('Accept-Ranges', 'bytes');
    res.end();
    return;
  }

  // 支持 Range 的文件（视频/音频/PDF）：处理 Range 请求
  if (supportsRange) {
    const range = req.headers.range;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mimeOf(name));
    res.setHeader('Cache-Control', 'no-cache');
    // 打开方式：inline 让浏览器直接播放
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);

    if (!range) {
      // 无 Range → 完整返回
      res.statusCode = 200;
      res.setHeader('Content-Length', fileSize);
      pipeFile(res, full);
      return;
    }

    // 解析 bytes=start-end
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      res.end();
      return;
    }
    let start = m[1] === '' ? 0 : parseInt(m[1], 10);
    let end = m[2] === '' ? fileSize - 1 : parseInt(m[2], 10);
    if (isNaN(start) || isNaN(end) || start < 0 || start >= fileSize) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      res.end();
      return;
    }
    end = Math.min(end, fileSize - 1);
    const chunkSize = end - start + 1;

    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);
    pipeFile(res, full, { start, end, highWaterMark: 256 * 1024 });
    return;
  }

  // 非媒体文件：inline（PDF/图片）或 attachment（其他）
  const disposition = isInline
    ? `inline; filename="${encodeURIComponent(name)}"`
    : `attachment; filename="${encodeURIComponent(name)}"`;
  res.statusCode = 200;
  res.setHeader('Content-Type', mimeOf(name));
  res.setHeader('Content-Length', fileSize);
  res.setHeader('Content-Disposition', disposition);
  pipeFile(res, full);
}

// ============================================================
// 工具
// ============================================================
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

// 安全地把本地文件流式发送给客户端：
//   · 流读取出错（文件被删/替换等）→ 结束响应，不挂起
//   · 客户端断开/取消下载 → 立即销毁流，停止磁盘 IO
function pipeFile(res, full, opts) {
  const stream = fs.createReadStream(full, opts);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('读取文件失败');
    } else {
      res.destroy();
    }
  });
  // 客户端断开（取消下载/关页面）时销毁底层流
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

// ============================================================
// HTTP 服务
// ============================================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  // 方法拦截：只允许 GET / HEAD，其余返回 405
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength('405 Method Not Allowed'));
    res.end('405 Method Not Allowed');
    return;
  }

  try {
    if (p === '/' || p === '/index.html') {
      // 前端页面（内存缓存，启动时已读入）
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Length', INDEX_HTML.length);
      res.end(INDEX_HTML);
    } else if (p === '/api/roots') {
      apiRoots(req, res);
    } else if (p === '/api/reload') {
      const ok = reloadConfig();
      sendJson(res, ok ? 200 : 500, ok
        ? { ok: true, message: `配置已重载，当前 ${CONFIG.roots.length} 个根目录` }
        : { ok: false, error: '配置重载失败，请检查 config.json（服务保留旧配置）' });
    } else if (p === '/api/list') {
      apiList(req, res, url);
    } else if (p === '/file') {
      serveFile(req, res, url);
    } else {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('404 Not Found');
    }
  } catch (err) {
    console.error('请求处理错误:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('500 Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`
==================================================
  📂 本地文件浏览器已启动

  访问: http://localhost:${PORT}

  根目录 (${CONFIG.roots.length}):
${CONFIG.roots.map((r, i) => `    [${i}] ${r.name} → ${r.path}`).join('\n')}

  视频/音频 → 在线播放    PDF → 在线查看    其他 → 下载
==================================================
  `);
});

// ============================================================
// 端口占用检测：启动失败时给出明确的排查/清理指引
// ============================================================
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') {
    console.error('❌ 服务器启动错误:', err);
    process.exit(1);
  }

  console.error(`
❌ 端口 ${PORT} 已被占用，服务启动失败！

原因：很可能有一个之前启动的实例还在后台运行（比如用 nohup/后台方式启动的，
     Ctrl+C 关不掉它，或者根本不在当前终端里）。

解决办法（任选其一）:

  1. 清理所有本服务残留实例（推荐）:
       pkill -f "node server.js"

  2. 查看是哪个进程占用了端口，然后手动结束它:
       lsof -nP -iTCP:${PORT} -sTCP:LISTEN
       kill <上面输出的 PID>

  3. 换一个端口启动:
       修改 config.json 里的 "port" 字段，然后重新启动
`);
  process.exit(1);
});
