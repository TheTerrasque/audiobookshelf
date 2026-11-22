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
 * @typedef PooledExtractor
 * @property {string} path
 * @property {string} revision
 * @property {import('../utils/comicBookExtractors').AbstractComicBookExtractor|null} extractor set once opened
 * @property {Promise<void>} opening resolves once the extractor is open (shared by concurrent callers)
 * @property {number} users number of in-flight operations currently using the extractor
 * @property {boolean} disposed removed from the pool; close as soon as no operation uses it
 * @property {boolean} closed
 */

/**
 * Serves comic book (CBZ/CBR) pages as individual images.
 *
 * - Page images are extracted on demand and kept in an in-memory byte-based LRU cache
 * - Open archive handles are pooled (small LRU keyed by path + revision) so consecutive
 *   page requests reuse the same extractor instead of reopening the archive.
 *   Concurrent requests share a single open, and an extractor that is evicted from the pool
 *   while a request is still reading from it is only closed once that request is done.
 * - A per-file manifest (page list + ComicInfo metadata) is cached in memory and
 *   invalidated when the file's mtime/size changes
 * - Concurrent requests for the same manifest or page share one extraction
 */
class ComicPageCacheManager {
  constructor() {
    const pageCacheMaxBytes = Math.max(1, toNumber(process.env.COMIC_PAGE_CACHE_MAX_BYTES, DEFAULT_PAGE_CACHE_MAX_BYTES))
    const extractorPoolMax = Math.max(1, toNumber(process.env.COMIC_EXTRACTOR_POOL_MAX, DEFAULT_EXTRACTOR_POOL_MAX))

    this.pageCache = new LRUCache({
      maxSize: pageCacheMaxBytes,
      sizeCalculation: (value) => value?.length || 1
    })
    this.extractorPool = new LRUCache({
      max: extractorPoolMax,
      dispose: (entry) => {
        entry.disposed = true
        this._closeIfUnused(entry)
      }
    })
    /** @type {Map<string, { statsKey: string, manifest: object }>} */
    this.manifestCache = new Map()
    /** @type {Map<string, Promise<object>>} in-flight manifest builds keyed by path + statsKey */
    this.pendingManifests = new Map()
    /** @type {Map<string, Promise<Buffer>>} in-flight page extractions keyed like pageCache */
    this.pendingPages = new Map()
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

    const pendingKey = `${ebookFilePath}:${statsKey}`
    let pending = this.pendingManifests.get(pendingKey)
    if (!pending) {
      pending = this._buildManifest(ebookFilePath, statsKey).finally(() => {
        this.pendingManifests.delete(pendingKey)
      })
      this.pendingManifests.set(pendingKey, pending)
    }
    return pending
  }

  /**
   * @param {string} ebookFilePath
   * @param {string} statsKey
   */
  async _buildManifest(ebookFilePath, statsKey) {
    const revision = crypto.createHash('md5').update(statsKey).digest('hex')
    try {
      return await this._withExtractor(ebookFilePath, revision, async (extractor) => {
        const filePaths = (await extractor.getFilePaths()) || []
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
          manifest.metadata = await this._parseComicInfo(extractor, comicInfoPath)
        }

        this.manifestCache.set(ebookFilePath, { statsKey, manifest })
        return manifest
      })
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

    let pending = this.pendingPages.get(cacheKey)
    if (!pending) {
      pending = this._extractPage(ebookFilePath, pagePath, extension, revision, cacheKey).finally(() => {
        this.pendingPages.delete(cacheKey)
      })
      this.pendingPages.set(cacheKey, pending)
    }
    return pending
  }

  async _extractPage(ebookFilePath, pagePath, extension, revision, cacheKey) {
    try {
      const buffer = await this._withExtractor(ebookFilePath, revision, (extractor) => extractor.extractToBuffer(pagePath))
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
   * Close and remove all pooled extractors for a file path (any revision).
   * Extractors still in use by an in-flight request are closed once that request finishes.
   *
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
   * Remove everything cached for a file path: its manifest, cached page images and open extractors.
   * Used when the file's library item is deleted.
   *
   * @param {string} ebookFilePath
   */
  evictPath(ebookFilePath) {
    const prefix = `${ebookFilePath}:`
    this.manifestCache.delete(ebookFilePath)
    for (const key of [...this.pageCache.keys()]) {
      if (key.startsWith(prefix)) {
        this.pageCache.delete(key)
      }
    }
    this.evictExtractorsForPath(ebookFilePath)
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
   * Run an operation with a pooled (open) extractor for the given file revision.
   * The extractor is guaranteed not to be closed until the operation settles.
   *
   * @template T
   * @param {string} ebookFilePath
   * @param {string} revision
   * @param {(extractor: import('../utils/comicBookExtractors').AbstractComicBookExtractor) => Promise<T>} operation
   * @returns {Promise<T>}
   */
  async _withExtractor(ebookFilePath, revision, operation) {
    const entry = await this._acquireExtractor(ebookFilePath, revision)
    try {
      return await operation(/** @type {any} */ (entry.extractor))
    } finally {
      entry.users--
      this._closeIfUnused(entry)
    }
  }

  /**
   * Get a pooled extractor for the given file revision, opening one if needed, and mark it in use.
   * Concurrent callers for the same file revision share a single open.
   * Callers must decrement `users` (see _withExtractor) when done.
   *
   * @param {string} ebookFilePath
   * @param {string} revision
   * @returns {Promise<PooledExtractor>}
   */
  async _acquireExtractor(ebookFilePath, revision) {
    const poolKey = `${ebookFilePath}:${revision}`
    let entry = this.extractorPool.get(poolKey)
    if (!entry) {
      /** @type {PooledExtractor} */
      const newEntry = {
        path: ebookFilePath,
        revision,
        extractor: null,
        opening: Promise.resolve(),
        users: 0,
        disposed: false,
        closed: false
      }
      newEntry.opening = (async () => {
        const extractor = createComicBookExtractor(ebookFilePath)
        await extractor.open()
        newEntry.extractor = extractor
      })()
      entry = newEntry
      this.extractorPool.set(poolKey, entry)
    }

    // Count as a user before waiting so that a dispose during the open can't close it under us
    entry.users++
    try {
      await entry.opening
    } catch (error) {
      entry.users--
      if (this.extractorPool.peek(poolKey) === entry) {
        this.extractorPool.delete(poolKey)
      }
      throw error
    }
    return entry
  }

  /**
   * Close a pooled extractor once it has been removed from the pool and no operation uses it
   * @param {PooledExtractor} entry
   */
  _closeIfUnused(entry) {
    if (!entry.disposed || entry.users > 0 || entry.closed) return
    entry.closed = true
    entry.opening
      .then(() => entry.extractor?.close())
      .catch((error) => {
        // An extractor that failed to open has nothing to close
        if (entry.extractor) {
          Logger.error(`[ComicPageCacheManager] Failed to close pooled extractor for "${entry.path}"`, error)
        }
      })
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
