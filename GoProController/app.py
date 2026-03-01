import asyncio
import threading
import logging
import json
import time
import subprocess
import requests
import os
from flask import Flask, jsonify, request, render_template, Response
from flask_cors import CORS
from open_gopro import WiredGoPro, WirelessGoPro

# --- Background Event Loop for BLE ---
# We run a single event loop in a background thread to prevent WinError 10038
# caused by creating/destroying ProactorEventLoops per request on Windows.
ble_loop = asyncio.new_event_loop()

def _start_ble_loop(loop):
    asyncio.set_event_loop(loop)
    loop.run_forever()

ble_thread = threading.Thread(target=_start_ble_loop, args=(ble_loop,), daemon=True)
ble_thread.start()

app = Flask(__name__)
CORS(app)

# GoPro IP defaults to 10.5.5.9 when connected to its WiFi AP
# We start with None, and populate it when we connect via BLE or user sets it
GOPRO_IP = None
GOPRO_BASE_URL = ""

# Track if we are currently trying to connect via BLE
is_ble_connecting = False

# Ensure working directory is the script's directory so logs and DB are kept here
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

from logging.handlers import RotatingFileHandler

# Setup logging
log_handler = RotatingFileHandler('log.txt', maxBytes=20*1024*1024, backupCount=1)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        log_handler,
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# FFmpeg process reference
ffmpeg_process = None

def proxy_request(endpoint, method="GET", params=None):
    """Helper to proxy requests to the GoPro."""
    global GOPRO_BASE_URL
    if not GOPRO_BASE_URL:
        return {"error": "Camera IP not configured. Connect via Wi-Fi Setup first."}, 503
        
    url = f"{GOPRO_BASE_URL}{endpoint}"
    try:
        if method == "GET":
            response = requests.get(url, params=params, timeout=10)
        else:
            response = requests.request(method, url, timeout=10)
        
        # GoPro often returns 200 with JSON, try to parse
        try:
            return response.json(), response.status_code
        except json.JSONDecodeError:
            return {"message": response.text}, response.status_code
    except requests.exceptions.RequestException as e:
        logger.error(f"Error communicating with GoPro at {url}: {e}")
        return {"error": "Could not connect to GoPro. Ensure you are connected to its WiFi."}, 503

# Keep-alive thread to prevent GoPro from sleeping
def keep_alive_worker():
    while True:
        if GOPRO_BASE_URL:
            try:
                requests.get(f"{GOPRO_BASE_URL}/gopro/camera/keep_alive", timeout=2)
            except Exception:
                pass
        time.sleep(3)

ka_thread = threading.Thread(target=keep_alive_worker, daemon=True)
ka_thread.start()

@app.route("/")

def index():
    return render_template("index.html")

# --- BLE Wi-Fi Configuration Logic ---

async def _ble_enable_ap():
    global is_ble_connecting
    is_ble_connecting = True
    
    try:
        logger.info("Connecting to GoPro via BLE to enable AP Mode...")
        gopro = WirelessGoPro(interfaces={WirelessGoPro.Interface.BLE})
        
        try:
            await gopro.open(timeout=15, retries=2)
        except Exception as connect_err:
            logger.error(f"GoPro not found or failed to connect: {connect_err}")
            return {"success": False, "error": "No se encontraron cámaras GoPro por Bluetooth."}
            
        try:
            logger.info("BLE Connected. Enabling Wi-Fi AP...")
            await gopro.ble_command.enable_wifi_ap(enable=True)
            
            # Now fetch SSID and Password to show the user
            logger.info("Fetching AP credentials...")
            ssid_resp = await gopro.ble_command.get_wifi_ssid()
            pass_resp = await gopro.ble_command.get_wifi_password()
            
            ssid = ssid_resp.data if ssid_resp.ok else "Desconocido"
            password = pass_resp.data if pass_resp.ok else "Desconocida"
            
            return {"success": True, "ssid": ssid, "password": password}
        finally:
            if gopro.is_open:
                await gopro.close()
    except Exception as e:
        logger.error(f"BLE AP Setup failed: {e}")
        return {"success": False, "error": str(e)}
    finally:
        is_ble_connecting = False


@app.route("/api/camera_ip", methods=["GET", "POST"])
def camera_ip():
    """Get the currently configured IP, or set it manually"""
    global GOPRO_IP, GOPRO_BASE_URL
    if request.method == "POST":
         GOPRO_IP = request.json.get("ip")
         GOPRO_BASE_URL = f"http://{GOPRO_IP}:8080"
         
    return jsonify({"ip": GOPRO_IP})

@app.route("/api/enable_ap", methods=["POST"])
def enable_ap():
    """Endpoint to enable GoPro's own Wi-Fi AP and return credentials"""
    if is_ble_connecting:
         return jsonify({"error": "Wait, connection in progress..."}), 400
         
    try:
        start_t = time.time()
        future = asyncio.run_coroutine_threadsafe(_ble_enable_ap(), ble_loop)
        result = future.result()
        end_t = time.time()
        
        if not result.get("success") and (end_t - start_t) < 15.0:
            remaining = 15.0 - (end_t - start_t)
            time.sleep(remaining)
            
        return jsonify(result), 200 if result.get("success") else 500
    except Exception as e:
        logger.error(f"Event loop error: {e}")
        return jsonify({"success": False, "error": "Error interno del servidor, vuelve a intentarlo."}), 500

@app.route("/api/connect_windows_wifi", methods=["POST"])
def connect_windows_wifi():
    """Uses Windows netsh to automatically connect to the target Wi-Fi."""
    data = request.json
    ssid = data.get("ssid")
    password = data.get("password")
    
    if not ssid or not password:
        return jsonify({"success": False, "error": "Missing ssid or password"}), 400
        
    xml_content = f'''<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
    <name>{ssid}</name>
    <SSIDConfig>
        <SSID>
            <name>{ssid}</name>
        </SSID>
    </SSIDConfig>
    <connectionType>ESS</connectionType>
    <connectionMode>auto</connectionMode>
    <MSM>
        <security>
            <authEncryption>
                <authentication>WPA2PSK</authentication>
                <encryption>AES</encryption>
                <useOneX>false</useOneX>
            </authEncryption>
            <sharedKey>
                <keyType>passPhrase</keyType>
                <protected>false</protected>
                <keyMaterial>{password}</keyMaterial>
            </sharedKey>
        </security>
    </MSM>
    <MacRandomization xmlns="http://www.microsoft.com/networking/WLAN/profile/v3">
        <enableRandomization>false</enableRandomization>
    </MacRandomization>
</WLANProfile>'''

    temp_xml = "temp_wifi_profile.xml"
    try:
        with open(temp_xml, "w") as f:
            f.write(xml_content)
            
        # Add profile
        subprocess.run(["netsh", "wlan", "add", "profile", f"filename={temp_xml}"], capture_output=True)
        # Connect
        res = subprocess.run(["netsh", "wlan", "connect", f"name={ssid}"], capture_output=True, text=True)
        
        if "successfully" in res.stdout.lower() or "correctamente" in res.stdout.lower() or res.returncode == 0:
            return jsonify({"success": True}), 200
        else:
            return jsonify({"success": False, "error": res.stdout}), 500
    except Exception as e:
         return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if os.path.exists(temp_xml):
            os.remove(temp_xml)

# -------------------------------------

@app.route("/api/settings", methods=["GET", "POST"])
def settings_control():
    """Get or Set Camera Settings (Resolution: ID 2, FPS: ID 3, Auto Power Down: ID 59)"""
    if request.method == "POST":
        data = request.json or {}
        
        # We can accept any settings generically or explicitly. Let's process the ones given.
        res_id = data.get("resolution")
        fps_id = data.get("fps")
        fov_id = data.get("fov")
        auto_off_id = data.get("auto_off")
        
        # Sequentially set them if provided
        resp_data = {"success": True, "results": []}
        
        # Settings mappings:
        # 2: Resolution, 3: FPS, 122: Lens/FOV, 59: Auto Power Down
        settings_map = {
            "2": res_id,
            "3": fps_id,
            "122": fov_id,
            "59": auto_off_id
        }
        
        for s_id, option in settings_map.items():
            if option is not None:
                d, s = proxy_request(f"/gopro/camera/setting?setting={s_id}&option={option}")
                # Wait briefly between configuration commands to assure GoPro processes it reliably
                time.sleep(0.1)
                resp_data["results"].append({"setting": s_id, "status": s, "response": d})
             
        return jsonify(resp_data), 200
        
    else:
        # GET: Read current state
        data, status = proxy_request("/gopro/camera/state")
        if status == 200 and isinstance(data, dict) and "settings" in data:
            return jsonify({
                "success": True, 
                "resolution": data["settings"].get("2"), 
                "fps": data["settings"].get("3"),
                "fov": data["settings"].get("122"),
                "auto_off": data["settings"].get("59")
            }), 200
        return jsonify({"success": False, "error": "Could not fetch state"}), status

@app.route("/api/camera/mode", methods=["POST"])
def set_camera_mode():
    data = request.json or {}
    mode_val = data.get("mode")
    
    # Map frontend mode value (0=Video, 1=Photo, 2=Timelapse) to Preset Group ID
    mode_map = {
        0: "1000", # Video
        1: "1001", # Photo
        2: "1002"  # Timelapse
    }
    
    group_id = mode_map.get(mode_val)
    if group_id is not None:
        d, s = proxy_request(f"/gopro/camera/presets/set_group?id={group_id}")
        return jsonify({"success": True, "response": d}), s
    else:
        return jsonify({"success": False, "error": "Invalid mode"}), 400

@app.route("/api/camera/full_state", methods=["GET"])
def get_full_state():
    """Fetches the entire camera state including battery level, modes, etc."""
    data, status = proxy_request("/gopro/camera/state")
    if status == 200 and isinstance(data, dict):
        # We extract useful fields for the frontend
        status_data = data.get("status", {})
        settings_data = data.get("settings", {})
        
        # status 70 is battery percentage
        battery_pct = status_data.get("70", 0)
        # status 8 is system ready, 82 is quick capture active, 114 is current mode
        is_recording = status_data.get("114") == 1 # sometimes 1 is recording, wait, system active is different
        # Let's just return the raw status and let frontend decide or we parse
        return jsonify({"success": True, "status": status_data, "settings": settings_data}), 200
    
    return jsonify({"success": False, "error": "Could not fetch state"}), status



@app.route("/api/shutter/start", methods=["POST"])
def shutter_start():
    # https://[GoPro-IP]/gopro/camera/shutter/start
    data, status = proxy_request("/gopro/camera/shutter/start")
    return jsonify(data), status

@app.route("/api/shutter/stop", methods=["POST"])
def shutter_stop():
    # https://[GoPro-IP]/gopro/camera/shutter/stop
    data, status = proxy_request("/gopro/camera/shutter/stop")
    return jsonify(data), status

@app.route("/api/media/list", methods=["GET"])
def media_list():
    # https://[GoPro-IP]/gopro/media/list
    data, status = proxy_request("/gopro/media/list")
    return jsonify(data), status

@app.route("/api/media/download/<directory>/<filename>", methods=["GET"])
def download_media(directory, filename):
    # This acts as a true proxy for the binary file
    custom_name = request.args.get("custom_name")
    url = f"{GOPRO_BASE_URL}/videos/DCIM/{directory}/{filename}"
    try:
        req = requests.get(url, stream=True, timeout=15)
        headers = dict(req.headers)
        
        # Override filename if requested
        final_filename = custom_name if custom_name else filename
        headers["Content-Disposition"] = f'attachment; filename="{final_filename}"'
        
        def generate():
            for chunk in req.iter_content(chunk_size=8192):
                yield chunk
                
        return Response(generate(), headers=headers)
    except requests.exceptions.RequestException as e:
        logger.error(f"Error downloading from GoPro: {e}")
        return jsonify({"error": "Failed to download file"}), 503
ffmpeg_process = None

@app.route("/api/stream/start", methods=["POST"])
def stream_start():
    """Confirms GoPro starts UDP stream and launches local ffmpeg."""
    global ffmpeg_process
    
    # Send official start command. GoPro typically streams to requesting IP on UDP 8554.
    data, status = proxy_request("/gopro/camera/stream/start")
    
    if ffmpeg_process is None or ffmpeg_process.poll() is not None:
        cmd = [
            'ffmpeg', '-hide_banner', '-loglevel', 'error',
            '-fflags', 'nobuffer', '-flags', 'low_delay',
            '-i', 'udp://0.0.0.0:8554?overrun_nonfatal=1&fifo_size=5000000',
            '-f', 'mpjpeg',
            '-an',
            '-' # Output to stdout
        ]
        ffmpeg_process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        
    return jsonify({"message": "Stream started", "status": status, "data": data}), 200

@app.route("/api/stream/stop", methods=["POST"])
def stream_stop():
    global ffmpeg_process
    data, status = proxy_request("/gopro/camera/stream/stop")
    if ffmpeg_process:
        ffmpeg_process.terminate()
        ffmpeg_process.wait(timeout=2)
        ffmpeg_process = None
    return jsonify(data), status

def generate_frames():
    global ffmpeg_process
    while ffmpeg_process and ffmpeg_process.poll() is None:
        chunk = ffmpeg_process.stdout.read(4096)
        if not chunk:
            break
        yield chunk

@app.route("/video_feed")
def video_feed():
    return Response(generate_frames(), mimetype="multipart/x-mixed-replace; boundary=--ffmpeg")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
