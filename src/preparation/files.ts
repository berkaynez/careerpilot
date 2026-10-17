import { constants } from 'node:fs';
import { chmod, mkdir, open, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Profile, Job } from './core.js';
import { renderPreparation } from './core.js';

export async function readLocalJSON(path: string): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 256_000) throw new Error('PREP_INPUT_INVALID');
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } catch { throw new Error('PREP_INPUT_INVALID'); } finally { await handle.close(); }
}

export async function writePreparation(directory: string, profile: Profile, job: Job, plan: unknown, origin: 'local_review' | 'model', postingText?: string) {
  const result = renderPreparation(profile, job, plan, origin);
  const cvHandle = await open(result.cv.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let cv: Buffer;
  try {
    const info = await cvHandle.stat();
    if (!info.isFile() || info.size > 5_000_000) throw new Error('PREP_CV_INVALID');
    cv = await cvHandle.readFile();
    if (!cv.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('PREP_CV_INVALID');
  } finally { await cvHandle.close(); }
  // A fresh directory avoids silently replacing a previously reviewed packet.
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);
  const cvName = basename(result.cv.path);
  await writeFile(join(directory, cvName), cv, { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'cover-letter.txt'), result.coverLetter + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'review.txt'), result.report + '\n', { flag: 'wx', mode: 0o600 });
  if (postingText !== undefined) await writeFile(join(directory, 'posting.txt'), postingText, { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'job.json'), JSON.stringify(job, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'preparation.json'), JSON.stringify({ version: result.version, status: result.status,
    origin, cv: { id: result.cv.id, file: cvName, language: result.language, photo: result.cv.photo },
    requiresSponsorship: result.requiresSponsorship, sourceUrl: job.sourceUrl, checkedOn: job.checkedOn,
    plan: result.plan, letter: result.letterEvidence }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return { directory, cvFile: cvName, status: result.status };
}
