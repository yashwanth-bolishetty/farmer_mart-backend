import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import sharp from 'sharp';

const uploadDirectory = fileURLToPath(new URL('../uploads/products/', import.meta.url));

export const receiveProductImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Choose a JPG, PNG, or WebP image.');
      error.statusCode = 400;
      return callback(error);
    }
    return callback(null, true);
  },
});

export async function saveProductImage(file) {
  if (!file) return null;

  const filename = `${randomUUID()}.webp`;
  const imagePath = path.join(uploadDirectory, filename);
  let image;
  try {
    image = await sharp(file.buffer, { limitInputPixels: 40000000 })
      .rotate()
      .resize(800, 800, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    const error = new Error('This image could not be read. Choose a valid JPG, PNG, or WebP image.');
    error.statusCode = 400;
    throw error;
  }

  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(imagePath, image, { flag: 'wx' });
  return `/uploads/products/${filename}`;
}

export async function removeProductImage(imageUrl) {
  const match = /^\/uploads\/products\/([a-f\d-]+\.webp)$/i.exec(imageUrl || '');
  if (!match) return;

  try {
    await unlink(path.join(uploadDirectory, match[1]));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
