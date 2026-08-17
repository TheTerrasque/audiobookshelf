/**
 * @typedef MigrationContext
 * @property {import('sequelize').QueryInterface} queryInterface - a Sequelize QueryInterface object.
 * @property {import('../Logger')} logger - a Logger object.
 *
 * @typedef MigrationOptions
 * @property {MigrationContext} context - an object containing the migration context.
 */

const migrationVersion = '2.37.0'
const migrationName = `${migrationVersion}-add-ebook-file-ino-to-media-progress`
const loggerPrefix = `[${migrationVersion} migration]`

/**
 * This migration script adds an ebookFileIno column to the mediaProgresses table, so that progress
 * for a book with multiple ebook files (e.g. multi-volume comics) can remember which file it belongs to.
 *
 * @param {MigrationOptions} options - an object containing the migration context.
 * @returns {Promise<void>} - A promise that resolves when the migration is complete.
 */
async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  if (await queryInterface.tableExists('mediaProgresses')) {
    const tableDescription = await queryInterface.describeTable('mediaProgresses')

    if (!tableDescription.ebookFileIno) {
      logger.info(`${loggerPrefix} Adding ebookFileIno column to mediaProgresses table`)
      await queryInterface.addColumn('mediaProgresses', 'ebookFileIno', {
        type: queryInterface.sequelize.Sequelize.DataTypes.STRING,
        allowNull: true
      })
      logger.info(`${loggerPrefix} Added ebookFileIno column to mediaProgresses table`)
    } else {
      logger.info(`${loggerPrefix} ebookFileIno column already exists in mediaProgresses table`)
    }
  } else {
    logger.info(`${loggerPrefix} mediaProgresses table does not exist`)
  }

  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

/**
 * This migration script removes the ebookFileIno column from the mediaProgresses table.
 *
 * @param {MigrationOptions} options - an object containing the migration context.
 * @returns {Promise<void>} - A promise that resolves when the migration is complete.
 */
async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  if (await queryInterface.tableExists('mediaProgresses')) {
    const tableDescription = await queryInterface.describeTable('mediaProgresses')

    if (tableDescription.ebookFileIno) {
      logger.info(`${loggerPrefix} Removing ebookFileIno column from mediaProgresses table`)
      await queryInterface.removeColumn('mediaProgresses', 'ebookFileIno')
      logger.info(`${loggerPrefix} Removed ebookFileIno column from mediaProgresses table`)
    } else {
      logger.info(`${loggerPrefix} ebookFileIno column does not exist in mediaProgresses table`)
    }
  } else {
    logger.info(`${loggerPrefix} mediaProgresses table does not exist`)
  }

  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

module.exports = { up, down }
