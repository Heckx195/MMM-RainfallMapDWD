const tar = require('tar-stream')
const { Readable } = require('stream')

/**
 * Extracts entries from an in-memory tar Buffer.
 * @param {Buffer} tarBuffer
 * @param {(name: string) => boolean} [filter] Only entries for which this returns true are kept in the result (all others are still drained but discarded).
 * @returns {Promise<Map<string, Buffer>>} entry name -> full content
 */
function extractTar(tarBuffer, filter) {
  return new Promise((resolve, reject) => {
    const extract = tar.extract()
    const entries = new Map()

    extract.on('entry', (header, stream, next) => {
      const keep = !filter || filter(header.name)
      const chunks = keep ? [] : null

      stream.on('data', (chunk) => {
        if (keep) chunks.push(chunk)
      })
      stream.on('end', () => {
        if (keep) entries.set(header.name, Buffer.concat(chunks))
        next()
      })
      stream.on('error', reject)
      stream.resume()
    })

    extract.on('finish', () => resolve(entries))
    extract.on('error', reject)

    Readable.from(tarBuffer).pipe(extract)
  })
}

module.exports = { extractTar }
