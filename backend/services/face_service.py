"""
Face Recognition Service
Uses facenet-pytorch (InceptionResnetV1) to extract FaceNet embeddings.
"""

import numpy as np
import base64
import io
from PIL import Image

# Global models to avoid reloading
_mtcnn = None
_resnet = None

def _get_models():
    global _mtcnn, _resnet
    if _mtcnn is None:
        from facenet_pytorch import MTCNN, InceptionResnetV1
        # Initialize MTCNN for face detection
        _mtcnn = MTCNN(keep_all=True)
        # Initialize InceptionResnetV1 (FaceNet) for embeddings, using VGGFace2 pre-trained weights
        _resnet = InceptionResnetV1(pretrained='vggface2').eval()
    return _mtcnn, _resnet

def decode_image(image_bytes: bytes) -> Image.Image:
    """Decode a base64 image (data URL or raw base64) into a PIL RGB image."""
    try:
        if isinstance(image_bytes, str):
            image_bytes = image_bytes.encode("utf-8")
        if image_bytes.startswith(b"data:image"):
            # Strip the data URL header: "data:image/jpeg;base64,<data>"
            image_bytes = image_bytes.split(b",", 1)[1]
        decoded = base64.b64decode(image_bytes)
        image = Image.open(io.BytesIO(decoded)).convert("RGB")
        return image
    except Exception as e:
        raise ValueError(f"Invalid image format: {e}")

MAX_FACE_TEMPLATES = 6    # per student (enrolled + adaptive)
MIN_FACE_PX = 80          # enrollment: face must be at least this wide
MIN_FACE_PROB = 0.90      # enrollment: detector confidence


def encode_face(image_bytes, enforce_quality: bool = False) -> dict:
    """
    Detect a face and extract its 512-dimensional embedding using FaceNet.
    enforce_quality=True (enrollment) rejects small / low-confidence faces.
    """
    return encode_face_image(decode_image(image_bytes), enforce_quality)


def encode_face_image(image: Image.Image, enforce_quality: bool = False) -> dict:
    mtcnn, resnet = _get_models()

    try:
        # Detect face boxes and probabilities
        boxes, probs = mtcnn.detect(image)
        if boxes is None or len(boxes) == 0:
            raise ValueError("No face detected in the image.")

        if len(boxes) > 1:
            raise ValueError(f"Multiple faces detected ({len(boxes)}). Please ensure only one person is in the frame.")

        quality_score = float(probs[0])
        width = float(boxes[0][2] - boxes[0][0])
        if enforce_quality:
            if width < MIN_FACE_PX:
                raise ValueError("Face is too small or too far away. Move closer to the camera.")
            if quality_score < MIN_FACE_PROB:
                raise ValueError("Face is not clear enough. Face the camera directly in good lighting.")

        # Extract face crop as tensor
        face_crop = mtcnn(image)
        if face_crop is None:
            raise ValueError("Could not crop face.")

        import torch
        with torch.no_grad():
            # face_crop is (N, 3, 160, 160), resnet returns (N, 512)
            embedding = resnet(face_crop).squeeze().tolist()

        return {"embedding": embedding, "quality_score": quality_score, "face_width": width}
    except ValueError as ve:
        raise ve
    except Exception as e:
        raise ValueError(f"Face extraction failed: {str(e)}")


def embedding_similarity(a, b) -> float:
    """Same 0-1 score scale as compare_faces, without the match decision."""
    return max(0.0, 1.0 - float(np.linalg.norm(np.asarray(a) - np.asarray(b))) / 2.0)


def compare_faces(stored_embedding: list, live_embedding: list, threshold: float) -> dict:
    """
    Compare two FaceNet embeddings using Euclidean distance.
    """
    try:
        stored = np.array(stored_embedding)
        live = np.array(live_embedding)
        
        # Calculate Euclidean distance
        distance = float(np.linalg.norm(stored - live))
        
        # For FaceNet (VGGFace2), identical faces have distance < 1.0 (often 0.4-0.8)
        # Different faces have distance > 1.0 (often 1.2-1.5)
        # Map distance to score: score = max(0, 1.0 - (distance / 2.0))
        # Distance 0.0 -> Score 1.0
        # Distance 1.0 -> Score 0.50
        # Distance 2.0 -> Score 0.0
        score = max(0.0, 1.0 - (distance / 2.0))
        match = score >= threshold
        
        return {"match": bool(match), "score": round(score, 4), "distance": round(distance, 4)}
    except Exception as e:
        return {"match": False, "score": 0.0, "distance": 1.0}

def get_best_match(live_embedding: list, all_embeddings: list, threshold: float = 0.50) -> dict:
    """
    Find the best-matching student from a list of enrolled embeddings.
    """
    best = {"student_id": None, "score": 0.0, "match": False}
    
    for entry in all_embeddings:
        result = compare_faces(entry["embedding"], live_embedding, threshold)
        if result["score"] > best["score"]:
            best["score"] = result["score"]
            best["student_id"] = entry["student_id"]
            best["match"] = result["match"]
            
    return best

def check_duplicate_face(new_embedding: list, all_embeddings: list, duplicate_threshold: float = 0.85) -> dict:
    """
    Check if a newly captured face is already enrolled under a different student.
    Uses a stricter threshold (0.85) than normal matching to catch near-identical faces.

    Returns:
        dict: {is_duplicate: bool, existing_student_id: int|None, score: float}
    """
    best_score = 0.0
    existing_id = None

    for entry in all_embeddings:
        result = compare_faces(entry["embedding"], new_embedding, duplicate_threshold)
        if result["score"] > best_score:
            best_score = result["score"]
            if result["match"]:
                existing_id = entry["student_id"]

    return {
        "is_duplicate": existing_id is not None,
        "existing_student_id": existing_id,
        "score": round(best_score, 4)
    }


# ─── Fast 1:N search over every stored template ─────────────────────────────

import json
import threading


class FaceIndex:
    """
    All face templates as one float32 matrix, so a 1:N search is a single
    vectorized distance computation instead of a Python loop with JSON parsing.
    A student may own several templates; the student's score is the best one.
    The matrix is rebuilt automatically when the stored data changes.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._sig = None
        self._mat = np.zeros((0, 512), dtype=np.float32)
        self._owner = np.zeros((0,), dtype=np.int64)

    @staticmethod
    def _signature(db):
        from sqlalchemy import func
        from database.models import FaceTemplate, Student
        t = db.query(func.count(FaceTemplate.id), func.coalesce(func.max(FaceTemplate.id), 0),
                     func.coalesce(func.sum(FaceTemplate.id), 0)).one()
        s = db.query(func.count(Student.id), func.coalesce(func.sum(Student.id), 0)).filter(Student.is_active == True).one()
        return tuple(t) + tuple(s)

    def _refresh(self, db):
        sig = self._signature(db)
        if sig == self._sig:
            return
        from database.models import FaceTemplate, Student
        rows = (db.query(FaceTemplate.student_id, FaceTemplate.embedding)
                .join(Student, Student.id == FaceTemplate.student_id)
                .filter(Student.is_active == True).all())
        vecs, owners = [], []
        for sid, emb in rows:
            try:
                v = np.asarray(json.loads(emb), dtype=np.float32)
            except Exception:
                continue
            if v.shape == (512,):
                vecs.append(v)
                owners.append(sid)
        with self._lock:
            self._mat = np.vstack(vecs) if vecs else np.zeros((0, 512), dtype=np.float32)
            self._owner = np.asarray(owners, dtype=np.int64)
            self._sig = sig

    def scores(self, db, live_embedding, exclude_student: int = None) -> dict:
        """{student_id: best 0-1 similarity over that student's templates}"""
        self._refresh(db)
        with self._lock:
            mat, owner = self._mat, self._owner
        if len(owner) == 0:
            return {}
        dist = np.linalg.norm(mat - np.asarray(live_embedding, dtype=np.float32), axis=1)
        sim = np.maximum(0.0, 1.0 - dist / 2.0)
        best = {}
        for sid, sc in zip(owner.tolist(), sim.tolist()):
            if sid == exclude_student:
                continue
            if sc > best.get(sid, -1.0):
                best[sid] = sc
        return best


face_index = FaceIndex()
