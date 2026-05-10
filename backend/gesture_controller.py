import base64
import logging
import time

import cv2
import numpy as np

try:
    import mediapipe as mp
    _hands_module = mp.solutions.hands
    _USE_LEGACY = True
except AttributeError:
    _USE_LEGACY = False

logger = logging.getLogger(__name__)

FINGERTIP_IDS = [4, 8, 12, 16, 20]
PIP_IDS       = [3, 6, 10, 14, 18]
PALM_ANCHORS  = [0, 5, 9, 13, 17]

class GestureController:

    SMOOTHING_ALPHA = 0.30
    DEAD_ZONE       = 0.08
    LEFT_THRESHOLD  = 0.40
    RIGHT_THRESHOLD = 0.60

    def __init__(self, max_num_hands: int = 1, detection_confidence: float = 0.65):
        self._smooth_steering = 0.0

        if _USE_LEGACY:
            self._hands = _hands_module.Hands(
                static_image_mode=False,
                max_num_hands=max_num_hands,
                min_detection_confidence=detection_confidence,
                min_tracking_confidence=0.5,
            )
            logger.info("GestureController: using mp.solutions.hands (legacy)")
        else:

            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision as mp_vision
            import urllib.request, os, tempfile

            model_url  = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
            model_path = os.path.join(tempfile.gettempdir(), "hand_landmarker.task")
            if not os.path.exists(model_path):
                logger.info("Downloading hand_landmarker model...")
                urllib.request.urlretrieve(model_url, model_path)

            base_opts = mp_python.BaseOptions(model_asset_path=model_path)
            opts = mp_vision.HandLandmarkerOptions(
                base_options=base_opts,
                running_mode=mp_vision.RunningMode.IMAGE,
                num_hands=max_num_hands,
                min_hand_detection_confidence=detection_confidence,
                min_hand_presence_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self._landmarker = mp_vision.HandLandmarker.create_from_options(opts)
            logger.info("GestureController: using HandLandmarker (Tasks API)")

    def process_frame(self, base64_image: str) -> dict:
        result = {
            "steering": 0.0,
            "action": "none",
            "hand_detected": False,
            "confidence": 0.0,
            "palm_x": 0.5,
            "palm_y": 0.5,
        }

        try:
            img_bytes = base64.b64decode(base64_image)
            img_arr   = np.frombuffer(img_bytes, dtype=np.uint8)
            frame     = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
            if frame is None:
                return result
        except Exception as exc:
            logger.warning("Frame decode error: %s", exc)
            return result

        frame_rgb = cv2.cvtColor(cv2.flip(frame, 1), cv2.COLOR_BGR2RGB)

        if _USE_LEGACY:
            landmarks, confidence = self._detect_legacy(frame_rgb)
        else:
            landmarks, confidence = self._detect_tasks(frame_rgb)

        if not landmarks:
            self._smooth_steering *= 0.85
            return result

        palm_x = float(np.mean([landmarks[i][0] for i in PALM_ANCHORS]))
        palm_y = float(np.mean([landmarks[i][1] for i in PALM_ANCHORS]))

        raw = self._palm_x_to_steering(palm_x)
        self._smooth_steering = (
            self.SMOOTHING_ALPHA * raw + (1 - self.SMOOTHING_ALPHA) * self._smooth_steering
        )
        steering = self._smooth_steering
        if abs(steering) < self.DEAD_ZONE:
            steering = 0.0
        steering = float(np.clip(steering, -1.0, 1.0))

        action = self._classify_gesture(landmarks)

        result.update(
            steering=steering, action=action,
            hand_detected=True, confidence=float(confidence),
            palm_x=palm_x, palm_y=palm_y,
        )
        return result

    def _detect_legacy(self, frame_rgb):
        mp_result = self._hands.process(frame_rgb)
        if not mp_result.multi_hand_landmarks:
            return None, 0.0
        lm = mp_result.multi_hand_landmarks[0].landmark
        landmarks = [(l.x, l.y) for l in lm]
        confidence = 1.0
        if mp_result.multi_handedness:
            confidence = mp_result.multi_handedness[0].classification[0].score
        return landmarks, confidence

    def _detect_tasks(self, frame_rgb):
        import mediapipe as mp
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
        mp_result = self._landmarker.detect(mp_image)
        if not mp_result.hand_landmarks:
            return None, 0.0
        lm = mp_result.hand_landmarks[0]
        landmarks = [(l.x, l.y) for l in lm]
        confidence = 1.0
        if mp_result.handedness:
            confidence = mp_result.handedness[0][0].score
        return landmarks, confidence

    def _palm_x_to_steering(self, palm_x: float) -> float:
        steering = (palm_x - 0.5) * 2.0
        if palm_x < self.LEFT_THRESHOLD:
            steering = -1.0 * (1.0 - palm_x / self.LEFT_THRESHOLD) - 0.2
        elif palm_x > self.RIGHT_THRESHOLD:
            steering = 1.0 * (palm_x - self.RIGHT_THRESHOLD) / (1 - self.RIGHT_THRESHOLD) + 0.2
        return float(np.clip(steering, -1.0, 1.0))

    def _classify_gesture(self, landmarks) -> str:
        extended = []
        for tip_id, pip_id in zip(FINGERTIP_IDS[1:], PIP_IDS[1:]):
            tip_y = landmarks[tip_id][1]
            pip_y = landmarks[pip_id][1]
            extended.append(tip_y < pip_y - 0.02)
        n = sum(extended)
        if n >= 3:  return "accelerate"
        if n <= 1:  return "brake"
        return "none"

    def release(self):
        if _USE_LEGACY:
            self._hands.close()
        logger.info("GestureController released")