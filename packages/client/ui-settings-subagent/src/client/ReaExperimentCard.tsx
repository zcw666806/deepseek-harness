/** REA opt-in for new Web sessions. */

import {
  SettingsForm, SettingsFormModel, Switch,
  type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { formLabels } from './locales.ts'
import css from './SubagentModelSelectionFields.module.css'

interface ReaExperimentSettings {
  enabled: boolean
}

/**
 * Bind the revisioned REA flag without exposing launcher fields.
 * @param scope - form served by the REA profile entry.
 * @returns disposable form model.
 */
export function reaExperimentForm(scope: SettingsFormScope<ReaExperimentSettings>) {
  return new SettingsFormModel(scope, [{
    field: 'enabled',
    format: value => value === true ? 'true' : 'false',
    parse: text => ({ kind: 'set', value: text === 'true' }),
  }])
}

/** State and staged actions supplied to the REA settings page. */
export interface ReaExperimentFace extends SettingsFormActions {
  hooks: { reaExperiment: SnapshotStore<SettingsFormShell & ReaExperimentSettings> }
}

/**
 * Render the REA summary or the staged opt-in switch.
 * @param props - page context, localized copy and the opt-in form.
 * @returns the appropriate Plugins page content.
 */
export function ReaExperimentCard(props: PropsRuntime<'plugins.item'> & PropsLocale<'settings.subagent'> & InjectFace<ReaExperimentFace>) {
  const { t } = props
  const state = props.useReaExperiment(snapshot => snapshot)
  if (props.view === 'summary') return t('reaDescription')
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <div className={css.permission}>
        <div className={css.toggleRow}>
          <span className={css.toggleLabel}>{t('reaToggle')}</span>
          <Switch checked={state.enabled} label={t('reaToggle')} disabled={!state.writable || state.saving}
            onChange={() => { props.edit('enabled', String(!state.enabled)) }} />
        </div>
      </div>
    </SettingsForm>
  )
}
