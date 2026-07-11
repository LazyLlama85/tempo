#!/usr/bin/env node
// Tempo — one-time cache of exercise GIFs + instructions into Supabase.
//
// The app used to call the ExerciseDB image endpoint LIVE, from every device, on
// every view (src/data/exerciseMedia.ts) — that's what blew through the RapidAPI
// BASIC plan's 690 req/month quota (shared across every install, not per-dev).
// Each exercise's GIF and instructions never change, so they only need fetching
// from RapidAPI ONCE, ever. This script:
//   1. Downloads each exercise's GIF (once) and uploads it to the public
//      `exercise-gifs` Supabase Storage bucket (add_exercise_gif_storage.sql) —
//      the app now serves that URL directly, no RapidAPI call at runtime.
//   2. Backfills `exercises.instructions` for imported rows that still have it
//      empty — ExerciseFormSheet already skips its live remote-instructions
//      fetch once that column is non-empty, so this needs no client change.
//
// BASIC plan is 690 req/month total (shared across both calls above), so a
// single run will likely hit the monthly cap partway through 1,300+ exercises —
// that's expected. Re-run this script next month (or after a plan upgrade) to
// keep filling in the rest; already-cached/backfilled exercises are skipped, so
// it's always safe to re-run.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-exercise-media.mjs
//   (RapidAPI key + Supabase URL are read from mobile/.env.local automatically)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOST = 'exercisedb.p.rapidapi.com'
const BUCKET = 'exercise-gifs'
const RESOLUTION = 180 // the only resolution the BASIC plan guarantees

function readEnvVar(name) {
  if (process.env[name]) return process.env[name].trim()
  try {
    const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
    return (env.match(new RegExp(`${name}=(.+)`)) || [])[1]?.trim()
  } catch {
    return undefined
  }
}

const RAPIDAPI_KEY = readEnvVar('EXPO_PUBLIC_RAPIDAPI_KEY')
const SUPABASE_URL = readEnvVar('EXPO_PUBLIC_SUPABASE_URL')
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!RAPIDAPI_KEY) { console.error('Missing EXPO_PUBLIC_RAPIDAPI_KEY (env or mobile/.env.local).'); process.exit(1) }
if (!SUPABASE_URL) { console.error('Missing EXPO_PUBLIC_SUPABASE_URL (env or mobile/.env.local).'); process.exit(1) }
if (!SERVICE_ROLE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var (Supabase dashboard → Project Settings → API → service_role). Never commit this key.'); process.exit(1) }

const RAPIDAPI_HEADERS = { 'x-rapidapi-host': HOST, 'x-rapidapi-key': RAPIDAPI_KEY }
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const IMPORTED_PREFIX = 'edb00000-0000-4000-8000-'

function exdbIdFromRowId(id) {
  if (!id.startsWith(IMPORTED_PREFIX)) return null
  const suffix = id.slice(IMPORTED_PREFIX.length)
  if (!/^0{8}\d{4}$/.test(suffix)) return null // 9xxx… = hand-written, no remote source
  return suffix.slice(-4)
}

// Curated original-seed ids (already carry inline instructions — only their GIF needs caching).
function curatedExdbIds() {
  const src = fs.readFileSync(path.join(root, 'src/data/exerciseMedia.ts'), 'utf8')
  const ids = new Set()
  for (const m of src.matchAll(/exdbId:\s*'(\d{3,4})'/g)) ids.add(m[1])
  return ids
}

// Imported-library rows: { rowId, exdbId, needsInstructions }.
async function importedRows() {
  const out = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('exercises')
      .select('id, instructions')
      .is('user_id', null)
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const row of data) {
      const exdbId = exdbIdFromRowId(row.id)
      if (exdbId) out.push({ rowId: row.id, exdbId, needsInstructions: !(row.instructions?.length) })
    }
    if (data.length < PAGE) break
  }
  return out
}

async function alreadyCachedGifs() {
  const cached = new Set()
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(BUCKET).list('', { limit: PAGE, offset })
    if (error) throw error
    for (const f of data) cached.add(f.name.replace(/\.gif$/, ''))
    if (data.length < PAGE) break
  }
  return cached
}

function isQuotaExceeded(body) {
  return typeof body === 'string' && /MONTHLY quota/i.test(body)
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

async function main() {
  console.log('Loading exercise list + already-cached GIFs...')
  const curated = curatedExdbIds()
  const imported = await importedRows()
  const cachedGifs = await alreadyCachedGifs()

  // Unique exdbIds needing a GIF fetch (curated + imported), skipping cached ones.
  const gifTargets = new Map() // exdbId -> true
  for (const id of curated) if (!cachedGifs.has(id)) gifTargets.set(id, true)
  for (const { exdbId } of imported) if (!cachedGifs.has(exdbId)) gifTargets.set(exdbId, true)

  const instructionTargets = imported.filter((r) => r.needsInstructions)

  console.log(`GIFs to fetch: ${gifTargets.size} (already cached: ${cachedGifs.size})`)
  console.log(`Instructions to backfill: ${instructionTargets.length}`)

  let gifsDone = 0, gifsFailed = 0, quotaHit = false

  for (const exdbId of gifTargets.keys()) {
    if (quotaHit) break
    try {
      const res = await fetch(`https://${HOST}/image?exerciseId=${exdbId}&resolution=${RESOLUTION}`, { headers: RAPIDAPI_HEADERS })
      if (res.status === 429) {
        const body = await res.text()
        if (isQuotaExceeded(body)) { quotaHit = true; console.log(`\nMonthly RapidAPI quota hit after ${gifsDone} GIFs — stopping. Re-run next month.`); break }
        gifsFailed++; continue
      }
      const ct = res.headers.get('content-type') || ''
      if (!res.ok || !ct.startsWith('image/')) { gifsFailed++; continue }
      const bytes = Buffer.from(await res.arrayBuffer())
      const { error } = await supabase.storage.from(BUCKET).upload(`${exdbId}.gif`, bytes, { contentType: 'image/gif', upsert: true })
      if (error) { gifsFailed++; console.log(`  upload failed for ${exdbId}: ${error.message}`); continue }
      gifsDone++
    } catch (e) {
      gifsFailed++
      console.log(`  fetch failed for ${exdbId}: ${e.message}`)
    }
    await sleep(150)
  }

  let instructionsDone = 0, instructionsFailed = 0

  for (const { rowId, exdbId } of instructionTargets) {
    if (quotaHit) break
    try {
      const res = await fetch(`https://${HOST}/exercises/exercise/${exdbId}`, { headers: RAPIDAPI_HEADERS })
      if (res.status === 429) {
        const body = await res.text()
        if (isQuotaExceeded(body)) { quotaHit = true; console.log(`\nMonthly RapidAPI quota hit after ${instructionsDone} instruction sets — stopping. Re-run next month.`); break }
        instructionsFailed++; continue
      }
      if (!res.ok) { instructionsFailed++; continue }
      const data = await res.json()
      const steps = (Array.isArray(data?.instructions) ? data.instructions : []).map((s) => String(s).trim()).filter(Boolean)
      if (!steps.length) { instructionsFailed++; continue }
      const { error } = await supabase.from('exercises').update({ instructions: steps }).eq('id', rowId)
      if (error) { instructionsFailed++; console.log(`  DB update failed for ${rowId}: ${error.message}`); continue }
      instructionsDone++
    } catch (e) {
      instructionsFailed++
      console.log(`  fetch failed for ${exdbId}: ${e.message}`)
    }
    await sleep(150)
  }

  console.log(`\nGIFs cached this run: ${gifsDone} (failed: ${gifsFailed}, remaining: ${gifTargets.size - gifsDone - gifsFailed})`)
  console.log(`Instructions backfilled this run: ${instructionsDone} (failed: ${instructionsFailed}, remaining: ${instructionTargets.length - instructionsDone - instructionsFailed})`)
  if (quotaHit) console.log('Stopped early on monthly RapidAPI quota — re-run this script next billing cycle to continue.')
}

main().catch((e) => { console.error(e); process.exit(1) })
