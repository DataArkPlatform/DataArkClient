import type { SVGProps } from 'react'

/**
 * 图标集 —— 路径数据源自原型 HTML（Heroicons 风格 20×20 viewBox）。
 * 全部使用 currentColor，颜色由上层 CSS 变量控制。
 */

export interface IconProps extends SVGProps<SVGSVGElement> {
  /** 渲染尺寸（px），默认 20 */
  size?: number
}

function base({
  size = 20,
  viewBox = '0 0 20 20',
  fill = 'currentColor',
  ...rest
}: IconProps & { viewBox?: string }): IconProps & { viewBox: string; fill: string } {
  return { width: size, height: size, viewBox, fill, ...rest }
}

/** 扫掠箭头（AI Agent） */
export function IconScan(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M3 4a1 1 0 011-1h3a1 1 0 010 2H6.414l3.293 3.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm11.707 4.707a1 1 0 01-1.414-1.414L16.586 4H15a1 1 0 010-2h3a1 1 0 011 1v3a1 1 0 01-2 0v-.586l-3.293 3.293zM5 14.586V13a1 1 0 10-2 0v3a1 1 0 001 1h3a1 1 0 100-2H5.414l1.293-1.293a1 1 0 10-1.414-1.414l-.293.293zM15 14.586V13a1 1 0 112 0v3a1 1 0 01-1 1h-3a1 1 0 110-2h1.586l-1.293-1.293a1 1 0 111.414-1.414l.293.293z"
      />
    </svg>
  )
}

/** 会话气泡（评论 Comments，完成态「查看全部会话」按钮图标，Figma 1660:6856 / 1617:8119） */
export function IconChat(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        d="M15 1.66699C15.4602 1.66699 15.833 2.03976 15.833 2.5V8.33301H18.333C18.7932 8.33301 19.167 8.70675 19.167 9.16699V15.833C19.167 16.2932 18.7932 16.667 18.333 16.667H16.5947L15.5889 17.6729C15.2635 17.9979 14.7365 17.9979 14.4111 17.6729L13.4053 16.667H9.16699C8.70675 16.667 8.33301 16.2932 8.33301 15.833V13.333H7.42871L6.00586 14.7559C5.68042 15.0813 5.15259 15.0813 4.82715 14.7559L3.40527 13.333H1.66699C1.20675 13.333 0.833008 12.9602 0.833008 12.5V2.5C0.833008 2.03976 1.20675 1.66699 1.66699 1.66699H15ZM15.833 12.5C15.833 12.9602 15.4602 13.333 15 13.333H10V15H13.75C13.9709 15 14.1826 15.088 14.3389 15.2441L15 15.9053L15.6611 15.2441L15.7217 15.1885C15.87 15.067 16.0566 15 16.25 15H17.5V10H15.833V12.5ZM5 8.33301C4.53976 8.33301 4.16699 8.70675 4.16699 9.16699C4.16717 9.62708 4.53987 10 5 10H7.5C7.96013 10 8.33283 9.62708 8.33301 9.16699C8.33301 8.70675 7.96024 8.33301 7.5 8.33301H5ZM5 5C4.53987 5 4.16717 5.37292 4.16699 5.83301C4.16699 6.29325 4.53976 6.66699 5 6.66699H10C10.4602 6.66699 10.833 6.29325 10.833 5.83301C10.8328 5.37292 10.4601 5 10 5H5Z"
      />
    </svg>
  )
}

/** 文件夹（我的项目） */
export function IconFolder(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
    </svg>
  )
}

/** 回收站/垃圾箱 */
export function IconTrash(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
      />
    </svg>
  )
}

/** 齿轮（设置） */
export function IconSettings(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
      />
    </svg>
  )
}

/** 折叠箭头（16 viewBox 描边） */
export function IconChevronDown(props: IconProps): React.JSX.Element {
  const p = base({ ...props, size: props.size ?? 10, viewBox: '0 0 16 16', fill: 'none' })
  return (
    <svg {...p} aria-hidden="true">
      <path
        d="M6 3l5 5-5 5"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 更多操作（··· 圆点） */
export function IconMore(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <circle cx="4.5" cy="10" r="1.7" />
      <circle cx="10" cy="10" r="1.7" />
      <circle cx="15.5" cy="10" r="1.7" />
    </svg>
  )
}

/** 星标 */
export function IconStar(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 搜索 */
export function IconSearch(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 对勾（特性行/勾选框） */
export function IconCheck(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 成功圆标（Toast success） */
export function IconCheckCircle(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 错误圆标（Toast error） */
export function IconXCircle(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 警告三角（Toast warning） */
export function IconWarning(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 信息圆标（Toast info） */
export function IconInfo(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 注意圆标（Toast warning/info · Figma Attention：圆底 + 感叹号） */
export function IconAttention(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-13a1 1 0 011 1v5a1 1 0 11-2 0V6a1 1 0 011-1zM11 14.5a1 1 0 11-2 0 1 1 0 012 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 点击手势（扫描页手动读取按钮 · Figma Click-tap 1660:7029） */
export function IconClickTap(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.5 4.16699C8.65061 4.16699 9.58301 5.09939 9.58301 6.25V7.95801C9.71771 7.93065 9.85722 7.91699 10 7.91699C10.4696 7.91699 10.9016 8.0738 11.25 8.33594C11.5984 8.0738 12.0304 7.91699 12.5 7.91699C12.9696 7.91699 13.4016 8.0738 13.75 8.33594C14.0984 8.0738 14.5304 7.91699 15 7.91699C16.1506 7.91699 17.083 8.84939 17.083 10V13.125C17.083 16.2316 14.5646 18.75 11.458 18.75H11.042C7.93538 18.75 5.41699 16.2316 5.41699 13.125V6.25C5.41699 5.09939 6.34939 4.16699 7.5 4.16699ZM7.5 5.83301C7.26986 5.83301 7.08301 6.01986 7.08301 6.25V13.125C7.08301 15.3111 8.85585 17.083 11.042 17.083H11.458C13.6441 17.083 15.417 15.3111 15.417 13.125V10C15.417 9.76986 15.2301 9.58301 15 9.58301C14.7699 9.58301 14.583 9.76986 14.583 10V12.083C14.583 12.5432 14.2102 12.917 13.75 12.917C13.2898 12.917 12.917 12.5432 12.917 12.083V10C12.917 9.76986 12.7301 9.58301 12.5 9.58301C12.2699 9.58301 12.083 9.76986 12.083 10V12.083C12.083 12.5432 11.7102 12.917 11.25 12.917C10.7898 12.917 10.417 12.5432 10.417 12.083V10C10.417 9.76986 10.2301 9.58301 10 9.58301C9.76986 9.58301 9.58301 9.76986 9.58301 10V12.083C9.58301 12.5432 9.21024 12.917 8.75 12.917C8.28976 12.917 7.91699 12.5432 7.91699 12.083V6.25C7.91699 6.01986 7.73014 5.83301 7.5 5.83301ZM7.5 1.25C9.14862 1.25 10.6111 2.04926 11.5205 3.27734C11.845 3.7156 12.0992 4.20947 12.2676 4.74219C12.4182 5.219 12.5 5.72586 12.5 6.25C12.5 6.71013 12.1271 7.08283 11.667 7.08301C11.2068 7.08301 10.833 6.71024 10.833 6.25C10.833 5.89825 10.7796 5.56048 10.6797 5.24414C10.5679 4.89022 10.3974 4.56121 10.1807 4.26855C9.572 3.44685 8.59798 2.91699 7.5 2.91699C6.40203 2.91699 5.42801 3.44685 4.81934 4.26855C4.6026 4.56125 4.43214 4.89025 4.32031 5.24414C4.22038 5.56047 4.16699 5.89823 4.16699 6.25C4.16699 6.71024 3.79325 7.08301 3.33301 7.08301C2.87292 7.08283 2.5 6.71013 2.5 6.25C2.5 5.72598 2.58087 5.21893 2.73145 4.74219C2.89981 4.20943 3.15503 3.71557 3.47949 3.27734C4.38894 2.04926 5.85138 1.25 7.5 1.25Z"
      />
    </svg>
  )
}

/** 铃铛（Toast neutral） */
export function IconBell(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 003 13h14a1 1 0 00.707-1.707L17 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 窗口控件共用描边基底（16 viewBox） */
function strokeBase(props: IconProps): IconProps & { viewBox: string; fill: string } {
  const { size = 14 } = props
  return {
    ...props,
    size,
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }
}

/** 最小化 − */
export function IconMinimize(props: IconProps): React.JSX.Element {
  return (
    <svg {...strokeBase(props)} aria-hidden="true">
      <path d="M3.5 8.5h9" />
    </svg>
  )
}

/** 最大化/还原 □ */
export function IconMaximize(props: IconProps): React.JSX.Element {
  return (
    <svg {...strokeBase(props)} aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="1.5" />
    </svg>
  )
}

/** 还原窗口（最大化态：后方大框 + 前方小框，Windows 还原语义） */
export function IconMaximizeRestore(props: IconProps): React.JSX.Element {
  return (
    <svg {...strokeBase(props)} aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="1.5" />
      <rect x="5.5" y="5.5" width="7" height="7" rx="1.5" />
    </svg>
  )
}

/** 关闭 × */
export function IconClose(props: IconProps): React.JSX.Element {
  return (
    <svg {...strokeBase(props)} aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  )
}

/** 加号（新建分组） */
export function IconPlus(props: IconProps): React.JSX.Element {
  const p = base({ ...props, size: props.size ?? 14, viewBox: '0 0 16 16' })
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8 3a1 1 0 011 1v3h3a1 1 0 110 2H9v3a1 1 0 11-2 0V9H4a1 1 0 110-2h3V4a1 1 0 011-1z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 减号（全选半选态） */
export function IconDash(props: IconProps): React.JSX.Element {
  const p = base({ ...props, size: props.size ?? 14, viewBox: '0 0 16 16' })
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M3.5 8a1 1 0 011-1h7a1 1 0 110 2h-7a1 1 0 01-1-1z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 铅笔（重命名） */
export function IconPencil(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
    </svg>
  )
}

/** 下载（导出） */
export function IconDownload(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 3a1 1 0 011 1v5.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 111.414-1.414L9 9.586V4a1 1 0 011-1zm-7 9a1 1 0 011 1v1h10v-1a1 1 0 112 0v1a2 2 0 01-2 2H4a2 2 0 01-2-2v-1a1 1 0 011-1z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/* ============ M5 · 会话详情页新增图标（勿改既有导出） ============ */

/** 返回箭头 ← */
export function IconArrowLeft(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M17 10a1 1 0 01-1 1H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 111.414 1.414L5.414 9H16a1 1 0 011 1z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 文件（文档描边，patch / file_ref / 成果卡片用） */
export function IconFile(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm2 7a1 1 0 100 2h4a1 1 0 100-2H8zm-1 5a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 右向折叠箭头（成果面板收起/展开） */
export function IconChevronRight(props: IconProps): React.JSX.Element {
  const p = base({ ...props, size: props.size ?? 10, viewBox: '0 0 16 16', fill: 'none' })
  return (
    <svg {...p} aria-hidden="true">
      <path
        d="M6 3l5 5-5 5"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** 调色盘（外观分段控件） */
export function IconPalette(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 3a7 7 0 100 14h.5a1.5 1.5 0 001.5-1.5c0-.4-.16-.76-.42-1.03a1.5 1.5 0 011.06-2.47H14A3 3 0 0017 9c0-3.31-3.13-6-7-6zM6.5 8.5a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5zm3.5 0a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5zM12.5 7a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** 帮助（？圆标） */
export function IconHelp(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 1111 13a1 1 0 01-1-1 1 1 0 01.5-.866A2 2 0 1010 7zm-1 8a1 1 0 112 0 1 1 0 01-2 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/* ============ 垃圾箱 · Figma 1660:9913 图标（恢复/彻底删除/清空） ============ */

/** 恢复（Figma Frame 1660:10326/10356 · 环形回转箭头，20 viewBox 按 size 缩放） */
export function IconRestore(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path d="M18.9749 9.09352L15.689 5.01456C15.3491 4.56135 14.6693 4.56135 14.3294 5.01456L11.0435 9.09352C10.8169 9.43344 11.0435 9.88665 11.3835 9.88665H12.6298C12.6298 12.266 12.6298 15.3253 8.32424 17.818C8.21093 17.9313 8.32424 18.0446 8.43754 18.0446C16.4822 16.7982 17.162 11.3596 17.162 9.88665H18.5216C18.9748 9.88665 19.2015 9.43344 18.9749 9.09352ZM8.66415 10.1133H7.3045C7.3045 7.73387 7.3045 4.67465 11.6101 2.18195C11.7234 2.06865 11.6101 1.95534 11.4968 1.95534C3.45215 3.20169 2.77232 8.64031 2.77232 10.1133H1.41267C0.959448 10.1133 0.73284 10.5665 1.07275 10.9064L4.35858 14.9854C4.69849 15.4386 5.37832 15.4386 5.71823 14.9854L9.00406 10.9064C9.23067 10.5665 9.00406 10.1133 8.66415 10.1133Z" />
    </svg>
  )
}

/** 彻底删除/清空（Figma Format 1660:10330/10360 · 实心垃圾桶，20 viewBox 按 size 缩放） */
export function IconTrashFilled(props: IconProps): React.JSX.Element {
  const p = base(props)
  return (
    <svg {...p} aria-hidden="true">
      <path d="M11.667 1.63086C12.127 1.63104 12.4998 2.00389 12.5 2.46387V4.96387H17.917C18.3771 4.96404 18.75 5.33773 18.75 5.79785V9.13086C18.75 9.59099 18.3771 9.96369 17.917 9.96387H17.5V16.667C17.4998 17.127 17.127 17.4998 16.667 17.5H3.33301C2.87303 17.4998 2.50018 17.127 2.5 16.667V9.96387H2.08301C1.62292 9.96369 1.25 9.59099 1.25 9.13086V5.79785C1.25001 5.33773 1.62293 4.96404 2.08301 4.96387H7.5V2.46387C7.50018 2.00389 7.87303 1.63104 8.33301 1.63086H11.667ZM6.66699 13.2979C6.20675 13.2979 5.83301 13.6716 5.83301 14.1318V15.833H7.5V14.1318C7.5 13.6717 7.12708 13.298 6.66699 13.2979ZM10 13.291C9.5399 13.291 9.16721 13.664 9.16699 14.124V15.833H10.833V14.124C10.8328 13.664 10.4601 13.291 10 13.291ZM13.333 13.2979C12.8729 13.298 12.5 13.6717 12.5 14.1318V15.833H14.167V14.1318C14.167 13.6716 13.7932 13.2979 13.333 13.2979ZM9.16699 5.79785C9.16682 6.25794 8.79314 6.63086 8.33301 6.63086H2.91699V8.29785H17.083V6.63086H11.667C11.2069 6.63086 10.8332 6.25794 10.833 5.79785V3.29785H9.16699V5.79785Z" />
    </svg>
  )
}
