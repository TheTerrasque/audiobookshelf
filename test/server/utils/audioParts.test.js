const { expect } = require('chai')
const { parsePartMinutes, computePartCuts } = require('../../../server/utils/audioParts')

describe('audioParts', () => {
  describe('parsePartMinutes', () => {
    it('treats empty values as no split', () => {
      for (const v of [undefined, null, '', '0', 0]) expect(parsePartMinutes(v), String(v)).to.equal(0)
    })

    it('parses valid lengths', () => {
      expect(parsePartMinutes('30')).to.equal(30)
      expect(parsePartMinutes(15)).to.equal(15)
      expect(parsePartMinutes('2.5')).to.equal(2.5)
    })

    it('rejects invalid lengths', () => {
      for (const v of ['abc', '-5', '0.5', '601', 'Infinity']) expect(() => parsePartMinutes(v), v).to.throw()
    })
  })

  describe('computePartCuts', () => {
    it('does not split short books', () => {
      expect(computePartCuts(0, 1800)).to.deep.equal([])
      expect(computePartCuts(1800, 1800)).to.deep.equal([])
      expect(computePartCuts(2600, 1800)).to.deep.equal([])
      expect(computePartCuts(3600, 0)).to.deep.equal([])
    })

    it('makes evenly sized parts without chapters', () => {
      expect(computePartCuts(3600, 1800)).to.deep.equal([1800])
      // 10 h in 30 min parts
      const cuts = computePartCuts(36000, 1800)
      expect(cuts).to.have.length(19)
      expect(cuts[0]).to.equal(1800)
      expect(cuts[18]).to.equal(34200)
      // 100 min in 30 min parts -> 3 parts of 33:20
      expect(computePartCuts(6000, 1800)).to.deep.equal([2000, 4000])
    })

    it('moves cuts to nearby chapter starts', () => {
      const chapters = [{ start: 0 }, { start: 1500 }, { start: 1750 }, { start: 2900 }, { start: 3700 }]
      // targets 1800 and 3600 (3 parts of 5400 s)
      expect(computePartCuts(5400, 1800, chapters)).to.deep.equal([1750, 3700])
    })

    it('ignores chapter starts that are too far away', () => {
      const chapters = [{ start: 0 }, { start: 1000 }, { start: 2500 }]
      expect(computePartCuts(3600, 1800, chapters)).to.deep.equal([1800])
    })

    it('keeps cuts ascending and inside the book', () => {
      const chapters = Array.from({ length: 200 }, (_, i) => ({ start: i * 97.3 }))
      const duration = 200 * 97.3
      const cuts = computePartCuts(duration, 600, chapters)
      expect(cuts.length).to.be.greaterThan(20)
      for (let i = 0; i < cuts.length; i++) {
        expect(cuts[i]).to.be.greaterThan(i ? cuts[i - 1] : 0)
        expect(cuts[i]).to.be.lessThan(duration)
      }
    })
  })
})
