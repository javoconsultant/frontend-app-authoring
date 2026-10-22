import type { ReactNode } from 'react';
import {
  CompetencyAssociationsContext,
  type CompetencyAssociationsContextValue,
} from './CompetencyAssociationsContext';

/** Builds a full `CompetencyAssociationsContextValue`, overriding only the
 * fields a given test cares about. Used by component tests below
 * `CompetencyAssociationsProvider` that want to control focus/data state
 * directly, without mocking every HTTP request the real provider would
 * otherwise issue - the provider's own data-fetching and focus mechanics
 * get their own dedicated coverage in `CompetencyAssociationsContext.test.tsx`.
 */
export const buildMockCompetencyAssociationsContextValue = (
  overrides: Partial<CompetencyAssociationsContextValue> = {},
): CompetencyAssociationsContextValue => ({
  focus: null,
  placeholder: { parentRuleGroupId: null, logicOperator: 'OR', rulePayload: null },
  addPlaceholderRuleBox: jest.fn(),
  addPlaceholderGroup: jest.fn(),
  setPlaceholderLogicOperator: jest.fn(),
  setPlaceholderRulePayload: jest.fn(),
  discardPlaceholder: jest.fn(),
  hasPlaceholder: false,
  placeholderDuplicateRejected: false,
  focusGroup: jest.fn(),
  focusRuleBox: jest.fn(),
  notifyCourseExpanded: jest.fn(),
  associateSubsection: jest.fn(),
  updateGroupOperator: jest.fn(),
  deleteGroup: jest.fn(),
  isDeletingGroup: false,
  removePlaceholderGroup: jest.fn(),
  keyboardFocusRequest: null,
  consumeKeyboardFocusRequest: jest.fn(),
  updateRuleScore: jest.fn().mockResolvedValue(undefined),
  canEditCourse: () => true,
  conflictingCompetencyName: () => undefined,
  groupsQuery: {
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: { groups: [], criteria: [], criteriaCount: 0, totalCriteriaCount: 0 },
  } as unknown as CompetencyAssociationsContextValue['groupsQuery'],
  profileQuery: {
    isLoading: false,
    isError: false,
    isSuccess: true,
    data: undefined,
  } as unknown as CompetencyAssociationsContextValue['profileQuery'],
  isLoadingAssociations: false,
  index: undefined,
  systemDefaultProfile: undefined,
  associatedObjectIds: new Set(),
  accessibleCourseGroups: [],
  areCourseOutlinesLoading: false,
  competencyExternalId: null,
  notifyCoursesDisplayed: jest.fn(),
  displayedCourseKeys: undefined,
  competencyName: 'Test Competency',
  ...overrides,
});

/** Matches the element whose `textContent` is `text`. Testing Library's string matcher reads only an element's
 * own text nodes, so it misses text split by a `<strong>`.
 */
export const byTextContent = (text: string) => (_content: string, element: Element | null) =>
  element?.textContent === text;

export interface MockCompetencyAssociationsProviderProps {
  value?: Partial<CompetencyAssociationsContextValue>;
  children: ReactNode;
}

/** A lightly-mocked stand-in for `CompetencyAssociationsProvider` - renders
 * the raw context directly with a hand-built value, instead of the real
 * provider's own data-fetching.
 */
export const MockCompetencyAssociationsProvider = ({ value, children }: MockCompetencyAssociationsProviderProps) => (
  <CompetencyAssociationsContext.Provider value={buildMockCompetencyAssociationsContextValue(value)}>
    {children}
  </CompetencyAssociationsContext.Provider>
);
