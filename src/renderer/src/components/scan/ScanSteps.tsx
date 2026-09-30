/**
 * 步骤指示器（01 手动读取/读取中 → 02 读取完成）。
 * active=1：第一步激活（待读取态 AI Agent-1 / 读取中态 AI Agent-2）；
 * active=2：第二步激活（完成态 AI Agent-3）。
 * 头像含内框插画（激活=蓝 / 未激活=灰）+ 右下角标（01=齿轮，02=对勾），
 * 角标切图对应 Figma imgSubtract / imgFrame4。
 */
import { useI18n } from '../../stores/useI18n'
import stepsArrow from '../../assets/icons/steps-arrow.svg'
import step1Inner from '../../assets/icons/step1-inner.svg'
import step2Inner from '../../assets/icons/step2-inner.svg'
import step1Corner from '../../assets/icons/step1-corner.svg'
import step2Corner from '../../assets/icons/step2-corner.svg'

interface ScanStepsProps {
  active: 1 | 2
  /** 读取中态：第一步标签为「读取中...」（AI Agent-2 1660:183） */
  running?: boolean
}

export function ScanSteps({ active, running = false }: ScanStepsProps): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const step1Label = running ? t('readingStep') : t('manualRead')

  return (
    <div className="da-scan-steps">
      <div className={active === 1 ? 'da-scan-step da-scan-step--active' : 'da-scan-step'}>
        <span className="da-scan-step__avatar" aria-hidden="true">
          <img
            className="da-scan-step__inner"
            src={active === 1 ? step1Inner : step2Inner}
            alt=""
            draggable={false}
          />
          <img className="da-scan-step__corner" src={step1Corner} alt="" draggable={false} />
        </span>
        <span className="da-scan-step__text">
          <strong className="da-scan-step__num">01</strong>
          <span className="da-scan-step__label">{step1Label}</span>
        </span>
      </div>
      <img className="da-scan-steps__arrow" src={stepsArrow} alt="" draggable={false} />
      <div className={active === 2 ? 'da-scan-step da-scan-step--active' : 'da-scan-step'}>
        <span className="da-scan-step__avatar" aria-hidden="true">
          <img
            className="da-scan-step__inner"
            src={active === 2 ? step1Inner : step2Inner}
            alt=""
            draggable={false}
          />
          <img className="da-scan-step__corner" src={step2Corner} alt="" draggable={false} />
        </span>
        <span className="da-scan-step__text">
          <strong className="da-scan-step__num">02</strong>
          <span className="da-scan-step__label">{t('readDone')}</span>
        </span>
      </div>
    </div>
  )
}
