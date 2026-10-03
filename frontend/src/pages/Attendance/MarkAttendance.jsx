import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import {
  Camera,
  Hand,
  Fingerprint,
  CheckCircle,
  XCircle,
  ChevronRight,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import client from "../../api/client";
import { useFingerprintSupport, scanFingerprint } from "../../utils/webauthn";
import SmartWebcamCapture from "../../components/SmartWebcamCapture";

const MarkAttendance = () => {
  const [step, setStep] = useState(1);
  const [faceImg, setFaceImg] = useState(null);
  const [faceBurst, setFaceBurst] = useState(null); // { frames, token } for server-side liveness
  const [palmImg, setPalmImg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const hasFingerprint = useFingerprintSupport(); // null=checking
  const [sessions, setSessions] = useState([]); // open attendance sessions
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    client
      .get("/sessions/open")
      .then((res) => {
        setSessions(res.data);
        if (res.data.length === 1) setSessionId(String(res.data[0].id));
      })
      .catch(() => {});
  }, []);

  const handleCaptureFace = (img, burst) => {
    setFaceImg(img);
    setFaceBurst(img ? burst || null : null);
  };

  const handleCapturePalm = (img) => {
    setPalmImg(img);
  };

  const handleScanFingerprint = async () => {
    try {
      setLoading(true);
      const assertion = await scanFingerprint();
      if (!assertion) {
        toast("No fingerprints are enrolled yet. Using Face/Palm only.", { icon: "⚠️" });
      }
      await verifyAll(assertion);
    } catch (err) {
      if (err.name === "NotAllowedError") {
        toast.error("Fingerprint scan cancelled or not allowed.");
      } else {
        toast.error(err.response?.data?.detail || "Could not scan fingerprint.");
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyAll = async (fingerprint) => {
    setLoading(true);
    try {
      const res = await client.post("/attendance/verify/multimodal", {
        face_frames: faceBurst?.frames || null,
        liveness_token: faceBurst?.token || null,
        palm_image: palmImg,
        fingerprint: fingerprint || null,
        session_id: sessionId ? Number(sessionId) : null,
      });

      setResult(res.data);
      if (res.data.match) {
        toast.success(
          res.data.attendance_status === "late"
            ? `⏰ ${res.data.student_name} marked LATE`
            : `✅ Attendance marked for ${res.data.student_name}!`,
        );
      } else {
        toast.error("❌ Verification failed. Score below threshold.");
      }
      setStep(4);
    } catch (err) {
      toast.error(
        err.response?.data?.detail || "Verification error. Please try again.",
      );
      reset();
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep(1);
    setFaceImg(null);
    setFaceBurst(null);
    setPalmImg(null);
    setResult(null);
  };

  const stepLabels = ["Face", "Palm", "Fingerprint"];

  // Server reasons a modality was dropped, e.g. "Palm: No palm/hand detected..."
  const reasonFor = (name) =>
    (result?.warnings || [])
      .find((w) => w.toLowerCase().startsWith(name.toLowerCase() + ":"))
      ?.slice(name.length + 1)
      .trim();

  const getScoreBadge = (score, threshold, name) => {
    if (score === undefined || score === null) {
      const reason = name && reasonFor(name);
      if (reason) return { text: "Failed", color: "bg-amber-100 text-amber-800 border-amber-300", reason };
      return { text: "Not used", color: "bg-slate-100 text-slate-500" };
    }
    const pct = score * 100;
    if (pct >= threshold * 100) {
      return { text: `${pct.toFixed(1)}% (Matched)`, color: "bg-emerald-100 text-emerald-800 border-emerald-300" };
    }
    return { text: `${pct.toFixed(1)}% (Low)`, color: "bg-rose-100 text-rose-800 border-rose-300" };
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <h1 className="text-3xl font-extrabold text-slate-800 text-center tracking-tight">
        Mark Attendance
      </h1>

      {/* Step indicator */}
      {step <= 3 && (
        <div className="flex justify-center items-center gap-3 mb-6">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={`flex items-center justify-center w-10 h-10 rounded-full font-bold text-sm transition-all ${
                    step > s
                      ? "bg-emerald-500 text-white"
                      : step === s
                        ? "bg-indigo-600 text-white ring-4 ring-indigo-100 shadow-md"
                        : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {step > s ? "✓" : s}
                </div>
                <span
                  className={`text-xs mt-1.5 font-semibold ${
                    step === s ? "text-indigo-600" : "text-slate-400"
                  }`}
                >
                  {stepLabels[s - 1]}
                </span>
              </div>
              {s < 3 && (
                <div
                  className={`w-14 h-1 rounded ${
                    step > s ? "bg-emerald-500" : "bg-slate-200"
                  } mb-3`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-8">
        {/* Session picker */}
        {step <= 3 && (
          <div className="mb-6">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
              Attendance session
            </label>
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">{sessions.length ? "No session (whole-day attendance)" : "No open session"}</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} (until {new Date(s.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Step 1: Face */}
        {step === 1 && (
          <div className="space-y-5 flex flex-col items-center">
            <div className="text-center">
              <Camera className="w-10 h-10 text-indigo-500 mx-auto mb-2" />
              <h2 className="text-xl font-bold text-slate-800">
                Step 1: Face Recognition
              </h2>
              <p className="text-slate-500 text-sm mt-1">
                Look at the camera and press Start. Follow the on-screen instruction (blink, then turn your head) — the server checks you are a live person.
              </p>
            </div>
            <SmartWebcamCapture
              title=""
              mode="face"
              burst
              onCapture={handleCaptureFace}
            />
            {faceImg && (
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setStep(2)}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-3 rounded-xl shadow-lg transition"
                >
                  Continue to Palm <ChevronRight className="w-5 h-5" />
                </button>
                <button
                  onClick={() => verifyAll(null)}
                  disabled={loading}
                  className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 text-white font-semibold px-6 py-3 rounded-xl shadow transition text-sm disabled:opacity-50"
                >
                  Verify Face Only
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Palm */}
        {step === 2 && (
          <div className="space-y-5 flex flex-col items-center">
            <div className="text-center">
              <Hand className="w-10 h-10 text-indigo-500 mx-auto mb-2" />
              <h2 className="text-xl font-bold text-slate-800">
                Step 2: Palm Print Biometrics
              </h2>
              <p className="text-slate-500 text-sm mt-1">
                Hold your open palm flat and steady in front of the camera for 2 seconds.
              </p>
            </div>
            <SmartWebcamCapture
              title=""
              mode="palm"
              onCapture={handleCapturePalm}
            />
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              {palmImg && (
                <>
                  <button
                    onClick={() => verifyAll(null)}
                    disabled={loading}
                    className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-8 py-3 rounded-xl shadow-lg transition disabled:opacity-50 text-base"
                  >
                    {loading ? "Verifying..." : "Verify Attendance (Face + Palm)"}
                  </button>
                  <button
                    onClick={() => setStep(3)}
                    disabled={loading}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl shadow transition disabled:opacity-50 text-sm"
                  >
                    Add Fingerprint <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
              <button
                onClick={() => setStep(3)}
                disabled={loading}
                className="text-slate-400 hover:text-slate-600 underline text-sm px-4 py-3"
              >
                Skip Palm
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Fingerprint */}
        {step === 3 && (
          <div className="flex flex-col items-center space-y-6 text-center py-6">
            <Fingerprint className="w-20 h-20 text-indigo-500" />
            <h2 className="text-2xl font-bold text-slate-800">
              Step 3: Fingerprint (Optional)
            </h2>
            <p className="text-slate-500 max-w-sm">
              Scan your finger on this device's built-in fingerprint sensor (Windows Hello / Touch ID).
            </p>
            {hasFingerprint === null && (
              <p className="text-slate-500">Checking system fingerprint reader...</p>
            )}
            {hasFingerprint === false && (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl text-sm font-medium">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                No fingerprint reader found on this system.
              </div>
            )}
            {hasFingerprint === true && (
              <button
                onClick={handleScanFingerprint}
                disabled={loading}
                className="flex items-center gap-3 px-10 py-4 bg-indigo-600 text-white text-lg font-bold rounded-2xl hover:bg-indigo-700 shadow-xl disabled:opacity-50 transition"
              >
                <Fingerprint className="w-6 h-6" />
                {loading ? "Verifying..." : "Scan & Verify Fingerprint"}
              </button>
            )}
            <button
              onClick={() => verifyAll(null)}
              disabled={loading}
              className={hasFingerprint === false
                ? "px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50"
                : "text-slate-500 hover:text-slate-800 underline text-sm"}
            >
              {hasFingerprint === false ? "Continue Without Fingerprint" : "Skip Fingerprint (Use Face/Palm Only)"}
            </button>
          </div>
        )}

        {/* Step 4: Comprehensive Clear View Result */}
        {step === 4 && result && (
          <div className="space-y-6 text-center py-2">
            {/* Main Status Banner */}
            <div
              className={`p-6 rounded-2xl border text-center transition-all ${
                result.match
                  ? "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                  : "bg-rose-50/80 border-rose-200 text-rose-950"
              }`}
            >
              <div className="flex justify-center mb-3">
                {result.match ? (
                  <CheckCircle className="w-20 h-20 text-emerald-600" />
                ) : (
                  <XCircle className="w-20 h-20 text-rose-600" />
                )}
              </div>
              <h2
                className={`text-3xl font-black tracking-wide ${
                  result.match ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {result.match
                  ? result.attendance_status === "late"
                    ? "VERIFIED — MARKED LATE"
                    : result.already_marked_today
                      ? "VERIFIED — ALREADY MARKED"
                      : "VERIFIED — ATTENDANCE MARKED"
                  : "ACCESS DENIED"}
              </h2>
              <p className="mt-2 text-xl font-bold text-slate-800">
                {result.student_name ? result.student_name : "Unrecognized Identity"}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-600 max-w-md mx-auto">
                {result.fusion_result?.message ||
                  result.message ||
                  (result.match
                    ? "Identity successfully authenticated."
                    : "Biometric match score was below threshold.")}
              </p>
            </div>

            {result.spoof_suspected && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 text-sm font-semibold rounded-xl px-4 py-3">
                Possible spoof attempt: the live-person check failed, so face data was not accepted.
              </div>
            )}
            {result.ambiguous && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm font-semibold rounded-xl px-4 py-3">
                More than one person matched closely. Add palm or fingerprint to confirm identity.
              </div>
            )}
            {result.liveness?.live && (
              <p className="text-xs font-semibold text-emerald-700">
                Liveness confirmed ({Math.round((result.liveness.score || 0) * 100)}%)
                {result.adaptive_template_added ? " · face profile updated" : ""}
              </p>
            )}

            {/* Clear Multi-Modal Metrics Breakdown */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 text-left space-y-4">
              <div className="flex justify-between items-center border-b border-slate-200 pb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Biometric Factor
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Score & Status
                </span>
              </div>

              {/* Face Metric */}
              {(() => {
                const fScore = result.fusion_result?.individual_scores?.face;
                const badge = getScoreBadge(fScore, 0.50, "Face");
                return (
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-semibold text-slate-700 flex items-center gap-2">
                        <Camera className="w-4 h-4 text-indigo-500" /> Face Recognition
                      </span>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${badge.color}`}>
                        {badge.text}
                      </span>
                    </div>
                    {badge.reason && <p className="text-xs text-amber-700">{badge.reason}</p>}
                    {fScore !== undefined && fScore !== null && (
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            fScore >= 0.50 ? "bg-emerald-500" : "bg-rose-500"
                          }`}
                          style={{ width: `${Math.min(100, fScore * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Palm Metric */}
              {(() => {
                const pScore = result.fusion_result?.individual_scores?.palm;
                const badge = getScoreBadge(pScore, 0.55, "Palm");
                return (
                  <div className="space-y-1.5 pt-2">
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-semibold text-slate-700 flex items-center gap-2">
                        <Hand className="w-4 h-4 text-indigo-500" /> Palm Print Biometrics
                      </span>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${badge.color}`}>
                        {badge.text}
                      </span>
                    </div>
                    {badge.reason && <p className="text-xs text-amber-700">{badge.reason}</p>}
                    {pScore !== undefined && pScore !== null && (
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            pScore >= 0.55 ? "bg-emerald-500" : "bg-rose-500"
                          }`}
                          style={{ width: `${Math.min(100, pScore * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Fingerprint Metric */}
              <div className="flex justify-between items-center text-sm pt-2">
                <span className="font-semibold text-slate-700 flex items-center gap-2">
                  <Fingerprint className="w-4 h-4 text-indigo-500" /> Fingerprint (Touch ID)
                </span>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                  {result.fusion_result?.individual_scores?.fingerprint !== undefined &&
                  result.fusion_result?.individual_scores?.fingerprint !== null
                    ? "Valid ✓"
                    : reasonFor("Fingerprint")
                      ? "Failed"
                      : "Not used"}
                </span>
              </div>
              {reasonFor("Fingerprint") && (
                <p className="text-xs text-amber-700">{reasonFor("Fingerprint")}</p>
              )}

              {/* Overall Multi-Modal Fusion Score */}
              <div className="border-t border-slate-200 pt-4 mt-2 flex justify-between items-center">
                <div>
                  <span className="text-base font-extrabold text-slate-800">
                    Weighted Fusion Score
                  </span>
                  <p className="text-xs text-slate-500">
                    Required threshold:{" "}
                    <span className="font-bold text-slate-700">
                      {((result.fusion_result?.threshold || 0.55) * 100).toFixed(0)}%
                    </span>
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`text-2xl font-black ${
                      result.match ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {((result.fusion_result?.fusion_score || 0) * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Diagnostic Advice if Access Denied */}
            {!result.match && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left text-sm text-amber-900 space-y-2">
                <div className="font-bold flex items-center gap-2 text-amber-800">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  Tips to Successfully Mark Attendance:
                </div>
                <ul className="text-xs text-amber-800/90 space-y-1 list-disc list-inside">
                  <li>
                    <strong>Face:</strong> Ensure your face is centered and illuminated. Avoid strong backlighting or tilting your head.
                  </li>
                  <li>
                    <strong>Palm:</strong> Hold your hand completely flat facing the lens until the progress bar reaches 100%.
                  </li>
                  <li>
                    <strong>Student Match:</strong> Make sure you are enrolling biometrics under the correct student profile.
                  </li>
                </ul>
              </div>
            )}

            {/* Bottom Action Buttons */}
            <div className="pt-4 flex justify-center gap-4">
              <button
                onClick={reset}
                className="flex items-center gap-2 px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg transition"
              >
                <RotateCcw className="w-4 h-4" />
                {result.match ? "Mark Another Attendance" : "Try Again"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkAttendance;
