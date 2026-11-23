/**
 * @typedef MigrationContext
 * @property {import('sequelize').QueryInterface} queryInterface - a Sequelize QueryInterface object.
 * @property {import('../Logger')} logger - a Logger object.
 *
 * @typedef MigrationOptions
 * @property {MigrationContext} context - an object containing the migration context.
 */

const migrationVersion = '2.38.2'
const migrationName = `${migrationVersion}-add-media-versions`
const loggerPrefix = `[${migrationVersion} migration]`

/**
 * This migration script creates the mediaVersions table, which holds alternative copies of a library
 * item's files (e.g. m4b re-encodes) stored outside the library folders.
 *
 * @param {MigrationOptions} options - an object containing the migration context.
 * @returns {Promise<void>} - A promise that resolves when the migration is complete.
 */
async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  if (await queryInterface.tableExists('mediaVersions')) {
    logger.info(`${loggerPrefix} mediaVersions table already exists`)
  } else {
    const DataTypes = queryInterface.sequelize.Sequelize.DataTypes
    logger.info(`${loggerPrefix} Creating mediaVersions table`)
    await queryInterface.createTable('mediaVersions', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true
      },
      kind: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'audio'
      },
      sourceIno: DataTypes.STRING,
      label: DataTypes.STRING,
      tool: DataTypes.STRING,
      options: DataTypes.JSON,
      dirPath: DataTypes.STRING,
      files: DataTypes.JSON,
      duration: DataTypes.FLOAT,
      chapters: DataTypes.JSON,
      size: DataTypes.BIGINT,
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      libraryItemId: {
        type: DataTypes.UUID,
        references: {
          model: 'libraryItems',
          key: 'id'
        },
        onDelete: 'CASCADE'
      }
    })
    await queryInterface.addIndex('mediaVersions', ['libraryItemId'])
    logger.info(`${loggerPrefix} Created mediaVersions table`)
  }

  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

/**
 * This migration script drops the mediaVersions table. Version files on disk are left in place.
 *
 * @param {MigrationOptions} options - an object containing the migration context.
 * @returns {Promise<void>} - A promise that resolves when the migration is complete.
 */
async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  if (await queryInterface.tableExists('mediaVersions')) {
    logger.info(`${loggerPrefix} Dropping mediaVersions table`)
    await queryInterface.dropTable('mediaVersions')
    logger.info(`${loggerPrefix} Dropped mediaVersions table`)
  } else {
    logger.info(`${loggerPrefix} mediaVersions table does not exist`)
  }

  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

module.exports = { up, down }
