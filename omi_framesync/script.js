document.addEventListener('DOMContentLoaded', () => {
    // UI Panels
    const dropzone = document.getElementById('dropzone');
    const appContainer = document.getElementById('app-container');
    const loadingMetadata = document.getElementById('loading-metadata');

    // Media Elements
    const initialVideoUpload = document.getElementById('initial-video-upload');
    const videoPlayer = document.getElementById('video-player');
    const videoFilename = document.getElementById('video-filename');
    const videoTimeDisplay = document.getElementById('video-time-display');
    const changeVideoBtn = document.getElementById('change-video-btn');

    // Sync Displays & Buttons
    const syncPointsList = document.getElementById('sync-points-list');
    const addRefPointBtn = document.getElementById('add-ref-point-btn');

    // Inputs & Buttons
    const videoFpsInput = document.getElementById('video-fps');
    const targetFpsInput = document.getElementById('target-fps');
    const addFpsBtn = document.getElementById('add-fps-btn');
    const customFpsContainer = document.getElementById('custom-fps-container');

    // Scrub Controls
    const videoPrevFrame = document.getElementById('video-prev-frame');
    const videoNextFrame = document.getElementById('video-next-frame');
    const videoPrevMs = document.getElementById('video-prev-ms');
    const videoNextMs = document.getElementById('video-next-ms');

    // Results Container
    const resultsContainer = document.getElementById('calculation-results');

    // Waveform Tools
    const waveformZoom = document.getElementById('waveform-zoom');
    const frameGridOverlay = document.getElementById('frame-grid-overlay');

    // State Variables
    let syncPoints = [
        { id: Date.now(), name: "Reference 1", visual: null, audio: null }
    ];
    let wavesurfer = null;

    // --- Helper Functions ---

    function formatTimecode(seconds, fps = null) {
        if (isNaN(seconds)) return "00:00:00.000";

        const date = new Date(seconds * 1000);
        const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
        const mm = String(date.getUTCMinutes()).padStart(2, '0');
        const ss = String(date.getSeconds()).padStart(2, '0');
        const ms = String(date.getMilliseconds()).padStart(3, '0');

        let timeStr = `${hh}:${mm}:${ss}.${ms}`;

        if (fps) {
            const frame = Math.floor((seconds % 1) * fps);
            timeStr += ` (Frame ${frame})`;
        }

        return timeStr;
    }

    function calculateResults() {
        const hasValidPoints = syncPoints.some(p => p.visual !== null && p.audio !== null);

        if (!hasValidPoints) {
            resultsContainer.innerHTML = '<div class="result-box placeholder">Add a Reference Point and set both Visual and Audio sync points to calculate.</div>';
            resultsContainer.parentElement.classList.remove('highlight-panel');
            return;
        }

        const videoFps = parseFloat(videoFpsInput.value) || 240.119;
        const targetFps = parseFloat(targetFpsInput.value) || 50;

        // Get custom FPS values
        const customInputs = customFpsContainer.querySelectorAll('input');
        const customFpsList = [];
        customInputs.forEach(input => {
            const fps = parseFloat(input.value);
            if (!isNaN(fps) && fps > 0) customFpsList.push(fps);
        });

        // Generate Table Header
        let tableHtml = `
            <table class="results-table">
                <thead>
                    <tr>
                        <th>Reference Point</th>
                        <th>Offset (ms)</th>
                        <th>Video Source (${videoFps.toFixed(3)} fps)</th>
                        <th>Target System (${targetFps} fps)</th>
        `;

        customFpsList.forEach(fps => {
            tableHtml += `<th>Custom (${fps} fps)</th>`;
        });

        tableHtml += `
                    </tr>
                </thead>
                <tbody>
        `;

        // Generate Table Rows for each valid sync point
        syncPoints.forEach(point => {
            if (point.visual !== null && point.audio !== null) {
                const offsetSeconds = point.audio - point.visual;
                const offsetMs = offsetSeconds * 1000;
                const offsetClass = offsetMs >= 0 ? 'offset-positive' : 'offset-negative';
                const msSign = offsetMs >= 0 ? '+' : '';

                const videoFramesOffset = offsetSeconds * videoFps;
                const targetFramesOffset = offsetSeconds * targetFps;

                tableHtml += `
                    <tr>
                        <td><strong>${point.name}</strong></td>
                        <td class="${offsetClass}">${msSign}${offsetMs.toFixed(2)} ms</td>
                        <td class="${offsetClass}">${msSign}${videoFramesOffset.toFixed(2)} f</td>
                        <td class="${offsetClass}">${msSign}${targetFramesOffset.toFixed(2)} f</td>
                `;

                customFpsList.forEach(fps => {
                    const customFramesOffset = offsetSeconds * fps;
                    tableHtml += `<td class="${offsetClass}">${msSign}${customFramesOffset.toFixed(2)} f</td>`;
                });

                tableHtml += `</tr>`;
            }
        });

        tableHtml += `
                </tbody>
            </table>
        `;

        resultsContainer.innerHTML = tableHtml;
        resultsContainer.parentElement.classList.add('highlight-panel');
    }

    function updateTimeDisplays() {
        const vFps = parseFloat(videoFpsInput.value) || 240.119;
        videoTimeDisplay.textContent = formatTimecode(videoPlayer.currentTime, vFps);
    }

    // --- File Handling & MediaInfo ---

    async function extractMetadata(file) {
        loadingMetadata.style.display = 'flex';
        try {
            // Check if MediaInfo is loaded globally, which it should be via CDN
            if (typeof MediaInfo === 'undefined') {
                console.warn("MediaInfo not loaded, skipping metadata extraction.");
                videoFpsInput.value = 240.119;
                return;
            }

            const mediainfo = await MediaInfo({ format: 'object' });

            const getSize = () => file.size;
            const readChunk = (chunkSize, offset) =>
                new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        if (event.target.error) {
                            reject(event.target.error);
                        }
                        resolve(new Uint8Array(event.target.result));
                    };
                    reader.readAsArrayBuffer(file.slice(offset, offset + chunkSize));
                });

            const result = await mediainfo.analyzeData(getSize, readChunk);
            let extractedFps = 240.119; // Default fallback

            if (result && result.media && result.media.track) {
                const videoTrack = result.media.track.find(t => t['@type'] === 'Video');
                if (videoTrack && videoTrack.FrameRate) {
                    extractedFps = parseFloat(videoTrack.FrameRate);
                    console.log(`Extracted FPS from metadata: ${extractedFps}`);
                }
            }

            videoFpsInput.value = extractedFps;

        } catch (error) {
            console.error("Error extracting metadata, falling back to 240.119", error);
            videoFpsInput.value = 240.119;
        } finally {
            loadingMetadata.style.display = 'none';
        }
    }

    async function loadVideoFile(file) {
        if (!file) return;

        // Extract metadata first
        await extractMetadata(file);

        // Load into player
        const url = URL.createObjectURL(file);

        if (!wavesurfer) {
            wavesurfer = WaveSurfer.create({
                container: '#waveform-container',
                waveColor: 'rgba(0, 229, 255, 0.4)',
                progressColor: 'rgba(255, 51, 102, 0.7)',
                cursorColor: '#fff',
                height: 80,
                barWidth: 2,
                barGap: 2,
                media: videoPlayer,
                minPxPerSec: parseInt(waveformZoom.value),
                plugins: [
                    WaveSurfer.Timeline.create({
                        container: '#waveform-timeline',
                        height: 20,
                        timeInterval: 0.1,
                        primaryLabelInterval: 1,
                        style: {
                            fontSize: '10px',
                            color: '#a0a8b5'
                        }
                    })
                ]
            });

            // Native Scroll Sync for the Grid
            wavesurfer.on('scroll', (e) => {
                if (e && e.target) {
                    frameGridOverlay.style.backgroundPositionX = `-${e.target.scrollLeft}px`;
                }
            });

            // Handle Zoom Input
            waveformZoom.addEventListener('input', (e) => {
                const minPxPerSec = Number(e.target.value);
                wavesurfer.zoom(minPxPerSec);
                updateFrameGrid(minPxPerSec);
            });
        }

        // This sets the videoPlayer.src and generates the waveform
        wavesurfer.load(url);

        videoFilename.textContent = `Loaded: ${file.name}`;

        // Reset state
        syncPoints = [{ id: Date.now(), name: "Reference 1", visual: null, audio: null }];
        renderSyncPoints();
        calculateResults();

        // Switch UI
        dropzone.classList.remove('active');
        appContainer.style.display = 'block';
        updateTimeDisplays();
    }

    // --- Drag and Drop Events ---

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
    });

    dropzone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('video/')) {
            loadVideoFile(file);
        } else {
            alert('Please drop a valid video file (.mp4, .mov, etc)');
        }
    });

    initialVideoUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) loadVideoFile(file);
    });

    changeVideoBtn.addEventListener('click', () => {
        videoPlayer.pause();
        videoPlayer.src = "";
        appContainer.style.display = 'none';
        dropzone.classList.add('active');
    });

    // --- Time Updates ---
    videoPlayer.addEventListener('timeupdate', updateTimeDisplays);

    // --- Sync Points Dynamic Rendering ---
    function renderSyncPoints() {
        syncPointsList.innerHTML = '';
        const vFps = parseFloat(videoFpsInput.value) || 240.119;

        syncPoints.forEach((point, index) => {
            const row = document.createElement('div');
            row.className = 'ref-point-row';

            // Name Input
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'ref-point-name';
            nameInput.value = point.name;
            nameInput.onchange = (e) => {
                point.name = e.target.value;
                calculateResults();
            };

            // Visual Action
            const visualAction = document.createElement('div');
            visualAction.className = 'sync-action';
            const visualBtn = document.createElement('button');
            visualBtn.className = 'btn btn-primary visual-btn';
            visualBtn.innerHTML = '<ion-icon name="videocam"></ion-icon> Set Visual';
            visualBtn.onclick = () => {
                if (!videoPlayer.src) return;
                point.visual = videoPlayer.currentTime;
                renderSyncPoints();
                calculateResults();
            };
            const visualDisplay = document.createElement('div');
            visualDisplay.className = 'sync-point-display';
            visualDisplay.style.cursor = point.visual !== null ? 'pointer' : 'default';
            visualDisplay.innerHTML = point.visual !== null
                ? `<span style="color:var(--accent-color); text-decoration:underline;" title="Click to seek to this frame">${formatTimecode(point.visual, vFps)}</span>`
                : 'Not Set';

            if (point.visual !== null) {
                visualDisplay.onclick = () => {
                    if (videoPlayer) videoPlayer.currentTime = point.visual;
                };
            }

            visualAction.appendChild(visualBtn);
            visualAction.appendChild(visualDisplay);

            // Audio Action
            const audioAction = document.createElement('div');
            audioAction.className = 'sync-action';
            const audioBtn = document.createElement('button');
            audioBtn.className = 'btn btn-primary audio-btn';
            audioBtn.innerHTML = '<ion-icon name="musical-notes"></ion-icon> Set Audio';
            audioBtn.onclick = () => {
                if (!videoPlayer.src) return;
                point.audio = videoPlayer.currentTime;
                renderSyncPoints();
                calculateResults();
            };
            const audioDisplay = document.createElement('div');
            audioDisplay.className = 'sync-point-display';
            audioDisplay.style.cursor = point.audio !== null ? 'pointer' : 'default';
            audioDisplay.innerHTML = point.audio !== null
                ? `<span style="color:var(--danger-color); text-decoration:underline;" title="Click to seek to this frame">${formatTimecode(point.audio, vFps)}</span>`
                : 'Not Set';

            if (point.audio !== null) {
                audioDisplay.onclick = () => {
                    if (videoPlayer) videoPlayer.currentTime = point.audio;
                };
            }

            audioAction.appendChild(audioBtn);
            audioAction.appendChild(audioDisplay);

            // Remove Button
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn btn-icon remove-btn';
            removeBtn.innerHTML = '<ion-icon name="trash-outline"></ion-icon>';
            removeBtn.title = "Remove Reference Point";
            removeBtn.onclick = () => {
                syncPoints.splice(index, 1);
                renderSyncPoints();
                calculateResults();
            };

            row.appendChild(nameInput);
            row.appendChild(visualAction);
            row.appendChild(audioAction);
            row.appendChild(removeBtn);

            syncPointsList.appendChild(row);
        });
    }

    addRefPointBtn.addEventListener('click', () => {
        syncPoints.push({
            id: Date.now(),
            name: `Reference ${syncPoints.length + 1}`,
            visual: null,
            audio: null
        });
        renderSyncPoints();
        calculateResults();
    });

    // --- Scrub Controls ---
    videoPrevFrame.addEventListener('click', () => {
        const fps = parseFloat(videoFpsInput.value) || 240.119;
        const frameTime = 1 / fps;
        videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - frameTime);
    });

    videoNextFrame.addEventListener('click', () => {
        const fps = parseFloat(videoFpsInput.value) || 240.119;
        const frameTime = 1 / fps;
        videoPlayer.currentTime = Math.min(videoPlayer.duration || 0, videoPlayer.currentTime + frameTime);
    });

    videoPrevMs.addEventListener('click', () => {
        videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 0.02);
    });

    videoNextMs.addEventListener('click', () => {
        videoPlayer.currentTime = Math.min(videoPlayer.duration || 0, videoPlayer.currentTime + 0.02);
    });

    // Add Custom FPS
    addFpsBtn.addEventListener('click', () => {
        const item = document.createElement('div');
        item.className = 'custom-fps-item input-group-row';

        const input = document.createElement('input');
        input.type = 'number';
        input.step = '1';
        input.value = '60';
        input.placeholder = 'FPS';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-icon remove-btn';
        removeBtn.innerHTML = '<ion-icon name="trash-outline"></ion-icon>';
        removeBtn.title = "Remove FPS";

        removeBtn.onclick = () => {
            item.remove();
            calculateResults();
        };

        input.onchange = calculateResults;

        item.appendChild(input);
        item.appendChild(removeBtn);
        customFpsContainer.appendChild(item);

        calculateResults();
    });

    // Recalculate on main FPS change
    videoFpsInput.addEventListener('change', () => {
        updateTimeDisplays();
        renderSyncPoints(); // Re-render to update the display text of captured times with new FPS
        calculateResults();

        // Update grid if wavesurfer is active
        if (wavesurfer) {
            updateFrameGrid(Number(waveformZoom.value));
        }
    });

    targetFpsInput.addEventListener('change', calculateResults);

    // --- Frame Grid Logic ---
    function updateFrameGrid(pxPerSec) {
        const fps = parseFloat(videoFpsInput.value) || 240.119;
        const pxPerFrame = pxPerSec / fps;

        // Only show grid if zoomed in enough (e.g. at least 5px per frame)
        if (pxPerFrame >= 5) {
            frameGridOverlay.style.display = 'block';

            // Create a repeating gradient where each line is spaced by exactly pxPerFrame.
            // Notice we do NOT scale width by scrollWidth, we keep it 100% of visible container,
            // and simply offset the backgroundPosition via the native scroll listener above!
            frameGridOverlay.style.width = '100%';

            frameGridOverlay.style.backgroundImage = `repeating-linear-gradient(
                to right,
                rgba(255, 255, 255, 0.0) 0,
                rgba(255, 255, 255, 0.0) calc(${pxPerFrame}px - 1px),
                rgba(255, 255, 255, 0.15) calc(${pxPerFrame}px - 1px),
                rgba(255, 255, 255, 0.15) ${pxPerFrame}px
            )`;

            // Re-sync background position locally just in case scroll is active
            if (wavesurfer && wavesurfer.getWrapper()) {
                const shadowDiv = wavesurfer.getWrapper().shadowRoot && wavesurfer.getWrapper().shadowRoot.querySelector('div');
                if (shadowDiv) {
                    frameGridOverlay.style.backgroundPositionX = `-${shadowDiv.scrollLeft}px`;
                }
            }
        } else {
            frameGridOverlay.style.display = 'none';
        }
    }

});
