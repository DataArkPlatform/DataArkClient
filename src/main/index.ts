import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { IPC } from '../shared/ipc-contract'
import { registerDataIpc, getDataDaos } from './ipc'
import { initScheduler, stopScheduler } from './services/scheduler'

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#EFF1F5',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 最大化状态变更推送给 renderer（标题栏图标切换）
  win.on('maximize', () => win.webContents.send(IPC.windowMaximizedChanged, true))
  win.on('unmaximize', () => win.webContents.send(IPC.windowMaximizedChanged, false))

  // 外部链接一律走系统浏览器；协议白名单防 file:/自定义协议 被 ShellExecute 执行
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function registerIpc(): void {
  registerDataIpc()

  ipcMain.handle(IPC.ping, () => 'pong')

  ipcMain.handle(IPC.windowMinimize, () => {
    mainWindow?.minimize()
  })
  ipcMain.handle(IPC.windowIsMaximized, () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle(IPC.windowToggleMaximize, () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.handle(IPC.windowClose, () => {
    mainWindow?.close()
  })
}

app.whenReady().then(() => {
  registerIpc()
  initScheduler(getDataDaos) // M7：垃圾箱自动清理 + 自动读取定时
  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('will-quit', () => {
  stopScheduler()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
