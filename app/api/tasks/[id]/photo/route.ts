import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { currentUser } from '@/lib/auth/session';
import { deviceAllowed } from '@/lib/devices';
import { db } from '@/lib/db';
import { taskPhotos, tasks } from '@/lib/db/schema';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Optional photo proof, one image per task. The client has already downscaled
 * (long edge ~1280px) and re-encoded to JPEG ~70 before uploading, plus built a
 * ~320px thumbnail it sends alongside; this route only validates and stores.
 * The board serves the thumbnail and never the full photo, so opening the board
 * stays cheap even with photos everywhere.
 */

/** Post-compression ceiling; matches PHOTO_MAX_BYTES on the client. */
const MAX_BYTES = 2 * 1024 * 1024;

function notFound() {
  return NextResponse.json({ error: 'not-found', code: 'TASQ-E0201' }, { status: 404 });
}

function unauthenticated() {
  return NextResponse.json({ error: 'not-authenticated', code: 'TASQ-E0401' }, { status: 401 });
}

function tooMany(retryAfterMs: number) {
  return NextResponse.json(
    { error: 'rate-limited', code: 'TASQ-E0704' },
    { status: 429, headers: { 'retry-after': String(Math.ceil(retryAfterMs / 1000)) } },
  );
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'local';
}

/** JPEG magic: FF D8 FF. The client always sends JPEG, but this route is the last line. */
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

type RouteParams = { params: Promise<{ id: string }> };

function parseTaskId(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

/** Serve the stored image. `?size=thumb` returns the ~320px board thumbnail. */
export async function GET(request: Request, { params }: RouteParams) {
  const user = await currentUser();
  if (!(await deviceAllowed())) {
    return NextResponse.json({ error: 'device-not-approved', code: 'TASQ-E0407' }, { status: 403 });
  }
  if (!user) return unauthenticated();

  const { id } = await params;
  const taskId = parseTaskId(id);
  if (taskId === null) return notFound();

  const row = db
    .select({ mime: taskPhotos.mime, bytes: taskPhotos.bytes, thumbBytes: taskPhotos.thumbBytes, updatedAt: taskPhotos.updatedAt })
    .from(taskPhotos)
    .where(eq(taskPhotos.taskId, taskId))
    .get();
  if (!row) return notFound();

  const wantThumb = new URL(request.url).searchParams.get('size') === 'thumb';
  const bytes = wantThumb ? row.thumbBytes : row.bytes;

  // The URL carries the row's updatedAt as ?t=, so an image that was replaced
  // gets a new URL — this cache line can safely say "immutable".
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': row.mime,
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
}

/** Store (or replace — one photo per task) the compressed photo for a task. */
export async function POST(request: Request, { params }: RouteParams) {
  const user = await currentUser();
  if (!(await deviceAllowed())) {
    return NextResponse.json({ error: 'device-not-approved', code: 'TASQ-E0407' }, { status: 403 });
  }
  if (!user) return unauthenticated();

  const limit = rateLimit(`photo:post:${user.id}:${clientIp(request)}`, 20, 60_000);
  if (!limit.allowed) return tooMany(limit.retryAfterMs);

  const { id } = await params;
  const taskId = parseTaskId(id);
  if (taskId === null) return notFound();

  // The task itself must still exist (cancelling is a status, not a delete,
  // so proof survives on history — but a made-up id rejects here).
  const task = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return notFound();

  // Full photo and thumbnail travel as one multipart body. They must NOT ride
  // in headers: a detailed 320px thumb is easily 30-70KB of base64, and Node's
  // ~16KB header cap rejects the whole request with 431 before this route ever
  // runs — the upload would fail forever on real photos while passing on flat
  // test images.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'bad-body', code: 'TASQ-E0702' }, { status: 400 });
  }

  const fullPart = form.get('full');
  const thumbPart = form.get('thumb');
  if (!(fullPart instanceof Blob) || !(thumbPart instanceof Blob)) {
    return NextResponse.json({ error: 'bad-body', code: 'TASQ-E0702' }, { status: 400 });
  }

  const body = new Uint8Array(await fullPart.arrayBuffer());
  if (body.byteLength === 0) {
    return NextResponse.json({ error: 'empty', code: 'TASQ-E0702' }, { status: 400 });
  }
  if (body.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'too-large', code: 'TASQ-E0701' }, { status: 413 });
  }
  if (!isJpeg(body)) {
    return NextResponse.json({ error: 'not-jpeg', code: 'TASQ-E0702' }, { status: 415 });
  }

  const thumbBytes = Buffer.from(await thumbPart.arrayBuffer());
  if (thumbBytes.byteLength === 0 || thumbBytes.byteLength > MAX_BYTES || !isJpeg(thumbBytes)) {
    return NextResponse.json({ error: 'bad-thumb', code: 'TASQ-E0702' }, { status: 400 });
  }

  const now = Date.now();
  // taskId is the primary key, so this is a true upsert — replacing a photo
  // overwrites the old bytes, nothing is ever duplicated.
  db.insert(taskPhotos)
    .values({ taskId, bytes: Buffer.from(body), thumbBytes, mime: 'image/jpeg', createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: taskPhotos.taskId,
      set: { bytes: Buffer.from(body), thumbBytes, mime: 'image/jpeg', updatedAt: now },
    })
    .run();

  return NextResponse.json({ ok: true, bytes: body.byteLength, thumbBytes: thumbBytes.byteLength });
}

/** Remove a task's photo. Idempotent: removing an absent photo is still fine. */
export async function DELETE(request: Request, { params }: RouteParams) {
  const user = await currentUser();
  if (!(await deviceAllowed())) {
    return NextResponse.json({ error: 'device-not-approved', code: 'TASQ-E0407' }, { status: 403 });
  }
  if (!user) return unauthenticated();

  const limit = rateLimit(`photo:delete:${user.id}:${clientIp(request)}`, 20, 60_000);
  if (!limit.allowed) return tooMany(limit.retryAfterMs);

  const { id } = await params;
  const taskId = parseTaskId(id);
  if (taskId === null) return notFound();

  db.delete(taskPhotos).where(eq(taskPhotos.taskId, taskId)).run();
  return NextResponse.json({ ok: true });
}
