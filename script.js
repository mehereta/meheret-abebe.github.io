// Meheret's notebook: hand-drawn sketches, plus a scroll-driven camera that zooms
// from the whole page into each chapter and travels along the drawn path to the next.

const root = document.documentElement;
const page = document.querySelector('.page');
const track = document.querySelector('.track');
const route = document.querySelector('.route');
const spots = Array.from(document.querySelectorAll('.spot'));
const stripLinks = Array.from(document.querySelectorAll('.strip a'));
const modeBtn = document.querySelector('.bar-mode');
const canZoom = window.matchMedia('(min-width: 901px) and (prefers-reduced-motion: no-preference)');

const BAR = 60;      // height of the fixed top bar
const MARGIN = 44;   // breathing room around a framed chapter
const PAD = 56;      // canvas padding around a chapter when framing it

// ---------- Sketches: roughen every .sk path so it looks drawn by hand ----------

function drawSketches() {
    if (!window.rough) return;
    document.querySelectorAll('.sketch svg, .hint svg').forEach((svg, n) => {
        const rc = window.rough.svg(svg);
        svg.querySelectorAll('path.sk').forEach((path, i) => {
            const fill = path.dataset.fill;
            const node = rc.path(path.getAttribute('d'), {
                seed: 7 + n * 31 + i,
                roughness: 1.15,
                bowing: 1.4,
                stroke: '#1f3a93',
                strokeWidth: 2.3,
                fill: fill || undefined,
                fillStyle: fill === '#ffffff' ? 'solid' : 'hachure',
                hachureGap: 5.5,
                hachureAngle: -38,
                fillWeight: 2.6,
            });
            node.setAttribute('aria-hidden', 'true');
            path.replaceWith(node);
        });
    });
}

// ---------- Mode ----------

function storedMode() {
    try { return localStorage.getItem('notebook-mode'); } catch (e) { return null; }
}

function storeMode(value) {
    try { localStorage.setItem('notebook-mode', value); } catch (e) { /* private mode */ }
}

function wantsZoom() {
    return canZoom.matches && storedMode() !== 'list';
}

// ---------- Camera ----------

let stops = [];
let total = 0;
let vw = 0;
let vh = 0;
let centerY = 0;
let transitionLen = 0;
let currentId = null;
let overviewScale = 1;
let labels = [];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Position within the page canvas, even when nested in a positioned wrapper
function rectOf(el) {
    let x = el.offsetLeft;
    let y = el.offsetTop;
    for (let p = el.offsetParent; p && p !== page; p = p.offsetParent) {
        x += p.offsetLeft;
        y += p.offsetTop;
    }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

function layout() {
    page.style.transform = 'none';
    vw = window.innerWidth;
    vh = window.innerHeight;
    const availW = vw - MARGIN * 2;
    const availH = vh - BAR - MARGIN * 2;
    centerY = BAR + MARGIN + availH / 2;
    transitionLen = vh * 0.95;

    const W = page.offsetWidth;
    const H = page.offsetHeight;
    overviewScale = Math.min(availW / W, availH / H);
    stops = [];

    spots.forEach(spot => {
        const r = rectOf(spot);
        let s = Math.min(availW / (r.w + PAD * 2), 1.2);
        const cx = r.x + r.w / 2;
        if ((r.h + PAD * 2) * s <= availH) {
            s = Math.min(s, availH / (r.h + PAD * 2));
            stops.push({ id: spot.id, cams: [{ cx, cy: r.y + r.h / 2, s }], hold: vh * 0.55 });
        } else {
            // Taller than the screen: frame the top, then pan down while reading
            const half = availH / 2 / s;
            const top = r.y - PAD + half;
            const bottom = r.y + r.h + PAD - half;
            stops.push({
                id: spot.id,
                cams: [{ cx, cy: top, s }, { cx, cy: bottom, s }],
                hold: (bottom - top) * s * 1.1 + vh * 0.35,
            });
        }
        // After the cover, pull back to show the whole story map before diving in
        if (spot.id === 'cover') {
            stops.push({ id: 'cover', map: true, cams: [{ cx: W / 2, cy: H / 2, s: overviewScale }], hold: vh * 0.45 });
        }
    });
    stops[0].hold = vh * 0.25;

    let at = 0;
    stops.forEach((stop, i) => {
        stop.start = at;
        at += stop.hold + (i < stops.length - 1 ? transitionLen : 0);
    });

    labels.forEach(item => {
        const h = item.spot.querySelector('h2');
        let x = h.offsetLeft;
        let y = h.offsetTop;
        for (let el = h.offsetParent; el && el !== page; el = el.offsetParent) {
            x += el.offsetLeft;
            y += el.offsetTop;
        }
        item.x = x + Math.min(h.offsetWidth, 700) / 2;
        item.y = y + h.offsetHeight / 2;
    });
    total = at;
    track.style.height = `${total + vh}px`;

    drawRoute(W, H);
    render();
}

function panProgress(stop, p) {
    const lead = vh * 0.15;
    return clamp((p - stop.start - lead) / Math.max(1, stop.hold - lead * 2), 0, 1);
}

function camAt(p) {
    for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];
        const holdEnd = stop.start + stop.hold;
        if (p <= holdEnd || i === stops.length - 1) {
            if (stop.cams.length === 1) return { cam: stop.cams[0], id: stop.id };
            const u = panProgress(stop, p);
            const [a, b] = stop.cams;
            return { cam: { cx: a.cx, cy: lerp(a.cy, b.cy, u), s: a.s }, id: stop.id };
        }
        const next = stops[i + 1];
        if (p < next.start) {
            const t = (p - holdEnd) / transitionLen;
            const e = easeInOut(t);
            const a = stop.cams[stop.cams.length - 1];
            const b = next.cams[0];
            const travel = Math.hypot(b.cx - a.cx, b.cy - a.cy) * Math.min(a.s, b.s) / vw;
            const dip = 1 - Math.min(0.5, travel * 0.3) * Math.sin(Math.PI * t);
            return {
                cam: {
                    cx: lerp(a.cx, b.cx, e),
                    cy: lerp(a.cy, b.cy, e),
                    s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), e)) * dip,
                },
                id: t < 0.5 ? stop.id : next.id,
            };
        }
    }
    return { cam: stops[0].cams[0], id: 'cover' };
}

function render() {
    if (!root.classList.contains('zoom')) {
        // List reading: mark the section crossing the upper third of the screen
        const line = window.innerHeight * 0.35;
        let active = 'cover';
        spots.forEach(spot => { if (spot.getBoundingClientRect().top <= line) active = spot.id; });
        setCurrent(active);
        return;
    }
    const p = clamp(window.scrollY - track.offsetTop, 0, total);
    const { cam, id } = camAt(p);
    page.style.transform = `translate3d(${vw / 2 - cam.cx * cam.s}px, ${centerY - cam.cy * cam.s}px, 0) scale(${cam.s})`;
    const overview = cam.s < overviewScale * 1.8;
    root.classList.toggle('is-overview', overview);
    if (overview) placeLabels(cam);
    setCurrent(id);
}

// Readable chapter labels laid over the map view, since the page text is tiny there
function buildLabels() {
    const layer = document.createElement('div');
    layer.className = 'map-labels';
    layer.setAttribute('aria-hidden', 'true');
    labels = spots.filter(spot => spot.id !== 'cover' && spot.querySelector('h2')).map(spot => {
        const label = document.createElement('span');
        label.className = 'map-label';
        const heading = spot.querySelector('h2');
        label.textContent = spot.id === 'contact' ? 'Contact' : heading.textContent.trim();
        layer.appendChild(label);
        return { spot, label };
    });
    document.querySelector('.stage').appendChild(layer);
}

function placeLabels(cam) {
    const tx = vw / 2 - cam.cx * cam.s;
    const ty = centerY - cam.cy * cam.s;
    labels.forEach(item => {
        item.label.style.left = `${tx + item.x * cam.s}px`;
        item.label.style.top = `${ty + item.y * cam.s}px`;
    });
}

function setCurrent(id) {
    if (id === currentId) return;
    currentId = id;
    stripLinks.forEach(link => {
        const on = link.getAttribute('href') === `#${id}`;
        if (on) {
            link.setAttribute('aria-current', 'true');
            const strip = link.closest('.strip');
            strip.scrollTo({ left: link.offsetLeft - strip.clientWidth / 2 + link.offsetWidth / 2, behavior: 'smooth' });
        } else {
            link.removeAttribute('aria-current');
        }
    });
}

function drawRoute(W, H) {
    route.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const d = [];
    for (let i = 0; i < spots.length - 1; i++) {
        const a = rectOf(spots[i]);
        const b = rectOf(spots[i + 1]);
        const y = Math.min(a.y + Math.min(a.h, b.h) / 2, b.y + Math.min(a.h, b.h) / 2);
        if (b.x >= a.x + a.w && b.y < a.y + a.h) {
            // Neighbour to the right: a gentle wave across the gap
            const p1 = [a.x + a.w + 30, a.y + Math.min(a.h, b.h) / 2];
            const p2 = [b.x - 30, b.y + Math.min(a.h, b.h) / 2];
            const third = (p2[0] - p1[0]) / 3;
            d.push(`M${p1} C${p1[0] + third},${p1[1] - 40} ${p2[0] - third},${p2[1] + 40} ${p2}`);
        } else if (b.x + b.w <= a.x && b.y < a.y + a.h) {
            // Neighbour to the left
            const p1 = [a.x - 30, a.y + Math.min(a.h, b.h) / 2];
            const p2 = [b.x + b.w + 30, b.y + Math.min(a.h, b.h) / 2];
            const third = (p1[0] - p2[0]) / 3;
            d.push(`M${p1} C${p1[0] - third},${p1[1] + 40} ${p2[0] + third},${p2[1] - 40} ${p2}`);
        } else if (b.x + b.w <= a.x || b.x >= a.x + a.w) {
            // Next row, off to the side: drop into the gap between rows, travel along it, then down
            const x1 = a.x + a.w / 2;
            const x2 = b.x + b.w / 2;
            const channel = b.y - 150;
            const dir = Math.sign(x2 - x1);
            d.push(`M${x1},${a.y + a.h + 40} L${x1},${channel - 80} Q${x1},${channel} ${x1 + dir * 80},${channel} L${x2 - dir * 80},${channel} Q${x2},${channel} ${x2},${channel + 80} L${x2},${b.y - 40}`);
        } else {
            // Directly below
            const x = Math.max(a.x, b.x) + Math.min(a.w, b.w) * 0.72;
            d.push(`M${x},${a.y + a.h + 40} C${x + 160},${a.y + a.h + 130} ${x - 160},${b.y - 130} ${x},${b.y - 40}`);
        }
    }
    route.querySelector('path').setAttribute('d', d.join(' '));
}

function jumpTo(id, smooth) {
    const index = stops.findIndex(stop => stop.id === id);
    if (index < 0) return;
    window.scrollTo({ top: track.offsetTop + stops[index].start, behavior: smooth ? 'smooth' : 'auto' });
}

// ---------- Mode switching ----------

function enterZoom() {
    root.classList.add('zoom');
    document.querySelectorAll('.page img[loading="lazy"]').forEach(img => { img.loading = 'eager'; });
    layout();
}

function enterList() {
    root.classList.remove('zoom', 'is-overview');
    page.style.transform = '';
    track.style.height = '';
    currentId = null;
    render();
}

// Experience zigzag: each dotted hop runs from the centre of one role to the centre of the next.
// Positions are ratios of the zigzag's width, so they hold at any camera scale.
function drawHops() {
    const zigzag = document.querySelector('.role-zigzag');
    if (!zigzag) return;
    const box = zigzag.getBoundingClientRect();
    if (!box.width) return;
    // Centre of each role's text block
    const xOf = el => {
        const role = el.matches('.role') ? el : el.querySelector('.role');
        const body = (role.querySelector('.role-body') || role).getBoundingClientRect();
        return clamp(((body.left + body.width / 2 - box.left) / box.width) * 1000, 20, 980);
    };
    zigzag.querySelectorAll('.hop').forEach(hop => {
        const prev = hop.previousElementSibling || document.getElementById('exp-ck12');
        const next = hop.nextElementSibling;
        if (!prev || !next) return;
        const x1 = Math.round(xOf(prev));
        const x2 = Math.round(xOf(next));
        hop.querySelector('path').setAttribute('d', `M${x1} 2 C${x1} 64 ${x2} 46 ${x2} 108`);
    });
}

function applyMode() {
    const zoom = wantsZoom();
    modeBtn.hidden = !canZoom.matches;
    modeBtn.textContent = zoom ? 'Read as a list' : 'Zoom through the notebook';
    modeBtn.setAttribute('aria-pressed', String(!zoom));
    if (zoom) enterZoom(); else enterList();
    drawHops();
}

modeBtn.addEventListener('click', () => {
    storeMode(root.classList.contains('zoom') ? 'list' : 'zoom');
    applyMode();
    window.scrollTo(0, 0);
});

canZoom.addEventListener('change', applyMode);

// ---------- Events ----------

let ticking = false;
window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
        render();
        ticking = false;
    });
}, { passive: true });

window.addEventListener('resize', () => {
    drawHops();
    if (!root.classList.contains('zoom')) return;
    const progress = total ? (window.scrollY - track.offsetTop) / total : 0;
    layout();
    window.scrollTo(0, track.offsetTop + progress * total);
});

// In zoom mode, in-page links move the camera instead of the document
document.addEventListener('click', event => {
    if (!root.classList.contains('zoom')) return;
    const link = event.target.closest('a[href^="#"]');
    if (link) {
        event.preventDefault();
        jumpTo(link.getAttribute('href').slice(1), true);
        return;
    }
    // From the overview, clicking a chapter zooms into it
    if (root.classList.contains('is-overview') && !event.target.closest('a, button')) {
        const spot = event.target.closest('.spot');
        if (spot) jumpTo(spot.id, true);
    }
});

// Keyboard focus inside a chapter that is off camera brings the camera to it
document.addEventListener('focusin', event => {
    if (!root.classList.contains('zoom')) return;
    const spot = event.target.closest('.page .spot');
    if (!spot) return;
    const box = event.target.getBoundingClientRect();
    if (box.top >= BAR && box.bottom <= vh && box.left >= 0 && box.right <= vw && spot.id === currentId) return;
    const index = stops.findIndex(stop => stop.id === spot.id && !stop.map);
    if (index < 0) return;
    const r = rectOf(spot);
    let y = event.target.offsetTop;
    for (let el = event.target.offsetParent; el && el !== page; el = el.offsetParent) y += el.offsetTop;
    const f = clamp((y - r.y) / r.h, 0, 1);
    const stop = stops[index];
    window.scrollTo({ top: track.offsetTop + stop.start + (stop.cams.length > 1 ? f * stop.hold : 0), behavior: 'auto' });
});

// ---------- Start ----------

drawSketches();
buildLabels();
const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
ready.then(() => {
    applyMode();
    window.addEventListener('load', () => {
        if (root.classList.contains('zoom')) layout();
        drawHops();
    });
});
