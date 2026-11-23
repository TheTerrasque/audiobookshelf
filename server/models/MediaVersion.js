const { DataTypes, Model } = require('sequelize')

/**
 * An alternative copy of a library item's files (e.g. an m4b re-encode or a copy with embedded
 * metadata). Version files live under global.VersionsPath, never inside library folders, and each
 * user picks which version they get (see server/utils/mediaVersions.js).
 *
 * kind 'audio' replaces the item's whole audio track list.
 * kind 'ebook' (reserved for later) replaces the single ebook file with ino `sourceIno`.
 */
class MediaVersion extends Model {
  constructor(values, options) {
    super(values, options)

    /** @type {UUIDV4} */
    this.id
    /** @type {UUIDV4} */
    this.libraryItemId
    /** @type {'audio'|'ebook'} */
    this.kind
    /** @type {string} */
    this.sourceIno
    /** @type {string} */
    this.label
    /** @type {string} */
    this.tool
    /** @type {Object} */
    this.options
    /** @type {string} */
    this.dirPath
    /** @type {Object[]} AudioFile-shaped objects with synthetic inos */
    this.files
    /** @type {number} */
    this.duration
    /** @type {Object[]} */
    this.chapters
    /** @type {number} */
    this.size
    /** @type {Date} */
    this.createdAt
    /** @type {Date} */
    this.updatedAt
  }

  /**
   * Summary sent to clients (no absolute paths).
   */
  toJSONForClient() {
    return {
      id: this.id,
      libraryItemId: this.libraryItemId,
      kind: this.kind,
      sourceIno: this.sourceIno,
      label: this.label,
      tool: this.tool,
      options: this.options,
      numFiles: this.files?.length || 0,
      duration: this.duration,
      size: this.size,
      createdAt: this.createdAt?.valueOf?.() ?? this.createdAt,
      updatedAt: this.updatedAt?.valueOf?.() ?? this.updatedAt
    }
  }

  /**
   * @param {string} libraryItemId
   * @returns {Promise<MediaVersion[]>}
   */
  static getForLibraryItem(libraryItemId) {
    return this.findAll({ where: { libraryItemId }, order: [['createdAt', 'ASC']] })
  }

  /**
   * Initialize model
   * @param {import('../Database').sequelize} sequelize
   */
  static init(sequelize) {
    super.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
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
        size: DataTypes.BIGINT
      },
      {
        sequelize,
        modelName: 'mediaVersion',
        indexes: [{ fields: ['libraryItemId'] }]
      }
    )

    const { libraryItem } = sequelize.models
    libraryItem.hasMany(MediaVersion, { onDelete: 'CASCADE' })
    MediaVersion.belongsTo(libraryItem)
  }
}

module.exports = MediaVersion
