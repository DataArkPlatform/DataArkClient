/**
 * 数据共享 store —— 侧栏分组树 ↔ 会话管理页的桥接。
 * - groups：我的项目分组树（含计数）
 * - activeGroupId：会话列表的「按分组」过滤（侧栏点击分组头触发）
 * - conversationTotal：会话管理导航徽标数字
 * - version：任何分组/会话移动操作后 +1，会话页据此刷新列表
 */
import { create } from 'zustand'
import type { GroupSummary } from '../../../shared/data-contract'

interface DataState {
  groups: GroupSummary[]
  groupsLoaded: boolean
  /** 会话列表当前的分组过滤；null = 不限分组 */
  activeGroupId: string | null
  conversationTotal: number | null
  /** 当前打开的会话 id（详情页 M5 消费） */
  currentConvId: string | null
  /** 数据变更版本号 —— 会话页订阅，变化即重新拉取 */
  version: number
  refreshGroups: () => Promise<void>
  setActiveGroupId: (id: string | null) => void
  setConversationTotal: (total: number | null) => void
  openConversation: (id: string) => void
  createGroup: (name: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  removeGroup: (id: string) => Promise<void>
  assignGroup: (sessionIds: string[], groupId: string | null) => Promise<void>
  /** 手动触发数据版本 +1（如撤销删除后刷新列表/徽标） */
  bumpVersion: () => void
}

export const useDataStore = create<DataState>((set, get) => ({
  groups: [],
  groupsLoaded: false,
  activeGroupId: null,
  conversationTotal: null,
  currentConvId: null,
  version: 0,

  refreshGroups: async () => {
    try {
      const groups = await window.api.data.listGroups()
      set({ groups, groupsLoaded: true })
    } catch (err) {
      console.error('[data] refreshGroups 失败', err)
      set({ groups: [], groupsLoaded: true })
    }
  },

  setActiveGroupId: (id) => set({ activeGroupId: id }),

  setConversationTotal: (total) => set({ conversationTotal: total }),

  openConversation: (id) => set({ currentConvId: id }),

  createGroup: async (name) => {
    const group = await window.api.data.createGroup(name)
    set((s) => ({
      groups: [...s.groups, group],
      version: s.version + 1
    }))
  },

  renameGroup: async (id, name) => {
    await window.api.data.renameGroup(id, name)
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, name } : g)),
      version: s.version + 1
    }))
  },

  removeGroup: async (id) => {
    await window.api.data.removeGroup(id)
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      activeGroupId: s.activeGroupId === id ? null : s.activeGroupId,
      version: s.version + 1
    }))
  },

  assignGroup: async (sessionIds, groupId) => {
    await window.api.data.assignGroup(sessionIds, groupId)
    set((s) => ({ version: s.version + 1 }))
    // 组内会话数变动 → 重拉权威计数
    await get().refreshGroups()
  },

  bumpVersion: () => set((s) => ({ version: s.version + 1 }))
}))
