import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Max dimensions for web-optimized images
const MAX_WIDTH = 1200;
const MAX_HEIGHT = 1200;
const JPEG_QUALITY = 80;

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Use memory storage so we can process with sharp before saving
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: jpeg, png, webp, gif`));
    }
  }
});

export function createUploadsRouter(): Router {
  const router = Router();

  // Upload image with automatic resizing
  router.post('/', upload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

      // Validate magic bytes — must be real image regardless of MIME type
      const header = req.file.buffer.subarray(0, 12);
      const isJPEG = header[0] === 0xFF && header[1] === 0xD8;
      const isPNG = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
      const isGIF = header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46;
      const isWebP = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46
                  && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;
      if (!isJPEG && !isPNG && !isGIF && !isWebP) {
        res.status(400).json({ error: 'Invalid image file' });
        return;
      }

    try {
      const filename = `${uuidv4()}.jpg`;
      const outputPath = path.join(UPLOADS_DIR, filename);

      // Resize and convert to JPEG for web optimization
      const result = await sharp(req.file.buffer)
        .rotate() // auto-rotate based on EXIF
        .resize(MAX_WIDTH, MAX_HEIGHT, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toFile(outputPath);

      const publicUrl = `/api/uploads/${filename}`;
      res.json({
        filename,
        url: publicUrl,
        size: result.size,
        width: result.width,
        height: result.height,
        mimetype: 'image/jpeg'
      });
    } catch (err) {
      console.error('Image processing error:', err);
      res.status(500).json({ error: 'Failed to process image' });
    }
  });

  // Serve uploaded files publicly
  router.get('/:filename', (req: Request, res: Response) => {
    const { filename } = req.params;

    // Path traversal protection
    const safeName = path.basename(filename);
    const filePath = path.join(UPLOADS_DIR, safeName);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(filePath);
  });

  return router;
}
