const chai = require('chai')
const sinon = require('sinon')
const { expect } = chai

const { DataTypes } = require('sequelize')

const { up, down } = require('../../../server/migrations/v2.37.0-add-ebook-file-ino-to-media-progress')

describe('Migration v2.37.0-add-ebook-file-ino-to-media-progress', () => {
  let queryInterface, logger

  beforeEach(() => {
    queryInterface = {
      addColumn: sinon.stub().resolves(),
      removeColumn: sinon.stub().resolves(),
      tableExists: sinon.stub().resolves(true),
      describeTable: sinon.stub().resolves({ ebookFileIno: undefined }),
      sequelize: {
        Sequelize: {
          DataTypes: {
            STRING: DataTypes.STRING
          }
        }
      }
    }

    logger = {
      info: sinon.stub(),
      error: sinon.stub()
    }
  })

  describe('up', () => {
    it('should add the ebookFileIno column to mediaProgresses table', async () => {
      await up({ context: { queryInterface, logger } })

      expect(queryInterface.addColumn.calledOnce).to.be.true
      expect(
        queryInterface.addColumn.calledWith('mediaProgresses', 'ebookFileIno', {
          type: DataTypes.STRING,
          allowNull: true
        })
      ).to.be.true

      expect(logger.info.calledWith('[2.37.0 migration] UPGRADE BEGIN: 2.37.0-add-ebook-file-ino-to-media-progress')).to.be.true
      expect(logger.info.calledWith('[2.37.0 migration] Adding ebookFileIno column to mediaProgresses table')).to.be.true
      expect(logger.info.calledWith('[2.37.0 migration] Added ebookFileIno column to mediaProgresses table')).to.be.true
      expect(logger.info.calledWith('[2.37.0 migration] UPGRADE END: 2.37.0-add-ebook-file-ino-to-media-progress')).to.be.true
    })

    it('should skip adding the column if it already exists', async () => {
      queryInterface.describeTable.resolves({ ebookFileIno: {} })

      await up({ context: { queryInterface, logger } })

      expect(queryInterface.addColumn.called).to.be.false
      expect(logger.info.calledWith('[2.37.0 migration] ebookFileIno column already exists in mediaProgresses table')).to.be.true
    })

    it('should skip if the mediaProgresses table does not exist', async () => {
      queryInterface.tableExists.resolves(false)

      await up({ context: { queryInterface, logger } })

      expect(queryInterface.addColumn.called).to.be.false
      expect(logger.info.calledWith('[2.37.0 migration] mediaProgresses table does not exist')).to.be.true
    })
  })

  describe('down', () => {
    it('should remove the ebookFileIno column from mediaProgresses table', async () => {
      queryInterface.describeTable.resolves({ ebookFileIno: {} })

      await down({ context: { queryInterface, logger } })

      expect(queryInterface.removeColumn.calledOnce).to.be.true
      expect(queryInterface.removeColumn.calledWith('mediaProgresses', 'ebookFileIno')).to.be.true

      expect(logger.info.calledWith('[2.37.0 migration] DOWNGRADE BEGIN: 2.37.0-add-ebook-file-ino-to-media-progress')).to.be.true
      expect(logger.info.calledWith('[2.37.0 migration] Removing ebookFileIno column from mediaProgresses table')).to.be.true
      expect(logger.info.calledWith('[2.37.0 migration] Removed ebookFileIno column from mediaProgresses table')).to.be.true
      expect(logger.info.calledWith('[2.37.0 migration] DOWNGRADE END: 2.37.0-add-ebook-file-ino-to-media-progress')).to.be.true
    })

    it('should skip removing the column if it does not exist', async () => {
      await down({ context: { queryInterface, logger } })

      expect(queryInterface.removeColumn.called).to.be.false
      expect(logger.info.calledWith('[2.37.0 migration] ebookFileIno column does not exist in mediaProgresses table')).to.be.true
    })
  })
})
