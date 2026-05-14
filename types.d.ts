export interface Tosho {
  title?: string
  timestamp: number
  torrent_url: string
  torrent_name: string
  info_hash: string
  magnet_uri: string
  seeders: null
  leechers: null
  torrent_downloaded_count?: number
  total_size: number
  num_files: number
  torrent_url?: string
  article_url?: string
  website_url?: string
  nyaa_id?: string
  anidb_aid?: number
  anidb_eid?: number
  anidb_fid?: number
  nzb_url?: string
}

export interface Seadex {
  items: {
    alID: number
    expand: {
      trs: {
        created: Date
        dualAudio: boolean
        files: {
          length: number
          name: string
        }[]
        infoHash: string
        isBest: boolean
        releaseGroup: string
      }[]
    }
    trs: string[]
  }[]
}

export interface SearchInput {
  anilistId?: number;
  titles: string[];
  episodeCount?: number;
  resolution?: number;
}

export interface TorrentResult {
  title: string;
  link: string;
  hash: string;
  size: number;
  seeders: number;
  leechers: number;
  date: Date;
  downloads?: number;
  verified?: boolean;
  accuracy?: 'high' | 'medium' | 'low';
  type?: 'batch' | 'best' | 'alt';
}
