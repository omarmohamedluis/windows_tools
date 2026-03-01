document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const btnRecord = document.getElementById('btn-record');
    const recordingStatus = document.getElementById('recording-status');
    const togglePreview = document.getElementById('toggle-preview');
    const videoContainer = document.getElementById('video-container');
    const btnRefreshMedia = document.getElementById('btn-refresh-media');
    const mediaList = document.getElementById('media-list');

    const connectionDot = document.getElementById('connection-dot');
    const connectionText = document.getElementById('connection-text');

    // Setup Modal Elements
    const btnShowSetup = document.getElementById('btn-show-setup');
    const btnCloseSetup = document.getElementById('btn-close-setup');
    const setupModal = document.getElementById('setup-modal');
    const setupStatus = document.getElementById('setup-status');
    const btnSetIp = document.getElementById('btn-set-ip');
    const manualIpInput = document.getElementById('manual-ip');
    const btnEnableAp = document.getElementById('btn-enable-ap');

    // Settings Elements
    const selResolution = document.getElementById('sel-resolution');
    const selFps = document.getElementById('sel-fps');
    const selFov = document.getElementById('sel-fov');
    const selMode = document.getElementById('sel-mode');
    const btnApplySettings = document.getElementById('btn-apply-settings');

    // Camera Status Elements
    const iconBattery = document.getElementById('icon-battery');
    const textBattery = document.getElementById('text-battery');
    const iconMode = document.getElementById('icon-mode');
    const textMode = document.getElementById('text-mode');
    const textRes = document.getElementById('text-res');
    const textFps = document.getElementById('text-fps');
    const textFov = document.getElementById('text-fov');

    // State
    let isRecording = false;
    let isPreviewActive = false;

    // --- Configuration ---
    // Change this to the backend server's URL if not running on the same origin.
    // Assuming backend is running on default Flask port 5000:
    const API_BASE = window.location.origin + '/api';

    // -------------------
    // Connection Check (Polled or initial)
    // -------------------
    async function checkConnection() {
        try {
            // We can check connection by trying to get the media list
            const response = await fetch(`${API_BASE}/media/list`);
            if (response.ok) {
                setConnectionStatus('connected', 'GoPro Connected');
                loadMedia();
                loadSettings();
            } else {
                setConnectionStatus('disconnected', 'GoPro Disconnected');
                mediaList.innerHTML = `<div class="loading-state"><p>Camera not found. Check Wi-Fi.</p></div>`;
            }
        } catch (error) {
            console.error('Connection check failed', error);
            setConnectionStatus('disconnected', 'Backend Offline');
        }
    }

    function setConnectionStatus(status, text) {
        connectionDot.className = `dot ${status}`;
        connectionText.textContent = text;
    }

    // Non-blocking toast for alerts (to avoid pausing the stream)
    function showToast(msg) {
        setupStatus.textContent = msg;
        setupStatus.className = 'setup-status error';
        setupModal.classList.remove('hidden');
        setTimeout(() => {
            if (setupStatus.textContent === msg) {
                setupModal.classList.add('hidden');
            }
        }, 4000);
    }

    // Mode text and icon mapping
    const modeNames = { 0: 'Vídeo', 1: 'Foto', 2: 'Timelapse' };
    const modeIcons = { 0: 'ph-video-camera', 1: 'ph-camera', 2: 'ph-clock' };

    let failedPolls = 0;

    // Function to load all settings and status consistently
    async function loadSettings() {
        if (connectionText.textContent !== 'GoPro Connected') return;

        try {
            const res = await fetch(`${API_BASE}/camera/full_state`);
            const data = await res.json();
            if (res.ok && data.success) {
                failedPolls = 0;
                // Update Settings Dropdowns
                const settings = data.settings || {};

                // Helper to get text from select safely
                const getOptText = (sel, val) => {
                    if (!sel || !val) return val;
                    const opt = sel.querySelector(`option[value="${val}"]`);
                    return opt ? opt.text : val;
                };

                // Readouts (What the camera ACTUALLY has active right now)
                if (settings["2"] && textRes) textRes.textContent = getOptText(selResolution, settings["2"]);
                if (settings["3"] && textFps) textFps.textContent = getOptText(selFps, settings["3"]);
                if (settings["122"] && textFov) textFov.textContent = getOptText(selFov, settings["122"]);

                // Only load into dropdowns ONCE to avoid overwriting user selections while they are choosing
                if (!selResolution.getAttribute('data-loaded')) {
                    if (settings["2"]) selResolution.value = settings["2"];
                    if (settings["3"]) selFps.value = settings["3"];
                    if (settings["122"]) selFov.value = settings["122"];
                    selResolution.setAttribute('data-loaded', 'true');
                }

                // Mode: 0=Video, 1=Photo, 2=Timelapse (ID 114)
                const mode = data.status["114"];
                if (mode !== undefined) {
                    textMode.textContent = modeNames[mode] || 'Desconocido';
                    iconMode.className = `ph ${modeIcons[mode] || 'ph-video-camera'}`;

                    if (selMode && !selMode.getAttribute('data-loaded')) {
                        selMode.value = mode;
                        selMode.setAttribute('data-loaded', 'true');
                    }
                }

                // Battery Status (ID 70)
                const battery = data.status["70"];
                if (battery !== undefined) {
                    textBattery.textContent = `${battery}%`;
                    if (battery > 20) {
                        iconBattery.style.color = '#4ade80'; // green
                        iconBattery.className = 'ph ph-battery-full';
                    } else {
                        iconBattery.style.color = '#ef4444'; // red
                        iconBattery.className = 'ph ph-battery-warning';
                    }
                }
            } else {
                failedPolls++;
                if (failedPolls > 2) {
                    setConnectionStatus('disconnected', 'Cámara Desconectada');
                    if (isPreviewActive) stopPreview();
                }
            }
        } catch (e) {
            console.error("Error polling state:", e);
            failedPolls++;
            if (failedPolls > 2) {
                setConnectionStatus('disconnected', 'Señal Perdida');
                if (isPreviewActive) stopPreview();
            }
        }
    }

    // Interval to poll full state every 3 seconds (faster response)
    setInterval(loadSettings, 3000);

    // -------------------
    // Setup / Config Modal Logic
    // -------------------
    btnShowSetup.addEventListener('click', () => {
        setupModal.classList.remove('hidden');

        // Cargar IP actual si existe
        fetch(`${API_BASE}/camera_ip`)
            .then(res => res.json())
            .then(data => {
                if (data.ip) manualIpInput.value = data.ip;
            });
    });

    btnCloseSetup.addEventListener('click', () => {
        setupModal.classList.add('hidden');
        setupStatus.textContent = '';
        setupStatus.className = 'setup-status';
    });

    btnEnableAp.addEventListener('click', async () => {
        setupStatus.textContent = "";
        btnEnableAp.disabled = true;
        btnEnableAp.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Arrancando Bluetooth y encendiendo Wi-Fi...';

        try {
            const res = await fetch(`${API_BASE}/enable_ap`, { method: 'POST' });
            const data = await res.json();

            if (res.ok && data.success) {
                setupStatus.innerHTML = `<b>¡Bluetooth ok!</b><br><i class="ph ph-spinner animate-spin"></i> Conectando Windows a Wi-Fi: ${data.ssid}...`;
                setupStatus.className = 'setup-status';

                // Attempt auto-connect
                try {
                    const connectRes = await fetch(`${API_BASE}/connect_windows_wifi`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ssid: data.ssid, password: data.password })
                    });

                    const connectData = await connectRes.json();

                    if (connectRes.ok && connectData.success) {
                        setupStatus.innerHTML = `<b>¡Conectado!</b><br>Aplicando ajustes y arrancando vídeo...`;
                        setupStatus.className = 'setup-status success';
                        manualIpInput.value = "10.5.5.9"; // IP por defecto en modo AP

                        // Force IP
                        await fetch(`${API_BASE}/camera_ip`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ip: "10.5.5.9" })
                        });

                        // Set Auto Power Down to Never (ID 59 = 0)
                        await fetch(`${API_BASE}/settings`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ auto_off: 0 })
                        });

                        await checkConnection();

                        setTimeout(() => {
                            setupModal.classList.add('hidden');
                            if (!isPreviewActive) {
                                startPreview();
                            }
                        }, 1500);

                    } else {
                        setupStatus.innerHTML = `<b>¡AP Encendido!</b><br>Red: ${data.ssid}<br>Clave: ${data.password}<br><br>⚠️ Windows no pudo conectarse automáticamente. Conecta el Wi-Fi manualmente a esa red y dale a "Forzar IP".`;
                        setupStatus.className = 'setup-status warning';
                        manualIpInput.value = "10.5.5.9";
                    }
                } catch (cErr) {
                    setupStatus.innerHTML = `<b>¡AP Encendido!</b><br>Red: ${data.ssid}<br>Clave: ${data.password}<br><br>⚠️ Error al mandar orden a Windows. Conecta el Wi-Fi manualmente a esa red y dale a "Forzar IP".`;
                    setupStatus.className = 'setup-status warning';
                    manualIpInput.value = "10.5.5.9";
                }

            } else {
                setupStatus.textContent = data.error || "Error al encender AP.";
                setupStatus.className = 'setup-status error';
            }
        } catch (err) {
            setupStatus.textContent = "Error conectando con el backend.";
            setupStatus.className = 'setup-status error';
        } finally {
            btnEnableAp.disabled = false;
            btnEnableAp.innerHTML = '<i class="ph ph-broadcast"></i> Conectar a GoPro';
        }
    });

    btnSetIp.addEventListener('click', async () => {
        const ip = manualIpInput.value;
        if (!ip) return;

        btnSetIp.textContent = 'Forzando...';
        try {
            await fetch(`${API_BASE}/camera_ip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip })
            });
            setupStatus.textContent = `IP manual guardada: ${ip}`;
            setupStatus.className = 'setup-status success';
            checkConnection();
        } catch (e) {
            setupStatus.textContent = "Error guardando IP.";
            setupStatus.className = 'setup-status error';
        } finally {
            btnSetIp.textContent = 'Forzar IP';
        }
    });

    // -------------------
    // Shutter Controls (Record)
    // -------------------
    btnRecord.addEventListener('click', async () => {
        try {
            const endpoint = isRecording ? '/shutter/stop' : '/shutter/start';
            const req = await fetch(`${API_BASE}${endpoint}`, { method: 'POST' });

            if (req.ok) {
                isRecording = !isRecording;
                updateRecordingUI();
            } else {
                showToast('No se pudo enviar el comando a la cámara.');
            }
        } catch (error) {
            console.error('Record error:', error);
            showToast('No se puede conectar con el servidor.');
        }
    });

    function updateRecordingUI() {
        if (isRecording) {
            btnRecord.classList.add('recording');
            recordingStatus.textContent = 'Recording Elapsed: 00:00';
            recordingStatus.classList.add('recording-status-active');
            // Simplified timer logic, typically you query the camera for specific time
        } else {
            btnRecord.classList.remove('recording');
            recordingStatus.textContent = 'Ready to Record';
            recordingStatus.classList.remove('recording-status-active');
        }
    }



    // Apply all settings via manual button
    if (btnApplySettings) {
        btnApplySettings.addEventListener('click', async () => {
            const originalText = btnApplySettings.innerHTML;
            btnApplySettings.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Enviando...';
            btnApplySettings.disabled = true;

            try {
                // First, update mode if it changed (requires a separate endpoint)
                const modeRes = await fetch(`${API_BASE}/camera/mode`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: parseInt(selMode.value) })
                });

                // Wait a tiny bit just in case
                await new Promise(r => setTimeout(r, 200));

                // Send all other parameters
                const payload = {
                    resolution: selResolution.value,
                    fps: selFps.value,
                    fov: selFov.value
                };

                const res = await fetch(`${API_BASE}/settings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!res.ok || !modeRes.ok) throw new Error("Failed to change setting");

                // Re-read status strictly to confirm success
                await loadSettings();

                btnApplySettings.innerHTML = '<i class="ph ph-check"></i> Enviado';
                setTimeout(() => {
                    btnApplySettings.innerHTML = originalText;
                    btnApplySettings.disabled = false;
                }, 2000);
            } catch (err) {
                console.error(err);
                showToast("No se pudieron aplicar todos los cambios. Quizá no sean compatibles entre sí o la cámara esté grabando.");
                btnApplySettings.innerHTML = originalText;
                btnApplySettings.disabled = false;
            }
        });
    }

    // -------------------
    // Video Preview (RTMP via Python server)
    // -------------------
    togglePreview.addEventListener('click', async () => {
        if (isPreviewActive) {
            stopPreview();
        } else {
            startPreview();
        }
    });

    async function startPreview() {
        try {
            togglePreview.innerHTML = '<i class="ph ph-spinner animate-spin"></i> Starting...';
            // Tell backend to start stream
            const res = await fetch(`${API_BASE}/stream/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ local_ip: window.location.hostname })
            });

            if (res.ok) {
                // Pequeño delay para darle tiempo al feed mjpeg a generarse
                setTimeout(() => {
                    isPreviewActive = true;
                    togglePreview.className = 'btn glass glass-active';
                    togglePreview.innerHTML = '<i class="ph ph-stop-circle"></i> Stop Preview';

                    // Re-asignar src con un timestamp obligará al browser a no usar el cache
                    const cacheBuster = new Date().getTime();
                    videoContainer.innerHTML = `<img src="/video_feed?v=${cacheBuster}" id="video-stream" alt="Live Stream">`;
                }, 1000);
            } else {
                throw new Error("Failed to start stream");
            }

        } catch (err) {
            console.error(err);
            showToast("No se pudo iniciar la vista previa.");
            togglePreview.innerHTML = '<i class="ph ph-monitor-play"></i> Start Preview';
        }
    }

    async function stopPreview() {
        try {
            await fetch(`${API_BASE}/stream/stop`, { method: 'POST' });
        } catch (e) { } // Ignore error if already stopped

        isPreviewActive = false;
        togglePreview.className = 'btn btn-secondary glass';
        togglePreview.innerHTML = '<i class="ph ph-monitor-play"></i> Start Preview';

        videoContainer.innerHTML = `
            <div class="no-signal">
                <i class="ph ph-prohibit"></i>
                <p>Preview Offline</p>
            </div>
        `;
    }

    // -------------------
    // Media Gallery
    // -------------------
    btnRefreshMedia.addEventListener('click', () => {
        mediaList.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading media...</p></div>`;
        loadMedia();
    });

    async function loadMedia() {
        try {
            const response = await fetch(`${API_BASE}/media/list`);
            const data = await response.json();

            if (!data.media || data.media.length === 0) {
                mediaList.innerHTML = `<div class="loading-state"><p>No media found on camera.</p></div>`;
                return;
            }

            renderMediaList(data.media);
        } catch (error) {
            console.error('Error fetching media list', error);
            mediaList.innerHTML = `<div class="loading-state"><p>Error loading media.</p></div>`;
        }
    }

    function renderMediaList(directories) {
        mediaList.innerHTML = '';

        // The API returns media nested by directory (e.g., 100GOPRO)
        directories.forEach(dir => {
            const dirName = dir.d;

            // Reversing the files array to show newest first (often highest number)
            const files = dir.fs.reverse();

            files.forEach(file => {
                const isVideo = file.n.toLowerCase().endsWith('.mp4');
                const icon = isVideo ? 'ph-video' : 'ph-image';
                const sizeMB = (file.s / (1024 * 1024)).toFixed(1);

                const itemHtml = `
                    <div class="media-item">
                        <div class="media-info">
                            <i class="ph ${icon}"></i>
                            <div>
                                <div class="media-name">${file.n}</div>
                                <div class="media-size">${sizeMB} MB</div>
                            </div>
                        </div>
                        <button onclick="downloadMediaWithCustomName('${dirName}', '${file.n}')" class="btn btn-download">
                            Descargar
                        </button>
                    </div>
                `;
                mediaList.insertAdjacentHTML('beforeend', itemHtml);
            });
        });
    }

    window.downloadMediaWithCustomName = function (dirName, filename) {
        let suggestedName = filename;
        const customName = prompt(`¿Con qué nombre quieres descargar este archivo? (Opciones: dejar igual o cambiar)\nEjemplo: "toma_buena_final"`, suggestedName);

        if (customName !== null) {
            // Check if they accidentally stripped the extension, add it back based on original
            let finalName = customName.trim();
            if (finalName === "") finalName = filename;

            const extMatch = filename.match(/\.[0-9a-z]+$/i);
            const originalExt = extMatch ? extMatch[0] : '';

            if (originalExt && !finalName.toLowerCase().endsWith(originalExt.toLowerCase())) {
                finalName += originalExt;
            }

            const rawUrl = `${API_BASE}/media/download/${dirName}/${filename}`;
            const finalUrl = `${rawUrl}?custom_name=${encodeURIComponent(finalName)}`;
            window.open(finalUrl, '_blank');
        }
    };

    // Initial check
    checkConnection();
});
