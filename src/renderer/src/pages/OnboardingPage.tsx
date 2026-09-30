/**
 * 引导页 —— 弹性布局 + Figma 背景整层（SVG 导出，颜色 100% 保真）。
 * 纵向节奏对齐设计稿：Logo区 → 渐变描述×2 → 特性卡横排 → 信息组 → CTA → 复选框。
 */
import { useState } from 'react'
import { useAppStore } from '../stores/useAppStore'
import { useI18n } from '../stores/useI18n'
import { IconCheck } from '../components/icons'
import { Modal } from '../components/Modal'
import onboardingBg from '../assets/onboarding/onboarding-bg.svg'
import logoHero from '../assets/logo/logo-hero.png'
import infoCheck from '../assets/onboarding/info-check.png'
import featTransparent from '../assets/features/feature-transparent.png'
import featOffline from '../assets/features/feature-offline.png'
import featControl from '../assets/features/feature-control.png'

/* TODO-i18n: 特性卡文案（v1 固定中文） */
const FEATURE_CARDS = [
  {
    img: featTransparent,
    title: '代码完全透明',
    desc: '开源可审计(MIT协议)',
    tone: 'blue'
  },
  {
    img: featOffline,
    title: '全程离线可用',
    desc: '不发起任何非必要网络请求',
    tone: 'purple'
  },
  {
    img: featControl,
    title: '拥有完全控制权',
    desc: '数据仅存储在本地备份目录',
    tone: 'green'
  }
] as const

export function OnboardingPage(): React.JSX.Element {
  const t = useI18n((s) => s.t)
  const navigate = useAppStore((s) => s.navigate)
  const previousPage = useAppStore((s) => s.previousPage)
  const [agreed, setAgreed] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)

  const handleStart = async () => {
    if (!agreed) return
    try {
      await window.api.data.setSetting('onboarding.completed', true)
    } catch (err) {
      // 持久化失败不阻断进入，但打日志便于排查（避免静默丢失"已完成"状态）
      console.error('[onboarding] 持久化引导完成状态失败', err)
    }
    // 从设置页进入的重新查看引导：完成后回到设置页；首启则进入会话列表。
    // 注意不能用 back()：它会消费 previousPage（'settings'→null），导致设置页
    // 的关闭逻辑 back() 变成空操作而无法关闭。这里直接恢复设置浮层，并给回
    // 一个有效的返回目标（原底层页面在跳转链中已丢失，按 AppShell 默认回落 AI Agent 页）。
    if (previousPage === 'settings') {
      useAppStore.setState({ currentPage: 'settings', previousPage: 'scan' })
    } else {
      navigate('conversations')
    }
  }

  /* 信息组三条行文案（复用原型 i18n 键） */
  const infoRows = [t('privacy1'), t('privacy2'), t('privacy3')]

  return (
    <div className="da-onboarding da-onboarding--figma">
      {/* 背景层：Figma 导出 SVG（渐变+场景+纹理已合成，颜色保真） */}
      <img className="da-onboarding__bg" src={onboardingBg} alt="" aria-hidden="true" />

      {/* 内容层：z-index 高于背景 */}
      <div className="da-onb-flow">
        {/* Logo 区（位图 + 副标语） */}
        <img className="da-onb-hero" src={logoHero} alt="语料方舟 DataArt" />
        <div className="da-onb-tagline">{t('privacyMsg')}</div>

        {/* 两行渐变描述 */}
        <p className="da-onb-desc">
          一键读取电脑上的所有AI会话记录，统一管理、全文搜索、本地备份。
        </p>
        <p className="da-onb-desc da-onb-desc--second">数据全程留在你的电脑，不上传任何服务器。</p>

        {/* 特性卡横排 */}
        <div className="da-onb-cards">
          {FEATURE_CARDS.map((card) => (
            <div key={card.title} className={`da-onb-card da-onb-card--${card.tone}`}>
              {/* <span className="da-onb-card__glow" aria-hidden="true" /> */}
              <div className="da-onb-card__text">
                <div className="da-onb-card__title">{card.title}</div>
                <div className="da-onb-card__desc">{card.desc}</div>
              </div>
              <img className="da-onb-card__icon" src={card.img} alt="" aria-hidden="true" />
            </div>
          ))}
        </div>

        {/* 信息组 */}
        <div className="da-onb-infos">
          {infoRows.map((row) => (
            <div key={row} className="da-onb-info-row">
              <img className="da-onb-info-row__icon" src={infoCheck} alt="" aria-hidden="true" />
              <span className="da-onb-info-row__text">{row}</span>
            </div>
          ))}
        </div>

        {/* CTA 在复选框上方（Figma y604 < y688） */}
        <button
          type="button"
          className="da-onboarding__cta"
          disabled={!agreed}
          onClick={handleStart}
        >
          {t('startUse')}
        </button>

        <div className="da-onboarding__check">
          <button
            type="button"
            className="da-onboarding__check-toggle"
            role="checkbox"
            aria-checked={agreed}
            aria-label={t('privacyAgree')}
            onClick={() => setAgreed((v) => !v)}
          >
            <span className={agreed ? 'da-checkbox da-checkbox--checked' : 'da-checkbox'}>
              {agreed && <IconCheck size={12} />}
            </span>
          </button>
          <span className="da-onboarding__agree-text" onClick={() => setAgreed((v) => !v)}>
            {t('privacyAgree')}
          </span>
          <button
            type="button"
            className="da-onboarding__statement"
            onClick={() => setPrivacyOpen(true)}
          >
            {t('privacyStatement')}
          </button>
        </div>
      </div>

      {/* 隐私声明弹窗（点击「隐私声明」打开） */}
      <Modal open={privacyOpen} onClose={() => setPrivacyOpen(false)} title={t('privacyTitle')} width={520}>
        <div className="da-privacy">
          <p className="da-privacy__intro">{t('privacyIntro')}</p>
          <p className="da-privacy__item">{t('privacyBody1')}</p>
          <p className="da-privacy__item">{t('privacyBody2')}</p>
          <p className="da-privacy__item">{t('privacyBody3')}</p>
          <p className="da-privacy__item">{t('privacyBody4')}</p>
          <p className="da-privacy__item">{t('privacyBody5')}</p>
          <p className="da-privacy__footer">{t('privacyFooter')}</p>
        </div>
        <div className="da-modal__actions">
          <button type="button" className="da-btn da-btn--primary" onClick={() => setPrivacyOpen(false)}>
            {t('confirm')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
