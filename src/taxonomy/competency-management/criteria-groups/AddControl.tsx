import { useIntl } from '@edx/frontend-platform/i18n';
import { Button } from '@openedx/paragon';
import { Add } from '@openedx/paragon/icons';
import DisabledControlTooltip from '../DisabledControlTooltip';
import messages from './messages';

export interface AddControlProps {
  /** The visible label, such as "Rule" or "Rule Group". */
  label: string;
  onClick: React.MouseEventHandler;
  /** True while a placeholder exists, which explains itself in a tooltip. */
  disabled: boolean;
}

/** The "+ Rule" and "+ Rule Group" control, centered between two connector lines. */
const AddControl = ({ label, onClick, disabled }: AddControlProps) => {
  const intl = useIntl();

  const button = (
    <Button
      variant="outline-primary"
      size="sm"
      iconBefore={Add}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="sr-only">{intl.formatMessage(messages.addControlAccessiblePrefix)}{' '}</span>
      {label}
    </Button>
  );

  return (
    <div className="add-control">
      <span className="add-control__line" aria-hidden="true" />
      {disabled ?
        (
          <DisabledControlTooltip
            tooltip={intl.formatMessage(messages.addControlDisabledTooltip)}
            className="add-control__button-wrapper"
          >
            {button}
          </DisabledControlTooltip>
        ) :
        button}
      <span className="add-control__line" aria-hidden="true" />
    </div>
  );
};

export default AddControl;
