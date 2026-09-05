// The scheduling rules must be identical on the client and on the server.
//
// `supabase/functions/retime-sessions` enforces "never schedule a session at a
// time the user cannot make" server-side, because the client-side repair can only
// run inside a bundle the user has actually received — and on 2026-09-05 that
// turned out to mean it reached nobody while 44% of live sessions sat at
// impossible times.
//
// Deno edge functions cannot import from `src/`, so `availability.ts` is copied
// into the function directory. `availability.ts` has zero imports precisely so
// that copy is possible. This test is what stops the copy silently drifting: if
// someone changes the wake buffer, the weekday floor, or how free windows are
// computed on one side only, the two engines would disagree and the server would
// quietly "repair" sessions to times the client considers wrong.
//
// If this fails, copy the file again:
//   cp src/lib/availability.ts supabase/functions/retime-sessions/availability.ts

import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../..')
const SOURCE = path.join(ROOT, 'src/lib/availability.ts')
const VENDORED = path.join(ROOT, 'supabase/functions/retime-sessions/availability.ts')

describe('availability.ts vendored copy', () => {
  it('exists in the edge function directory', () => {
    expect(fs.existsSync(VENDORED)).toBe(true)
  })

  it('is byte-for-byte identical to the client source', () => {
    const source = fs.readFileSync(SOURCE, 'utf8')
    const vendored = fs.readFileSync(VENDORED, 'utf8')
    expect(vendored).toBe(source)
  })

  it('still has no imports, which is what makes sharing it possible at all', () => {
    // A single import would break the Deno copy, since the client's module
    // resolution ('@/...') does not exist there.
    const source = fs.readFileSync(SOURCE, 'utf8')
    const imports = source.split('\n').filter(l => /^\s*import\s/.test(l))
    expect(imports).toEqual([])
  })
})
