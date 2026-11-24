/**
 * Fork: split an audiobook into parts so the app can download, play and delete it piece by piece.
 *
 * The parts are ordinary audio files of a file version, so every client plays them back to back as one
 * book (same as a multi-file audiobook).
 */

const MIN_PART_MINUTES = 1
const MAX_PART_MINUTES = 600

/**
 * Parse the `partMinutes` option of the m4b encoder.
 *
 * @param {*} value - query value; empty / 0 / undefined = no split
 * @returns {number} part length in minutes, 0 = don't split
 * @throws {Error} on an invalid value
 */
function parsePartMinutes(value) {
  if (value === undefined || value === null || value === '' || value === '0' || value === 0) return 0
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes < MIN_PART_MINUTES || minutes > MAX_PART_MINUTES) {
    throw new Error(`Invalid part length "${value}": must be between ${MIN_PART_MINUTES} and ${MAX_PART_MINUTES} minutes`)
  }
  return minutes
}

/**
 * Where to cut a book of `duration` seconds into parts of about `partSeconds` each.
 *
 * Parts come out evenly sized. A cut moves to a nearby chapter start (within a quarter of a part)
 * so parts tend to begin at a chapter. Returns no cuts when the book is not much longer than one part.
 *
 * @param {number} duration - seconds
 * @param {number} partSeconds - wanted part length in seconds
 * @param {{start: number}[]} [chapters]
 * @returns {number[]} cut times in seconds, ascending, strictly inside (0, duration)
 */
function computePartCuts(duration, partSeconds, chapters = []) {
  if (!(duration > 0) || !(partSeconds > 0)) return []
  const count = Math.round(duration / partSeconds)
  if (count < 2) return []

  const ideal = duration / count
  const tolerance = ideal * 0.25
  const chapterStarts = (chapters || [])
    .map((c) => Number(c?.start))
    .filter((s) => Number.isFinite(s) && s > 0 && s < duration)
    .sort((a, b) => a - b)

  const cuts = []
  let previous = 0
  for (let i = 1; i < count; i++) {
    const target = ideal * i
    let cut = target
    let bestDistance = Infinity
    for (const start of chapterStarts) {
      const distance = Math.abs(start - target)
      if (distance <= tolerance && distance < bestDistance && start - previous >= ideal / 2) {
        cut = start
        bestDistance = distance
      }
    }
    // Never leave a tiny part at the end
    if (duration - cut < ideal / 2) break
    cut = Math.round(cut * 1000) / 1000
    cuts.push(cut)
    previous = cut
  }
  return cuts
}

module.exports = {
  MIN_PART_MINUTES,
  MAX_PART_MINUTES,
  parsePartMinutes,
  computePartCuts
}
