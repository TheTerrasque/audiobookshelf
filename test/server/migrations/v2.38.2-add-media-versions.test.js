const chai = require('chai')
const sinon = require('sinon')
const { expect } = chai

const { DataTypes } = require('sequelize')

const { up, down } = require('../../../server/migrations/v2.38.2-add-media-versions')

describe('Migration v2.38.2-add-media-versions', () => {
  let queryInterface, logger

  beforeEach(() => {
    queryInterface = {
      createTable: sinon.stub().resolves(),
      addIndex: sinon.stub().resolves(),
      dropTable: sinon.stub().resolves(),
      tableExists: sinon.stub().resolves(false),
      sequelize: { Sequelize: { DataTypes } }
    }
    logger = { info: sinon.stub(), error: sinon.stub() }
  })

  describe('up', () => {
    it('creates the mediaVersions table and index when missing', async () => {
      await up({ context: { queryInterface, logger } })

      expect(queryInterface.createTable.calledOnce).to.be.true
      expect(queryInterface.createTable.firstCall.args[0]).to.equal('mediaVersions')
      const columns = queryInterface.createTable.firstCall.args[1]
      expect(columns).to.include.all.keys('id', 'kind', 'label', 'tool', 'options', 'dirPath', 'files', 'duration', 'chapters', 'size', 'libraryItemId', 'createdAt', 'updatedAt')
      expect(columns.libraryItemId.references).to.deep.equal({ model: 'libraryItems', key: 'id' })
      expect(columns.libraryItemId.onDelete).to.equal('CASCADE')
      expect(queryInterface.addIndex.calledOnceWith('mediaVersions', ['libraryItemId'])).to.be.true
      expect(logger.info.calledWith('[2.38.2 migration] UPGRADE BEGIN: 2.38.2-add-media-versions')).to.be.true
      expect(logger.info.calledWith('[2.38.2 migration] UPGRADE END: 2.38.2-add-media-versions')).to.be.true
    })

    it('skips when the table already exists', async () => {
      queryInterface.tableExists.resolves(true)

      await up({ context: { queryInterface, logger } })

      expect(queryInterface.createTable.called).to.be.false
      expect(queryInterface.addIndex.called).to.be.false
      expect(logger.info.calledWith('[2.38.2 migration] mediaVersions table already exists')).to.be.true
    })
  })

  describe('down', () => {
    it('drops the table when it exists', async () => {
      queryInterface.tableExists.resolves(true)

      await down({ context: { queryInterface, logger } })

      expect(queryInterface.dropTable.calledOnceWith('mediaVersions')).to.be.true
      expect(logger.info.calledWith('[2.38.2 migration] DOWNGRADE END: 2.38.2-add-media-versions')).to.be.true
    })

    it('skips when the table does not exist', async () => {
      await down({ context: { queryInterface, logger } })

      expect(queryInterface.dropTable.called).to.be.false
      expect(logger.info.calledWith('[2.38.2 migration] mediaVersions table does not exist')).to.be.true
    })
  })
})
