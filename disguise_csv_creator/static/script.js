/* OmiLED Mapper V3.7 JS */

// --- State ---
let gridWidth = 10;
let gridHeight = 10;
let pixels = [];
let selectedIndices = new Set();
let selectionOrder = [];
let lastClickedIndex = -1;

// --- History / Undo / Redo ---
let history = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

function saveState() {
    // Snapshot current state
    const state = {
        w: gridWidth,
        h: gridHeight,
        inputs: {
            u: document.getElementById('startUni').value,
            a: document.getElementById('startAddr').value
        },
        patches: pixels.filter(p => p.uni !== null).map(p => ({
            idx: p.index, u: p.uni, a: p.addr
        }))
    };

    // Slice if we are in middle of history
    if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
    }

    history.push(state);
    if (history.length > MAX_HISTORY) history.shift();
    else historyIndex++;

    //console.log("State Saved. Index:", historyIndex);
}

function restoreState(state) {
    // Restore Grid Size if changed
    if (state.w !== gridWidth || state.h !== gridHeight) {
        document.getElementById('gridW').value = state.w;
        document.getElementById('gridH').value = state.h;
        createGrid(false); // Rebuild grid empty
    } else {
        // Just clear patches
        pixels.forEach(p => {
            p.uni = null; p.addr = null;
            p.el.classList.remove('patched', 'duplicate');
            p.addrDisplay.innerText = '';
        });
    }

    // Restore Inputs
    if (state.inputs) {
        document.getElementById('startUni').value = state.inputs.u;
        document.getElementById('startAddr').value = state.inputs.a;
    }

    // Restore Patches
    state.patches.forEach(d => {
        if (pixels[d.idx]) {
            const p = pixels[d.idx];
            p.uni = d.u;
            p.addr = d.a;
            p.addrDisplay.innerText = `${p.uni}.${p.addr}`;
            p.el.classList.add('patched');
        }
    });

    validateDuplicates();
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        restoreState(history[historyIndex]);
    }
}

function redo() {
    if (historyIndex < history.length - 1) {
        historyIndex++;
        restoreState(history[historyIndex]);
    }
}

let lastClickedCol = -1;
let lastClickedRow = -1;

let pixelSize = 40;
let gapSize = 2;
const canvasPadding = 800; // Match CSS

const gridEl = document.getElementById('pixel-grid');
const rulerTop = document.getElementById('ruler-top');
const rulerLeft = document.getElementById('ruler-left');
const scrollContainer = document.getElementById('grid-container-wrapper');

// --- Layout / Resizer ---
const sidebar = document.getElementById('sidebar');
const resizer = document.getElementById('resizer');
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    resizer.classList.add('resizing');
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = e.clientX;
    if (newWidth > 150 && newWidth < 800) {
        sidebar.style.width = newWidth + 'px';
    }
});

document.addEventListener('mouseup', () => {
    isResizing = false;
    document.body.style.cursor = 'default';
    resizer.classList.remove('resizing');
});

// --- Panning Logic ---
let isPanning = false;
let startX, startY, scrollLeft, scrollTop;
let hasMoved = false;

scrollContainer.addEventListener('mousedown', (e) => {
    const isMiddleClick = e.button === 1;

    if (isMiddleClick) {
        e.preventDefault();
        startPan(e);
    } else if (e.target.closest('.pixel') || e.target.closest('.ruler-cell')) {
        // Do nothing
    } else {
        startPan(e);
    }
});

function startPan(e) {
    isPanning = true;
    hasMoved = false;
    document.body.classList.add('grabbing');
    scrollContainer.classList.add('grabbing');

    startX = e.pageX - scrollContainer.offsetLeft;
    startY = e.pageY - scrollContainer.offsetTop;
    scrollLeft = scrollContainer.scrollLeft;
    scrollTop = scrollContainer.scrollTop;
}

document.addEventListener('mouseup', (e) => {
    if (isPanning && !hasMoved && e.button === 0) {
        clearSelection();
    }
    isPanning = false;
    document.body.classList.remove('grabbing');
    scrollContainer.classList.remove('grabbing');
});

document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    e.preventDefault();
    const x = e.pageX - scrollContainer.offsetLeft;
    const y = e.pageY - scrollContainer.offsetTop;
    if (Math.abs(x - startX) > 3 || Math.abs(y - startY) > 3) {
        hasMoved = true;
    }

    const walkX = (x - startX) * 1;
    const walkY = (y - startY) * 1;
    scrollContainer.scrollLeft = scrollLeft - walkX;
    scrollContainer.scrollTop = scrollTop - walkY;
});

// --- Navigation ---
scrollContainer.addEventListener('wheel', (e) => {
    if (e.ctrlKey || true) {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        changeZoom(dir);
    }
}, { passive: false });

function changeZoom(dir) {
    pixelSize += (dir * 4);
    if (pixelSize < 10) pixelSize = 10;
    if (pixelSize > 150) pixelSize = 150;

    const root = document.documentElement;
    root.style.setProperty('--pixel-size', pixelSize + 'px');

    const topCells = document.querySelectorAll('.ruler-top .ruler-cell');
    topCells.forEach(el => el.style.width = `${pixelSize}px`);

    const leftCells = document.querySelectorAll('.ruler-left .ruler-cell');
    leftCells.forEach(el => el.style.height = `${pixelSize}px`);

    const totalW = (gridWidth * pixelSize) + ((gridWidth - 1) * gapSize);
    rulerTop.style.width = `${totalW}px`;

    const totalH = (gridHeight * pixelSize) + ((gridHeight - 1) * gapSize);
    rulerLeft.style.height = `${totalH}px`;
}

function resetView() {
    scrollContainer.scrollTop = canvasPadding - 50;
    scrollContainer.scrollLeft = canvasPadding - 50;
    pixelSize = 40;
    changeZoom(0);
}

// --- Selection Logic ---
function handleColClick(e, x) {
    e.stopPropagation();
    let start = x;
    let end = x;

    if (e.shiftKey && lastClickedCol !== -1) {
        start = Math.min(lastClickedCol, x);
        end = Math.max(lastClickedCol, x);
    }

    if (!e.ctrlKey) {
        clearSelection(true);
    }

    for (let c = start; c <= end; c++) {
        for (let y = 0; y < gridHeight; y++) {
            const idx = y * gridWidth + c;
            if (!selectedIndices.has(idx)) {
                selectedIndices.add(idx);
                selectionOrder.push(idx);
            }
        }
    }

    lastClickedCol = x;
    lastClickedRow = -1;
    updateAllColors();
    updateLegend(null);
}

function handleRowClick(e, y) {
    e.stopPropagation();
    let start = y;
    let end = y;

    if (e.shiftKey && lastClickedRow !== -1) {
        start = Math.min(lastClickedRow, y);
        end = Math.max(lastClickedRow, y);
    }

    if (!e.ctrlKey) {
        clearSelection(true);
    }

    for (let r = start; r <= end; r++) {
        for (let x = 0; x < gridWidth; x++) {
            const idx = r * gridWidth + x;
            if (!selectedIndices.has(idx)) {
                selectedIndices.add(idx);
                selectionOrder.push(idx);
            }
        }
    }

    lastClickedRow = y;
    lastClickedCol = -1;
    updateAllColors();
    updateLegend(null);
}

function updateAllColors() {
    pixels.forEach(p => updatePixelUI(p));
}

// --- Grid Logic ---
function createGrid(preserve = true) {

    // Preservation Logic
    const oldData = new Map();
    if (preserve) {
        pixels.forEach(p => {
            if (p.uni !== null) {
                oldData.set(`${p.x},${p.y}`, { uni: p.uni, addr: p.addr });
            }
        });
    }

    // New Dimension
    gridWidth = parseInt(document.getElementById('gridW').value);
    gridHeight = parseInt(document.getElementById('gridH').value);
    document.getElementById('current-dim').innerText = `${gridWidth} x ${gridHeight}`;

    // Clear
    gridEl.innerHTML = '';
    rulerTop.innerHTML = '';
    rulerLeft.innerHTML = '';
    pixels = [];
    selectedIndices.clear();
    selectionOrder = [];
    lastClickedIndex = -1;
    lastClickedCol = -1;
    lastClickedRow = -1;
    updateLegend(null);

    gridEl.style.gridTemplateColumns = `repeat(${gridWidth}, var(--pixel-size))`;

    // Top Ruler
    for (let x = 0; x < gridWidth; x++) {
        const cell = document.createElement('div');
        cell.className = 'ruler-cell';
        cell.innerText = x;
        cell.addEventListener('mousedown', (e) => handleColClick(e, x));
        rulerTop.appendChild(cell);
    }

    // Left Ruler
    for (let y = 0; y < gridHeight; y++) {
        const cell = document.createElement('div');
        cell.className = 'ruler-cell';
        cell.innerText = y;
        cell.addEventListener('mousedown', (e) => handleRowClick(e, y));
        rulerLeft.appendChild(cell);
    }

    // Pixels
    for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
            const index = y * gridWidth + x;
            const p = {
                x: x, y: y, index: index,
                uni: null, addr: null,
                el: document.createElement('div')
            };

            if (preserve) {
                const saved = oldData.get(`${x},${y}`);
                if (saved) {
                    p.uni = saved.uni;
                    p.addr = saved.addr;
                }
            }

            p.el.className = 'pixel';
            const addrSpan = document.createElement('span');
            addrSpan.className = 'addr';
            p.addrDisplay = addrSpan;
            p.el.appendChild(addrSpan);
            p.el.onmousedown = (e) => handlePixelClick(e, p);
            p.el.onmouseover = () => updateLegend(p);

            if (p.uni !== null) {
                p.addrDisplay.innerText = `${p.uni}.${p.addr}`;
                p.el.classList.add('patched');
            }

            pixels.push(p);
            gridEl.appendChild(p.el);
        }
    }

    if (preserve) validateDuplicates();
    changeZoom(0);
}

function init() {
    createGrid(false);
    resetView();
    saveState(); // Initial State
}

function updateGrid() {
    createGrid(true);
    saveState();
}

// --- Interaction ---
function handlePixelClick(e, p) {
    if (e.button === 1) return;

    const idx = p.index;

    if (e.shiftKey && lastClickedIndex !== -1) {
        const p1 = pixels[lastClickedIndex]; // Origin
        const p2 = p; // Target

        // Determine direction
        const stepX = p2.x >= p1.x ? 1 : -1;
        const stepY = p2.y >= p1.y ? 1 : -1;

        // Loop in the direction of the selection to preserve order
        for (let y = p1.y; y !== p2.y + stepY; y += stepY) {
            for (let x = p1.x; x !== p2.x + stepX; x += stepX) {
                const targetIdx = y * gridWidth + x;
                if (!selectedIndices.has(targetIdx)) {
                    selectedIndices.add(targetIdx);
                    selectionOrder.push(targetIdx);
                    updatePixelUI(pixels[targetIdx]);
                }
            }
        }
    } else if (e.ctrlKey) {
        if (selectedIndices.has(idx)) {
            selectedIndices.delete(idx);
            selectionOrder = selectionOrder.filter(i => i !== idx);
        } else {
            selectedIndices.add(idx);
            selectionOrder.push(idx);
        }
    } else {
        clearSelection(true);
        selectedIndices.add(idx);
        selectionOrder.push(idx);
    }

    lastClickedIndex = idx;
    lastClickedCol = -1;
    lastClickedRow = -1;

    updatePixelUI(p);
    updateLegend(p);
}

function updatePixelUI(p) {
    if (selectedIndices.has(p.index)) {
        p.el.classList.add('selected');
    } else {
        p.el.classList.remove('selected');
    }
    p.el.classList.remove('patched');
    p.el.classList.remove('duplicate');
    p.addrDisplay.innerText = '';

    if (p.uni !== null) {
        p.addrDisplay.innerText = `${p.uni}.${p.addr}`;
        p.el.classList.add('patched');

        if (p.isDuplicate) {
            p.el.classList.add('duplicate');
            p.el.classList.remove('patched');
        }
    }
}

function validateDuplicates() {
    const chPerPix = parseInt(document.getElementById('chPerPixel').value);
    const freq = new Map();
    pixels.forEach(p => {
        if (p.uni !== null) {
            for (let i = 0; i < chPerPix; i++) {
                const key = `${p.uni}.${p.addr + i}`;
                freq.set(key, (freq.get(key) || 0) + 1);
            }
        }
    });
    pixels.forEach(p => {
        let isDup = false;
        if (p.uni !== null) {
            for (let i = 0; i < chPerPix; i++) {
                const key = `${p.uni}.${p.addr + i}`;
                if (freq.get(key) > 1) {
                    isDup = true;
                    break;
                }
            }
        }
        if (isDup) {
            p.isDuplicate = true;
            p.el.classList.add('duplicate');
            p.el.classList.remove('patched');
        } else if (p.uni !== null) {
            p.isDuplicate = false;
            p.el.classList.add('patched');
            p.el.classList.remove('duplicate');
        } else {
            p.isDuplicate = false;
        }
    });
}

function updateLegend(p) {
    document.getElementById('lg-sel-count').innerText = `${selectedIndices.size} Selected`;
    if (!p) return;
    document.getElementById('lg-pos').innerText = `Pos: X${p.x} / Y${p.y}`;
    document.getElementById('lg-idx').innerText = `Index: ${p.index}`;
    const dmxEl = document.getElementById('lg-dmx');
    if (p.uni !== null) {
        dmxEl.innerHTML = `DMX: <strong style="color: #66bb6a">${p.uni}.${p.addr}</strong>`;
        if (p.el.classList.contains('duplicate')) {
            dmxEl.innerHTML = `DMX: <strong style="color: #ef5350">${p.uni}.${p.addr} (Dup)</strong>`;
        }
    } else {
        dmxEl.innerHTML = `DMX: <span style="color:#666">Not Patched</span>`;
    }
}

function selectAll() {
    pixels.forEach(p => {
        selectedIndices.add(p.index);
        selectionOrder.push(p.index);
        updatePixelUI(p);
    });
    updateLegend(pixels[0]);
}

function clearSelection(silent = false) {
    selectedIndices.clear();
    selectionOrder = [];
    pixels.forEach(p => {
        if (p.el.classList.contains('selected')) {
            p.el.classList.remove('selected');
        }
    });
    lastClickedIndex = -1;
    lastClickedCol = -1;
    lastClickedRow = -1;
    if (!silent) updateLegend(null);
}

function applyPatch() {
    if (selectedIndices.size === 0) return alert("Select pixels first!");

    const startUni = parseInt(document.getElementById('startUni').value);
    const startAddr = parseInt(document.getElementById('startAddr').value);
    const chPerPix = parseInt(document.getElementById('chPerPixel').value);
    const orderMode = document.getElementById('patchOrder').value;

    let patchList = [];
    if (orderMode === 'selection') {
        patchList = selectionOrder.map(i => pixels[i]);
    } else {
        patchList = Array.from(selectedIndices).sort((a, b) => a - b).map(i => pixels[i]);
        if (orderMode !== 'rowMajor') {
            patchList.sort((a, b) => {
                // Row Major Variants
                if (orderMode === 'rowMajorBL') return (b.y - a.y) || (a.x - b.x);
                if (orderMode === 'rowMajorTR') return (a.y - b.y) || (b.x - a.x);
                if (orderMode === 'rowMajorBR') return (b.y - a.y) || (b.x - a.x);

                // Column Major Variants
                if (orderMode === 'colMajor') return (a.x - b.x) || (a.y - b.y);
                if (orderMode === 'colMajorTR') return (b.x - a.x) || (a.y - b.y);
                if (orderMode === 'colMajorBL') return (a.x - b.x) || (b.y - a.y);
                if (orderMode === 'colMajorBR') return (b.x - a.x) || (b.y - a.y);

                // Snake
                if (orderMode === 'snakeRows') {
                    if (a.y !== b.y) return a.y - b.y;
                    return (a.y % 2 === 0) ? (a.x - b.x) : (b.x - a.x);
                }
                return a.index - b.index;
            });
        }
    }

    let curUni = startUni;
    let curAddr = startAddr;

    patchList.forEach(p => {
        if (curAddr + chPerPix - 1 > 512) {
            curUni++;
            curAddr = 1;
        }
        p.uni = curUni;
        p.addr = curAddr;
        updatePixelUI(p);
        curAddr += chPerPix;
    });

    // Auto-Increment Inputs for next patch
    document.getElementById('startUni').value = curUni;
    document.getElementById('startAddr').value = curAddr;

    validateDuplicates();
    updateLegend(patchList[patchList.length - 1]);
    saveState();
}

function removePatch() {
    if (selectedIndices.size === 0) return alert("Select pixels to unpatch first!");
    if (!confirm("Remove patch from selected pixels?")) return;

    selectedIndices.forEach(idx => {
        const p = pixels[idx];
        p.uni = null;
        p.addr = null;
        updatePixelUI(p);
    });
    validateDuplicates();
    saveState();
}

function clearAllPatches() {
    if (!confirm("Clear ALL DMX data?")) return;
    pixels.forEach(p => { p.uni = null; p.addr = null; updatePixelUI(p); });
    validateDuplicates();
    saveState();
}

function downloadCSV() {
    const patched = pixels.filter(p => p.uni !== null);
    if (patched.length === 0) return alert("No pixels patched!");

    let name = document.getElementById('exportName').value.trim();
    if (!name) name = "dmx_patch";
    if (!name.endsWith(".csv")) name += ".csv";

    let csv = "x,y,universe,channel\n";
    patched.forEach(p => csv += `${p.x},${p.y},${p.uni},${p.addr}\r\n`);

    const b = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function loadCSV(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const text = e.target.result;
        const lines = text.split(/\r\n|\n/);

        // Parse CSV
        let patches = [];
        let maxX = 0;
        let maxY = 0;

        lines.forEach((line, idx) => {
            if (idx === 0) return; // Skip Header
            const parts = line.split(',');
            if (parts.length >= 4) {
                const x = parseInt(parts[0]);
                const y = parseInt(parts[1]);
                const uni = parseInt(parts[2]);
                const ch = parseInt(parts[3]);

                if (!isNaN(x) && !isNaN(y) && !isNaN(uni) && !isNaN(ch)) {
                    patches.push({ x, y, uni, ch });
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
        });

        if (patches.length === 0) return alert("No valid data found in CSV!");

        if (confirm(`Import ${patches.length} pixels?\nThis will resize grid to ${maxX + 1}x${maxY + 1} and OVERWRITE current data.`)) {

            document.getElementById('gridW').value = maxX + 1;
            document.getElementById('gridH').value = maxY + 1;

            // Create NEW grid (false = don't preserve old data)
            createGrid(false);

            // Apply patches
            patches.forEach(d => {
                const p = pixels.find(pix => pix.x === d.x && pix.y === d.y);
                if (p) {
                    p.uni = d.uni;
                    p.addr = d.ch;
                    updatePixelUI(p);
                }
            });

            validateDuplicates();
            alert("Import Successful!");
            saveState();
        }

        // Reset input so same file can be selected again
        input.value = '';
    };
    reader.readAsText(file);
}

function resetProject() {
    if (!confirm("Create NEW Project?\nThis will clear everything and reset to defaults.")) return;

    document.getElementById('gridW').value = 10;
    document.getElementById('gridH').value = 10;
    document.getElementById('startUni').value = 1;
    document.getElementById('startAddr').value = 1;
    document.getElementById('exportName').value = "dmx_patch";

    createGrid(false);
    resetView();
    saveState();
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') clearSelection();
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault(); selectAll();
    }
    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
    }

    // Keyboard Navigation (Arrows)
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();

        let currentIdx = lastClickedIndex;
        if (currentIdx === -1) {
            if (pixels.length > 0) currentIdx = 0;
            else return;
        }

        const p = pixels[currentIdx];
        let nextIdx = currentIdx;

        if (e.key === 'ArrowUp') {
            if (p.y > 0) nextIdx = currentIdx - gridWidth;
        } else if (e.key === 'ArrowDown') {
            if (p.y < gridHeight - 1) nextIdx = currentIdx + gridWidth;
        } else if (e.key === 'ArrowLeft') {
            if (p.x > 0) nextIdx = currentIdx - 1;
        } else if (e.key === 'ArrowRight') {
            if (p.x < gridWidth - 1) nextIdx = currentIdx + 1;
        }

        if (nextIdx !== currentIdx && nextIdx >= 0 && nextIdx < pixels.length) {
            const target = pixels[nextIdx];

            if (!e.ctrlKey) {
                clearSelection(true);
            }

            if (!selectedIndices.has(nextIdx)) {
                selectedIndices.add(nextIdx);
                selectionOrder.push(nextIdx);
            } else if (e.ctrlKey) {
                // Optional: Ctrl+Arrow on already selected item? 
                // User said "valla añadiendo" (go adding). usually implies keep selecting.
                // Standard behavior: if already selected, keep it selected.
            }

            lastClickedIndex = nextIdx;
            updateAllColors(); // Refresh UI
            updateLegend(target);

            // Auto-scroll
            target.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } else if (currentIdx === -1) {
            // First selection if none active
            const first = pixels[0];
            selectedIndices.add(0);
            selectionOrder.push(0);
            lastClickedIndex = 0;
            updateAllColors();
            updateLegend(first);
        }
    }
});

// Initialize
init();

function toggleHelp() {
    const el = document.getElementById('helpModal');
    el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
}
