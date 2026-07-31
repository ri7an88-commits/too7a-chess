const PIECES = {
    'wP': '♙', 'wN': '♘', 'wB': '♗', 'wR': '♖', 'wQ': '♕', 'wK': '♔',
    'bP': '♟', 'bN': '♞', 'bB': '♝', 'bR': '♜', 'bQ': '♛', 'bK': '♚'
};

// FIDE Laws of Chess, Article 3 — movement geometry (row/col based, no wraparound)
const KNIGHT_DELTAS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const KING_DELTAS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const ROOK_DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
const BISHOP_DIRS = [[-1,-1],[-1,1],[1,-1],[1,1]];
const QUEEN_DIRS = [...ROOK_DIRS, ...BISHOP_DIRS];

function sqToRC(sq) { return [Math.floor(sq / 8), sq % 8]; }
function rcToSq(r, c) { return r * 8 + c; }
function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

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
        this.promotedSquare = null; // set when a pawn reaches the last rank; UI offers the choice
        this.halfMoveClock = 0;   // FEN field 5: resets on pawn move or capture (50-move rule, Art. 9.3)
        this.fullMoveNumber = 1;  // FEN field 6: increments after Black's move
    }

    // Exports the position as FEN so an external UCI engine (Stockfish) can analyze it.
    toFEN() {
        let rows = [];
        for (let r = 0; r < 8; r++) {
            let row = '', empty = 0;
            for (let c = 0; c < 8; c++) {
                const p = this.board[rcToSq(r, c)];
                if (p) {
                    if (empty) { row += empty; empty = 0; }
                    row += p;
                } else {
                    empty++;
                }
            }
            if (empty) row += empty;
            rows.push(row);
        }
        const board = rows.join('/');
        const turn = this.turn;
        let castle = '';
        if (this.castleRights.wK) castle += 'K';
        if (this.castleRights.wQ) castle += 'Q';
        if (this.castleRights.bK) castle += 'k';
        if (this.castleRights.bQ) castle += 'q';
        if (!castle) castle = '-';
        const ep = this.enPassantTarget !== null
            ? String.fromCharCode(97 + (this.enPassantTarget % 8)) + (8 - Math.floor(this.enPassantTarget / 8))
            : '-';
        return `${board} ${turn} ${castle} ${ep} ${this.halfMoveClock} ${this.fullMoveNumber}`;
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

    // Pure geometry check: does the piece on `from` attack square `to`? (Article 3.1.2 / 3.1.3)
    // Used for check detection and castling-through-check checks. No recursion into getLegalMoves.
    canAttackSquare(from, to, piece) {
        const type = piece.toUpperCase();
        const color = this.getColor(piece);
        const [r, c] = sqToRC(from);
        const [tr, tc] = sqToRC(to);
        const dr = tr - r, dc = tc - c;

        if (type === 'P') {
            const dir = color === 'w' ? -1 : 1; // Article 3.7.3: pawn captures diagonally forward
            return dr === dir && Math.abs(dc) === 1;
        }
        if (type === 'N') { // Article 3.6
            return KNIGHT_DELTAS.some(([kr, kc]) => kr === dr && kc === dc);
        }
        if (type === 'K') { // Article 3.8.1
            return Math.abs(dr) <= 1 && Math.abs(dc) <= 1 && (dr !== 0 || dc !== 0);
        }
        if (type === 'R') { // Article 3.3
            if (dr !== 0 && dc !== 0) return false;
            return this.isPathClearRC(r, c, tr, tc);
        }
        if (type === 'B') { // Article 3.2
            if (Math.abs(dr) !== Math.abs(dc)) return false;
            return this.isPathClearRC(r, c, tr, tc);
        }
        if (type === 'Q') { // Article 3.4
            if (dr !== 0 && dc !== 0 && Math.abs(dr) !== Math.abs(dc)) return false;
            return this.isPathClearRC(r, c, tr, tc);
        }
        return false;
    }

    // Article 3.5: sliding pieces may not jump over intervening pieces
    isPathClearRC(r1, c1, r2, c2) {
        const stepR = Math.sign(r2 - r1);
        const stepC = Math.sign(c2 - c1);
        let r = r1 + stepR, c = c1 + stepC;
        while (r !== r2 || c !== c2) {
            if (this.board[rcToSq(r, c)]) return false;
            r += stepR;
            c += stepC;
        }
        return true;
    }

    isSquareAttacked(sq, byColor) {
        for (let i = 0; i < 64; i++) {
            const p = this.board[i];
            if (p && this.getColor(p) === byColor && this.canAttackSquare(i, sq, p)) return true;
        }
        return false;
    }

    getLegalMoves(sq) {
        const p = this.board[sq];
        if (!p || this.getColor(p) !== this.turn) return [];

        const type = p.toUpperCase();
        const color = this.getColor(p);
        const [row, col] = sqToRC(sq);
        let moves = [];

        if (type === 'P') { // Article 3.7
            const dir = color === 'w' ? -1 : 1;
            const startRow = color === 'w' ? 6 : 1;

            const fwdR = row + dir;
            if (inBounds(fwdR, col)) {
                const fwd = rcToSq(fwdR, col);
                if (!this.board[fwd]) {
                    moves.push(fwd); // 3.7.1
                    if (row === startRow) { // 3.7.2
                        const fwd2R = row + dir * 2;
                        const fwd2 = rcToSq(fwd2R, col);
                        if (!this.board[fwd2]) moves.push(fwd2);
                    }
                }
            }

            [-1, 1].forEach(dc => {
                const tr = row + dir, tc = col + dc;
                if (!inBounds(tr, tc)) return;
                const t = rcToSq(tr, tc);
                if (this.board[t] && this.getColor(this.board[t]) !== color) {
                    moves.push(t); // 3.7.3 diagonal capture
                } else if (!this.board[t] && t === this.enPassantTarget) {
                    moves.push(t); // 3.7.3.1 en passant
                }
            });
        } else if (type === 'N') { // 3.6
            KNIGHT_DELTAS.forEach(([dr, dc]) => {
                const tr = row + dr, tc = col + dc;
                if (!inBounds(tr, tc)) return;
                const t = rcToSq(tr, tc);
                if (!this.board[t] || this.getColor(this.board[t]) !== color) moves.push(t);
            });
        } else if (type === 'K') { // 3.8.1
            KING_DELTAS.forEach(([dr, dc]) => {
                const tr = row + dr, tc = col + dc;
                if (!inBounds(tr, tc)) return;
                const t = rcToSq(tr, tc);
                if (!this.board[t] || this.getColor(this.board[t]) !== color) moves.push(t);
            });
            this.addCastlingMoves(sq, color, moves); // 3.8.2
        } else {
            const dirs = type === 'R' ? ROOK_DIRS : type === 'B' ? BISHOP_DIRS : QUEEN_DIRS;
            dirs.forEach(([dr, dc]) => {
                let tr = row + dr, tc = col + dc;
                while (inBounds(tr, tc)) {
                    const t = rcToSq(tr, tc);
                    if (this.board[t]) {
                        if (this.getColor(this.board[t]) !== color) moves.push(t);
                        break; // 3.5: cannot jump over pieces
                    }
                    moves.push(t);
                    tr += dr;
                    tc += dc;
                }
            });
        }

        // Article 3.9.2: no move may leave/place own king in check.
        // Note: for en passant, the captured pawn sits BESIDE the destination square,
        // not on it — the simulation must remove it there or a discovered check is missed.
        return moves.filter(to => {
            const cap = this.board[to];
            const [tr2, tc2] = sqToRC(to);
            let epSq = null, epPiece = null;
            if (type === 'P' && cap === undefined && tc2 !== col) {
                epSq = rcToSq(row, tc2);
                epPiece = this.board[epSq];
                if (epPiece) delete this.board[epSq];
            }
            this.board[to] = p;
            delete this.board[sq];
            const king = this.findKing(this.turn);
            const legal = !this.isSquareAttacked(king, this.turn === 'w' ? 'b' : 'w');
            this.board[sq] = p;
            if (cap !== undefined) this.board[to] = cap; else delete this.board[to];
            if (epPiece) this.board[epSq] = epPiece;
            return legal;
        });
    }

    addCastlingMoves(sq, color, moves) {
        // Article 3.8.2.1 / 3.8.2.2: rights lost if king/rook moved, or path attacked/occupied
        // White's back rank is squares 56-63 (e1=60); Black's is 0-7 (e8=4).
        const opp = color === 'w' ? 'b' : 'w';
        if (color === 'w' && sq === 60) {
            if (this.castleRights.wK && this.board[63] === 'R' && !this.board[61] && !this.board[62]) {
                if (!this.isSquareAttacked(60, opp) && !this.isSquareAttacked(61, opp) && !this.isSquareAttacked(62, opp)) moves.push(62);
            }
            if (this.castleRights.wQ && this.board[56] === 'R' && !this.board[57] && !this.board[58] && !this.board[59]) {
                if (!this.isSquareAttacked(60, opp) && !this.isSquareAttacked(59, opp) && !this.isSquareAttacked(58, opp)) moves.push(58);
            }
        } else if (color === 'b' && sq === 4) {
            if (this.castleRights.bK && this.board[7] === 'r' && !this.board[5] && !this.board[6]) {
                if (!this.isSquareAttacked(4, opp) && !this.isSquareAttacked(5, opp) && !this.isSquareAttacked(6, opp)) moves.push(6);
            }
            if (this.castleRights.bQ && this.board[0] === 'r' && !this.board[1] && !this.board[2] && !this.board[3]) {
                if (!this.isSquareAttacked(4, opp) && !this.isSquareAttacked(3, opp) && !this.isSquareAttacked(2, opp)) moves.push(2);
            }
        }
    }

    movePiece(from, to) {
        const p = this.board[from];
        const captured = this.board[to];
        const type = p.toUpperCase();
        const [fr, fc] = sqToRC(from);
        const [tr, tc] = sqToRC(to);

        const moveInfo = {
            from, to, piece: p, color: this.getColor(p),
            captured: captured || null, capturedSquare: captured ? to : null,
            isCastle: false, rookFrom: null, rookTo: null,
            isPromotion: false
        };

        // En passant capture (3.7.3.1/3.7.3.2): captured pawn is beside the destination, not on it
        if (type === 'P' && !captured && fc !== tc) {
            const capSq = rcToSq(fr, tc);
            const cap = this.board[capSq];
            if (cap && this.getColor(cap) !== this.getColor(p)) {
                delete this.board[capSq];
                if (this.getColor(cap) === 'w') this.capturedW.push(cap);
                else this.capturedB.push(cap);
                moveInfo.captured = cap;
                moveInfo.capturedSquare = capSq;
            }
        }

        if (captured) {
            if (this.getColor(captured) === 'w') this.capturedW.push(captured);
            else this.capturedB.push(captured);
        }

        // Castling (3.8.2): move king two squares, rook jumps to the crossed square
        if (type === 'K' && Math.abs(tc - fc) === 2) {
            moveInfo.isCastle = true;
            if (tc > fc) {
                const rook = this.board[from + 3];
                this.board[from + 1] = rook;
                delete this.board[from + 3];
                moveInfo.rookFrom = from + 3;
                moveInfo.rookTo = from + 1;
            } else {
                const rook = this.board[from - 4];
                this.board[from - 1] = rook;
                delete this.board[from - 4];
                moveInfo.rookFrom = from - 4;
                moveInfo.rookTo = from - 1;
            }
        }

        // Article 3.8.2.1: castling rights lost once king or that rook has moved
        if (type === 'K') {
            if (this.getColor(p) === 'w') { this.castleRights.wK = false; this.castleRights.wQ = false; }
            else { this.castleRights.bK = false; this.castleRights.bQ = false; }
        } else if (type === 'R') {
            if (from === 0) this.castleRights.wQ = false;
            if (from === 7) this.castleRights.wK = false;
            if (from === 56) this.castleRights.bQ = false;
            if (from === 63) this.castleRights.bK = false;
        }
        // A rook captured on its home square also forfeits that side's rights
        if (to === 0) this.castleRights.wQ = false;
        if (to === 7) this.castleRights.wK = false;
        if (to === 56) this.castleRights.bQ = false;
        if (to === 63) this.castleRights.bK = false;

        // En passant target set only immediately after a two-square pawn advance (3.7.3.1)
        this.enPassantTarget = null;
        if (type === 'P' && Math.abs(tr - fr) === 2) {
            this.enPassantTarget = rcToSq((fr + tr) / 2, fc);
        }

        // Promotion (3.7.3.3): pawn reaching the last rank MUST be exchanged for a piece
        // of the player's choice (Q/R/B/N — 3.7.3.4). Default to Queen here; promotedSquare
        // flags the square so the UI can offer the actual choice before the turn proceeds.
        this.promotedSquare = null;
        if (type === 'P' && (tr === 0 || tr === 7)) {
            this.board[to] = this.getColor(p) === 'w' ? 'Q' : 'q';
            this.promotedSquare = to;
            moveInfo.isPromotion = true;
        } else {
            this.board[to] = p;
        }
        delete this.board[from];

        const fromSq = String.fromCharCode(97 + fc) + (8 - fr);
        const toSq = String.fromCharCode(97 + tc) + (8 - tr);
        this.moveHistory.push(fromSq + toSq);

        // FEN clocks (Art. 9.3 / standard FEN spec): halfmove resets on pawn move or capture
        this.halfMoveClock = (type === 'P' || captured) ? 0 : this.halfMoveClock + 1;
        if (this.getColor(p) === 'b') this.fullMoveNumber++;

        this.lastMoveFrom = from;
        this.lastMoveTo = to;
        this.turn = this.turn === 'w' ? 'b' : 'w';
        return moveInfo;
    }

    isInCheck(color) {
        const king = this.findKing(color);
        return king >= 0 && this.isSquareAttacked(king, color === 'w' ? 'b' : 'w');
    }

    hasAnyLegalMove(color) {
        for (let i = 0; i < 64; i++) {
            const p = this.board[i];
            if (p && this.getColor(p) === color && this.getLegalMoves(i).length > 0) return true;
        }
        return false;
    }

    isCheckmate(color) {
        return this.isInCheck(color) && !this.hasAnyLegalMove(color);
    }

    isStalemate(color) {
        return !this.isInCheck(color) && !this.hasAnyLegalMove(color);
    }
}

import * as Renderer3D from './renderer3d.js';

const game = new ChessGame();
let selected = null;
let validMoves = [];
let THINK_TIME_MS = 3000; // Stockfish "go movetime" — how long it analyzes before moving
let stockfish = null;
let inputLocked = false; // blocks clicks while a move is animating or the engine is thinking

function initEngine() {
    updateStatus('Loading Stockfish engine...', false);
    stockfish = new StockfishAI(() => {
        updateStatus('Engine ready. Your move (White).', false);
    });
}

function initBoard3D() {
    Renderer3D.init(document.getElementById('board3d'), (sq) => selectSquare(sq));
    Renderer3D.resetBoard(game);
    refreshHighlights();
}

function refreshHighlights() {
    const checkSq = game.isInCheck(game.turn) ? game.findKing(game.turn) : null;
    Renderer3D.setSelection(selected, validMoves, checkSq);
}

async function selectSquare(sq) {
    if (inputLocked || game.turn === 'b') return;

    if (selected !== null && validMoves.includes(sq)) {
        inputLocked = true;
        const moveInfo = game.movePiece(selected, sq);
        selected = null;
        validMoves = [];
        refreshHighlights();
        await Renderer3D.animateMove(moveInfo);
        updateUI();

        if (game.promotedSquare !== null) {
            await showPromotionPicker(game.promotedSquare, 'w');
        }
        inputLocked = false;
        afterWhiteMoveCompletes();
    } else if (game.board[sq] && game.getColor(game.board[sq]) === game.turn) {
        selected = sq;
        validMoves = game.getLegalMoves(sq);
        refreshHighlights();
    } else {
        selected = null;
        validMoves = [];
        refreshHighlights();
    }
}

function afterWhiteMoveCompletes() {
    if (game.isCheckmate('b')) {
        updateStatus('Checkmate! White Wins!', true);
    } else if (game.isStalemate('b')) {
        updateStatus('Stalemate! Draw!', false);
    } else {
        setTimeout(aiMove, 500);
    }
}

// Article 3.7.3.3/3.7.3.4: promotion is the player's choice, not restricted to captured pieces.
// Returns a Promise so the caller can await the pick before proceeding.
function showPromotionPicker(sq, color) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('promoOverlay');
        overlay.innerHTML = '';
        const choices = ['Q', 'R', 'B', 'N'];
        choices.forEach(ch => {
            const btn = document.createElement('button');
            btn.className = 'promo-btn';
            const pieceChar = color === 'w' ? ch : ch.toLowerCase();
            btn.innerHTML = `<span class="piece ${color === 'w' ? 'white' : 'black'}">${game.getPieceSymbol(pieceChar)}</span>`;
            btn.onclick = async () => {
                game.board[sq] = pieceChar;
                game.promotedSquare = null;
                overlay.style.display = 'none';
                await Renderer3D.morphPromotion(sq, pieceChar);
                resolve();
            };
            overlay.appendChild(btn);
        });
        overlay.style.display = 'flex';
    });
}

// Converts a UCI square like "e4" to a 0-63 board index.
function algebraicToSq(alg) {
    const col = alg.charCodeAt(0) - 97;
    const rank = parseInt(alg[1], 10);
    const row = 8 - rank;
    return row * 8 + col;
}

async function aiMove() {
    if (!stockfish || !stockfish.ready) {
        updateStatus('Engine still loading...', false);
        setTimeout(aiMove, 500);
        return;
    }
    if (game.isCheckmate('b') || game.isStalemate('b')) return;

    inputLocked = true;
    updateStatus('Stockfish is thinking...', false);
    const fen = game.toFEN();
    const uciMove = await stockfish.getBestMove(fen, THINK_TIME_MS);

    if (!uciMove || uciMove === '(none)') {
        inputLocked = false;
        if (game.isCheckmate('b')) updateStatus('Checkmate! White Wins!', true);
        else updateStatus('Stalemate! Draw!', false);
        return;
    }

    const from = algebraicToSq(uciMove.slice(0, 2));
    const to = algebraicToSq(uciMove.slice(2, 4));
    const promo = uciMove.length > 4 ? uciMove[4] : null; // q/r/b/n

    const moveInfo = game.movePiece(from, to);
    await Renderer3D.animateMove(moveInfo);

    if (promo && game.promotedSquare !== null) {
        // Article 3.7.3.3: honor the engine's chosen promotion piece (movePiece defaults to Queen)
        const map = { q: 'Q', r: 'R', b: 'B', n: 'N' };
        const letter = map[promo].toLowerCase(); // Black is the only side the AI promotes
        game.board[game.promotedSquare] = letter;
        await Renderer3D.morphPromotion(game.promotedSquare, letter);
    }
    game.promotedSquare = null;
    updateUI();
    refreshHighlights();
    inputLocked = false;

    if (game.isCheckmate('w')) updateStatus('Checkmate! Black Wins!', true);
    else if (game.isStalemate('w')) updateStatus('Stalemate! Draw!', false);
    else if (game.isInCheck('w')) updateStatus('White in Check!', true);
    else updateStatus('Your Turn', false);
}

function updateStatus(msg, isDanger) {
    const elem = document.getElementById('gameStatus');
    elem.textContent = msg;
    elem.className = isDanger ? 'status-box check' : 'status-box';
}

function updateUI() {
    const inCheck = game.isInCheck(game.turn);
    const status = (game.turn === 'w' ? 'White' : 'Black') + (inCheck ? ' - Check!' : '');
    document.getElementById('status').textContent = status;
    document.getElementById('moveCount').textContent = game.moveHistory.length;
    document.getElementById('moveHistory').innerHTML = game.moveHistory.map(m => `<div class="move-tag">${m}</div>`).join('');
    document.getElementById('capturedW').innerHTML = game.capturedB.map(p => `<span class="piece black">${game.getPieceSymbol(p)}</span>`).join('');
    document.getElementById('capturedB').innerHTML = game.capturedW.map(p => `<span class="piece white">${game.getPieceSymbol(p)}</span>`).join('');
}

document.getElementById('difficulty').onchange = (e) => THINK_TIME_MS = parseInt(e.target.value);
document.getElementById('newGame').onclick = () => {
    game.reset(); selected = null; validMoves = [];
    Renderer3D.resetBoard(game);
    updateUI();
    updateStatus('New Game!', false);
};
document.getElementById('flip').onclick = () => Renderer3D.flipCamera();
document.getElementById('reset').onclick = () => {
    if (confirm('Reset?')) {
        game.reset(); selected = null; validMoves = [];
        Renderer3D.resetBoard(game);
        updateUI();
        updateStatus('Reset!', false);
    }
};
document.getElementById('exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = 'data:text/plain,' + encodeURIComponent(game.moveHistory.join(' '));
    a.download = 'chess.pgn';
    a.click();
};
document.getElementById('saveBtn').onclick = () => {
    localStorage.setItem('chess', JSON.stringify({ board: game.board, hist: game.moveHistory, turn: game.turn }));
    updateStatus('✓ Saved', false);
};
document.getElementById('loadBtn').onclick = () => {
    const data = localStorage.getItem('chess');
    if (data) {
        const saved = JSON.parse(data);
        game.board = saved.board;
        game.moveHistory = saved.hist;
        game.turn = saved.turn;
        selected = null;
        validMoves = [];
        Renderer3D.resetBoard(game);
        updateUI();
        updateStatus('✓ Loaded', false);
    } else {
        updateStatus('No save', true);
    }
};

initBoard3D();
updateUI();
initEngine();
