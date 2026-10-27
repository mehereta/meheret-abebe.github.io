// Tabs slide out from behind the sheet once the page is ready
const root = document.documentElement;
root.classList.add('js');

const tabs = Array.from(document.querySelectorAll('.tab'));
tabs.forEach((tab, i) => tab.style.setProperty('--i', i));

requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.add('is-ready'));
});

// The tab for the section in view is pulled out
const tabFor = new Map(tabs.map(tab => [tab.getAttribute('href').slice(1), tab]));
const parts = Array.from(document.querySelectorAll('.part'));
const tabStrip = document.querySelector('.tabs');
let current = null;

function setCurrent(id) {
    if (id === current) return;
    current = id;
    tabs.forEach(tab => tab.removeAttribute('aria-current'));
    const tab = tabFor.get(id);
    if (!tab) return;
    tab.setAttribute('aria-current', 'true');

    // On the horizontal strip, keep the active tab visible
    if (tabStrip.scrollWidth > tabStrip.clientWidth) {
        const left = tab.offsetLeft - (tabStrip.clientWidth - tab.offsetWidth) / 2;
        tabStrip.scrollTo({ left, behavior: 'smooth' });
    }
}

function update() {
    const line = window.innerHeight * 0.35;
    let active = null;
    for (const part of parts) {
        if (part.getBoundingClientRect().top <= line) active = part.id;
    }
    setCurrent(active);
}

let ticking = false;
window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
        update();
        ticking = false;
    });
}, { passive: true });
window.addEventListener('resize', update);
update();
