import AbstractSource from './abstract.js'

const QUALITIES = ['1080', '720', '540', '480']

export default new class Tosho extends AbstractSource {
  url = atob('aHR0cHM6Ly9mZWVkLmFuaW1ldG9zaG8ub3JnL2pzb24=')

  buildQuery ({ resolution, exclusions }) {
    const base = `&qx=1&q=!("${exclusions.join('"|"')}")`
    if (!resolution) return base

    const excl = QUALITIES.filter(q => q !== resolution)
    return base + `!(*${excl.join('*|*')}*)`
  }

  /**
   * @param {import('./types').Tosho[]} entries
   * @param {boolean} batch
   * @returns {import('./').TorrentResult[]}
   **/
  map (entries, batch = false) {
    return entries.map(entry => {
      return {
        title: entry.title || entry.torrent_name,
        link: entry.magnet_uri,
        seeders: (entry.seeders || 0) >= 30000 ? 0 : entry.seeders || 0,
        leechers: (entry.leechers || 0) >= 30000 ? 0 : entry.leechers || 0,
        downloads: entry.torrent_downloaded_count || 0,
        hash: entry.info_hash,
        size: entry.total_size,
        accuracy: entry.anidb_fid ? 'high' : 'medium',
        type: batch ? 'batch' : undefined,
        date: new Date(entry.timestamp * 1000)
      }
    })
  }

  /** @type {import('./').SearchFunction} */
  async single ({ anidbEid, resolution, exclusions }) {
    if (!anidbEid) throw new Error('No anidbEid provided')
    const query = this.buildQuery({ resolution, exclusions })
    const res = await fetch(this.url + '?eid=' + anidbEid + query)

    /** @type {import('./types').Tosho[]} */
    const data = await res.json()

    if (data.length) return this.map(data)
    return []
  }

  /** @type {import('./').SearchFunction} */
  async batch ({ anidbAid, resolution, episodeCount, exclusions }) {
    if (!anidbAid) throw new Error('No anidbAid provided')
    if (episodeCount == null) throw new Error('No episodeCount provided')
    const query = this.buildQuery({ resolution, exclusions })
    const res = await fetch(this.url + '?order=size-d&aid=' + anidbAid + query)

    const data = /** @type {import('./types').Tosho[]} */(await res.json()).filter(entry => entry.num_files >= episodeCount)

    if (data.length) return this.map(data, true)
    return []
  }

  /** @type {import('./').SearchFunction} */
  async movie ({ anidbAid, resolution, exclusions }) {
    if (!anidbAid) throw new Error('No anidbAid provided')
    const query = this.buildQuery({ resolution, exclusions })
    const res = await fetch(this.url + '?aid=' + anidbAid + query)

    /** @type {import('./types').Tosho[]} */
    const data = await res.json()

    if (data.length) return this.map(data)
    return []
  }

  async test () {
    const res = await fetch(this.url)
    return res.ok
  }
}()
