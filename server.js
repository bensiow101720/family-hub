const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Simple JSON "database" ----------
function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      members: [
        { id: 'ben', name: 'Ben', color: '#3B82F6' },
        { id: 'inez', name: 'Inez', color: '#A855F7' },
        { id: 'miya', name: 'Miya', color: '#EC4899' },
        { id: 'tyler', name: 'Tyler', color: '#22C55E' }
      ],
      events: [],
      chores: [],
      lists: [],
      reminders: [],
      files: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function id() {
  return crypto.randomBytes(6).toString('hex');
}

// ---------- Helpers ----------
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function serveStatic(req, res, urlPath) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = path.join(PUBLIC_DIR, filePath);
  // Prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------- API ----------
async function handleAPI(req, res, urlPath) {
  const db = loadDB();
  const parts = urlPath.split('/').filter(Boolean); // ['api', 'events', ':id']
  const resource = parts[1]; // events, chores, lists, reminders, members, files
  const itemId = parts[2];

  const collections = ['events', 'chores', 'lists', 'reminders', 'files'];

  if (resource === 'members' && req.method === 'GET') {
    return sendJSON(res, 200, db.members);
  }

  if (collections.includes(resource)) {
    if (req.method === 'GET') {
      return sendJSON(res, 200, db[resource]);
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      const item = { id: id(), createdAt: new Date().toISOString(), ...body };
      db[resource].push(item);
      saveDB(db);
      return sendJSON(res, 201, item);
    }
    if (req.method === 'PUT' && itemId) {
      const body = await readBody(req);
      const idx = db[resource].findIndex(x => x.id === itemId);
      if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });
      db[resource][idx] = { ...db[resource][idx], ...body };
      saveDB(db);
      return sendJSON(res, 200, db[resource][idx]);
    }
    if (req.method === 'DELETE' && itemId) {
      const idx = db[resource].findIndex(x => x.id === itemId);
      if (idx === -1) return sendJSON(res, 404, { error: 'Not found' });
      const removed = db[resource].splice(idx, 1);
      saveDB(db);
      return sendJSON(res, 200, removed[0]);
    }
  }

  return sendJSON(res, 404, { error: 'Unknown endpoint' });
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  try {
    if (urlPath.startsWith('/api/')) {
      await handleAPI(req, res, urlPath);
    } else {
      serveStatic(req, res, urlPath);
    }
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Family Hub running on port ${PORT}`);
});
