const Path = require('path')
const crypto = require('crypto')
const { TextDecoder } = require('util')
const { LRUCache } = require('lru-cache')

const Logger = require('../Logger')
const fs = require('../libs/fsExtra')
const { toNumber, xmlToJSON } = require('../utils/index')
const globals = require('../utils/globals')
const parseComicInfoMetadata = require('../utils/parsers/parseComicInfoMetadata')
const { createComicBookExtractor } = require('../utils/comicBookExtractors')

const IMAGE_MIME_MAP = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

// Default max size of the in-memory page image cache (bytes)
const DEFAULT_PAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024
// Default max number of open comic archive handles kept in the extractor pool
const DEFAULT_EXTRACTOR_POOL_MAX = 4

/**
 * Serves comic book (CBZ/CBR) pages as individual images.
 *
 * - Page images are extracted on demand and kept in an in-memory byte-based LRU cache
 * - Open archive handles are pooled (small LRU keyed by path + revision) so consecutive
 *   page requests reuse the same extractor instead of reopening the archive
 * - A per-file manifest (page list + ComicInfo metadata) is cached in memory and
 *   invalidated when the file's mtime/size changes
 */
class ComicPageCacheManager {
  constructor() {
    const pageCacheMaxBytes = Math.max(1, toNumber(process.env.COMIC_PAGE_CACHE_MAX_BYTES, DEFAULT_PAGE_CACHE_MAX_BYTES))
    const extractorPoolMax = Math.max(1, toNumber(process.env.COMIC_EXTRACTOR_POOL_MAX, DEFAULT_EXTRACTOR_POOL_MAX))

    this.pageCache = new LRUCache({
      maxSize: pageCacheMaxBytes,
      sizeCalculation: (value) => value?.length || 0
    })
    this.extractorPool = new LRUCache({
      max: extractorPoolMax,
      dispose: (entry) => {
        try {
          entry?.extractor?.close()
        } catch (error) {
          Logger.error(`[ComicPageCacheManager] Failed to close pooled extractor for "${entry?.path}"`, error)
        }
      }
    })
    this.manifestCache = new Map()
  }

  /**
   * Get (or build) the page manifest for a comic book file.
   * The manifest is invalidated when the file's mtime or size changes.
   *
   * @param {string} ebookFilePath
   * @returns {Promise<{ pageCount: number, pages: object[], metadata: object|null, revision: string }>}
   */
  async getManifest(ebookFilePath) {
    const stats = await fs.stat(ebookFilePath)
    const statsKey = `${stats.mtimeMs}:${stats.size}`
    const cached = this.manifestCache.get(ebookFilePath)
    if (cached && cached.statsKey === statsKey) {
      return cached.manifest
    }

    if (cached) {
      // File changed: drop stale manifest and any open handles for the old revision
      this.manifestCache.delete(ebookFilePath)
      this.evictExtractorsForPath(ebookFilePath)
    }

    const revision = crypto.createHash('md5').update(statsKey).digest('hex')
    const entry = await this._getExtractor(ebookFilePath, revision)
    try {
      const filePaths = (await entry.extractor.getFilePaths()) || []
      filePaths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))

      const pages = filePaths
        .filter((filePath) => {
          const ext = Path.extname(filePath).toLowerCase().slice(1)
          return globals.SupportedImageTypes.includes(ext)
        })
        .map((filePath, index) => {
          const extension = Path.extname(filePath).toLowerCase().slice(1)
          const name = Path.basename(filePath)
          return {
            index: index + 1,
            path: filePath,
            name,
            displayName: name,
            extension,
            mime: IMAGE_MIME_MAP[extension] || 'image/jpeg'
          }
        })

      const manifest = {
        pageCount: pages.length,
        pages,
        metadata: null,
        revision
      }

      const comicInfoPath = filePaths.find((filePath) => filePath.toLowerCase() === 'comicinfo.xml')
      if (comicInfoPath) {
        manifest.metadata = await this._parseComicInfo(entry.extractor, comicInfoPath)
      }

      this.manifestCache.set(ebookFilePath, { statsKey, manifest })
      return manifest
    } catch (error) {
      Logger.error(`[ComicPageCacheManager] Failed to build manifest for "${ebookFilePath}"`, error)
      this.evictExtractorsForPath(ebookFilePath)
      throw error
    }
  }

  /**
   * Get the image data (Buffer) for a single page of a comic book file.
   *
   * @param {string} ebookFilePath
   * @param {string} pagePath path of the page image inside the archive
   * @param {string} extension image extension without dot (for logging)
   * @param {string} revision manifest revision of the file
   * @returns {Promise<Buffer>}
   */
  async getPageImage(ebookFilePath, pagePath, extension, revision) {
    const cacheKey = `${ebookFilePath}:${pagePath}:${revision}`
    const cached = this.pageCache.get(cacheKey)
    if (cached) return cached

    const entry = await this._getExtractor(ebookFilePath, revision)
    try {
      const buffer = await entry.extractor.extractToBuffer(pagePath)
      if (!buffer) {
        throw new Error(`Failed to extract page "${pagePath}" from "${ebookFilePath}"`)
      }
      this.pageCache.set(cacheKey, buffer)
      Logger.debug(`[ComicPageCacheManager] Extracted page "${pagePath}" (${extension}) from "${ebookFilePath}", size: ${buffer.length}`)
      return buffer
    } catch (error) {
      Logger.error(`[ComicPageCacheManager] Failed to extract page "${pagePath}" from "${ebookFilePath}"`, error)
      this.evictExtractorsForPath(ebookFilePath)
      throw error
    }
  }

  /**
   * Remove all cached manifests, page images and open extractors for a file path
   * @param {string} ebookFilePath
   */
  evictExtractorsForPath(ebookFilePath) {
    const prefix = `${ebookFilePath}:`
    for (const key of [...this.extractorPool.keys()]) {
      if (key.startsWith(prefix)) {
        this.extractorPool.delete(key)
      }
    }
  }

  /**
   * Clear all caches and close all pooled extractors
   */
  clear() {
    this.extractorPool.clear()
    this.pageCache.clear()
    this.manifestCache.clear()
  }

  /**
   * Get a pooled (open) extractor for the given file revision, opening one if needed
   * @param {string} ebookFilePath
   * @param {string} revision
   * @returns {Promise<{ extractor: import('../utils/comicBookExtractors').AbstractComicBookExtractor }>}
   */
  async _getExtractor(ebookFilePath, revision) {
    const poolKey = `${ebookFilePath}:${revision}`
    const pooled = this.extractorPool.get(poolKey)
    if (pooled) return pooled

    const extractor = createComicBookExtractor(ebookFilePath)
    await extractor.open()
    const entry = { path: ebookFilePath, revision, extractor }
    this.extractorPool.set(poolKey, entry)
    return entry
  }

  /**
   * Parse ComicInfo.xml into a flat display-friendly metadata object
   * @param {import('../utils/comicBookExtractors').AbstractComicBookExtractor} extractor
   * @param {string} comicInfoPath
   * @returns {Promise<object|null>}
   */
  async _parseComicInfo(extractor, comicInfoPath) {
    try {
      const comicInfoData = await extractor.extractToBuffer(comicInfoPath)
      if (!comicInfoData) return null
      const comicInfoJson = await xmlToJSON(new TextDecoder().decode(comicInfoData))
      const parsed = comicInfoJson ? parseComicInfoMetadata.parse(comicInfoJson) : null
      if (!parsed) return null

      const metadata = {
        Title: parsed.title || null,
        Series: parsed.series?.[0]?.name || null,
        Issue: parsed.series?.[0]?.sequence || null,
        Description: parsed.description || null
      }
      for (const key of Object.keys(metadata)) {
        if (metadata[key] == null) delete metadata[key]
      }
      return Object.keys(metadata).length ? metadata : null
    } catch (error) {
      Logger.error(`[ComicPageCacheManager] Failed to parse ComicInfo at "${comicInfoPath}"`, error)
      return null
    }
  }
}
module.exports = new ComicPageCacheManager()
