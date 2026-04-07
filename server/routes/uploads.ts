import { Router, Request, Response, NextFunction } from 'express';
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

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB (reduced from 10MB — phones send large files)

// Optimized for web display — smaller images load faster
const MAX_WIDTH = 800;
const MAX_HEIGHT = 800;
const JPEG_QUALITY = 70; // reduced from 80 — good balance of quality vs size

// Thumbnail for cards/previews
const THUMB_WIDTH = 400;
const THUMB_HEIGHT = 400;
const THUMB_QUALITY = 60;

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Use disk storage to avoid RAM pressure with multiple concurrent uploads
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, _file, cb) => {
    cb(null, `tmp_${uuidv4()}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: jpeg, png, webp, gif`));
    }
  }
});

export function createUploadsRouter(): Router {
  const router = Router();

  // Upload image with automatic resizing + thumbnail generation
  router.post('/', (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: any) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'File too large. Maximum size is 5MB.' });
          return;
        }
        res.status(400).json({ error: err.message || 'Upload failed' });
        return;
      }
      next();
    });
  }, async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const tmpPath = req.file.path;

    try {
      // Validate magic bytes from disk
      const fd = fs.openSync(tmpPath, 'r');
      const header = Buffer.alloc(12);
      fs.readSync(fd, header, 0, 12, 0);
      fs.closeSync(fd);

      const isJPEG = header[0] === 0xFF && header[1] === 0xD8;
      const isPNG = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
      const isGIF = header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46;
      const isWebP = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46
                  && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;

      if (!isJPEG && !isPNG && !isGIF && !isWebP) {
        fs.unlinkSync(tmpPath);
        res.status(400).json({ error: 'Invalid image file' });
        return;
      }

      const id = uuidv4();
      const filename = `${id}.jpg`;
      const thumbFilename = `${id}_thumb.jpg`;
      const outputPath = path.join(UPLOADS_DIR, filename);
      const thumbPath = path.join(UPLOADS_DIR, thumbFilename);

      // Process main image — optimized for web
      const result = await sharp(tmpPath)
        .rotate() // auto-rotate based on EXIF
        .resize(MAX_WIDTH, MAX_HEIGHT, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toFile(outputPath);

      // Generate thumbnail for cards/previews
      await sharp(tmpPath)
        .rotate()
        .resize(THUMB_WIDTH, THUMB_HEIGHT, {
          fit: 'cover',
          position: 'centre'
        })
        .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
        .toFile(thumbPath);

      // Remove temp file
      fs.unlinkSync(tmpPath);

      const publicUrl = `/api/uploads/${filename}`;
      const thumbUrl = `/api/uploads/${thumbFilename}`;

      res.json({
        filename,
        url: publicUrl,
        thumbUrl,
        size: result.size,
        width: result.width,
        height: result.height,
        mimetype: 'image/jpeg'
      });
    } catch (err) {
      // Clean up temp file on error
      try { fs.unlinkSync(tmpPath); } catch {}
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
