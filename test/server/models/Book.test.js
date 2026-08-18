const { expect } = require('chai')
const { Sequelize } = require('sequelize')

const Database = require('../../../server/Database')

describe('Book', () => {
  beforeEach(async () => {
    Database.sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    await Database.buildModels()
  })

  afterEach(async () => {
    await Database.sequelize.close()
  })

  describe('ebookFormat', () => {
    it('returns the stored ebookFormat', () => {
      const book = Database.bookModel.build({ ebookFile: { ebookFormat: 'cbz', metadata: { path: '/fake/book.cbz' } } })
      expect(book.ebookFormat).to.equal('cbz')
    })

    it('falls back to the file extension when ebookFormat is empty (legacy scans)', () => {
      const book = Database.bookModel.build({ ebookFile: { ebookFormat: '', metadata: { path: '/fake/book.cbz' } } })
      expect(book.ebookFormat).to.equal('cbz')
    })

    it('returns null when there is no ebook file', () => {
      const book = Database.bookModel.build({ ebookFile: null })
      expect(book.ebookFormat).to.equal(null)
    })
  })
})
