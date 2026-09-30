/**
 * 成果文件浮窗（M5）—— 从消息块中确定性提取产物：
 * artifacts = [全部 file_ref] ∪ [全部 patch files]，按文件名去重。
 * 外置颜色映射沿用 source.ts 的 SOURCE_COLORS 先例（功能色数据，非主题 token）。
 */
import type { ConversationMessage } from '../../../../shared/data-contract'
import { useI18n } from '../../stores/useI18n'
import { useToastStore } from '../../stores/useToastStore'
import { copyText } from '../../utils/clipboard'
import { IconDownload, IconFile } from '../icons'
import copyIcon from '../../assets/icons/copy.svg'

export interface Artifact {
  name: string
  ext: string
}

function extOf(filename: string): string {
  const idx = filename.lastIndexOf('.')
  if (idx > 0 && idx < filename.length - 1) return filename.slice(idx + 1).toLowerCase()
  return filename.toLowerCase() // 无扩展名（如 Dockerfile）
}

/** 确定性产物提取：全部 file_ref ∪ 全部 patch files，按文件名去重 */
export function collectArtifacts(messages: ConversationMessage[]): Artifact[] {
  const seen = new Set<string>()
  const out: Artifact[] = []
  for (const msg of messages) {
    for (const b of msg.blocks) {
      if (b.type === 'file_ref') {
        if (!seen.has(b.filename)) {
          seen.add(b.filename)
          out.push({ name: b.filename, ext: extOf(b.filename) })
        }
      } else if (b.type === 'patch') {
        for (const f of b.files) {
          if (!seen.has(f)) {
            seen.add(f)
            out.push({ name: f, ext: extOf(f) })
          }
        }
      }
    }
  }
  return out
}

export interface ArtifactsPanelProps {
  artifacts: Artifact[]
}

export function ArtifactsPanel({ artifacts }: ArtifactsPanelProps): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const toast = useToastStore((s) => s)

  const copyName = (name: string): void => {
    copyText(name)
      .then(() => toast.success(t('copied')))
      .catch(() => toast.error(t('copyFailed')))
  }

  return (
    <aside className="da-detail__panel">
      <div className="da-panel__header">
        <span className="da-panel__title">{t('artifacts')}</span>
        <span className="da-panel__sep">·</span>
        {/* TODO-i18n: 计数单位 v1 固定中文「个」对齐 Figma F13 */}
        <span className="da-panel__count">{artifacts.length} 个</span>
      </div>
      <div className="da-panel__list">
        {artifacts.map((a) => (
          <div key={a.name} className="da-artifact">
            {/* Figma F12：24px 中性文件图标（无扩展名色块） */}
            <div className="da-artifact__icon" aria-hidden="true">
              <IconFile size={20} />
            </div>
            <div className="da-artifact__info">
              <div className="da-artifact__name" title={a.name}>
                {a.name}
              </div>
            </div>
            <div className="da-artifact__actions">
              <button
                type="button"
                className="da-artifact__iconbtn"
                title={t('copy')}
                aria-label={t('copy')}
                onClick={() => copyName(a.name)}
              >
                <img src={copyIcon} alt="" draggable={false} />
              </button>
              <button
                type="button"
                className="da-artifact__iconbtn"
                title={t('download')}
                aria-label={t('download')}
                onClick={() => toast.info(t('downloadDeveloping'))}
              >
                <IconDownload />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
