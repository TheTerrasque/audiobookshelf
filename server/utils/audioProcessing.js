/**
 * Fork: optional audio processing for the M4B encoder (normalize, compress, voice EQ, noise reduction, speed).
 *
 * Options arrive as query-string values from POST /api/tools/item/:id/encode-m4b and are turned into
 * one ffmpeg -af filter chain. Everything is off unless asked for.
 */

const COMPRESSOR_PRESETS = {
  // Gentle levelling for speech; keeps most of the dynamics
  light: 'acompressor=threshold=-24dB:ratio=2:attack=20:release=250:makeup=2',
  medium: 'acompressor=threshold=-28dB:ratio=3:attack=15:release=200:makeup=4',
  // For cars and noisy places
  strong: 'acompressor=threshold=-32dB:ratio=6:attack=10:release=150:makeup=6'
}

const DENOISE_PRESETS = {
  light: 'afftdn=nr=6:nf=-40',
  medium: 'afftdn=nr=12:nf=-35',
  strong: 'afftdn=nr=20:nf=-30'
}

const VOICE_EQ_FILTERS = ['highpass=f=80', 'equalizer=f=3000:t=o:w=1.5:g=3']

const MIN_SPEED = 0.5
const MAX_SPEED = 3

/**
 * @typedef AudioProcessingOptions
 * @property {{target: number, truePeak: number, range: number}|null} normalize - EBU R128 loudness normalization
 * @property {'light'|'medium'|'strong'|null} compress - dynamic range compression preset
 * @property {boolean} voiceEq - rumble cut + presence boost
 * @property {'light'|'medium'|'strong'|null} denoise - FFT noise reduction preset
 * @property {number} speed - tempo factor (pitch preserved); 1 = unchanged
 */

function isOn(value) {
  return value === true || value === 1 || ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase())
}

function parseNumber(value, fallback, min, max, name) {
  if (value === undefined || value === null || value === '') return fallback
  const num = Number(value)
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new Error(`Invalid ${name} "${value}" (must be between ${min} and ${max})`)
  }
  return num
}

function parsePreset(value, presets, name) {
  if (value === undefined || value === null || value === '' || value === 'off' || value === 'none' || value === '0' || value === 'false') return null
  if (!presets[value]) throw new Error(`Invalid ${name} "${value}" (use ${Object.keys(presets).join(', ')})`)
  return value
}

/**
 * Parse and validate processing options from encoder options (query string values).
 *
 * @param {Object} raw
 * @returns {AudioProcessingOptions}
 * @throws {Error} on invalid values
 */
function parseAudioProcessingOptions(raw = {}) {
  const normalize = isOn(raw.normalize)
    ? {
        target: parseNumber(raw.loudnessTarget, -16, -40, -5, 'loudness target'),
        truePeak: parseNumber(raw.truePeak, -1.5, -9, 0, 'true peak'),
        range: parseNumber(raw.loudnessRange, 11, 1, 50, 'loudness range')
      }
    : null
  const speed = parseNumber(raw.speed, 1, MIN_SPEED, MAX_SPEED, 'speed')
  return {
    normalize,
    compress: parsePreset(raw.compress, COMPRESSOR_PRESETS, 'compression'),
    voiceEq: isOn(raw.voiceEq),
    denoise: parsePreset(raw.denoise, DENOISE_PRESETS, 'noise reduction'),
    speed: Math.round(speed * 1000) / 1000
  }
}

/**
 * True when any processing is requested.
 *
 * @param {AudioProcessingOptions} opts
 */
function hasAudioProcessing(opts) {
  return !!(opts && (opts.normalize || opts.compress || opts.voiceEq || opts.denoise || (opts.speed && opts.speed !== 1)))
}

/**
 * ffmpeg filters in the order they should run: clean up first, then shape dynamics, change tempo,
 * and normalize loudness last so the target holds for the final signal.
 *
 * @param {AudioProcessingOptions} opts
 * @returns {string[]}
 */
function buildAudioFilters(opts) {
  if (!opts) return []
  const filters = []
  if (opts.denoise) filters.push(DENOISE_PRESETS[opts.denoise])
  if (opts.voiceEq) filters.push(...VOICE_EQ_FILTERS)
  if (opts.compress) filters.push(COMPRESSOR_PRESETS[opts.compress])
  if (opts.speed && opts.speed !== 1) filters.push(`atempo=${opts.speed}`)
  if (opts.normalize) {
    const { target, truePeak, range } = opts.normalize
    filters.push(`loudnorm=I=${target}:TP=${truePeak}:LRA=${range}`)
  }
  return filters
}

/**
 * Only the options that were turned on, for storing on the version and showing to users.
 *
 * @param {AudioProcessingOptions} opts
 */
function summarizeAudioProcessing(opts) {
  const summary = {}
  if (!opts) return summary
  if (opts.normalize) summary.normalize = { ...opts.normalize }
  if (opts.compress) summary.compress = opts.compress
  if (opts.voiceEq) summary.voiceEq = true
  if (opts.denoise) summary.denoise = opts.denoise
  if (opts.speed && opts.speed !== 1) summary.speed = opts.speed
  return summary
}

module.exports = {
  COMPRESSOR_PRESETS,
  DENOISE_PRESETS,
  MIN_SPEED,
  MAX_SPEED,
  parseAudioProcessingOptions,
  hasAudioProcessing,
  buildAudioFilters,
  summarizeAudioProcessing
}
