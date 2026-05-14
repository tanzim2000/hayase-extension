import AbstractSource from './abstract.js'

export default new class SeaDex extends AbstractSource {
  url = atob('aHR0cHM6Ly9yZWxlYXNlcy5tb2UvYXBpL2NvbGxlY3Rpb25zL2VudHJpZXMvcmVjb3Jkcw==')

  /** @type {import('./').SearchFunction} */
  async single ({ anilistId, titles, episodeCount }) {
    if (!anilistId) throw new Error('No anilistId provided')
    if (!titles?.length) throw new Error('No titles provided')
    const res = await fetch(`${this.url}?page=1&perPage=1&filter=alID%3D%22${anilistId}%22&skipTotal=1&expand=trs`)

    /** @type {import('./types').Seadex} */
    const { items } = await res.json()

    if (!items[0]?.expand?.trs?.length) return []

    const { trs } = items[0].expand

    return trs.filter(({ infoHash, files }) => {
      if (infoHash === '<redacted>') return false
      if (episodeCount && episodeCount !== 1 && files.length === 1) return false // skip sigle file spam for now
      return true
    }).map(torrent => {
      return {
        hash: torrent.infoHash,
        link: torrent.infoHash,
        title: torrent.files.length === 1 ? torrent.files[0].name : `[${torrent.releaseGroup}] ${titles[0]} ${torrent.dualAudio ? 'Dual Audio' : ''}`,
        size: torrent.files.reduce((prev, curr) => prev + curr.length, 0),
        type: torrent.isBest ? 'best' : 'alt',
        date: new Date(torrent.created),
        seeders: 0,
        leechers: 0,
        downloads: 0,
        accuracy: 'high'
      }
    })
  }

  batch = this.single
  movie = this.single

  async test () {
    const res = await fetch(this.url)
    return res.ok
  }
}()
