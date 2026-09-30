import type { WindowApi } from '../shared/ipc-contract'

declare global {
  interface Window {
    api: WindowApi
  }
}

export {}
