import { useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import SmartWebcamCapture from './SmartWebcamCapture';

const FACE_PROMPTS = [
  'Look straight at the camera.',
  'Turn your head slightly to the LEFT.',
  'Turn your head slightly to the RIGHT.',
];
const PALM_PROMPTS = [
  'Hold your open palm flat and steady.',
  'Again — same hand, flat and steady.',
  'One more time — same hand.',
];

/**
 * Captures several shots in a row with the smart camera (models load once) and
 * calls onComplete(images[]) when done. Several samples let the server store
 * more than one face template / average the palm, which cuts false rejects.
 * Remount with a new `key` to start over.
 */
const MultiShotCapture = ({ mode = 'face', shots = 3, onComplete }) => {
  const prompts = mode === 'face' ? FACE_PROMPTS : PALM_PROMPTS;
  const imagesRef = useRef([]);
  const [count, setCount] = useState(0);
  const [reset, setReset] = useState(0);

  const handleCapture = (img) => {
    if (!img) return; // retake notification
    imagesRef.current = [...imagesRef.current, img];
    const n = imagesRef.current.length;
    setCount(n);
    if (n >= shots) {
      onComplete(imagesRef.current);
    } else {
      setTimeout(() => setReset((r) => r + 1), 700);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        {Array.from({ length: shots }).map((_, i) => (
          <div
            key={i}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
              i < count
                ? 'bg-emerald-500 border-emerald-500 text-white'
                : i === count
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-slate-300 text-slate-400'
            }`}
          >
            {i < count ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
          </div>
        ))}
      </div>
      <p className="text-sm font-semibold text-slate-700">
        {count < shots ? `Shot ${count + 1} of ${shots}: ${prompts[count] || prompts[0]}` : 'All shots captured'}
      </p>
      <SmartWebcamCapture mode={mode} title="" onCapture={handleCapture} resetSignal={reset} />
    </div>
  );
};

export default MultiShotCapture;
