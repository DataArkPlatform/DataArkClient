/**
 * DAO 聚合工厂 —— ingest / 服务层 / 测试统一入口
 */
import type { Database as DatabaseType } from 'better-sqlite3'
import { SessionsDao } from './sessions.dao'
import { MessagesDao } from './messages.dao'
import { GroupsDao } from './groups.dao'
import { TrashDao } from './trash.dao'
import { SettingsDao } from './settings.dao'
import { ReadStateDao } from './read_state.dao'

export interface DaoBundle {
  sessions: SessionsDao
  messages: MessagesDao
  groups: GroupsDao
  trash: TrashDao
  settings: SettingsDao
  readState: ReadStateDao
}

export function createDaos(db: DatabaseType): DaoBundle {
  return {
    sessions: new SessionsDao(db),
    messages: new MessagesDao(db),
    groups: new GroupsDao(db),
    trash: new TrashDao(db),
    settings: new SettingsDao(db),
    readState: new ReadStateDao(db)
  }
}
