const { expect } = require('chai')
const ap = require('../../../server/utils/audioProcessing')

describe('audioProcessing', () => {
  describe('parseAudioProcessingOptions', () => {
    it('defaults to everything off', () => {
      const opts = ap.parseAudioProcessingOptions({})
      expect(opts).to.deep.equal({ normalize: null, compress: null, voiceEq: false, denoise: null, speed: 1 })
      expect(ap.hasAudioProcessing(opts)).to.be.false
      expect(ap.buildAudioFilters(opts)).to.deep.equal([])
      expect(ap.parseAudioProcessingOptions().speed).to.equal(1)
    })

    it('normalizes with default values', () => {
      const opts = ap.parseAudioProcessingOptions({ normalize: '1' })
      expect(opts.normalize).to.deep.equal({ target: -16, truePeak: -1.5, range: 11 })
    })

    it('normalizes with custom values', () => {
      const opts = ap.parseAudioProcessingOptions({ normalize: 'true', loudnessTarget: '-23', truePeak: '-2', loudnessRange: '7' })
      expect(opts.normalize).to.deep.equal({ target: -23, truePeak: -2, range: 7 })
    })

    it('accepts truthy forms', () => {
      for (const v of ['1', 'true', 'on', true]) {
        expect(ap.parseAudioProcessingOptions({ voiceEq: v }).voiceEq, String(v)).to.be.true
      }
      expect(ap.parseAudioProcessingOptions({ voiceEq: '0' }).voiceEq).to.be.false
      expect(ap.parseAudioProcessingOptions({ voiceEq: 'false' }).voiceEq).to.be.false
    })

    it('throws on invalid values', () => {
      expect(() => ap.parseAudioProcessingOptions({ normalize: '1', loudnessTarget: 'abc' })).to.throw(/loudness target/)
      expect(() => ap.parseAudioProcessingOptions({ speed: '0.2' })).to.throw(/speed/)
      expect(() => ap.parseAudioProcessingOptions({ speed: '5' })).to.throw(/speed/)
      expect(() => ap.parseAudioProcessingOptions({ compress: 'extreme' })).to.throw(/compression/)
      expect(() => ap.parseAudioProcessingOptions({ denoise: 'max' })).to.throw(/noise reduction/)
    })

    it("treats 'off' and empty presets as null", () => {
      const opts = ap.parseAudioProcessingOptions({ compress: 'off', denoise: '' })
      expect(opts.compress).to.be.null
      expect(opts.denoise).to.be.null
    })

    it('rounds speed to 3 decimals', () => {
      expect(ap.parseAudioProcessingOptions({ speed: '1.23456' }).speed).to.equal(1.235)
    })
  })

  describe('buildAudioFilters', () => {
    it('orders filters: denoise, voice EQ, compressor, atempo, loudnorm', () => {
      const opts = ap.parseAudioProcessingOptions({ normalize: '1', compress: 'medium', voiceEq: '1', denoise: 'light', speed: '1.25' })
      const filters = ap.buildAudioFilters(opts)
      expect(filters).to.deep.equal([ap.DENOISE_PRESETS.light, 'highpass=f=80', 'equalizer=f=3000:t=o:w=1.5:g=3', ap.COMPRESSOR_PRESETS.medium, 'atempo=1.25', 'loudnorm=I=-16:TP=-1.5:LRA=11'])
      expect(ap.hasAudioProcessing(opts)).to.be.true
    })

    it('returns [] for null options and omits atempo at speed 1', () => {
      expect(ap.buildAudioFilters(null)).to.deep.equal([])
      expect(ap.buildAudioFilters(ap.parseAudioProcessingOptions({ voiceEq: '1' })).some((f) => f.startsWith('atempo'))).to.be.false
    })

    it('speed alone counts as processing', () => {
      expect(ap.hasAudioProcessing(ap.parseAudioProcessingOptions({ speed: '1.5' }))).to.be.true
    })
  })

  describe('summarizeAudioProcessing', () => {
    it('only includes enabled options', () => {
      expect(ap.summarizeAudioProcessing(ap.parseAudioProcessingOptions({}))).to.deep.equal({})
      expect(ap.summarizeAudioProcessing(null)).to.deep.equal({})
      const summary = ap.summarizeAudioProcessing(ap.parseAudioProcessingOptions({ normalize: '1', voiceEq: '1', speed: '1.5', compress: 'light' }))
      expect(summary).to.deep.equal({ normalize: { target: -16, truePeak: -1.5, range: 11 }, compress: 'light', voiceEq: true, speed: 1.5 })
      expect(summary).to.not.have.property('denoise')
    })
  })
})
