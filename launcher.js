// Launcher entry point — bundled into a standalone .exe via Node SEA.
// Serves the game files from the folder the .exe lives in, then opens the browser automatically.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 8080;
const URL = `http://localhost:${PORT}/`;
// When compiled to a .exe, process.execPath is the .exe itself; the game files
// (index.html, engine.js, engine/*.wasm) are expected to sit in the same folder.
const ROOT = path.dirname(process.execPath);

const MIME = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.wasm': 'application/wasm',
    '.css': 'text/css',
    '.json': 'application/json'
};

function openBrowser(url) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
        : process.platform === 'darwin' ? `open "${url}"`
        : `xdg-open "${url}"`;
    exec(cmd);
}

const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(ROOT, urlPath);

    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log('too7a Chess is already running — opening your browser...');
        openBrowser(URL);
    } else {
        console.error('Failed to start:', err.message);
        console.log('Press Enter to exit...');
        process.stdin.once('data', () => process.exit(1));
    }
});

server.listen(PORT, () => {
    console.log('========================================');
    console.log('   too7a Chess — powered by Stockfish 18');
    console.log('========================================');
    console.log('Opening ' + URL + ' in your browser...');
    console.log('Keep this window open while you play.');
    console.log('Close this window to stop the game server.');
    openBrowser(URL);
});
