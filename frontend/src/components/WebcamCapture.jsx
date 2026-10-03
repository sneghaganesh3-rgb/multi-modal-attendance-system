import { useRef, useCallback, useState } from 'react';
import Webcam from 'react-webcam';
import { Camera, RefreshCcw } from 'lucide-react';

const WebcamCapture = ({ onCapture, title, instructions }) => {
  const webcamRef = useRef(null);
  const [imgSrc, setImgSrc] = useState(null);
  const [error, setError] = useState(null);

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current.getScreenshot();
    setImgSrc(imageSrc);
    if (onCapture) onCapture(imageSrc);
  }, [webcamRef, onCapture]);

  const retake = () => {
    setImgSrc(null);
    if (onCapture) onCapture(null);
  };

  return (
    <div className="flex flex-col items-center p-4 bg-slate-50 rounded-lg border border-slate-200">
      {title && <h3 className="font-semibold text-lg mb-2">{title}</h3>}
      {instructions && <p className="text-slate-500 text-sm mb-4 text-center max-w-sm">{instructions}</p>}
      
      {error ? (
        <div className="text-red-500 p-4 bg-red-50 rounded-lg">Camera Error: {error}</div>
      ) : imgSrc ? (
        <div className="relative rounded-lg overflow-hidden border-2 border-indigo-500">
          <img src={imgSrc} alt="Captured" className="w-[320px] h-[240px] object-cover" />
          <button
            onClick={retake}
            className="absolute bottom-4 right-4 bg-slate-800/70 hover:bg-slate-800 text-white p-2 rounded-full backdrop-blur-sm transition"
          >
            <RefreshCcw className="w-5 h-5" />
          </button>
        </div>
      ) : (
        <div className="relative rounded-lg overflow-hidden border-2 border-slate-300 bg-black">
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            videoConstraints={{ width: 320, height: 240, facingMode: "user" }}
            onUserMediaError={(err) => setError(err.message || 'Permission denied')}
            mirrored={true}
            className="w-[320px] h-[240px] object-cover"
          />
          <button
            onClick={capture}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 transition"
          >
            <Camera className="w-5 h-5" />
            <span>Capture</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default WebcamCapture;
