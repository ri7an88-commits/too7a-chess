// UCI bridge to the real Stockfish 18 engine (WASM), running in a Web Worker.
// This replaces hand-written heuristics with the actual world-class engine —
// rated roughly 3600+ Elo, well above any human world champion (~2800 peak).
class StockfishAI {
    constructor(onReady) {
        this.ready = false;
        this.worker = new Worker('engine/stockfish-18-lite-single.js');
        this.worker.onmessage = (e) => this._handleMessage(typeof e.data === 'string' ? e.data : e.data.data);
        this.worker.onerror = (err) => console.error('Stockfish worker error:', err);
        this._pending = null;
        this.worker.postMessage('uci');
        this._onUciOk = () => {
            this.worker.postMessage('setoption name Skill Level value 20'); // max strength
            this.worker.postMessage('setoption name Threads value 1');
            this.worker.postMessage('isready');
        };
        this._onReadyOk = () => {
            this.ready = true;
            if (onReady) onReady();
        };
    }

    _handleMessage(line) {
        if (line === 'uciok') { this._onUciOk(); return; }
        if (line === 'readyok') { this._onReadyOk(); return; }
        if (line.startsWith('bestmove')) {
            const parts = line.split(' ');
            const move = parts[1];
            if (this._pending) {
                const cb = this._pending;
                this._pending = null;
                cb(move);
            }
        }
    }

    // fen: current position. movetimeMs: how long to "think" (search time).
    // Returns a Promise resolving to a UCI move string like "e2e4" or "e7e8q".
    getBestMove(fen, movetimeMs = 3000) {
        return new Promise((resolve) => {
            this._pending = resolve;
            this.worker.postMessage('position fen ' + fen);
            this.worker.postMessage('go movetime ' + movetimeMs);
        });
    }
}
