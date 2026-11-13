/** REA experiment controls for newly created chats. */

import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReaExperimentCardFace } from './rea-experiment-card-controller.ts'
import type {} from './slot-contract.ts'
import { PluginCard } from './PluginCard.tsx'
import css from './ReaExperimentCard.module.css'

/** Props bound by the plugin-card slot renderer. */
export type ReaExperimentCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ReaExperimentCardFace>

/**
 * Render staged REA enablement and optional launch configuration.
 * @param props - Localized copy, the card snapshot, and its actions.
 * @returns The card when its Host settings namespace is available.
 */
export function ReaExperimentCard(props: ReaExperimentCardProps) {
  const { t } = props
  const state = props.useReaExperimentCard(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  const advancedDisabled = disabled || !state.enabled
  return (
    <PluginCard
      t={t}
      titleKey="reaTitle"
      descriptionKey="reaDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <div className={css.toggleRow}>
        <span>{t('reaToggle')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          aria-label={t('reaToggle')}
          className={clsx(css.switch, state.enabled && css.switchOn)}
          disabled={disabled}
          onClick={props.toggleEnabled}
        >
          <span className={css.thumb} />
        </button>
      </div>
      <p className={css.hint}>{t('reaNewChats')}</p>
      <p className={css.hint}>{t('reaLocalAccess')}</p>
      <p className={css.hint}>{t('reaStartupFailure')}</p>
      <details className={css.advanced}>
        <summary>{t('reaAdvanced')}</summary>
        <div className={css.field}>
          <label htmlFor="plugin-config-rea-command">{t('reaCommand')}</label>
          <input
            id="plugin-config-rea-command"
            type="text"
            value={state.command}
            disabled={advancedDisabled}
            aria-invalid={state.commandInvalid || undefined}
            onChange={(event) => { props.edit('command', event.target.value) }}
          />
          {state.commandInvalid ? <p className={css.invalid}>{t('reaCommandInvalid')}</p> : null}
        </div>
        <div className={css.field}>
          <label htmlFor="plugin-config-rea-args">{t('reaArgs')}</label>
          <textarea
            id="plugin-config-rea-args"
            rows={3}
            value={state.args}
            disabled={advancedDisabled}
            aria-invalid={state.argsInvalid || undefined}
            onChange={(event) => { props.edit('args', event.target.value) }}
          />
          <p className={state.argsInvalid ? css.invalid : css.hint}>{t(state.argsInvalid ? 'reaArgsInvalid' : 'reaArgsHint')}</p>
        </div>
        <div className={css.field}>
          <label htmlFor="plugin-config-rea-timeout">{t('reaTimeout')}</label>
          <input
            id="plugin-config-rea-timeout"
            type="text"
            inputMode="numeric"
            value={state.toolCallTimeoutMs}
            disabled={advancedDisabled}
            aria-invalid={state.timeoutInvalid || undefined}
            onChange={(event) => { props.edit('toolCallTimeoutMs', event.target.value) }}
          />
          {state.timeoutInvalid ? <p className={css.invalid}>{t('reaTimeoutInvalid')}</p> : null}
        </div>
      </details>
      {state.conflicted ? <p className={css.invalid} role="alert">{t('reaConflict')}</p> : null}
    </PluginCard>
  )
}
