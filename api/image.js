import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const config = { runtime: 'nodejs', regions: ['sin1'], includeFiles: 'assets/**' };

const IMAGES = new Map([
  ['logo', { file: 'LOGO 1.jpg', type: 'image/jpeg' }],
  ['jacko', { file: 'jacko-avatar.jpg', type: 'image/jpeg' }],
  ['favicon', { file: 'favicon.ico', type: 'image/x-icon' }]
]);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET to request an image.' });
  const image = IMAGES.get(new URL(req.url, 'http://localhost').searchParams.get('name'));
  if (!image) return res.status(404).json({ error: 'Image not found.' });

  try {
    const file = await readFile(path.join(process.cwd(), 'assets', image.file));
    res.setHeader('Content-Type', image.type);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    return res.status(200).send(file);
  } catch (error) {
    console.error('Image API failed:', error.message);
    return res.status(500).json({ error: 'Image is temporarily unavailable.' });
  }
}

