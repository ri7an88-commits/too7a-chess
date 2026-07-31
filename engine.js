const PIECES = {
    'wP': '♙', 'wN': '♘', 'wB': '♗', 'wR': '♖', 'wQ': '♕', 'wK': '♔',
    'bP': '♟', 'bN': '♞', 'bB': '♝', 'bR': '♜', 'bQ': '♛', 'bK': '♚'
};

class ChessGame {
    constructor() {
        this.reset();
    }

    reset() {
        this.board = {};
        const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
        fen.split('/').forEach((row, r) => {
            let col = 0;
            for (let c of row) {
                if (/\d/.test(c)) col += parseInt(c);
                else this.board[r * 8 + col++] = c;
            }
        });
        this.turn = 'w';
        this.moveHistory = [];
        this.capturedW = [];
        this.capturedB = [];
        this.enPassantTarget = null;
        this.castleRights = { wK: true, wQ: true, bK: true, bQ: true };
        this.lastMoveFrom = null;
        this.lastMoveTo = null;
    }

    getPiece(sq) { return this.board[sq] || null; }
    getPieceSymbol(p) { return p ? PIECES[(p === p.toUpperCase() ? 'w' : 'b') + p.toUpperCase()] || '?' : ''; }
    getColor(p) { return p === p.toUpperCase() ? 'w' : 'b'; }

    findKing(color) {
        for (let i = 0; i < 64; i++) {
            if (this.board[i] === (color === 'w' ? 'K' : 'k')) return i;
        }
        return -1;
    }

    isSquareAttacked(sq, byColor) {
        for (let i = 0; i < 64; i++) {
            const p = this.board[i];
            if (p && this.getColor(p) === byColor) {
                if (this.canAttackSquare(i, sq, p)) return true;
            }
        }
        return false;
    }

    canAttackSquare(from, to, piece) {
        const type = piece.toUpperCase();
        const row = Math.floor(from / 8), col = from % 8;
        const toRow = Math.floor(to / 8), toCol = to % 8;
        const color = this.getColor(piece);

        if (type === 'P') {
            const dir = color === 'w' ? -1 : 1;
            return to === from + dir * 8 - 1 || to === from + dir * 8 + 1;
        } else if (type === 'N') {
            const dists = [6, 10, 15, 17, -6, -10, -15, -17];
            return dists.includes(to - from);
        } else if (type === 'K') {
            return Math.abs(to - from) <= 9 && Math.abs(toRow - row) <= 1 && Math.abs(toCol - col) <= 1;
        } else if (type === 'R') {
            if (row !== toRow && col !== toCol) return false;
            return this.isPathClear(from, to);
        } else if (type === 'B') {
            if (Math.abs(toRow - row) !== Math.abs(toCol - col)) return false;
            return this.isPathClear(from, to);
        } else if (type === 'Q') {
            if (row !== toRow && col !== toCol && Math.abs(toRow - row) !== Math.abs(toCol - col)) return false;
            return this.isPathClear(from, to);
        }
        return false;
    }

    isPathClear(from, to) {
        const diff = to - from;
        let dir;
        if (diff % 8 === 0) {
            dir = diff > 0 ? 8 : -8;
        } else {
            const abs = Math.abs(diff);
            dir = diff > 0 ? (abs / Math.abs(diff)) : (abs / Math.abs(diff));
            if (Math.abs(diff) > 8) {
                const rowDiff = Math.floor(to / 8) - Math.floor(from / 8);
                const colDiff = (to % 8) - (from % 8);
                dir = (rowDiff > 0 ? 1 : -1) * 8 + (colDiff > 0 ? 1 : -1);
            }
        }
        let sq = from + dir;
        while (sq !== to && sq >= 0 && sq < 64) {
            if (this.board[sq]) return false;
            sq += dir;
        }
        return true;
    }

    getLegalMoves(sq) {
        const p = this.board[sq];
        if (!p || this.getColor(p) !== this.turn) return [];

        const type = p.toUpperCase();
        const row = Math.floor(sq / 8), col = sq % 8;
        let moves = [];

        const addMove = (target) => {
            if (target < 0 || target > 63) return;
            const tp = this.board[target];
            if (!tp || this.getColor(tp) !== this.getColor(p)) moves.push(target);
        };

        if (type === 'P') {
            const dir = this.getColor(p) === 'w' ? -1 : 1;
            const startRow = this.getColor(p) === 'w' ? 6 : 1;
            
            const fwd = sq + dir * 8;
            if (fwd >= 0 && fwd < 64 && !this.board[fwd]) {
                moves.push(fwd);
                if (row === startRow) {
                    const fwd2 = sq + dir * 16;
                    if (!this.board[fwd2]) moves.push(fwd2);
                }
            }
            
            [sq + dir * 8 - 1, sq + dir * 8 + 1].forEach(t => {
                if (t >= 0 && t < 64 && this.board[t] && this.getColor(this.board[t]) !== this.getColor(p)) moves.push(t);
            });

            if (this.enPassantTarget === sq + dir * 8) moves.push(this.enPassantTarget);
        } else if (type === 'N') {
            [6, 10, 15, 17, -6, -10, -15, -17].forEach(d => addMove(sq + d));
        } else if (type === 'K') {
            for (let i = -9; i <= 9; i++) {
                if (Math.abs(i) <= 1) addMove(sq + i);
            }
            // Castling
            if (this.getColor(p) === 'w') {
                if (this.castleRights.wK && sq === 4 && this.board[7] === 'R' && !this.board[5] && !this.board[6]) {
                    if (!this.isSquareAttacked(4, 'b') && !this.isSquareAttacked(5, 'b')) moves.push(6);
                }
                if (this.castleRights.wQ && sq === 4 && this.board[0] === 'R' && !this.board[1] && !this.board[2] && !this.board[3]) {
                    if (!this.isSquareAttacked(4, 'b') && !this.isSquareAttacked(3, 'b')) moves.push(2);
                }
            } else {
                if (this.castleRights.bK && sq === 60 && this.board[63] === 'r' && !this.board[61] && !this.board[62]) {
                    if (!this.isSquareAttacked(60, 'w') && !this.isSquareAttacked(61, 'w')) moves.push(62);
                }
                if (this.castleRights.bQ && sq === 60 && this.board[56] === 'r' && !this.board[57] && !this.board[58] && !this.board[59]) {
                    if (!this.isSquareAttacked(60, 'w') && !this.isSquareAttacked(59, 'w')) moves.push(58);
                }
            }
        } else if (type === 'R') {
            [1, -1, 8, -8].forEach(dir => {
                let t = sq + dir;
                while (t >= 0 && t < 64 && Math.abs((t % 8) - col) <= 7) {
                    if (this.board[t]) {
                        if (this.getColor(this.board[t]) !== this.getColor(p)) moves.push(t);
                        break;
                    }
                    moves.push(t);
                    t += dir;
                }
            });
        } else if (type === 'B') {
            [7, -7, 9, -9].forEach(dir => {
                let t = sq + dir;
                while (t >= 0 && t < 64) {
                    if (this.board[t]) {
                        if (this.getColor(this.board[t]) !== this.getColor(p)) moves.push(t);
                        break;
                    }
                    moves.push(t);
                    t += dir;
                }
            });
        } else if (type === 'Q') {
            [1, -1, 8, -8, 7, -7, 9, -9].forEach(dir => {
                let t = sq + dir;
                while (t >= 0 && t < 64) {
                    if (this.board[t]) {
                        if (this.getColor(this.board[t]) !== this.getColor(p)) moves.push(t);
                        break;
                    }
                    moves.push(t);
                    t += dir;
                }
            });
        }

        // Filter illegal moves (those leaving king in check)
        return moves.filter(to => {
            const cap = this.board[to];
            this.board[to] = p;
            delete this.board[sq];
            const king = this.findKing(this.turn);
            const legal = !this.isSquareAttacked(king, this.turn === 'w' ? 'b' : 'w');
            this.board[sq] = p;
            this.board[to] = cap;
            return legal;
        });
    }

    movePiece(from, to) {
        const p = this.board[from];
        const captured = this.board[to];
        const type = p.toUpperCase();

        // Handle en passant capture
        if (type === 'P' && !captured && (to - from) % 8 !== 0) {
            const capSq = from + (to - from > 0 ? 8 : -8);
            if (this.board[capSq]) {
                const cap = this.board[capSq];
                if (this.getColor(cap) !== this.getColor(p)) {
                    delete this.board[capSq];
                    if (this.getColor(cap) === 'w') this.capturedW.push(cap);
                    else this.capturedB.push(cap);
                }
            }
        }

        // Normal capture
        if (captured) {
            if (this.getColor(captured) === 'w') this.capturedW.push(captured);
            else this.capturedB.push(captured);
        }

        // Castling
        if (type === 'K' && Math.abs(to - from) === 2) {
            if (to > from) {
                const rook = this.board[from + 3];
                this.board[from + 1] = rook;
                delete this.board[from + 3];
            } else {
                const rook = this.board[from - 4];
                this.board[from - 1] = rook;
                delete this.board[from - 4];
            }
            if (this.getColor(p) === 'w') {
                this.castleRights.wK = false;
                this.castleRights.wQ = false;
            } else {
                this.castleRights.bK = false;
                this.castleRights.bQ = false;
            }
        }

        // Update castle rights
        if (type === 'K') {
            if (this.getColor(p) === 'w') {
                this.castleRights.wK = false;
                this.castleRights.wQ = false;
            } else {
                this.castleRights.bK = false;
                this.castleRights.bQ = false;
            }
        } else if (type === 'R') {
            if (from === 0) this.castleRights.wQ = false;
            if (from === 7) this.castleRights.wK = false;
            if (from === 56) this.castleRights.bQ = false;
            if (from === 63) this.castleRights.bK = false;
        }

        // Pawn en passant setup
        this.enPassantTarget = null;
        if (type === 'P' && Math.abs(to - from) === 16) {
            this.enPassantTarget = from + (to > from ? 8 : -8);
        }

        // Pawn promotion
        if (type === 'P' && (to < 8 || to >= 56)) {
            this.board[to] = this.getColor(p) === 'w' ? 'Q' : 'q';
        } else {
            this.board[to] = p;
        }
        delete this.board[from];

        const fromSq = String.fromCharCode(97 + (from % 8)) + (8 - Math.floor(from / 8));
        const toSq = String.fromCharCode(97 + (to % 8)) + (8 - Math.floor(to / 8));
        this.moveHistory.push(fromSq + toSq);

        this.lastMoveFrom = from;
        this.lastMoveTo = to;
        this.turn = this.turn === 'w' ? 'b' : 'w';
        return true;
    }

    isInCheck(color) {
        const king = this.findKing(color);
        return king >= 0 && this.isSquareAttacked(king, color === 'w' ? 'b' : 'w');
    }

    isCheckmate(color) {
        if (!this.isInCheck(color)) return false;
        for (let i = 0; i < 64; i++) {
            const p = this.board[i];
            if (p && this.getColor(p) === color && this.getLegalMoves(i).length > 0) {
                return false;
            }
        }
        return true;
    }

    isStalemate(color) {
        if (this.isInCheck(color)) return false;
        for (let i = 0; i < 64; i++) {
            const p = this.board[i];
            if (p && this.getColor(p) === color && this.getLegalMoves(i).length > 0) {
                return false;
            }
        }
        return true;
    }
}

const game = new ChessGame();
let selected = null;
let validMoves = [];
let difficulty = 2;

function render() {
    const board = document.getElementById('chessboard');
    board.innerHTML = '';
    for (let i = 0; i < 64; i++) {
        const sq = document.createElement('div');
        const row = Math.floor(i / 8), col = i % 8;
        const isLight = (row + col) % 2 === 0;

        sq.className = `square ${isLight ? 'light' : 'dark'}`;
        sq.onclick = () => selectSquare(i);

        if (selected === i) sq.classList.add('selected');
        if (validMoves.includes(i)) sq.classList.add(game.board[i] ? 'capture' : 'valid-move');

        if (game.board[i]) {
            const piece = document.createElement('span');
            const color = game.getColor(game.board[i]);
            piece.className = `piece ${color === 'w' ? 'white' : 'black'}`;
            piece.textContent = game.getPieceSymbol(game.board[i]);
            sq.appendChild(piece);
        }

        board.appendChild(sq);
    }
    updateUI();
}

function selectSquare(sq) {
    if (game.turn === 'b') return;

    if (selected !== null && validMoves.includes(sq)) {
        game.movePiece(selected, sq);
        selected = null;
        validMoves = [];
        render();
        if (game.isCheckmate('b')) {
            updateStatus('Checkmate! White Wins!', true);
        } else if (game.isStalemate('b')) {
            updateStatus('Stalemate! Draw!', false);
        } else {
            setTimeout(aiMove, 800);
        }
    } else {
        selected = sq;
        validMoves = game.getLegalMoves(sq);
        render();
    }
}

function aiMove() {
    const moves = [];
    for (let i = 0; i < 64; i++) {
        const p = game.board[i];
        if (p && game.getColor(p) === 'b') {
            const legal = game.getLegalMoves(i);
            legal.forEach(to => moves.push({from: i, to}));
        }
    }

    if (!moves.length) {
        if (game.isCheckmate('b')) {
            updateStatus('Checkmate! White Wins!', true);
        } else {
            updateStatus('Stalemate! Draw!', false);
        }
        return;
    }

    let bestMove = moves[0];
    if (difficulty >= 2) {
        let bestScore = -999;
        moves.forEach(move => {
            let score = 0;
            const cap = game.board[move.to];
            if (cap) {
                const vals = {P: 1, N: 3, B: 3.5, R: 5, Q: 9};
                score += vals[cap.toUpperCase()] * 10;
            }
            if (difficulty === 3) {
                const row = Math.floor(move.to / 8), col = move.to % 8;
                const dist = Math.abs(3.5 - row) + Math.abs(3.5 - col);
                score += (7 - dist) * 0.3;
            }
            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        });
    } else {
        bestMove = moves[Math.floor(Math.random() * moves.length)];
    }

    game.movePiece(bestMove.from, bestMove.to);
    render();

    if (game.isCheckmate('w')) {
        updateStatus('Checkmate! Black Wins!', true);
    } else if (game.isStalemate('w')) {
        updateStatus('Stalemate! Draw!', false);
    } else if (game.isInCheck('w')) {
        updateStatus('White in Check!', true);
    } else {
        updateStatus('Your Turn', false);
    }
}

function updateStatus(msg, isDanger) {
    const elem = document.getElementById('gameStatus');
    elem.textContent = msg;
    elem.className = isDanger ? 'status-box check' : 'status-box';
}

function updateUI() {
    const status = game.isInCheck(game.turn) ? (game.turn === 'w' ? '♔ Check!' : '♚ Check!') : (game.turn === 'w' ? '♔ White' : '♚ Black');
    document.getElementById('status').textContent = status;
    document.getElementById('moveCount').textContent = game.moveHistory.length;
    document.getElementById('moveHistory').innerHTML = game.moveHistory.map(m => `<div class="move-tag">${m}</div>`).join('');
    document.getElementById('capturedW').innerHTML = game.capturedB.map(p => `<span class="piece black">${game.getPieceSymbol(p)}</span>`).join('');
    document.getElementById('capturedB').innerHTML = game.capturedW.map(p => `<span class="piece white">${game.getPieceSymbol(p)}</span>`).join('');
}

document.getElementById('difficulty').onchange = (e) => difficulty = parseInt(e.target.value);
document.getElementById('newGame').onclick = () => { game.reset(); selected = null; validMoves = []; render(); updateStatus('New Game!', false); };
document.getElementById('flip').onclick = () => {
    const b = document.getElementById('chessboard');
    b.style.transform = b.style.transform === 'rotate(180deg)' ? 'rotate(0deg)' : 'rotate(180deg)';
};
document.getElementById('reset').onclick = () => {
    if (confirm('Reset?')) { game.reset(); selected = null; validMoves = []; render(); updateStatus('Reset!', false); }
};
document.getElementById('exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = 'data:text/plain,' + encodeURIComponent(game.moveHistory.join(' '));
    a.download = 'chess.pgn';
    a.click();
};
document.getElementById('saveBtn').onclick = () => {
    localStorage.setItem('chess', JSON.stringify({board: game.board, hist: game.moveHistory, turn: game.turn}));
    updateStatus('✓ Saved', false);
};
document.getElementById('loadBtn').onclick = () => {
    const data = localStorage.getItem('chess');
    if (data) {
        const saved = JSON.parse(data);
        game.board = saved.board;
        game.moveHistory = saved.hist;
        game.turn = saved.turn;
        render();
        updateStatus('✓ Loaded', false);
    } else {
        updateStatus('No save', true);
    }
};

render();
updateStatus('Ready!', false);