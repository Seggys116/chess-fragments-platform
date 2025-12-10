import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'public', 'og-banner.svg');
    const imageBuffer = fs.readFileSync(filePath);

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving OG banner:', error);
    return new NextResponse('Image not found', { status: 404 });
  }
}
