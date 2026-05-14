export default new class NyaaSi {
  base = 'https://nyaasi-api.vercel.app/api/search'

  async single(query) {
    const { titles, episode, absoluteEpisodeNumber, exclusions = [], resolution, fetch } = query
    if (!titles?.length) return []
    return this.search({ titles, episode, absoluteEpisode: absoluteEpisodeNumber, exclusions, resolution, batch: false, fetch })
  }

  async batch(query) {
    const { titles, exclusions = [], fetch } = query
    if (!titles?.length) return []
    return this.search({ titles, exclusions, batch: true, fetch })
  }

  async movie(query) {
    const { titles, resolution, exclusions = [], fetch } = query
    if (!titles?.length) return []
    return this.search({ titles, exclusions, resolution, batch: false, fetch })
  }

  async search({ titles, episode, absoluteEpisode, exclusions, resolution, batch, fetch }) {
    // Pick best title for the primary query (shortest latin-script)
    const latin = titles.filter(t => /[a-zA-Z]/.test(t))
    const pool  = latin.length ? latin : titles
    const title = pool.reduce((a, b) => a.length <= b.length ? a : b)

    // Build primary query
    let q = title.replace(/[^\w\s-]/g, ' ').trim()
    if (!batch && episode != null) q += ' ' + String(episode).padStart(2, '0')
    if (batch) q += ' Batch'
    if (resolution) q += ' ' + resolution + 'p'

    // Pass all titles so the server can search them in parallel
    // Use ||| as a separator since titles can contain commas
    const extraTitles = pool.filter(t => t !== title).slice(0, 2) // up to 2 extras
    const titlesParam = extraTitles.length ? extraTitles.join('|||') : ''

    const params = '?q=' + encodeURIComponent(q)
      + '&title=' + encodeURIComponent(title)
      + '&category=1_0'
      + '&batch=' + String(batch)
      + (episode != null        ? '&episode='         + String(episode)         : '')
      + (absoluteEpisode != null ? '&absoluteEpisode=' + String(absoluteEpisode) : '')
      + (resolution             ? '&resolution='      + resolution              : '')
      + (exclusions.length      ? '&exclusions='      + encodeURIComponent(exclusions.join(',')) : '')
      + (titlesParam            ? '&titles='          + encodeURIComponent(titlesParam)          : '')

    const res = await fetch(this.base + params)
    if (!res.ok) return []

    const data = await res.json()
    if (!Array.isArray(data)) return []

    return data.map(item => ({
      title:     item.title     || 'Unknown',
      link:      item.magnet    || item.hash  || item.link || '',
      hash:      item.hash      || '',
      seeders:   Number(item.seeders)   || 0,
      leechers:  Number(item.leechers)  || 0,
      downloads: Number(item.downloads) || 0,
      size:      Number(item.size)      || 0,
      date:      item.date ? new Date(item.date) : new Date(0),
      accuracy:  item.accuracy  || 'low',
    }))
  }

  async test(options, fetch) {
    try {
      const res = await fetch(this.base + '?q=test&category=1_0')
      return res.ok
    } catch {
      return false
    }
  }
}()
