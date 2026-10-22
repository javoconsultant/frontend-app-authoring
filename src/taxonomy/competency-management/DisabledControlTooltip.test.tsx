import {
  initializeMocks,
  render,
  screen,
  userEvent,
} from '@src/testUtils';
import DisabledControlTooltip from './DisabledControlTooltip';

const tooltipText = 'Fill in the empty box first.';

const renderDisabledButton = () =>
  render(
    <DisabledControlTooltip tooltip={tooltipText}>
      <button type="button" disabled>Add</button>
    </DisabledControlTooltip>,
  );

const wrapperOf = (element: HTMLElement) => element.closest('span[tabindex="0"]') as HTMLElement;

describe('<DisabledControlTooltip />', () => {
  beforeEach(() => {
    initializeMocks();
  });

  it('describes the disabled control by its tooltip when the wrapper is hovered', async () => {
    const user = userEvent.setup();
    renderDisabledButton();
    const wrapper = wrapperOf(screen.getByRole('button', { name: 'Add' }));

    await user.hover(wrapper);

    const tooltip = await screen.findByText(tooltipText);
    expect(wrapper).toHaveAttribute('aria-describedby', tooltip.closest('[role="tooltip"]')!.id);
  });

  it('shows the tooltip when the wrapper takes keyboard focus', async () => {
    const user = userEvent.setup();
    renderDisabledButton();

    await user.tab();

    expect(wrapperOf(screen.getByRole('button', { name: 'Add' }))).toHaveFocus();
    expect(await screen.findByText(tooltipText)).toBeInTheDocument();
  });
});
