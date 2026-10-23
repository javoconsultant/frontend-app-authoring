import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { OverlayTrigger, Tooltip } from '@openedx/paragon';

export interface DisabledControlTooltipProps {
  tooltip: string;
  className?: string;
  placement?: ComponentProps<typeof OverlayTrigger>['placement'];
  variant?: 'light';
  tooltipClassName?: string;
  children: ReactNode;
}

/** Explains a disabled control in a tooltip shown on hover and keyboard focus.
 * A disabled button fires no hover or focus events, so the tooltip hangs off a
 * focusable wrapper span instead.
 */
const DisabledControlTooltip = ({
  tooltip,
  className,
  placement = 'top',
  variant,
  tooltipClassName,
  children,
}: DisabledControlTooltipProps) => {
  const tooltipId = useId();

  return (
    <OverlayTrigger
      placement={placement}
      overlay={<Tooltip id={tooltipId} variant={variant} className={tooltipClassName}>{tooltip}</Tooltip>}
    >
      <span className={className} tabIndex={0}>{children}</span>
    </OverlayTrigger>
  );
};

export default DisabledControlTooltip;
