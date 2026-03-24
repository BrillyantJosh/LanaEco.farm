import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, X, SwitchCamera } from 'lucide-react';

interface QrScannerProps {
  onScan: (value: string) => void;
  onClose: () => void;
}

export default function QrScanner({ onScan, onClose }: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [activeCameraIdx, setActiveCameraIdx] = useState(0);
  const isStartingRef = useRef(false);

  const startScanner = async (cameraId?: string) => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;
    setError(null);

    try {
      // Stop existing scanner if running
      if (scannerRef.current) {
        try {
          await scannerRef.current.stop();
        } catch {
          // ignore
        }
        scannerRef.current.clear();
        scannerRef.current = null;
      }

      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;

      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1,
      };

      if (cameraId) {
        await scanner.start(
          cameraId,
          config,
          (decodedText) => {
            onScan(decodedText);
            stopScanner();
          },
          () => {} // ignore errors during scanning
        );
      } else {
        // Use back camera by default (environment facing)
        await scanner.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => {
            onScan(decodedText);
            stopScanner();
          },
          () => {}
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setError('Camera permission denied. Please allow camera access and try again.');
      } else if (msg.includes('NotFound') || msg.includes('Requested device not found')) {
        setError('No camera found on this device.');
      } else {
        setError(`Camera error: ${msg}`);
      }
    } finally {
      isStartingRef.current = false;
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // ignore
      }
      try {
        scannerRef.current.clear();
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }
  };

  const switchCamera = async () => {
    if (cameras.length < 2) return;
    const nextIdx = (activeCameraIdx + 1) % cameras.length;
    setActiveCameraIdx(nextIdx);
    await startScanner(cameras[nextIdx].id);
  };

  useEffect(() => {
    // Get available cameras first
    Html5Qrcode.getCameras()
      .then((devices) => {
        if (devices.length > 0) {
          setCameras(devices);
          // Start with first camera (will try environment facing)
          startScanner();
        } else {
          setError('No camera found on this device.');
        }
      })
      .catch(() => {
        setError('Unable to access camera. Please check permissions.');
      });

    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h3 className="font-semibold text-gray-900 dark:text-white">Scan QR Code</h3>
          </div>
          <div className="flex items-center gap-2">
            {cameras.length > 1 && (
              <button
                onClick={switchCamera}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
                title="Switch camera"
              >
                <SwitchCamera className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => {
                stopScanner();
                onClose();
              }}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scanner viewport */}
        <div className="relative bg-black" ref={containerRef}>
          <div id="qr-reader" className="w-full" />
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="p-3 text-center text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700">
          Point your camera at a WIF QR code
        </div>
      </div>
    </div>
  );
}
