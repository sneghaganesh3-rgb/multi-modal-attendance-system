import React, { useRef, useCallback, useState, useEffect } from "react";
import Webcam from "react-webcam";
import {
  Camera,
  RefreshCcw,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Hand,
} from "lucide-react";
import client from "../api/client";
import {
  FaceDetector,
  FaceLandmarker,
  HandLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

/**
 * SmartWebcamCapture — AI camera with Face-ID overlay + Liveness Detection.
 *
 * Face mode:
 *   1. FaceDetector draws green bounding brackets.
 *   2. FaceLandmarker computes Eye Aspect Ratio (EAR).
 *   3. When EAR < BLINK_THRESH → blink counted.
 *   4. Capture unlocks only after ≥1 blink (anti-spoofing).
 *
 * Palm mode:
 *   1. HandLandmarker draws blue bounding brackets.
 *   2. User must hold palm steady for HOLD_SECONDS (progress bar).
 *   3. Capture unlocks when hold timer completes.
 *
 * Burst mode (face, `burst` prop): the server decides liveness. Pressing Capture
 * fetches a one-time challenge (blink + turn head left/right), records a short
 * burst of frames and passes them to onCapture(bestFrame, { frames, token }).
 * The client-side blink gate is skipped; the server verifies the real thing.
 *
 * Canvas coordinate system:
 *   - Canvas is NOT CSS-flipped. Before drawing, ctx is flipped in JS
 *     (ctx.translate + ctx.scale(-1,1)) so boxes match the mirrored video.
 */

const BLINK_EAR_THRESH = 0.2; // EAR below this = eyes closing
const HOLD_SECONDS = 2; // Palm hold duration for liveness
const BURST_FRAMES = 20; // frames recorded for server-side liveness
const BURST_INTERVAL_MS = 120; // ~2.4 s total: enough to catch a blink

// ─── EAR helper ─────────────────────────────────────────────────────────────
function eyeAspectRatio(landmarks, indices) {
  // indices: [p1, p2, p3, p4, p5, p6] from MediaPipe face landmark ids
  const [p1, p2, p3, p4, p5, p6] = indices.map((i) => landmarks[i]);
  const A = Math.hypot(p2.x - p6.x, p2.y - p6.y);
  const B = Math.hypot(p3.x - p5.x, p3.y - p5.y);
  const C = Math.hypot(p1.x - p4.x, p1.y - p4.y);
  return (A + B) / (2.0 * C + 1e-6);
}

// MediaPipe face mesh eye landmark indices
const LEFT_EYE = [362, 385, 387, 263, 373, 380];
const RIGHT_EYE = [33, 160, 158, 133, 153, 144];

// ─── Component ───────────────────────────────────────────────────────────────
const SmartWebcamCapture = ({
  onCapture,
  title,
  instructions,
  mode = "face",
  burst = false, // face: record a liveness burst verified by the server
  resetSignal = 0, // increment to clear the captured image (multi-shot flows)
}) => {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const detectorRef = useRef(null); // FaceDetector or HandLandmarker
  const landmarkerRef = useRef(null); // FaceLandmarker (for EAR, face mode only)
  const requestRef = useRef(null);
  const lastTimeRef = useRef(-1);

  // Liveness state
  const blinkCountRef = useRef(0);
  const eyeOpenRef = useRef(true); // debounce blinks
  const palmHoldRef = useRef(null); // timestamp when hold started
  const palmProgressRef = useRef(0); // 0-100

  const [imgSrc, setImgSrc] = useState(null);
  const [error, setError] = useState(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isDetected, setIsDetected] = useState(false); // face/palm present
  const [blinkCount, setBlinkCount] = useState(0);
  const [palmProgress, setPalmProgress] = useState(0); // 0-100
  const [livenessOk, setLivenessOk] = useState(false); // blink done / hold done
  const [recording, setRecording] = useState(false); // burst in progress
  const [burstProgress, setBurstProgress] = useState(0);
  const [challenge, setChallenge] = useState(null);

  // In burst mode the server verifies liveness, so no client-side blink gate.
  const clientLiveness = !(burst && mode === "face");
  const liveReady = livenessOk || !clientLiveness;

  // ─── Load models ────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
        );

        if (mode === "face") {
          // FaceDetector for bounding box
          detectorRef.current = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
              delegate: "CPU",
            },
            runningMode: "VIDEO",
            minDetectionConfidence: 0.4,
          });

          // FaceLandmarker for EAR (blink detection)
          landmarkerRef.current = await FaceLandmarker.createFromOptions(
            vision,
            {
              baseOptions: {
                modelAssetPath:
                  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "CPU",
              },
              runningMode: "VIDEO",
              numFaces: 1,
              outputFaceBlendshapes: false,
            },
          );
        } else if (mode === "palm") {
          detectorRef.current = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
              delegate: "CPU",
            },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.4,
            minHandPresenceConfidence: 0.4,
          });
        }

        if (active) setIsModelLoaded(true);
      } catch (err) {
        console.error("AI model load failed:", err);
        if (active) {
          setIsModelLoaded(true);
          setLivenessOk(true);
        } // graceful fallback
      }
    }
    load();
    return () => {
      active = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      try {
        detectorRef.current?.close();
      } catch {}
      try {
        landmarkerRef.current?.close();
      } catch {}
    };
  }, [mode]);

  // ─── Drawing helper (JS-flipped to match mirrored webcam) ───────────────
  const drawBrackets = useCallback((ctx, x1, y1, x2, y2, color) => {
    const cw = ctx.canvas.width;
    const len = Math.min(x2 - x1, y2 - y1) * 0.18;
    ctx.save();
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, cw * 0.005);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1 + len);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 + len, y1);
    ctx.moveTo(x2 - len, y1);
    ctx.lineTo(x2, y1);
    ctx.lineTo(x2, y1 + len);
    ctx.moveTo(x2, y2 - len);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - len, y2);
    ctx.moveTo(x1 + len, y2);
    ctx.lineTo(x1, y2);
    ctx.lineTo(x1, y2 - len);
    ctx.stroke();
    const [r, g, b] =
      color === "rgb(34,197,94)" ? [34, 197, 94] : [59, 130, 246];
    ctx.fillStyle = `rgba(${r},${g},${b},0.08)`;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.restore();
  }, []);

  // ─── Detection loop ──────────────────────────────────────────────────────
  const detectFrame = useCallback(() => {
    const video = webcamRef.current?.video;
    if (!video || video.readyState !== 4 || !detectorRef.current) {
      requestRef.current = requestAnimationFrame(detectFrame);
      return;
    }

    if (video.currentTime === lastTimeRef.current) {
      requestRef.current = requestAnimationFrame(detectFrame);
      return;
    }
    lastTimeRef.current = video.currentTime;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Match canvas to native video resolution (enables CSS object-fit scaling)
    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let detected = false;
    const tsMs = performance.now();

    try {
      if (mode === "face") {
        // ── Bounding box ────────────────────────────────────────────────
        const det = detectorRef.current.detectForVideo(video, tsMs);
        if (det.detections?.length > 0) {
          detected = true;
          const b = det.detections[0].boundingBox;
          const pad = b.width * 0.14;
          drawBrackets(
            ctx,
            b.originX - pad,
            b.originY - pad * 1.8,
            b.originX + b.width + pad,
            b.originY + b.height + pad,
            "rgb(34,197,94)",
          );
        }

        // ── Blink / liveness ────────────────────────────────────────────
        if (landmarkerRef.current && blinkCountRef.current < 1) {
          const lm = landmarkerRef.current.detectForVideo(video, tsMs);
          if (lm.faceLandmarks?.length > 0) {
            const pts = lm.faceLandmarks[0];
            const earL = eyeAspectRatio(pts, LEFT_EYE);
            const earR = eyeAspectRatio(pts, RIGHT_EYE);
            const ear = (earL + earR) / 2;

            if (ear < BLINK_EAR_THRESH && eyeOpenRef.current) {
              // Eyes just closed → blink event
              eyeOpenRef.current = false;
              blinkCountRef.current += 1;
              setBlinkCount(blinkCountRef.current);
              if (blinkCountRef.current >= 1) setLivenessOk(true);
            } else if (ear >= BLINK_EAR_THRESH) {
              eyeOpenRef.current = true; // eyes open again
            }
          }
        }
      } else if (mode === "palm") {
        // ── Palm bounding box ───────────────────────────────────────────
        const res = detectorRef.current.detectForVideo(video, tsMs);
        if (res.landmarks?.length > 0) {
          detected = true;
          const lms = res.landmarks[0];
          let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
          lms.forEach((lm) => {
            const x = lm.x * canvas.width;
            const y = lm.y * canvas.height;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          });
          const pad = canvas.width * 0.03;
          drawBrackets(
            ctx,
            minX - pad,
            minY - pad,
            maxX + pad,
            maxY + pad,
            "rgb(59,130,246)",
          );

          // ── Palm hold liveness ─────────────────────────────────────────
          const now = performance.now();
          if (palmHoldRef.current === null) {
            palmHoldRef.current = now;
          }
          const elapsed = (now - palmHoldRef.current) / 1000;
          const pct = Math.min(100, (elapsed / HOLD_SECONDS) * 100);
          palmProgressRef.current = pct;
          setPalmProgress(Math.round(pct));
          if (pct >= 100 && !livenessOk) setLivenessOk(true);
        } else {
          // Hand disappeared — reset hold timer
          if (palmHoldRef.current !== null) {
            palmHoldRef.current = null;
            setPalmProgress(0);
          }
        }
      }
    } catch {
      /* ignore single-frame errors */
    }

    setIsDetected((prev) => (prev !== detected ? detected : prev));
    requestRef.current = requestAnimationFrame(detectFrame);
  }, [mode, drawBrackets, livenessOk]);

  useEffect(() => {
    if (isModelLoaded && !imgSrc) {
      requestRef.current = requestAnimationFrame(detectFrame);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isModelLoaded, imgSrc, detectFrame]);

  // ─── Capture ─────────────────────────────────────────────────────────────
  const startBurst = useCallback(async () => {
    setRecording(true);
    setBurstProgress(0);
    try {
      const { data: ch } = await client.get("/attendance/liveness-challenge");
      setChallenge(ch);
      const frames = [];
      for (let i = 0; i < BURST_FRAMES; i++) {
        const f = webcamRef.current?.getScreenshot({ width: 480, height: 360 });
        if (f) frames.push(f);
        setBurstProgress(Math.round(((i + 1) / BURST_FRAMES) * 100));
        await new Promise((r) => setTimeout(r, BURST_INTERVAL_MS));
      }
      if (frames.length < 6) throw new Error("Camera did not deliver enough frames");
      const preview = frames[Math.floor(frames.length / 2)];
      setImgSrc(preview);
      if (onCapture) onCapture(preview, { frames, token: ch.token, direction: ch.direction });
    } catch (e) {
      console.error("Liveness capture failed", e);
      setError(e.response?.data?.detail || e.message || "Could not record the liveness check");
    } finally {
      setRecording(false);
      setChallenge(null);
    }
  }, [onCapture]);

  const capture = useCallback(() => {
    if (burst && mode === "face") {
      startBurst();
      return;
    }
    const src = webcamRef.current.getScreenshot();

    console.log("📸 Captured image:", {
      mode,
      hasImage: !!src,
      imageLength: src?.length,
    });

    setImgSrc(src);

    if (onCapture) {
      onCapture(src);
    }
  }, [onCapture, mode, burst, startBurst]);
  const retake = () => {
    setImgSrc(null);
    setIsDetected(false);
    setLivenessOk(false);
    blinkCountRef.current = 0;
    eyeOpenRef.current = true;
    palmHoldRef.current = null;
    palmProgressRef.current = 0;
    setBlinkCount(0);
    setPalmProgress(0);
    setError(null);
    if (onCapture) onCapture(null);
  };

  useEffect(() => {
    if (resetSignal > 0) retake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  const canCapture = isDetected && liveReady && !recording;
  const borderColor = canCapture
    ? "border-green-500"
    : isDetected
      ? "border-amber-400"
      : "border-slate-300";

  return (
    <div className="flex flex-col items-center gap-3">
      {title && <h3 className="font-semibold text-lg">{title}</h3>}
      {instructions && (
        <p className="text-slate-500 text-sm text-center max-w-sm">
          {instructions}
        </p>
      )}

      {error ? (
        <div className="text-red-500 p-4 bg-red-50 rounded-xl font-medium w-full text-center">
          {error}
          <button onClick={retake} className="block mx-auto mt-2 text-sm underline text-red-600">
            Try again
          </button>
        </div>
      ) : imgSrc ? (
        /* ── Captured preview ─────────────────────────────────────────── */
        <div className="relative rounded-xl overflow-hidden shadow-lg border-4 border-indigo-500">
          <img
            src={imgSrc}
            alt="Captured"
            className="w-[480px] h-[360px] object-cover"
          />
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-green-500/90 text-white px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2 backdrop-blur">
            <CheckCircle2 className="w-4 h-4" /> Captured!
          </div>
          <button
            onClick={retake}
            className="absolute bottom-4 right-4 bg-slate-800/80 hover:bg-slate-900 text-white p-3 rounded-full backdrop-blur-sm shadow-lg transition"
          >
            <RefreshCcw className="w-5 h-5" />
          </button>
        </div>
      ) : (
        /* ── Live camera ──────────────────────────────────────────────── */
        <div
          className={`relative rounded-xl overflow-hidden shadow-lg border-4 ${borderColor} bg-black transition-colors duration-300`}
          style={{ width: 480, height: 360 }}
        >
          {/* Loading overlay */}
          {!isModelLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/85 z-30">
              <div className="w-9 h-9 border-4 border-indigo-400 border-t-transparent rounded-full animate-spin mb-3" />
              <span className="text-white font-medium text-sm">
                Loading AI Models…
              </span>
            </div>
          )}

          {/* Webcam (mirrored via prop) */}
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            screenshotQuality={0.85}
            videoConstraints={{ width: 640, height: 480, facingMode: "user" }}
            onUserMediaError={(err) =>
              setError(err.message || "Camera permission denied")
            }
            mirrored={true}
            className="absolute inset-0 w-full h-full object-cover z-0"
          />

          {/* AI overlay canvas (JS-flipped, NOT CSS-flipped) */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full z-10 pointer-events-none"
            style={{ objectFit: "cover" }}
          />

          {/* ── Status badge ─────────────────────────────────────────── */}
          {isModelLoaded && (
            <div
              className={`absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 z-20 backdrop-blur shadow transition-all ${
                canCapture
                  ? "bg-green-500/90 text-white"
                  : isDetected && mode === "face"
                    ? "bg-amber-400/90 text-slate-900"
                    : isDetected && mode === "palm"
                      ? "bg-blue-400/90 text-white"
                      : "bg-red-500/90 text-white"
              }`}
            >
              {recording ? (
                <>
                  <Eye className="w-3 h-3" /> Recording… follow the instruction
                </>
              ) : canCapture ? (
                <>
                  <CheckCircle2 className="w-3 h-3" /> Ready to capture!
                </>
              ) : !isDetected ? (
                <>
                  <AlertTriangle className="w-3 h-3" />{" "}
                  {mode === "face"
                    ? "No face — look at camera"
                    : "No palm — show your hand"}
                </>
              ) : mode === "face" ? (
                <>
                  <Eye className="w-3 h-3" /> Blink once to verify liveness…
                </>
              ) : (
                <>
                  <Hand className="w-3 h-3" /> Hold steady…
                </>
              )}
            </div>
          )}

          {/* ── Liveness indicators ─────────────────────────────────── */}
          {isModelLoaded && isDetected && !liveReady && (
            <div className="absolute bottom-16 left-4 right-4 z-20">
              {mode === "face" && (
                <div className="bg-slate-900/80 backdrop-blur rounded-xl px-4 py-3 flex items-center gap-3">
                  <Eye className="w-5 h-5 text-amber-400 shrink-0" />
                  <div className="flex-1">
                    <p className="text-white text-xs font-bold">
                      Anti-Spoofing Check
                    </p>
                    <p className="text-slate-300 text-xs">
                      Please blink once to confirm you're a real person
                    </p>
                  </div>
                  <div
                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-sm ${
                      blinkCount >= 1
                        ? "border-green-400 text-green-400"
                        : "border-amber-400 text-amber-400"
                    }`}
                  >
                    {blinkCount >= 1 ? "✓" : "0"}
                  </div>
                </div>
              )}
              {mode === "palm" && (
                <div className="bg-slate-900/80 backdrop-blur rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <Hand className="w-4 h-4 text-blue-400" />
                      <p className="text-white text-xs font-bold">
                        Liveness: Hold steady
                      </p>
                    </div>
                    <span className="text-blue-300 text-xs font-bold">
                      {palmProgress}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div
                      className="bg-blue-400 h-2 rounded-full transition-all duration-100"
                      style={{ width: `${palmProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Server liveness challenge ────────────────────────────── */}
          {recording && (
            <div className="absolute bottom-16 left-4 right-4 z-20">
              <div className="bg-slate-900/85 backdrop-blur rounded-xl px-4 py-3">
                <p className="text-white text-sm font-bold">
                  {challenge?.instruction || "Preparing liveness check…"}
                </p>
                <div className="w-full bg-slate-700 rounded-full h-2 mt-2">
                  <div
                    className="bg-green-400 h-2 rounded-full transition-all duration-100"
                    style={{ width: `${burstProgress}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Capture button ───────────────────────────────────────── */}
          <button
            onClick={capture}
            disabled={!canCapture}
            className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-7 py-3 rounded-full font-bold flex items-center gap-2.5 z-20 shadow-xl transition-all ${
              canCapture
                ? "bg-indigo-600 hover:bg-indigo-700 text-white scale-100 cursor-pointer"
                : "bg-slate-600 text-slate-400 scale-95 cursor-not-allowed opacity-60"
            }`}
          >
            <Camera className="w-5 h-5" />
            {recording ? "Recording…" : burst && mode === "face" ? "Start liveness check" : "Capture"}
          </button>
        </div>
      )}
    </div>
  );
};

export default SmartWebcamCapture;
