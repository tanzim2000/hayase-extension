import AbstractSource from './abstract.js'

export default new class SubsPlease extends AbstractSource {
    base = 'https://subsplease.org/api/'

    /** @type {import('./').SearchFunction} */
    async single({ titles, episode }) {
        if (!titles?.length) return []

        const query = titles[0] + (episode ? ` ${episode}` : '')
        const url = `${this.base}?f=search&tz=America/New_York&s=${encodeURIComponent(query)}`
        const res = await fetch(url)
        const data = await res.json()

        if (!data || typeof data !== 'object') return []
        return this.map(data)
    }

    /** @type {import('./').SearchFunction} */
    batch = this.single
    movie = this.single
    map(data) {
        const results = []
        for (const key in data) {
            const item = data[key]
            if (!item.downloads) continue

            for (const download of item.downloads) {
                const hash = download.magnet?.match(/btih:([a-fA-F0-9]+)/)?.[1]
                if (!hash) continue

                results.push({
                    title: `${item.show} - ${item.episode} (${download.res}p)`,
                    link: download.magnet,
                    hash,
                    seeders: 0, // API doesn't provide seeders
                    leechers: 0,
                    downloads: 0,
                    size: 0, // API doesn't provide size
                    date: new Date(item.release_date),
                    verified: true,
                    type: 'alt',
                    accuracy: 'high'
                })
            }
        }
        return results
    }

    async test() {
        try {
            const res = await fetch(this.base + '?f=search&tz=America/New_York&s=One%20Piece')
            return res.ok
        } catch {
            return false
        }
    }
}