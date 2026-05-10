import json
import logging
import os
import sys
import time
from datetime import datetime

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit

sys.path.insert(0, os.path.dirname(__file__))
from gesture_controller import GestureController

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("GestureRacing")

BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")
DATA_FILE    = os.path.join(BASE_DIR, "leaderboard.json")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
app.config["SECRET_KEY"] = "gesture-racing-secret-2024"

CORS(app, resources={r"/api/*": {"origins": "*"}})

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    logger=False,
    engineio_logger=False,
    ping_timeout=20,
    ping_interval=10,
)

gesture_ctrl = GestureController(max_num_hands=1, detection_confidence=0.65)

_last_processed: dict[str, float] = {}
MIN_INTERVAL = 0.08

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)

def _load_leaderboard() -> list:
    if not os.path.exists(DATA_FILE):
        return []
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Could not read leaderboard: %s", exc)
        return []

def _save_leaderboard(data: list) -> None:
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except OSError as exc:
        logger.error("Could not save leaderboard: %s", exc)

@app.route("/api/leaderboard", methods=["GET"])
def get_leaderboard():
    board = _load_leaderboard()
    board.sort(key=lambda e: e.get("score", 0), reverse=True)
    return jsonify(board[:10])

@app.route("/api/save_score", methods=["POST"])
def save_score():
    body = request.get_json(silent=True) or {}
    name  = str(body.get("name", "Anonymous"))[:20]
    score = int(body.get("score", 0))

    if score <= 0:
        return jsonify({"success": False, "rank": -1, "message": "Score must be positive"}), 400

    board = _load_leaderboard()
    entry = {
        "name":  name,
        "score": score,
        "date":  datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
    }
    board.append(entry)
    board.sort(key=lambda e: e.get("score", 0), reverse=True)

    rank = next((i + 1 for i, e in enumerate(board) if e is entry), len(board))
    _save_leaderboard(board)

    logger.info("Score saved: %s = %d (rank #%d)", name, score, rank)
    return jsonify({"success": True, "rank": rank})

@app.route("/api/game_state", methods=["GET"])
def game_state():
    return jsonify({"status": "running", "timestamp": time.time()})

@socketio.on("connect")
def on_connect():
    logger.info("Client connected: %s", request.sid)
    emit("server_ready", {"message": "Gesture server connected", "version": "1.0"})

@socketio.on("disconnect")
def on_disconnect():
    _last_processed.pop(request.sid, None)
    logger.info("Client disconnected: %s", request.sid)

@socketio.on("process_frame")
def on_process_frame(data):
    sid = request.sid
    now = time.time()

    last = _last_processed.get(sid, 0)
    if now - last < MIN_INTERVAL:
        return

    _last_processed[sid] = now

    image_b64 = data.get("image", "") if isinstance(data, dict) else ""
    if not image_b64:
        emit("gesture_data", {
            "steering": 0.0, "action": "none",
            "hand_detected": False, "confidence": 0.0,
            "palm_x": 0.5, "palm_y": 0.5,
        })
        return

    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    try:
        gesture = gesture_ctrl.process_frame(image_b64)
    except Exception as exc:
        logger.error("Gesture processing error: %s", exc, exc_info=True)
        gesture = {
            "steering": 0.0, "action": "none",
            "hand_detected": False, "confidence": 0.0,
            "palm_x": 0.5, "palm_y": 0.5,
        }

    emit("gesture_data", gesture)

if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("  Gesture Racing Game – Backend Server")
    logger.info("  http://localhost:5000")
    logger.info("=" * 60)
    socketio.run(app, host="0.0.0.0", port=5000, debug=False, allow_unsafe_werkzeug=True)