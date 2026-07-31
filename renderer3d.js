// 3D board and pieces renderer, built on Three.js.
// This module owns the WebGL scene, camera, lighting, piece geometry, and all
// move/capture/promotion animation. Game rules stay entirely in engine.js —
// this module only ever reflects state it's told about via moveInfo objects.
import * as THREE from './lib/three.module.js';
import { OrbitControls } from './lib/OrbitControls.js';

const GOLD = 0xd4af37;
const WHITE_PIECE_COLOR = 0xf5e6d3;
const BLACK_PIECE_COLOR = 0x191410;
const LIGHT_SQ = 0xe8d4b8;
const DARK_SQ = 0x6f4f34;

let scene, camera, renderer, controls, container;
let boardGroup, piecesGroup, highlightGroup;
let pieceMeshes = {}; // sq(0-63) -> THREE.Group
let onSquareClickCb = null;
let raycaster, mouse;
let tweens = []; // active animations
let flipped = false;

function sqToWorld(sq) {
    const row = Math.floor(sq / 8), col = sq % 8;
    return { x: col - 3.5, z: row - 3.5 };
}

// ---------- Piece geometry ----------

function latheMaterial(isWhite) {
    return new THREE.MeshStandardMaterial({
        color: isWhite ? WHITE_PIECE_COLOR : BLACK_PIECE_COLOR,
        roughness: 0.32,
        metalness: 0.08
    });
}

function goldMaterial() {
    return new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.25, metalness: 0.85 });
}

function lathe(points, material, segments = 28) {
    const pts = points.map(([r, y]) => new THREE.Vector2(r, y));
    const geo = new THREE.LatheGeometry(pts, segments);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}

function goldRing(radius, y, tube = 0.02) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 24), goldMaterial());
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    ring.castShadow = true;
    return ring;
}

function buildPawn(mat) {
    const g = new THREE.Group();
    g.add(lathe([
        [0.30, 0.00], [0.30, 0.05], [0.16, 0.10], [0.14, 0.30],
        [0.19, 0.36], [0.13, 0.44], [0.13, 0.52],
        [0.20, 0.58], [0.20, 0.66], [0.10, 0.70], [0.00, 0.72]
    ], mat));
    g.add(goldRing(0.31, 0.03));
    return g;
}

function buildRook(mat) {
    const g = new THREE.Group();
    g.add(lathe([
        [0.34, 0.00], [0.34, 0.06], [0.18, 0.12], [0.16, 0.55],
        [0.28, 0.60], [0.28, 0.72]
    ], mat));
    g.add(goldRing(0.35, 0.03));
    const n = 8, r = 0.24;
    for (let i = 0; i < n; i++) {
        if (i % 2 === 0) continue; // crenellation gaps
        const a = (i / n) * Math.PI * 2;
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.10, 0.11), mat);
        block.position.set(Math.cos(a) * r, 0.77, Math.sin(a) * r);
        block.castShadow = true;
        g.add(block);
    }
    return g;
}

function buildBishop(mat) {
    const g = new THREE.Group();
    g.add(lathe([
        [0.30, 0.00], [0.30, 0.05], [0.15, 0.10], [0.13, 0.34],
        [0.20, 0.40], [0.12, 0.48], [0.26, 0.66], [0.10, 0.86],
        [0.13, 0.92], [0.00, 1.00]
    ], mat));
    g.add(goldRing(0.31, 0.03));
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.20), mat);
    slit.position.set(0, 0.92, 0);
    slit.rotation.z = Math.PI / 5;
    g.add(slit);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), goldMaterial());
    finial.position.y = 1.03;
    g.add(finial);
    return g;
}

function buildKnight(mat) {
    // Not rotationally symmetric — assembled from primitives into a stylized horse-head silhouette.
    const g = new THREE.Group();
    g.add(lathe([
        [0.32, 0.00], [0.32, 0.05], [0.17, 0.10], [0.15, 0.30], [0.20, 0.36]
    ], mat));
    g.add(goldRing(0.33, 0.03));
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.42, 0.30), mat);
    neck.position.set(0, 0.58, -0.02);
    neck.rotation.x = -0.25;
    neck.castShadow = true;
    g.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.20, 0.42), mat);
    head.position.set(0, 0.80, 0.14);
    head.rotation.x = 0.35;
    head.castShadow = true;
    g.add(head);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.18), mat);
    snout.position.set(0, 0.72, 0.34);
    snout.rotation.x = 0.35;
    g.add(snout);
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 8), mat);
    ear.position.set(0, 0.98, 0.05);
    ear.rotation.z = 0.2;
    g.add(ear);
    return g;
}

function buildQueen(mat) {
    const g = new THREE.Group();
    g.add(lathe([
        [0.33, 0.00], [0.33, 0.06], [0.17, 0.12], [0.15, 0.55],
        [0.26, 0.64], [0.22, 0.72], [0.30, 0.80], [0.14, 0.86]
    ], mat));
    g.add(goldRing(0.34, 0.03));
    const n = 7, r = 0.16;
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 8), goldMaterial());
        spike.position.set(Math.cos(a) * r, 0.94, Math.sin(a) * r);
        spike.castShadow = true;
        g.add(spike);
    }
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 14), goldMaterial());
    orb.position.y = 1.0;
    g.add(orb);
    return g;
}

function buildKing(mat) {
    const g = new THREE.Group();
    g.add(lathe([
        [0.34, 0.00], [0.34, 0.06], [0.18, 0.12], [0.16, 0.58],
        [0.28, 0.66], [0.20, 0.76], [0.24, 0.84], [0.13, 0.90]
    ], mat));
    g.add(goldRing(0.35, 0.03));
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.045), goldMaterial());
    crossV.position.y = 1.02;
    crossV.castShadow = true;
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.045, 0.045), goldMaterial());
    crossH.position.y = 1.00;
    crossH.castShadow = true;
    g.add(crossV, crossH);
    return g;
}

const BUILDERS = { P: buildPawn, R: buildRook, N: buildKnight, B: buildBishop, Q: buildQueen, K: buildKing };

function createPieceMesh(pieceChar) {
    const isWhite = pieceChar === pieceChar.toUpperCase();
    const mat = latheMaterial(isWhite);
    const group = BUILDERS[pieceChar.toUpperCase()](mat);
    group.scale.set(0.85, 0.85, 0.85);
    return group;
}

// ---------- Board ----------

function buildBoard() {
    boardGroup = new THREE.Group();

    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(9.2, 0.4, 9.2),
        new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.5, metalness: 0.1 })
    );
    frame.position.y = -0.3;
    frame.receiveShadow = true;
    boardGroup.add(frame);

    for (let sq = 0; sq < 64; sq++) {
        const row = Math.floor(sq / 8), col = sq % 8;
        const isLight = (row + col) % 2 === 0;
        const { x, z } = sqToWorld(sq);
        const tile = new THREE.Mesh(
            new THREE.BoxGeometry(0.98, 0.15, 0.98),
            new THREE.MeshStandardMaterial({ color: isLight ? LIGHT_SQ : DARK_SQ, roughness: 0.55, metalness: 0.05 })
        );
        tile.position.set(x, -0.08, z);
        tile.receiveShadow = true;
        tile.userData.sq = sq;
        boardGroup.add(tile);
    }

    const border = new THREE.Mesh(
        new THREE.RingGeometry(4.55, 4.65, 4, 1),
        goldMaterial()
    );
    border.rotation.x = -Math.PI / 2;
    border.position.y = -0.09;
    boardGroup.add(border);

    scene.add(boardGroup);
}

// ---------- Highlights ----------

function clearHighlights() {
    while (highlightGroup.children.length) {
        const m = highlightGroup.children.pop();
        m.geometry.dispose();
        m.material.dispose();
    }
}

export function setSelection(selectedSq, moves, checkSq) {
    clearHighlights();
    if (selectedSq !== null) {
        const { x, z } = sqToWorld(selectedSq);
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.42, 0.035, 8, 32),
            new THREE.MeshBasicMaterial({ color: 0xffd700 })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, 0.02, z);
        highlightGroup.add(ring);
    }
    (moves || []).forEach(sq => {
        const { x, z } = sqToWorld(sq);
        const isCapture = !!pieceMeshes[sq];
        const mesh = new THREE.Mesh(
            isCapture ? new THREE.TorusGeometry(0.4, 0.04, 8, 24) : new THREE.CircleGeometry(0.14, 24),
            new THREE.MeshBasicMaterial({
                color: isCapture ? 0xe74c3c : 0x5b8cff,
                transparent: true, opacity: 0.75
            })
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, 0.02, z);
        highlightGroup.add(mesh);
    });
    if (checkSq !== null && checkSq !== undefined) {
        const { x, z } = sqToWorld(checkSq);
        const glow = new THREE.Mesh(
            new THREE.CircleGeometry(0.48, 32),
            new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.45 })
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(x, 0.015, z);
        highlightGroup.add(glow);
    }
}

// ---------- Tweening ----------

function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function addTween({ obj, from, to, duration, arc = 0, onComplete }) {
    return new Promise((resolve) => {
        tweens.push({
            obj, from, to, duration, arc, start: performance.now(),
            onComplete: () => { if (onComplete) onComplete(); resolve(); }
        });
    });
}

function stepTweens() {
    const now = performance.now();
    tweens = tweens.filter(tw => {
        const t = Math.min(1, (now - tw.start) / tw.duration);
        const e = easeInOutQuad(t);
        tw.obj.position.x = tw.from.x + (tw.to.x - tw.from.x) * e;
        tw.obj.position.z = tw.from.z + (tw.to.z - tw.from.z) * e;
        const baseY = tw.from.y + (tw.to.y - tw.from.y) * e;
        tw.obj.position.y = baseY + Math.sin(t * Math.PI) * tw.arc;
        if (tw.scaleFrom !== undefined) {
            const s = tw.scaleFrom + (tw.scaleTo - tw.scaleFrom) * e;
            tw.obj.scale.set(s, s, s);
        }
        if (t >= 1) { tw.onComplete(); return false; }
        return true;
    });
}

// ---------- Public API ----------

export function init(containerEl, onSquareClick) {
    container = containerEl;
    onSquareClickCb = onSquareClick;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1419);
    scene.fog = new THREE.Fog(0x0f1419, 12, 28);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    setCameraForSide(false);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.minDistance = 5;
    controls.maxDistance = 16;
    controls.maxPolarAngle = Math.PI * 0.48;

    scene.add(new THREE.AmbientLight(0x8899bb, 0.55));
    const key = new THREE.DirectionalLight(0xfff3d6, 1.1);
    key.position.set(5, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -7; key.shadow.camera.right = 7;
    key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
    scene.add(key);
    const fill = new THREE.PointLight(0xd4af37, 0.5, 20);
    fill.position.set(-4, 5, -4);
    scene.add(fill);

    boardGroup = new THREE.Group();
    piecesGroup = new THREE.Group();
    highlightGroup = new THREE.Group();
    buildBoard();
    scene.add(piecesGroup);
    scene.add(highlightGroup);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    renderer.domElement.addEventListener('click', onCanvasClick);

    window.addEventListener('resize', resize);
    resize();

    animate();
}

function setCameraForSide(black) {
    if (black) camera.position.set(0, 6.2, -7.5);
    else camera.position.set(0, 6.2, 7.5);
    camera.lookAt(0, 0, 0);
}

function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

function onCanvasClick(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(boardGroup.children, false);
    const tileHit = hits.find(h => h.object.userData && h.object.userData.sq !== undefined);
    if (tileHit && onSquareClickCb) onSquareClickCb(tileHit.object.userData.sq);
}

function animate() {
    requestAnimationFrame(animate);
    stepTweens();
    controls.update();
    renderer.render(scene, camera);
}

export function resetBoard(game) {
    Object.values(pieceMeshes).forEach(m => piecesGroup.remove(m));
    pieceMeshes = {};
    for (let sq = 0; sq < 64; sq++) {
        const p = game.board[sq];
        if (!p) continue;
        const mesh = createPieceMesh(p);
        const { x, z } = sqToWorld(sq);
        mesh.position.set(x, 0, z);
        piecesGroup.add(mesh);
        pieceMeshes[sq] = mesh;
    }
    clearHighlights();
}

function removePieceAt(sq, animated) {
    const mesh = pieceMeshes[sq];
    if (!mesh) return Promise.resolve();
    delete pieceMeshes[sq];
    if (!animated) { piecesGroup.remove(mesh); return Promise.resolve(); }
    return new Promise((resolve) => {
        tweens.push({
            obj: mesh,
            from: { x: mesh.position.x, y: 0, z: mesh.position.z },
            to: { x: mesh.position.x, y: 0.9, z: mesh.position.z },
            duration: 300, arc: 0,
            scaleFrom: 0.85, scaleTo: 0.01,
            start: performance.now(),
            onComplete: () => { piecesGroup.remove(mesh); resolve(); }
        });
    });
}

// Animates a completed engine move. Returns a Promise resolving when visuals settle.
export async function animateMove(moveInfo) {
    const { from, to, isCastle, rookFrom, rookTo, capturedSquare } = moveInfo;

    const captureP = capturedSquare !== null ? removePieceAt(capturedSquare, true) : Promise.resolve();

    const mesh = pieceMeshes[from];
    delete pieceMeshes[from];
    pieceMeshes[to] = mesh;
    const fromW = sqToWorld(from), toW = sqToWorld(to);
    const moveP = mesh ? addTween({
        obj: mesh,
        from: { x: fromW.x, y: 0, z: fromW.z },
        to: { x: toW.x, y: 0, z: toW.z },
        duration: 450, arc: 0.6
    }) : Promise.resolve();

    let castleP = Promise.resolve();
    if (isCastle) {
        const rMesh = pieceMeshes[rookFrom];
        delete pieceMeshes[rookFrom];
        pieceMeshes[rookTo] = rMesh;
        const rf = sqToWorld(rookFrom), rt = sqToWorld(rookTo);
        castleP = rMesh ? addTween({
            obj: rMesh,
            from: { x: rf.x, y: 0, z: rf.z },
            to: { x: rt.x, y: 0, z: rt.z },
            duration: 450, arc: 0.4
        }) : Promise.resolve();
    }

    await Promise.all([captureP, moveP, castleP]);
}

// Swaps a pawn mesh for the promoted piece with a scale pop. sq: board index, pieceChar: e.g. 'Q' or 'q'.
export async function morphPromotion(sq, pieceChar) {
    const old = pieceMeshes[sq];
    if (old) {
        await addTween({
            obj: old, from: { x: old.position.x, y: 0, z: old.position.z },
            to: { x: old.position.x, y: 0, z: old.position.z }, duration: 180
        });
        piecesGroup.remove(old);
    }
    const mesh = createPieceMesh(pieceChar);
    const { x, z } = sqToWorld(sq);
    mesh.position.set(x, 0, z);
    mesh.scale.set(0.01, 0.01, 0.01);
    piecesGroup.add(mesh);
    pieceMeshes[sq] = mesh;
    await new Promise((resolve) => {
        tweens.push({
            obj: mesh, from: { x, y: 0, z }, to: { x, y: 0, z }, duration: 300, arc: 0,
            scaleFrom: 0.01, scaleTo: 0.85, start: performance.now(),
            onComplete: resolve
        });
    });
}

export function flipCamera() {
    flipped = !flipped;
    const start = camera.position.clone();
    const end = flipped ? new THREE.Vector3(0, 6.2, -7.5) : new THREE.Vector3(0, 6.2, 7.5);
    const t0 = performance.now();
    function step() {
        const t = Math.min(1, (performance.now() - t0) / 600);
        camera.position.lerpVectors(start, end, easeInOutQuad(t));
        camera.lookAt(0, 0, 0);
        if (t < 1) requestAnimationFrame(step);
    }
    step();
}
