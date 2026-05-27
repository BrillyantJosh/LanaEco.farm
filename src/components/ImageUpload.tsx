import { useState, useRef } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { uploadImageWithThumb, generateEphemeralPrivateKey } from '@/lib/mediaUpload';

interface ImageUploadProps {
  /** Called with main + thumb URL after a successful upload. */
  onUpload: (url: string, thumbUrl?: string) => void;
  onUploadingChange?: (uploading: boolean) => void;
  currentUrl?: string;
  label?: string;
  /** Override the signing key (e.g. for anonymous /apply flow). */
  privateKeyHex?: string;
}

export function ImageUpload({ onUpload, onUploadingChange, currentUrl, label = 'Upload Image', privateKeyHex }: ImageUploadProps) {
  const { session } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentUrl || null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError(t('image.invalidType'));
      return;
    }

    setError(null);
    setInfo(null);
    setIsUploading(true);
    onUploadingChange?.(true);

    try {
      // Sign with: explicit override → session key → ephemeral fallback.
      const privKey = privateKeyHex
        || session?.nostrPrivateKey
        || generateEphemeralPrivateKey();

      const result = await uploadImageWithThumb(file, privKey);

      setPreview(result.thumbUrl); // small preview = fast load
      onUpload(result.url, result.thumbUrl);

      if (result.legacy) {
        setInfo(t('image.legacyFallback', 'Saved locally (media server unreachable)'));
      } else {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        setInfo(`${sizeMB} MB → media.lanaloves.us ✓`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      onUploadingChange?.(false);
    }
  };

  const handleRemove = () => {
    setPreview(null);
    onUpload('', '');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>

      {preview ? (
        <div className="relative inline-block">
          <img src={preview} alt="Preview" className="w-32 h-32 object-cover rounded-lg border dark:border-gray-600" />
          <button
            type="button"
            onClick={handleRemove}
            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => fileRef.current?.click()}
          className="w-32 h-32 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
        >
          {isUploading ? (
            <Loader2 className="w-6 h-6 text-gray-400 dark:text-gray-500 animate-spin" />
          ) : (
            <>
              <Upload className="w-6 h-6 text-gray-400 dark:text-gray-500" />
              <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('image.upload')}</span>
            </>
          )}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleUpload}
        className="hidden"
      />

      {info && <p className="text-xs text-green-600 dark:text-green-400">{info}</p>}
      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
    </div>
  );
}
