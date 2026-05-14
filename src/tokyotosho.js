import AbstractSource from './abstract.js'

export default new class TokyoTosho extends AbstractSource {
  base = 'https://www.tokyotosho.info/rss.php'

  /** @type {import('./').SearchFunction} */
  async single({ titles, episode }) {
    if (!titles?.length) return []

    const query = titles[0] + (episode ? ` ${episode}` : '')
    const url = `${this.base}?terms=${encodeURIComponent(query)}`

    const res = await fetch(url)
    const text = await res.text()

    return this.parseRSS(text)
  }

  /** @type {import('./').SearchFunction} */
  batch = this.single
  movie = this.single

  parseRSS(text) {
    const results = []
    const itemRegex = /<item>([\s\S]*?)<\/item>/g
    const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>/
    const linkRegex = /<link>(.*?)<\/link>/
    const descRegex = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/
    
    let match
    while ((match = itemRegex.exec(text)) !== null) {
      const itemContent = match[1]
      const titleMatch = itemContent.match(titleRegex)
      const linkMatch = itemContent.match(linkRegex)
      const descMatch = itemContent.match(descRegex)

      if (titleMatch && descMatch) {
        const title = titleMatch[1]
        const description = descMatch[1]
        
        // Extract magnet link from description
        const magnetMatch = description.match(/magnet:\?xt=urn:btih:([a-zA-Z0-9]+)/)
        if (!magnetMatch) continue

        const magnet = magnetMatch[0]
        const hash = magnetMatch[1]

        // Extract size if available (often in description like "Size: 123MB")
        const sizeMatch = description.match(/Size:\s*([\d.]+)\s*(KiB|MiB|GiB|KB|MB|GB)/i)
        const size = sizeMatch ? this.parseSize(sizeMatch[0]) : 0

        results.push({
          title,
          link: magnet,
          hash,
          seeders: 0, // RSS doesn't provide seeders
          leechers: 0,
          downloads: 0,
          size,
          date: new Date(), // RSS items usually don't have easy to parse date in description, could parse <pubDate> if needed
          verified: false,
          type: 'alt',
          accuracy: 'medium'
        })
      }
    }
    return results
  }

  parseSize(sizeStr) {
    const match = sizeStr.match(/([\d.]+)\s*(KiB|MiB|GiB|KB|MB|GB)/i)
    if (!match) return 0

    const value = parseFloat(match[1])
    const unit = match[2].toUpperCase()

    switch (unit) {
      case 'KIB':
      case 'KB': return value * 1024
      case 'MIB':
      case 'MB': return value * 1024 * 1024
      case 'GIB':
      case 'GB': return value * 1024 * 1024 * 1024
      default: return 0
    }
  }

  async test() {
    try {
      const res = await fetch(this.base)
      return res.ok
    } catch {
      return false
    }
  }
}()
