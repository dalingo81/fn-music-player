const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const child_process = require('child_process');
const crypto = require('crypto');

// ══════════════════════════════════════════════════════
// 小牛音乐播放器 - Node.js 后端服务
// ══════════════════════════════════════════════════════

const PORT = process.env.PORT || 6688;
// 支持多个音乐文件夹（冒号分隔，来自 TRIM_DATA_ACCESSIBLE_PATHS）
var MUSIC_PATHS = [];
if (process.env.MUSIC_PATH) {
  MUSIC_PATHS = process.env.MUSIC_PATH.split(':').filter(function(p) { return p.trim(); });
}
if (process.env.TRIM_DATA_ACCESSIBLE_PATHS) {
  var sharePaths = process.env.TRIM_DATA_ACCESSIBLE_PATHS.split(':').filter(function(p) { return p.trim(); });
  for (var i = 0; i < sharePaths.length; i++) {
    if (MUSIC_PATHS.indexOf(sharePaths[i]) === -1) {
      MUSIC_PATHS.push(sharePaths[i]);
    }
  }
}
if (!MUSIC_PATHS.length) {
  MUSIC_PATHS = ['/var/music'];
}
const MUSIC_PATH = MUSIC_PATHS.join(':');
const DATA_DIR = process.env.DATA_DIR || '/tmp/fn-music-player';

// 会话管理（内存中，重启后需重新登录）
var sessions = {};
var SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24h

// 清理过期会话
setInterval(function() {
  var now = Date.now();
  for (var key in sessions) {
    if (sessions[key].expires < now) delete sessions[key];
  }
}, 60000);

// 生成随机 session key
function generateSession() {
  return crypto.randomBytes(24).toString('hex');
}

// 验证登录：通过 su 测试本地账号密码
function verifyLogin(username, password) {
  try {
    // 使用 expect 风格的 su 测试 - 通过 echo pipe 方式验证
    // `su -c 'echo OK' username` 然后输入密码
    var result = child_process.spawnSync('su', ['-c', 'echo AUTH_OK', username], {
      input: password + '\n',
      timeout: 5000,
      encoding: 'utf-8'
    });
    // 如果命令执行成功（exit code 0）且输出包含 AUTH_OK，认证通过
    return result.status === 0 && result.stdout && result.stdout.indexOf('AUTH_OK') >= 0;
  } catch(e) {
    return false;
  }
}

// 检查请求是否已认证
function checkAuth(req) {
  var cookies = {};
  var raw = req.headers.cookie || '';
  raw.split(';').forEach(function(c) {
    var parts = c.trim().split('=');
    if (parts.length === 2) cookies[parts[0].trim()] = parts[1].trim();
  });
  var sid = cookies.session;
  if (sid && sessions[sid] && sessions[sid].expires > Date.now()) {
    // 刷新过期时间
    sessions[sid].expires = Date.now() + SESSION_TIMEOUT;
    return sessions[sid].username;
  }
  return null;
}

// 收藏列表文件（存在 DATA_DIR 下，系统保证可写）
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');

// 支持的音频格式
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.wav', '.aac', '.ogg', '.ape', '.wma', '.m4a', '.opus', '.aiff', '.dsf', '.dff'
]);

// 封面图片扩展名
const COVER_FILENAMES = [
  'cover.jpg', 'cover.jpeg', 'cover.png',
  'folder.jpg', 'folder.jpeg', 'folder.png',
  'front.jpg', 'front.png',
  'album.jpg', 'album.png',
  'Cover.jpg', 'Cover.jpeg', 'Cover.png',
  'Folder.jpg', 'Folder.jpeg', 'Folder.png',
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.ape': 'audio/ape',
  '.wma': 'audio/x-ms-wma',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
  '.aiff': 'audio/aiff',
  '.dsf': 'audio/dsf',
  '.dff': 'audio/dff',
};

// ══════════════════════════════════════════════════════
// 音乐扫描
// ══════════════════════════════════════════════════════

let musicCache = {
  songs: [],
  byArtist: {},
  byAlbum: {},
  lastScan: 0
};

function scanMusic() {
  const songs = [];
  const startTime = Date.now();

  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (AUDIO_EXTENSIONS.has(ext)) {
            songs.push(fullPath);
          }
        }
      }
    } catch (err) {
      // 跳过权限不足的目录
    }
  }

  for (const rootDir of MUSIC_PATHS) {
    try {
      if (fs.existsSync(rootDir)) {
        walk(rootDir);
        console.log('Scanned directory: ' + rootDir);
      } else {
        console.log('Directory not found: ' + rootDir);
      }
    } catch (err) {
      console.error('Error scanning music directory ' + rootDir + ': ' + err.message);
    }
  }

  // 解析标签信息
  const parsed = songs.map(f => parseSongInfo(f));
  const byArtist = {};
  const byAlbum = {};

  for (const song of parsed) {
    const artist = song.artist || '未知艺术家';
    const album = song.album || '未知专辑';

    if (!byArtist[artist]) byArtist[artist] = [];
    byArtist[artist].push(song);

    if (!byAlbum[album]) byAlbum[album] = [];
    byAlbum[album].push(song);
  }

  musicCache = {
    songs: parsed,
    byArtist,
    byAlbum,
    lastScan: Date.now()
  };

  console.log('Scanned ' + parsed.length + ' songs in ' + (Date.now() - startTime) + 'ms from ' + MUSIC_PATHS.length + ' folder(s)');
  return musicCache;
}

function parseSongInfo(filePath) {
  const fileName = path.basename(filePath);
  const dirName = path.dirname(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const fileNameNoExt = path.basename(filePath, ext);

  // 尝试从文件名解析艺术家 - 曲名（常见格式 "艺术家 - 曲名.mp3"）
  let artist = '';
  let title = fileNameNoExt;
  const dashMatch = fileNameNoExt.match(/^(.+?)\s*-\s*(.+)$/);
  if (dashMatch) {
    artist = dashMatch[1].trim();
    title = dashMatch[2].trim();
  }

  // 查找目录下的封面
  const cover = findCover(dirName);

  return {
    // URL-safe base64: / -> _, + -> -, 去掉 = padding（解码时可自动补回）
    id: Buffer.from(filePath).toString('base64').replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, ''),
    filePath,
    fileName,
    fileNameNoExt,
    title,
    artist,
    album: path.basename(dirName),
    ext,
    cover,
    dir: dirName,
    size: getFileSize(filePath),
  };
}

function findCover(dirPath) {
  try {
    for (const name of COVER_FILENAMES) {
      const coverPath = path.join(dirPath, name);
      if (fs.existsSync(coverPath) && fs.statSync(coverPath).isFile()) {
        return coverPath;
      }
    }
    // 如果没找到标准封面名，尝试找目录中的第一张图片
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (['.jpg', '.jpeg', '.png'].includes(ext)) {
        const imgPath = path.join(dirPath, entry);
        if (fs.statSync(imgPath).isFile()) return imgPath;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function getFileSize(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.size;
  } catch (e) {
    return 0;
  }
}

// 格式文件大小
function formatSize(bytes) {
  if (bytes === 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return size.toFixed(1) + ' ' + units[i];
}

// ══════════════════════════════════════════════════════
// HTTP 请求处理
// ══════════════════════════════════════════════════════

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    var cacheControl = 'public, max-age=3600';
    if (ext === '.html') cacheControl = 'no-cache, no-store, must-revalidate';
    else if (ext === '.mp3' || ext === '.flac') cacheControl = 'no-cache';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', () => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });
  } catch (err) {
    res.writeHead(404);
    res.end('Not Found');
  }
}

function serveAudio(res, filePath, rangeHeader) {
  var stat, fileSize, ext, contentType;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    fileSize = stat.size;
    ext = path.extname(filePath).toLowerCase();
    contentType = MIME_TYPES[ext] || 'audio/mpeg';
  } catch (err) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  try {
    if (rangeHeader) {
      var parts = rangeHeader.replace(/bytes=/, '').split('-');
      var start = parseInt(parts[0], 10);
      var end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      var chunkSize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': 'bytes ' + start + '-' + end + '/' + fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      });

      var stream = fs.createReadStream(filePath, { start: start, end: end });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      });

      var stream = fs.createReadStream(filePath);
      stream.pipe(res);
    }
  } catch (err) {
    if (!res.headersSent) res.writeHead(500);
    res.end('Stream error');
  }
}

// ══════════════════════════════════════════════════════
// API 路由
// ══════════════════════════════════════════════════════

function handleAPI(req, res, parsedUrl) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (parsedUrl.pathname === '/api/scan' && req.method === 'POST') {
    // 重新扫描
    const result = scanMusic();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: result.songs.length }));
    return;
  }

  if (parsedUrl.pathname === '/api/songs' && req.method === 'GET') {
    // 获取全部歌曲
    const search = (parsedUrl.query && parsedUrl.query.q) ? parsedUrl.query.q.toLowerCase() : '';
    let songs = musicCache.songs;

    if (search) {
      songs = songs.filter(s =>
        s.title.toLowerCase().includes(search) ||
        s.artist.toLowerCase().includes(search) ||
        s.album.toLowerCase().includes(search) ||
        s.fileName.toLowerCase().includes(search)
      );
    }

    const result = songs.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      ext: s.ext,
      size: formatSize(s.size),
      hasCover: !!s.cover,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (parsedUrl.pathname === '/api/artists' && req.method === 'GET') {
    const artists = Object.keys(musicCache.byArtist).map(name => ({
      name,
      count: musicCache.byArtist[name].length,
    }));
    artists.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(artists));
    return;
  }

  if (parsedUrl.pathname === '/api/albums' && req.method === 'GET') {
    const albums = Object.keys(musicCache.byAlbum).map(name => ({
      name,
      artist: musicCache.byAlbum[name][0].artist,
      count: musicCache.byAlbum[name].length,
      hasCover: musicCache.byAlbum[name].some(s => s.cover),
    }));
    albums.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(albums));
    return;
  }

  if (parsedUrl.pathname === '/api/artist' && req.method === 'GET') {
    const name = parsedUrl.query && parsedUrl.query.name;
    if (name && musicCache.byArtist[name]) {
      const songs = musicCache.byArtist[name].map(s => ({
        id: s.id, title: s.title, artist: s.artist, album: s.album, ext: s.ext, hasCover: !!s.cover,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(songs));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Artist not found' }));
    }
    return;
  }

  if (parsedUrl.pathname === '/api/album' && req.method === 'GET') {
    const name = parsedUrl.query && parsedUrl.query.name;
    if (name && musicCache.byAlbum[name]) {
      const songs = musicCache.byAlbum[name].map(s => ({
        id: s.id, title: s.title, artist: s.artist, album: s.album, ext: s.ext, hasCover: !!s.cover,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(songs));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Album not found' }));
    }
    return;
  }

  if (parsedUrl.pathname === '/api/status' && req.method === 'GET') {
    var pathStatus = MUSIC_PATHS.map(function(p) {
      return { path: p, exists: fs.existsSync(p) };
    });
    var anyExists = pathStatus.some(function(s) { return s.exists; });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      songCount: musicCache.songs.length,
      musicPaths: MUSIC_PATHS,
      pathStatus: pathStatus,
      anyPathExists: anyExists,
      lastScan: musicCache.lastScan,
      version: '1.0.0',
    }));
    return;
  }

  // === 收藏歌单 API ===
  if (parsedUrl.pathname === '/api/favorites' && req.method === 'GET') {
    const favs = readFavorites();
    // 只返回当前还在歌曲库中的收藏
    const valid = favs.filter(function(id) {
      return musicCache.songs.some(function(s) { return s.id === id; });
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(valid));
    return;
  }

  if (parsedUrl.pathname === '/api/favorites/toggle' && req.method === 'POST') {
    let body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        var id = data.id;
        if (!id) { res.writeHead(400); res.end('{"error":"missing id"}'); return; }
        var favs = readFavorites();
        var idx = favs.indexOf(id);
        var liked = false;
        if (idx >= 0) { favs.splice(idx, 1); }
        else { favs.push(id); liked = true; }
        writeFavorites(favs);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ liked: liked, count: favs.length }));
      } catch(e) {
        res.writeHead(400);
        res.end('{"error":"invalid json"}');
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/favorites/check' && req.method === 'POST') {
    let body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        var ids = data.ids;
        if (!Array.isArray(ids)) { res.writeHead(400); res.end('{"error":"ids required"}'); return; }
        var favs = readFavorites();
        var result = {};
        ids.forEach(function(id) { result[id] = favs.indexOf(id) >= 0; });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch(e) {
        res.writeHead(400);
        res.end('{"error":"invalid json"}');
      }
    });
    return;
  }

  // === 登录 API ===
  if (parsedUrl.pathname === '/api/login' && req.method === 'POST') {
    var body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        var data = JSON.parse(body);
        var user = data.username || '';
        var pass = data.password || '';
        if (!user || !pass) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: '用户名和密码不能为空' }));
          return;
        }
        if (verifyLogin(user, pass)) {
          var sid = generateSession();
          sessions[sid] = { username: user, expires: Date.now() + SESSION_TIMEOUT };
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': 'session=' + sid + '; path=/; max-age=' + (SESSION_TIMEOUT / 1000) + '; SameSite=Lax',
          });
          res.end(JSON.stringify({ success: true, username: user }));
        } else {
          res.writeHead(401);
          res.end(JSON.stringify({ error: '用户名或密码错误' }));
        }
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: '请求格式错误' }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/api/check_session' && req.method === 'GET') {
    var user = checkAuth(req);
    if (user) {
      res.writeHead(200);
      res.end(JSON.stringify({ authenticated: true, username: user }));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ authenticated: false }));
    }
    return;
  }

  if (parsedUrl.pathname === '/api/logout' && req.method === 'POST') {
    var cookies = {};
    var raw = req.headers.cookie || '';
    raw.split(';').forEach(function(c) {
      var parts = c.trim().split('=');
      if (parts.length === 2) cookies[parts[0].trim()] = parts[1].trim();
    });
    if (cookies.session) delete sessions[cookies.session];
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'session=; path=/; max-age=0; SameSite=Lax',
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // 404 for unknown API
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
}

function readFavorites() {
  var fp = FAVORITES_FILE;
  try {
    if (fs.existsSync(fp)) {
      var raw = fs.readFileSync(fp, 'utf-8');
      return JSON.parse(raw);
    }
  } catch(e) {}
  return [];
}

function writeFavorites(favs) {
  var fp = FAVORITES_FILE;
  try {
    var dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(favs));
  } catch(e) {
    console.error('writeFavorites failed:', e.message);
  }
}

// ══════════════════════════════════════════════════════
// 服务器主循环
// ══════════════════════════════════════════════════════

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 登录/登出/会话检查 API 不需要认证
  if (pathname === '/api/login' || pathname === '/api/logout' || pathname === '/api/check_session') {
    handleAPI(req, res, parsedUrl);
    return;
  }

  // 其他 API 需要登录认证
  if (pathname.startsWith('/api/')) {
    var user = checkAuth(req);
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '未登录', loginRequired: true }));
      return;
    }
    handleAPI(req, res, parsedUrl);
    return;
  }

  // 登录页面不需要认证
  if (pathname === '/login.html') {
    serveStatic(res, path.join(__dirname, '..', 'www', 'login.html'));
    return;
  }

  // 其他页面需要认证
  var user = checkAuth(req);
  if (!user) {
    // 直接重定向到登录页
    res.writeHead(302, { 'Location': '/login.html' });
    res.end();
    return;
  }

  // 音频流（通过编码后的ID获取真实路径）
  if (pathname.startsWith('/stream/')) {
    const encodedPath = pathname.replace('/stream/', '').replace(/_/g, '/').replace(/-/g, '+');
    // 去掉尾部多余的 /（兼容旧编码中 = 被替换为 _ 再转为 / 的情况）
    const clean = encodedPath.replace(/\/+$/, '');
    // 解码得到真实路径（Node.js base64 不需要 padding）
    let filePath = null;
    try {
      filePath = Buffer.from(clean, 'base64').toString('utf-8');
    } catch(e) {}
    if (filePath && fs.existsSync(filePath)) {
      serveAudio(res, filePath, req.headers.range);
    } else if (filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('File not found: ' + filePath);
    } else {
      res.writeHead(404);
      res.end('File not found');
    }
    return;
  }

  // 封面图片
  if (pathname.startsWith('/cover/')) {
    const encodedPath = pathname.replace('/cover/', '').replace(/_/g, '/').replace(/-/g, '+');
    const clean = encodedPath.replace(/\/+$/, '');
    let coverPath = null;
    try {
      const fp = Buffer.from(clean, 'base64').toString('utf-8');
      const dir = path.dirname(fp);
      // 在歌曲目录中找封面
      for (const name of COVER_FILENAMES) {
        const cp = path.join(dir, name);
        if (fs.existsSync(cp)) { coverPath = cp; break; }
      }
    } catch(e) {}
    if (coverPath && fs.existsSync(coverPath)) {
      serveStatic(res, coverPath);
    } else {
      res.writeHead(404);
      res.end('');
    }
    return;
  }

  // 静态文件（前端）
  let filePath = path.join(__dirname, '..', 'www', pathname === '/' ? 'index.html' : pathname);

  // 安全检查：防止目录穿越
  const resolvedPath = path.resolve(filePath);
  const wwwDir = path.resolve(path.join(__dirname, '..', 'www'));
  if (!resolvedPath.startsWith(wwwDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(resolvedPath)) {
    serveStatic(res, resolvedPath);
  } else {
    // SPA fallback: 所有未知路径返回 index.html
    const indexPath = path.join(__dirname, '..', 'www', 'index.html');
    if (fs.existsSync(indexPath)) {
      serveStatic(res, indexPath);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }
});

// ══════════════════════════════════════════════════════
// 启动
// ══════════════════════════════════════════════════════

console.log('========================================');
console.log('  🎵 小牛音乐播放器 - Music Player');
console.log('========================================');
console.log('  Port:         ' + PORT);
console.log('  Music Folders (' + MUSIC_PATHS.length + '):');
MUSIC_PATHS.forEach(function(p) { console.log('    - ' + p); });
console.log('  Data Dir:     ' + DATA_DIR);
console.log('========================================');
if (!MUSIC_PATHS.length || (MUSIC_PATHS.length === 1 && MUSIC_PATHS[0] === '/var/music')) {
  console.log('⚠️  No music folder authorized. Please set it in App Settings.');
}

// 启动时扫描音乐
console.log('Scanning music library...');
scanMusic();
console.log('Found ' + musicCache.songs.length + ' songs.');

server.listen(PORT, '::', () => {
  console.log('Server listening on http://[::]:' + PORT + ' (IPv4 + IPv6)');
});

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});
