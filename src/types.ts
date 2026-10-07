export const languages = ['zh-CN', 'en-US', 'ja-JP'] as const
export type Language = typeof languages[number]
export const channels = ['release', 'beta', 'preview'] as const
export type Channel = typeof channels[number]
export type Level = 'info' | 'warning' | 'critical'
export type Translations = Record<Language, string>

export interface Announcement {
  schemaVersion: 1
  id: string
  publishedAt: string
  updatedAt: string
  level: Level
  title: Translations
  content: Translations
  minAppVersion: string | null
  maxAppVersion: string | null
  channels: Channel[]
}

export interface ManifestEntry {
  id: string
  path?: string
  publishedAt: string
  updatedAt: string
  enabled: boolean
  revision: number
  sha256: string
  minAppVersion: string | null
  maxAppVersion: string | null
  channels: Channel[]
}

export interface Manifest { schemaVersion: 1; announcements: ManifestEntry[] }
export interface AdminListItem extends ManifestEntry { title: Translations; level: Level }
export interface AnnouncementDetail { announcement: Announcement; entry: ManifestEntry; fileSha: string; manifestSha: string | null; actualSha256: string }
