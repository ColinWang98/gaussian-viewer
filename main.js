// 依赖：three 与 @lumaai/luma-web 通过 CDN 引入（ESM）
// - Three.js r162 ESM
// - Luma Web v0.2+ ESM（含 LumaSplatsThree）

import * as THREE from './libs/three.module.js';
import { OrbitControls } from './libs/OrbitControls.js';
import { VRButton } from './libs/VRButton.js';
import { LumaSplatsThree } from './libs/luma-web.module.js';

const container = document.getElementById('threeContainer');
const spzInput = document.getElementById('spzInput');
const gridToggle = document.getElementById('gridToggle');
const resetViewBtn = document.getElementById('resetViewBtn');
const statusEl = document.getElementById('status');
const loadSampleBtn = document.getElementById('loadSampleBtn');

let renderer, scene, camera, controls, grid;
let currentSplats = null;

init();
animate();

function init() {
    try { setStatus('待机'); } catch {}
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    // WebGL2 支持检测
    try {
        const gl = renderer.getContext();
        const isWebGL2 = (gl && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);
        if (!isWebGL2) {
            setStatus('警告：未使用 WebGL2，性能或兼容性可能受限');
        }
    } catch (e) {
        setStatus('错误：无法获取 WebGL 上下文');
        console.error(e);
    }

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f1a);

    camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.01, 2000);
    camera.position.set(0.8, 0.5, 1.2);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.2, 0);

    // 辅助：地面网格
    grid = new THREE.GridHelper(10, 20, 0x274060, 0x1a2a44);
    grid.material.opacity = 0.35;
    grid.material.transparent = true;
    scene.add(grid);

    // 默认添加一个占位文本提示
    addSplashNotice();

    // 事件
    window.addEventListener('resize', onWindowResize);
    spzInput.addEventListener('change', onFilePicked);
    gridToggle.addEventListener('change', () => grid.visible = gridToggle.checked);
    resetViewBtn.addEventListener('click', resetView);
    if (loadSampleBtn) {
        loadSampleBtn.addEventListener('click', () => {
            setStatus('从示例加载中…');
            // 使用公开的 Luma capture 链接（示例来自官方文档）
            loadSpzFromUrl('https://lumalabs.ai/capture/83e9aae8-7023-448e-83a6-53ccb377ec86');
        });
    }

    // VR（可选）
    try {
        renderer.xr.enabled = true;
        const vrButton = VRButton.createButton(renderer);
        vrButton.style.position = 'absolute';
        vrButton.style.right = '10px';
        vrButton.style.bottom = '10px';
        container.appendChild(vrButton);
    } catch {}

    // 留言板初始化
    initMessageBoard();

    // 自动加载 ?src=
    const params = new URLSearchParams(location.search);
    const src = params.get('src');
    if (src) {
        // 允许 http(s) 或相对/同源路径；无法直接读取 C:\ 绝对路径
        if (/^https?:\/\//i.test(src) || !/^[a-zA-Z]:\\/.test(src)) {
            setStatus('从 URL 加载中…');
            loadSpzFromUrl(src);
        }
    }

    // Drag & Drop 加载 .spz
    ['dragenter','dragover','dragleave','drop'].forEach(ev => {
        container.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false);
    });
    container.addEventListener('drop', (e) => {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !files.length) return;
        const file = files[0];
        if (!file.name.toLowerCase().endsWith('.spz')) { alert('请拖拽 .spz 文件'); return; }
        setStatus('从拖拽文件加载中…');
        loadSpzFromBlob(file);
    });

    // 初始化完成标记，供外部自检
    try { window.__gsInitDone = true; } catch {}
}

function addSplashNotice() {
    console.log('提示：请在顶部选择本地 .spz 文件以加载高斯场景');
}

async function loadSpzFromBlob(fileOrBlob) {
    // 优先直接传入 File 给 Luma（保留扩展名，便于识别）
    let file = fileOrBlob;
    if (!(fileOrBlob instanceof File)) {
        file = new File([fileOrBlob], 'local.spz', { type: 'application/octet-stream' });
    }

    // 移除旧的 splats
    if (currentSplats) {
        scene.remove(currentSplats);
        currentSplats.dispose?.();
        currentSplats = null;
    }

    try {
        // 直接传 File 对象
        currentSplats = new LumaSplatsThree({
            source: file,
            loadingAnimationEnabled: true,
            enableThreeShaderIntegration: true,
        });
        currentSplats.material.transparent = true;
        scene.add(currentSplats);
        await waitNextFrame();
        tryFitViewToSplats();
        setStatus('加载完成');
    } catch (err) {
        console.warn('直接传 File 失败，尝试 blob URL 回退：', err);
        try {
            const blobUrl = URL.createObjectURL(file);
            currentSplats = new LumaSplatsThree({
                source: blobUrl,
                loadingAnimationEnabled: true,
                enableThreeShaderIntegration: true,
            });
            currentSplats.material.transparent = true;
            scene.add(currentSplats);
            await waitNextFrame();
            tryFitViewToSplats();
            setStatus('加载完成');
        } catch (err2) {
            console.error('加载 SPZ 失败（含回退）：', err2);
            setStatus('加载失败');
            alert('加载 .spz 失败，请确认文件是否有效或通过本地服务器访问后再试。');
        }
    }
}

async function loadSpzFromUrl(url) {
    if (currentSplats) {
        scene.remove(currentSplats);
        currentSplats.dispose?.();
        currentSplats = null;
    }
    currentSplats = new LumaSplatsThree({
        source: url,
        loadingAnimationEnabled: true,
        enableThreeShaderIntegration: true,
    });
    currentSplats.material.transparent = true;
    scene.add(currentSplats);
    await waitNextFrame();
    tryFitViewToSplats();
    setStatus('加载完成');
}

function tryFitViewToSplats() {
    // LumaSplatsThree 未暴露直接包围盒，这里做一个合理视角重置
    controls.target.set(0, 0.2, 0);
    camera.position.set(0.8, 0.5, 1.2);
    controls.update();
}

function onFilePicked(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const isSpz = file.name.toLowerCase().endsWith('.spz');
    if (!isSpz) {
        alert('请选择 .spz 文件');
        return;
    }
    setStatus('从选择文件加载中…');
    loadSpzFromBlob(file);
}

function resetView() {
    tryFitViewToSplats();
}

function onWindowResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function waitNextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
}

// 全局错误捕获，便于显示状态
window.addEventListener('error', (e) => {
    try { setStatus('脚本错误'); } catch {}
    console.error('全局错误', e);
});
window.addEventListener('unhandledrejection', (e) => {
    try { setStatus('脚本未处理的异常'); } catch {}
    console.error('未处理的 Promise 拒绝', e.reason || e);
});

// ------------------------- 留言板与弹幕 -------------------------
const STORAGE_KEY = 'gs_viewer_messages_v1';
const MAX_MESSAGES = 10;
const msgForm = document.getElementById('msgForm');
const nicknameInput = document.getElementById('nickname');
const messageInput = document.getElementById('message');
const danmakuRoot = document.getElementById('danmaku');

let laneCount = 6; // 车道数量
let laneHeights = [];
let activeItems = [];

function initMessageBoard() {
    msgForm.addEventListener('submit', onSubmitMessage);
    layoutDanmaku();
    window.addEventListener('resize', layoutDanmaku);
    // 载入历史并开播
    const list = getMessages();
    list.forEach((m, i) => spawnDanmaku(m, i * 700));
}

function onSubmitMessage(e) {
    e.preventDefault();
    const nickname = (nicknameInput.value || '').trim();
    const content = (messageInput.value || '').trim();
    if (!content) return;
    const msg = {
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        nickname,
        content,
        ts: Date.now()
    };
    const list = getMessages();
    list.push(msg);
    // 仅保留最近 10 条
    const trimmed = list.slice(-MAX_MESSAGES);
    saveMessages(trimmed);
    messageInput.value = '';
    spawnDanmaku(msg, 0);
}

function getMessages() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr;
    } catch {
        return [];
    }
}

function saveMessages(arr) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch {}
}

function layoutDanmaku() {
    const h = danmakuRoot.clientHeight;
    laneCount = Math.max(4, Math.min(10, Math.floor(h / 32)));
    laneHeights = new Array(laneCount).fill(0).map((_, i) => Math.floor((i + 0.3) * (h / laneCount)));
}

function pickLane(widthPx) {
    // 简单选择：找与当前活跃弹幕冲突最少的一条
    // 计算每条车道的最右端位置
    const now = performance.now();
    const speeds = 90; // px/s
    const gap = 40; // 与前车最小间隔
    let bestLane = 0, bestX = -Infinity;
    for (let i = 0; i < laneCount; i++) {
        let laneRight = 0;
        for (const it of activeItems) {
            if (it.lane !== i) continue;
            const elapsed = (now - it.startTime) / 1000;
            const x = it.startX - speeds * elapsed; // 当前左侧位置
            const right = x + it.width;
            laneRight = Math.max(laneRight, right);
        }
        const candidate = -laneRight; // 越小越拥堵
        if (candidate > bestX) { bestX = candidate; bestLane = i; }
    }
    return bestLane;
}

function spawnDanmaku(msg, delayMs = 0) {
    const el = document.createElement('div');
    el.className = 'item color-' + (Math.abs(hashCode(msg.id)) % 8);
    const name = msg.nickname ? `<span class="badge">${escapeHtml(msg.nickname)}</span>` : '';
    el.innerHTML = `${name}${escapeHtml(msg.content)}`;
    danmakuRoot.appendChild(el);
    // 先让浏览器计算宽度
    el.style.transform = 'translateX(0)';
    const width = el.clientWidth + 8;
    const lane = pickLane(width);
    const y = laneHeights[lane] || 0;
    const startX = danmakuRoot.clientWidth + 20;
    const speed = 90; // px/s
    const total = (startX + width + 40) / speed * 1000; // ms
    el.style.top = `${y}px`;
    el.style.left = `${startX}px`;

    const item = { el, lane, width, startX, startTime: performance.now() + delayMs };
    activeItems.push(item);

    setTimeout(() => animateItem(item, speed), delayMs);
}

function animateItem(item, pxPerSecond) {
    const step = () => {
        const now = performance.now();
        const elapsed = Math.max(0, (now - item.startTime) / 1000);
        const x = item.startX - pxPerSecond * elapsed;
        item.el.style.transform = `translateX(${x}px)`;
        if (x + item.width < -40) {
            // 移除
            danmakuRoot.removeChild(item.el);
            const idx = activeItems.indexOf(item);
            if (idx >= 0) activeItems.splice(idx, 1);
        } else {
            requestAnimationFrame(step);
        }
    };
    requestAnimationFrame(step);
}

function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    return h;
}

function escapeHtml(s) {
    return s.replace(/[&<>"]+/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}


