#!/usr/bin/env node
// Tempo — verify/refresh exercise form-guide media.
//
// Reads the curated UUID→ExerciseDB mapping from src/data/exerciseMedia.ts and
// confirms every mapped id still returns a real GIF from the ExerciseDB image
// endpoint, then prints a coverage summary (matched / broken / missing).
//
// Usage:  EXPO_PUBLIC_RAPIDAPI_KEY=... node scripts/sync-exercise-media.mjs
//   (or)  npm run sync:media          (reads the key from mobile/.env.local)
//
// Network + a valid RapidAPI key required. This does not write to Supabase; the
// mapping is bundled in the app, so there's nothing to sync server-side.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOST = 'exercisedb.p.rapidapi.com'

function readKey() {
  if (process.env.EXPO_PUBLIC_RAPIDAPI_KEY) return process.env.EXPO_PUBLIC_RAPIDAPI_KEY.trim()
  try {
    const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
    return (env.match(/EXPO_PUBLIC_RAPIDAPI_KEY=(.+)/) || [])[1]?.trim()
  } catch {
    return undefined
  }
}

function parseMapping() {
  // Pull `[UUID('NN')]: { exdbId: 'XXXX' }` pairs out of the data file so the
  // script and the app can never drift apart.
  const src = fs.readFileSync(path.join(root, 'src/data/exerciseMedia.ts'), 'utf8')
  const re = /UUID\('(\d{2})'\)\]:\s*\{\s*exdbId:\s*'(\d{3,4})'/g
  const out = []
  let m
  while ((m = re.exec(src))) out.push({ suffix: m[1], exdbId: m[2] })
  return out
}

const KEY = readKey()
if (!KEY) {
  console.error('Missing EXPO_PUBLIC_RAPIDAPI_KEY (env or mobile/.env.local). Aborting.')
  process.exit(1)
}

const headers = { 'x-rapidapi-host': HOST, 'x-rapidapi-key': KEY }
const mapping = parseMapping()
let ok = 0
const broken = []

for (const { suffix, exdbId } of mapping) {
  const url = `https://${HOST}/image?exerciseId=${exdbId}&resolution=360`
  try {
    const r = await fetch(url, { headers })
    const ct = r.headers.get('content-type') || ''
    if (r.ok && ct.startsWith('image/')) ok++
    else broken.push(`${suffix} -> ${exdbId} (HTTP ${r.status} ${ct || 'no content-type'})`)
  } catch (e) {
    broken.push(`${suffix} -> ${exdbId} (${e.message})`)
  }
  await new Promise((res) => setTimeout(res, 80))
}

console.log(`\nExerciseDB media check`)
console.log(`  mapped:  ${mapping.length}`)
console.log(`  valid:   ${ok}`)
console.log(`  broken:  ${broken.length}`)
if (broken.length) {
  console.log('\nBroken ids (update src/data/exerciseMedia.ts):')
  for (const b of broken) console.log('  - ' + b)
  process.exit(2)
}
console.log('\nAll mapped clips return a valid GIF. See supabase/MISSING_EXERCISE_MEDIA.md for the 8 deliberate gaps.')
