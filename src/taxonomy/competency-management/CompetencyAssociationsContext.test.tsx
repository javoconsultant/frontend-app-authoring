import { useEffect } from 'react';
import { buildOutlineIndex } from '@src/course-outline/__mocks__';
import { getCourseOutlineIndexApiUrl } from '@src/course-outline/data';
import {
  act,
  fireEvent,
  initializeMocks,
  render,
  screen,
  waitFor,
} from '@src/testUtils';
import { CompetencyAssociationsProvider, useCompetencyAssociations } from './CompetencyAssociationsContext';
import { apiUrls } from './data/api';
import { competencyQueryKeys } from './data/apiHooks';
import type { CompetencyCriteriaTree } from './data/types';

let axiosMock: ReturnType<typeof initializeMocks>['axiosMock'];
let mockShowToast: ReturnType<typeof initializeMocks>['mockShowToast'];
let queryClient: ReturnType<typeof initializeMocks>['queryClient'];

const tagId = 42;
const courseA = 'course-v1:OrgX+CS101+2024';
const courseB = 'course-v1:OrgX+CS102+2024';
const courseOther = 'course-v1:OrgX+CS999+2024';

const groupsUrl = apiUrls.competencyCriteriaGroups(tagId);
const blockedCoursesUrl = apiUrls.competencyBlockedCourses(tagId);
const profileUrl = apiUrls.defaultCompetencyRuleProfile();
const createUrl = apiUrls.createCompetencyCriterion(tagId);
const updateGroupOperatorUrl = apiUrls.updateCompetencyCriteriaGroup(tagId, 10);
const updateRuleScoreUrl = apiUrls.updateCompetencyCriteriaRule(10);

/** The criteria-groups wire body. Its groups and criteria are written camelCase here, which `camelCaseObject`
 * leaves unchanged; the counts are the snake_case fields it converts.
 */
type CriteriaGroupsHttpResponse = CompetencyCriteriaTree & {
  criteria_count: number;
  total_criteria_count: number;
};

/** `#773`'s real response envelope: a paginated list, not a single object -
 * see `CompetencyRuleProfileListResponse` in `./data/types`.
 */
const profileResponse = {
  count: 1,
  next: null,
  previous: null,
  results: [
    {
      id: 1,
      scope_type: 'system_default',
      rule_type: 'grade',
      rule_payload: { op: 'gte', value: 0.7, scale: 'percent' },
      archived: false,
    },
  ],
};

/** The competency's root group (id 500, instance-wide, never rendered),
 * one course-level group (courseA, id 1) holding one leaf group (id 10)
 * with one criterion (`existing-sub`, no override - resolves through the
 * default profile above).
 */
const singleGroupResponse: CriteriaGroupsHttpResponse = {
  groups: [
    {
      id: 500,
      parentId: null,
      tagId,
      courseKey: null,
      name: 'root',
      ordering: 0,
      logicOperator: 'AND',
      archived: false,
    },
    {
      id: 1,
      parentId: 500,
      tagId,
      courseKey: courseA,
      name: 'course',
      ordering: 0,
      logicOperator: 'AND',
      archived: false,
    },
    { id: 10, parentId: 1, tagId, courseKey: null, name: 'leaf', ordering: 0, logicOperator: 'AND', archived: false },
  ],
  criteria: [
    {
      id: 900,
      objectId: 'existing-sub',
      groupId: 10,
      ruleProfileId: 1,
      ruleTypeOverride: null,
      rulePayloadOverride: null,
    },
  ],
  criteria_count: 1,
  total_criteria_count: 1,
};

/** Same course-level group, but two leaf groups (10 and 11) - so "exactly
 * one bottom-tier group" is false.
 */
const twoGroupsResponse: CriteriaGroupsHttpResponse = {
  groups: [
    {
      id: 500,
      parentId: null,
      tagId,
      courseKey: null,
      name: 'root',
      ordering: 0,
      logicOperator: 'AND',
      archived: false,
    },
    {
      id: 1,
      parentId: 500,
      tagId,
      courseKey: courseA,
      name: 'course',
      ordering: 0,
      logicOperator: 'AND',
      archived: false,
    },
    { id: 10, parentId: 1, tagId, courseKey: null, name: 'leaf', ordering: 0, logicOperator: 'AND', archived: false },
    { id: 11, parentId: 1, tagId, courseKey: null, name: 'leaf', ordering: 1, logicOperator: 'AND', archived: false },
  ],
  criteria: [],
  criteria_count: 0,
  total_criteria_count: 0,
};

/** Like `singleGroupResponse`, but its only box is gte 75%, so the 70% default is free. */
const uniqueDefaultResponse: CriteriaGroupsHttpResponse = {
  ...singleGroupResponse,
  criteria: [
    {
      id: 901,
      objectId: 'existing-sub',
      groupId: 10,
      ruleProfileId: null,
      ruleTypeOverride: 'grade',
      rulePayloadOverride: { op: 'gte', value: 0.75, scale: 'percent' },
    },
  ],
  criteria_count: 1,
  total_criteria_count: 1,
};

const noGroupsResponse: CriteriaGroupsHttpResponse = {
  groups: [],
  criteria: [],
  criteria_count: 0,
  total_criteria_count: 0,
};

/** Two course-level groups under the same root: courseA (id 1, leaf group
 * 10) and courseB (id 2, leaf group 20) - used to prove a course whose own
 * outline fetch fails is excluded from `accessibleCourseGroups` while a
 * sibling course whose outline succeeds is not.
 */
const twoCoursesResponse: CriteriaGroupsHttpResponse = {
  groups: [
    {
      id: 500,
      parentId: null,
      tagId,
      courseKey: null,
      name: 'root',
      ordering: 0,
      logicOperator: 'AND',
      archived: false,
    },
    {
      id: 1,
      parentId: 500,
      tagId,
      courseKey: courseA,
      name: 'course',
      ordering: 0,
      logicOperator: 'AND',
      archived: false,
    },
    { id: 10, parentId: 1, tagId, courseKey: null, name: 'leaf', ordering: 0, logicOperator: 'AND', archived: false },
    {
      id: 2,
      parentId: 500,
      tagId,
      courseKey: courseB,
      name: 'course',
      ordering: 1,
      logicOperator: 'AND',
      archived: false,
    },
    { id: 20, parentId: 2, tagId, courseKey: null, name: 'leaf', ordering: 0, logicOperator: 'AND', archived: false },
  ],
  criteria: [],
  criteria_count: 0,
  total_criteria_count: 0,
};

/** courseA (id 1, leaf 10) and courseB (id 2) with two leaves listed out of
 * order: 21 (ordering 1, two rule boxes) and 20 (ordering 0). The last group
 * by `ordering` is 21, and its last rule box is the `eq` override.
 */
const courseBGroupsResponse: CriteriaGroupsHttpResponse = {
  groups: [
    ...twoCoursesResponse.groups.filter((group) => group.id !== 20),
    { id: 21, parentId: 2, tagId, courseKey: null, name: 'leaf', ordering: 1, logicOperator: 'AND', archived: false },
    { id: 20, parentId: 2, tagId, courseKey: null, name: 'leaf', ordering: 0, logicOperator: 'AND', archived: false },
  ],
  criteria: [
    { id: 910, objectId: 'b-sub-1', groupId: 21, ruleProfileId: 1, ruleTypeOverride: null, rulePayloadOverride: null },
    {
      id: 911,
      objectId: 'b-sub-2',
      groupId: 21,
      ruleProfileId: null,
      ruleTypeOverride: 'grade',
      rulePayloadOverride: { op: 'eq', value: 1, scale: 'percent' },
    },
  ],
  criteria_count: 2,
  total_criteria_count: 2,
};

/** Like `twoCoursesResponse`, but group 20 has a criterion, so focusing it yields a real rule key. */
const courseExpansionResponse: CriteriaGroupsHttpResponse = {
  ...twoCoursesResponse,
  criteria: [
    {
      id: 950,
      objectId: 'course-b-sub',
      groupId: 20,
      ruleProfileId: 1,
      ruleTypeOverride: null,
      rulePayloadOverride: null,
    },
  ],
  criteria_count: 1,
  total_criteria_count: 1,
};

const defaultRuleKey = 'grade:gte:0.7:percent';

/** `twoGroupsResponse`'s two leaf groups, each holding one default-rule criterion. */
const twoGroupsWithCriteriaResponse: CriteriaGroupsHttpResponse = {
  ...twoGroupsResponse,
  criteria: [
    { id: 901, objectId: 'sub-a', groupId: 10, ruleProfileId: 1, ruleTypeOverride: null, rulePayloadOverride: null },
    { id: 902, objectId: 'sub-b', groupId: 11, ruleProfileId: 1, ruleTypeOverride: null, rulePayloadOverride: null },
  ],
  criteria_count: 2,
  total_criteria_count: 2,
};

/** `twoGroupsWithCriteriaResponse` after group 10 was deleted. */
const afterDeletingGroup10Response: CriteriaGroupsHttpResponse = {
  groups: twoGroupsWithCriteriaResponse.groups.filter((group) => group.id !== 10),
  criteria: twoGroupsWithCriteriaResponse.criteria.filter((criterion) => criterion.groupId !== 10),
  criteria_count: 1,
  total_criteria_count: 1,
};

/** Course A (group 10) and course B (group 20), each leaf holding one default-rule criterion. */
const twoCoursesWithCriteriaResponse: CriteriaGroupsHttpResponse = {
  ...twoCoursesResponse,
  criteria: [
    { id: 901, objectId: 'sub-a', groupId: 10, ruleProfileId: 1, ruleTypeOverride: null, rulePayloadOverride: null },
    { id: 902, objectId: 'sub-b', groupId: 20, ruleProfileId: 1, ruleTypeOverride: null, rulePayloadOverride: null },
  ],
  criteria_count: 2,
  total_criteria_count: 2,
};

const outlineFixture = buildOutlineIndex();

/** The course keys `TestConsumer` reports by default: every course the fixtures above use. */
const defaultReportedCourseKeys = [courseA, courseB];

interface TestConsumerProps {
  /** Reported through `notifyCoursesDisplayed` on mount and on change, the way
   * `CourseSearchBrowse` reports its page; `null` reports nothing.
   */
  reportedCourseKeys?: string[] | null;
}

/** Exposes every context value/action as plain, clickable test hooks. */
const TestConsumer = ({ reportedCourseKeys = defaultReportedCourseKeys }: TestConsumerProps) => {
  const ctx = useCompetencyAssociations();
  const { notifyCoursesDisplayed } = ctx;
  useEffect(() => {
    if (reportedCourseKeys !== null) {
      notifyCoursesDisplayed(reportedCourseKeys);
    }
  }, [notifyCoursesDisplayed, reportedCourseKeys]);
  return (
    <div>
      <div data-testid="focus">{JSON.stringify(ctx.focus)}</div>
      <div data-testid="placeholder">{JSON.stringify(ctx.placeholder)}</div>
      <div data-testid="has-placeholder">{String(ctx.hasPlaceholder)}</div>
      <div data-testid="duplicate-rejected">{String(ctx.placeholderDuplicateRejected)}</div>
      <div data-testid="groups-status">{ctx.groupsQuery.isSuccess ? 'groups-success' : 'groups-pending'}</div>
      <div data-testid="profile-status">{ctx.profileQuery.isSuccess ? 'profile-success' : 'profile-pending'}</div>
      <div data-testid="accessible-course-group-ids">
        {ctx.accessibleCourseGroups.map((group) => group.courseKey).join(',')}
      </div>
      <div data-testid="conflict-course-a">{ctx.conflictingCompetencyName(courseA) ?? 'none'}</div>
      <div data-testid="conflict-course-b">{ctx.conflictingCompetencyName(courseB) ?? 'none'}</div>
      <button type="button" onClick={() => ctx.focusGroup(999)}>focus-999</button>
      <button type="button" onClick={() => ctx.focusGroup(10)}>focus-group-10</button>
      <button type="button" onClick={() => ctx.focusGroup(11)}>focus-group-11</button>
      <button type="button" onClick={() => ctx.focusGroup(20)}>focus-group-20</button>
      <button type="button" onClick={() => ctx.focusRuleBox(10, 'grade:gte:0.7:percent')}>focus-rulebox-10</button>
      <button type="button" onClick={() => ctx.addPlaceholderRuleBox(10)}>add-placeholder-rule-10</button>
      <button type="button" onClick={() => ctx.addPlaceholderGroup(1)}>add-placeholder-group-1</button>
      <button
        type="button"
        onClick={() => ctx.setPlaceholderRulePayload({ op: 'gte', value: 0.85, scale: 'percent' })}
      >
        set-placeholder-rule-payload
      </button>
      <button type="button" onClick={() => ctx.notifyCourseExpanded(courseB)}>expand-course-b</button>
      <button type="button" onClick={() => ctx.notifyCourseExpanded(courseA)}>expand-course-a</button>
      <button type="button" onClick={() => ctx.discardPlaceholder()}>discard-placeholder</button>
      <button type="button" onClick={() => ctx.associateSubsection('new-sub', courseA)}>associate-course-a</button>
      <button type="button" onClick={() => ctx.associateSubsection('new-sub', courseB)}>associate-course-b</button>
      <button
        type="button"
        onClick={() => ctx.associateSubsection('new-sub', courseOther)}
      >
        associate-other-course
      </button>
      <button
        type="button"
        onClick={() => ctx.associateSubsection('existing-sub', courseA)}
      >
        associate-duplicate
      </button>
      <div data-testid="is-deleting-group">{String(ctx.isDeletingGroup)}</div>
      <div data-testid="keyboard-focus-request">{JSON.stringify(ctx.keyboardFocusRequest)}</div>
      <button type="button" onClick={() => ctx.deleteGroup(10)}>delete-group-10</button>
      <button type="button" onClick={() => ctx.deleteGroup(20)}>delete-group-20</button>
      <button
        type="button"
        onClick={() => {
          ctx.deleteGroup(10);
          ctx.deleteGroup(10);
        }}
      >
        delete-group-10-twice
      </button>
      <button type="button" onClick={() => ctx.removePlaceholderGroup()}>remove-placeholder-group</button>
      <button type="button" onClick={() => ctx.updateGroupOperator(10, 'OR')}>update-group-operator</button>
      <button
        type="button"
        onClick={() => {
          // Caught only to silence an unhandled-rejection warning; irrelevant to this consumer.
          ctx.updateRuleScore(10, [900], { op: 'gte', value: 0.8, scale: 'percent' }).catch(() => {});
        }}
      >
        update-rule-score
      </button>
    </div>
  );
};

type ProviderTreeProps = TestConsumerProps & { providerTagId?: number; };

const providerTree = ({ providerTagId = tagId, ...props }: ProviderTreeProps = {}) => (
  <CompetencyAssociationsProvider tagId={providerTagId} competencyName="Competency" competencyExternalId="CCRS-1.3">
    <TestConsumer {...props} />
  </CompetencyAssociationsProvider>
);

const renderProvider = (props: ProviderTreeProps = {}) => render(providerTree(props));

describe('CompetencyAssociationsProvider', () => {
  beforeEach(() => {
    ({ axiosMock, mockShowToast, queryClient } = initializeMocks());
  });

  describe('initial focus', () => {
    it('focuses the sole bottom-tier group once the groups query and every visible course outline resolve', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":10');
      });
      expect(screen.getByTestId('focus')).toHaveTextContent('"ruleKey":"grade:gte:0.7:percent"');
    });

    it('leaves focus unset when more than one bottom-tier group exists across visible course groups', async () => {
      axiosMock.onGet(groupsUrl).reply(200, twoGroupsResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success');
      });
      expect(screen.getByTestId('focus')).toHaveTextContent('null');
    });

    it('leaves focus unset when there are no visible course-level groups', async () => {
      axiosMock.onGet(groupsUrl).reply(200, noGroupsResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success');
      });
      expect(screen.getByTestId('focus')).toHaveTextContent('null');
    });

    it('a click beats a preceding auto-focus and is not reverted once the data resolves', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      renderProvider();

      // Click before anything has resolved - at this point `focus` is
      // still unset and the initial-focus effect hasn't run yet.
      fireEvent.click(screen.getByText('focus-999'));
      expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":999');

      // Let the groups/profile/outline queries resolve - the sole
      // bottom-tier group (id 10) would otherwise be auto-focused.
      await waitFor(() => {
        expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success');
      });

      // The manual click's focus must survive - the auto-focus effect
      // still marks itself as having run, but skips writing anything
      // because focus was no longer unset by the time its gate resolved.
      expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":999');
    });
  });

  describe('accessibleCourseGroups', () => {
    it('excludes a course-level group whose own outline fetch fails, keeping a sibling course\'s group', async () => {
      axiosMock.onGet(groupsUrl).reply(200, twoCoursesResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      // courseB's own outline fetch fails - e.g. a 403 on a course the
      // author can see via content search but can't read the outline of.
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB)).reply(403);
      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('accessible-course-group-ids')).toHaveTextContent(courseA);
      });
      // Not shown with a missing/blank/placeholder name instead - it's
      // excluded entirely, never included at all.
      expect(screen.getByTestId('accessible-course-group-ids')).not.toHaveTextContent(courseB);
    });

    it('excludes every course-level group when every course fails, leaving the list empty (same as no associations at all)', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(403);
      renderProvider();

      // Wait for the outline request itself to actually complete (not just
      // for the unrelated groups query), so this doesn't pass vacuously
      // before the failure has even been processed.
      await waitFor(() => {
        expect(axiosMock.history.get.some((req) => req.url === getCourseOutlineIndexApiUrl(courseA))).toBe(true);
      });
      await waitFor(() => {
        expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success');
      });
      expect(screen.getByTestId('accessible-course-group-ids')).toHaveTextContent('');
    });

    it('does not auto-focus a bottom-tier group that belongs to an inaccessible course', async () => {
      // A single course-level group with a single bottom-tier group - the
      // exact shape `'focuses the sole bottom-tier group...'` above proves
      // auto-focuses when the course IS accessible. Here, its own outline
      // fetch fails, so this bottom-tier group must not be eligible for
      // auto-focus at all, even though it's still the *only* one in the raw
      // `#681` response - counting the raw response instead of
      // `accessibleCourseGroups` was exactly the bug this test guards
      // against.
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(403);
      renderProvider();

      // Wait for the outline request itself to actually complete first, so
      // the assertions below don't pass vacuously before the failure has
      // even been processed.
      await waitFor(() => {
        expect(axiosMock.history.get.some((req) => req.url === getCourseOutlineIndexApiUrl(courseA))).toBe(true);
      });
      await waitFor(() => {
        expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success');
      });
      expect(screen.getByTestId('accessible-course-group-ids')).toHaveTextContent('');
      expect(screen.getByTestId('focus')).toHaveTextContent('null');
    });
  });

  it(
    'does not delay initial focus when an unrelated, still-loading course is expanded via notifyCourseExpanded',
    async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      // Course B has no group for this competency, and its own outline
      // never resolves - simulates the author expanding an unrelated
      // course in the content panel below while this competency's own
      // course (courseA) is still loading. `notifyCourseExpanded` feeds
      // `canEditCourse`'s course list, not the initial-focus gate, so this
      // must have no bearing on when focus fires.
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB)).reply(() => new Promise(() => {}));
      renderProvider();

      fireEvent.click(screen.getByText('expand-course-b'));

      // The sole bottom-tier group (courseA's group 10) still auto-focuses
      // once courseA's own data resolves, unaffected by courseB's outline
      // never resolving.
      await waitFor(() => {
        expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":10');
      });
    },
  );

  describe('notifyCourseExpanded focus', () => {
    const renderWithCourseB = async () => {
      axiosMock.onGet(groupsUrl).reply(200, courseBGroupsResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB)).reply(200, outlineFixture);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('profile-status')).toHaveTextContent('profile-success'));
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));
    };

    it('moves focus from another course\'s group to the expanded course\'s last group and last rule box', async () => {
      await renderWithCourseB();
      fireEvent.click(screen.getByText('focus-group-10'));

      fireEvent.click(screen.getByText('expand-course-b'));
      const expected = JSON.stringify({ groupId: 21, ruleKey: 'grade:eq:1:percent' });
      expect(screen.getByTestId('focus')).toHaveTextContent(expected);

      fireEvent.click(screen.getByText('focus-group-10'));
      fireEvent.click(screen.getByText('expand-course-b'));
      expect(screen.getByTestId('focus')).toHaveTextContent(expected);
    });

    it('moves focus when nothing is focused', async () => {
      await renderWithCourseB();

      fireEvent.click(screen.getByText('expand-course-b'));

      expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":21');
    });

    it('leaves focus unchanged when the expanded course has no groups', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('profile-status')).toHaveTextContent('profile-success'));
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));
      fireEvent.click(screen.getByText('focus-group-10'));

      fireEvent.click(screen.getByText('expand-course-b'));

      expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":10');
    });

    it('leaves focus unchanged when it is already on a group of the expanded course', async () => {
      await renderWithCourseB();
      fireEvent.click(screen.getByText('focus-group-20'));
      const before = screen.getByTestId('focus').textContent;

      fireEvent.click(screen.getByText('expand-course-b'));

      expect(before).toContain('"groupId":20');
      expect(screen.getByTestId('focus')).toHaveTextContent(before as string);
    });

    it('associates a subsection of the expanded course into the group that expansion focused', async () => {
      await renderWithCourseB();
      axiosMock.onPost(createUrl).reply(201, {
        id: 920,
        group_id: 21,
        rule_profile_id: null,
        rule_type_override: 'grade',
        rule_payload_override: { op: 'eq', value: 1, scale: 'percent' },
        object_tag_id: tagId,
      });
      fireEvent.click(screen.getByText('focus-group-10'));
      fireEvent.click(screen.getByText('expand-course-b'));

      fireEvent.click(screen.getByText('associate-course-b'));

      await waitFor(() => expect(axiosMock.history.post).toHaveLength(1));
      expect(JSON.parse(axiosMock.history.post[0].data)).toEqual({
        object_id: 'new-sub',
        group_id: 21,
        rule_type_override: 'grade',
        rule_payload_override: { op: 'eq', value: 1, scale: 'percent' },
      });
    });
  });

  describe('placeholder lifecycle (#671)', () => {
    it('"+ Rule" starts a placeholder rule box in the given group, focusing it with ruleKey: null', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('add-placeholder-rule-10'));

      expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":10');
      expect(screen.getByTestId('focus')).toHaveTextContent('"ruleKey":null');
      expect(screen.getByTestId('has-placeholder')).toHaveTextContent('true');
    });

    it('"+ Rule Group" replaces an existing placeholder rule box, since focus has only one slot', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('add-placeholder-rule-10'));
      expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":10');

      fireEvent.click(screen.getByText('add-placeholder-group-1'));

      expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":null');
      expect(screen.getByTestId('placeholder')).toHaveTextContent('"parentRuleGroupId":1');
      expect(screen.getByTestId('placeholder')).toHaveTextContent('"logicOperator":"OR"');
    });

    it('focusing a different real group clears an existing placeholder', async () => {
      axiosMock.onGet(groupsUrl).reply(200, courseExpansionResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB)).reply(200, outlineFixture);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('add-placeholder-rule-10'));
      expect(screen.getByTestId('has-placeholder')).toHaveTextContent('true');

      fireEvent.click(screen.getByText('focus-group-20'));

      expect(screen.getByTestId('has-placeholder')).toHaveTextContent('false');
      expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":20');
      expect(screen.getByTestId('focus')).toHaveTextContent('"ruleKey":"grade:gte:0.7:percent"');
    });

    it(
      'resolves a placeholder onto an expanded course\'s own last bottom-tier group, when one already exists',
      async () => {
        axiosMock.onGet(groupsUrl).reply(200, courseExpansionResponse);
        axiosMock.onGet(profileUrl).reply(200, profileResponse);
        axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
        axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB)).reply(200, outlineFixture);
        renderProvider();
        await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

        fireEvent.click(screen.getByText('add-placeholder-rule-10'));
        expect(screen.getByTestId('focus')).toHaveTextContent('"ruleKey":null');

        fireEvent.click(screen.getByText('expand-course-b'));

        await waitFor(() => {
          expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":20');
        });
        expect(screen.getByTestId('focus')).toHaveTextContent('"ruleKey":"grade:gte:0.7:percent"');
      },
    );

    it.each([
      ['rule box in a real group', 'add-placeholder-rule-10'],
      ['group', 'add-placeholder-group-1'],
    ])('keeps a placeholder %s when its own course is expanded', async (_label, addButton) => {
      axiosMock.onGet(groupsUrl).reply(200, courseExpansionResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB)).reply(200, outlineFixture);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText(addButton));
      const focusBefore = screen.getByTestId('focus').textContent;
      fireEvent.click(screen.getByText('expand-course-a'));

      expect(screen.getByTestId('focus').textContent).toBe(focusBefore);
      expect(screen.getByTestId('has-placeholder')).toHaveTextContent('true');
    });

    it('discardPlaceholder clears focus, and with it the placeholder', async () => {
      axiosMock.onGet(groupsUrl).reply(200, courseExpansionResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB)).reply(200, outlineFixture);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('add-placeholder-group-1'));
      fireEvent.click(screen.getByText('discard-placeholder'));

      expect(screen.getByTestId('focus')).toHaveTextContent('null');
      expect(screen.getByTestId('has-placeholder')).toHaveTextContent('false');
    });

    it('course expansion leaves focus unchanged when no placeholder exists', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('focus')).toHaveTextContent('"ruleKey":"grade:gte:0.7:percent"');
      });

      fireEvent.click(screen.getByText('expand-course-b'));

      expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":10');
      expect(screen.getByTestId('focus')).toHaveTextContent('"ruleKey":"grade:gte:0.7:percent"');
    });
  });

  describe('listed course changes (#683)', () => {
    beforeEach(() => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
    });

    it.each([
      ['rule box', 'add-placeholder-rule-10'],
      ['group', 'add-placeholder-group-1'],
    ])('discards a placeholder %s when different course keys are reported', async (_label, addButton) => {
      const { rerender } = renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));
      fireEvent.click(screen.getByText(addButton));
      expect(screen.getByTestId('has-placeholder')).toHaveTextContent('true');

      rerender(providerTree({ reportedCourseKeys: [courseOther] }));

      expect(screen.getByTestId('has-placeholder')).toHaveTextContent('false');
      expect(screen.getByTestId('focus')).toHaveTextContent('null');
    });

    it('keeps a placeholder when the same course keys are reported in a new array', async () => {
      const { rerender } = renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));
      fireEvent.click(screen.getByText('add-placeholder-rule-10'));

      rerender(providerTree({ reportedCourseKeys: [...defaultReportedCourseKeys] }));

      expect(screen.getByTestId('has-placeholder')).toHaveTextContent('true');
      expect(screen.getByTestId('focus')).toHaveTextContent('{"groupId":10,"ruleKey":null}');
    });

    it('keeps a focused saved group when different course keys are reported', async () => {
      const { rerender } = renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));
      fireEvent.click(screen.getByText('focus-rulebox-10'));

      rerender(providerTree({ reportedCourseKeys: [courseOther] }));

      expect(screen.getByTestId('focus')).toHaveTextContent(`{"groupId":10,"ruleKey":"${defaultRuleKey}"}`);
    });
  });

  describe('blocked courses (#797)', () => {
    const blockedCoursesBody = (rows: { course_key: string; conflicting_tag_value: string; }[]) => ({
      count: rows.length,
      next: null,
      previous: null,
      results: rows.map((row) => ({ ...row, conflicting_tag_id: 7 })),
    });
    const blockedCoursesRequests = (url = blockedCoursesUrl) => axiosMock.history.get.filter((req) => req.url === url);

    beforeEach(() => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
    });

    it('names the related competency for a blocked listed course, and nothing for the others', async () => {
      axiosMock.onGet(blockedCoursesUrl).reply(
        200,
        blockedCoursesBody([
          { course_key: courseA, conflicting_tag_value: 'Inference' },
        ]),
      );
      renderProvider();

      await waitFor(() => expect(screen.getByTestId('conflict-course-a')).toHaveTextContent('Inference'));
      expect(screen.getByTestId('conflict-course-b')).toHaveTextContent('none');
      expect(blockedCoursesRequests()[0].params).toEqual({ course_keys: defaultReportedCourseKeys.join(',') });
    });

    it('names nothing while the lookup is in flight', async () => {
      axiosMock.onGet(blockedCoursesUrl).reply(() => new Promise(() => {}));
      renderProvider();

      await waitFor(() => expect(blockedCoursesRequests()).toHaveLength(1));
      expect(screen.getByTestId('conflict-course-a')).toHaveTextContent('none');
    });

    it.each([404, 500])('names nothing, and shows no toast, when the lookup fails with %s', async (status) => {
      axiosMock.onGet(blockedCoursesUrl).reply(status);
      renderProvider();

      await waitFor(() => (
        expect(
          queryClient.getQueryState(
            competencyQueryKeys.competencyBlockedCourses(tagId, defaultReportedCourseKeys),
          )?.status,
        ).toEqual('error')
      ));
      expect(screen.getByTestId('conflict-course-a')).toHaveTextContent('none');
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('re-scopes to newly reported course keys, keeping no previous conflict while they load', async () => {
      axiosMock.onGet(blockedCoursesUrl).reply((config) => (
        config.params.course_keys.includes(courseA)
          ? [200, blockedCoursesBody([{ course_key: courseA, conflicting_tag_value: 'Inference' }])]
          : new Promise(() => {})
      ));
      const { rerender } = renderProvider();
      await waitFor(() => expect(screen.getByTestId('conflict-course-a')).toHaveTextContent('Inference'));

      rerender(providerTree({ reportedCourseKeys: [courseOther] }));

      await waitFor(() => expect(blockedCoursesRequests()).toHaveLength(2));
      expect(blockedCoursesRequests()[1].params).toEqual({ course_keys: courseOther });
      expect(screen.getByTestId('conflict-course-a')).toHaveTextContent('none');
    });

    it('fetches again for a newly selected competency, keeping no previous conflict while it loads', async () => {
      const otherTagId = tagId + 1;
      axiosMock.onGet(apiUrls.competencyCriteriaGroups(otherTagId)).reply(200, noGroupsResponse);
      axiosMock.onGet(blockedCoursesUrl).reply(
        200,
        blockedCoursesBody([
          { course_key: courseA, conflicting_tag_value: 'Inference' },
        ]),
      );
      axiosMock.onGet(apiUrls.competencyBlockedCourses(otherTagId)).reply(() => new Promise(() => {}));
      const { rerender } = renderProvider();
      await waitFor(() => expect(screen.getByTestId('conflict-course-a')).toHaveTextContent('Inference'));

      rerender(providerTree({ providerTagId: otherTagId }));

      await waitFor(() => expect(blockedCoursesRequests(apiUrls.competencyBlockedCourses(otherTagId))).toHaveLength(1));
      expect(screen.getByTestId('conflict-course-a')).toHaveTextContent('none');
    });
  });

  describe('associateSubsection', () => {
    it('sends the focused group\'s id and rule when the focus is a group belonging to the clicked subsection\'s course', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPost(createUrl).reply(201, {
        id: 901,
        group_id: 10,
        rule_profile_id: null,
        rule_type_override: 'grade',
        rule_payload_override: { op: 'gte', value: 0.7, scale: 'percent' },
        object_tag_id: tagId,
      });
      renderProvider();
      // `associateSubsection` no-ops until the groups/profile queries have
      // resolved (matching real usage - the content panel only offers this
      // action once `CourseGroupList`'s own loading gate has passed).
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('focus-rulebox-10'));
      fireEvent.click(screen.getByText('associate-course-a'));

      await waitFor(() => expect(axiosMock.history.post).toHaveLength(1));
      expect(JSON.parse(axiosMock.history.post[0].data)).toEqual({
        object_id: 'new-sub',
        group_id: 10,
        rule_type_override: 'grade',
        rule_payload_override: { op: 'gte', value: 0.7, scale: 'percent' },
      });
    });

    it('omits group_id and rule fields when focus is unset', async () => {
      axiosMock.onGet(groupsUrl).reply(200, noGroupsResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onPost(createUrl).reply(201, {
        id: 902,
        group_id: 20,
        rule_profile_id: 1,
        rule_type_override: null,
        rule_payload_override: null,
        object_tag_id: tagId,
      });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('associate-course-a'));

      await waitFor(() => expect(axiosMock.history.post).toHaveLength(1));
      expect(JSON.parse(axiosMock.history.post[0].data)).toEqual({ object_id: 'new-sub' });
    });

    it('omits group_id and rule fields when focus is a group belonging to a different course', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPost(createUrl).reply(201, {
        id: 903,
        group_id: 20,
        rule_profile_id: 1,
        rule_type_override: null,
        rule_payload_override: null,
        object_tag_id: tagId,
      });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('focus-rulebox-10')); // group 10 belongs to courseA
      fireEvent.click(screen.getByText('associate-other-course')); // clicked from courseOther

      await waitFor(() => expect(axiosMock.history.post).toHaveLength(1));
      expect(JSON.parse(axiosMock.history.post[0].data)).toEqual({ object_id: 'new-sub' });
    });

    it('returns early with an informational toast, sending no request, for an already-associated subsection', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('associate-duplicate'));

      expect(axiosMock.history.post).toHaveLength(0);
      expect(mockShowToast).toHaveBeenCalledWith('This content is already associated with this competency.');
    });

    it('focuses the response\'s group and rule after a successful create, not a stale local read', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      // Group 999 doesn't exist anywhere in the local tree - if focus were
      // derived via `lastRealRuleKeyIn` against the (stale, not-yet-refetched)
      // local index, it would find nothing and resolve a `null` rule key.
      axiosMock.onPost(createUrl).reply(201, {
        id: 904,
        group_id: 999,
        rule_profile_id: null,
        rule_type_override: 'grade',
        rule_payload_override: { op: 'eq', value: 1, scale: 'percent' },
        object_tag_id: tagId,
      });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('associate-course-a'));

      await waitFor(() => {
        expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":999');
      });
      expect(screen.getByTestId('focus')).toHaveTextContent('"ruleKey":"grade:eq:1:percent"');
    });

    it('shows a specific toast when the create request 400s with a tag_id field error', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPost(createUrl).reply(400, {
        tag_id: ['A parent or child competency already has criteria in this course.'],
      });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('associate-course-a'));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'This competency can\'t be associated with this content because a parent or child '
            + 'competency already has criteria in this course.',
        );
      });
    });

    it('shows the generic toast for a 400 that is not a tag_id field error', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPost(createUrl).reply(400, { object_id: ['This field is required.'] });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('associate-course-a'));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith('There was a problem creating this association. Please try again.');
      });
    });

    it('sends only group_id for a placeholder rule box whose score the author has not changed', async () => {
      axiosMock.onGet(groupsUrl).reply(200, uniqueDefaultResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPost(createUrl).reply(201, {
        id: 905,
        group_id: 10,
        rule_profile_id: 1,
        rule_type_override: null,
        rule_payload_override: null,
        object_tag_id: tagId,
      });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('add-placeholder-rule-10'));
      fireEvent.click(screen.getByText('associate-course-a'));

      await waitFor(() => expect(axiosMock.history.post).toHaveLength(1));
      expect(JSON.parse(axiosMock.history.post[0].data)).toEqual({ object_id: 'new-sub', group_id: 10 });
    });

    it('sends no request and flags a rejection for an untouched placeholder whose default score is taken', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('add-placeholder-rule-10'));
      fireEvent.click(screen.getByText('associate-course-a'));

      expect(axiosMock.history.post).toHaveLength(0);
      expect(screen.getByTestId('duplicate-rejected')).toHaveTextContent('true');
    });

    it('clears the rejection once the placeholder score changes, and then posts', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPost(createUrl).reply(201, {
        id: 910,
        group_id: 10,
        rule_profile_id: null,
        rule_type_override: 'grade',
        rule_payload_override: { op: 'gte', value: 0.85, scale: 'percent' },
        object_tag_id: tagId,
      });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('add-placeholder-rule-10'));
      fireEvent.click(screen.getByText('associate-course-a'));
      expect(screen.getByTestId('duplicate-rejected')).toHaveTextContent('true');

      fireEvent.click(screen.getByText('set-placeholder-rule-payload'));
      expect(screen.getByTestId('duplicate-rejected')).toHaveTextContent('false');

      fireEvent.click(screen.getByText('associate-course-a'));
      await waitFor(() => expect(axiosMock.history.post).toHaveLength(1));
    });

    it('sends group_id and both rule fields for a placeholder rule box whose score the author has changed', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPost(createUrl).reply(201, {
        id: 906,
        group_id: 10,
        rule_profile_id: null,
        rule_type_override: 'grade',
        rule_payload_override: { op: 'gte', value: 0.85, scale: 'percent' },
        object_tag_id: tagId,
      });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('add-placeholder-rule-10'));
      fireEvent.click(screen.getByText('set-placeholder-rule-payload'));
      fireEvent.click(screen.getByText('associate-course-a'));

      await waitFor(() => expect(axiosMock.history.post).toHaveLength(1));
      expect(JSON.parse(axiosMock.history.post[0].data)).toEqual({
        object_id: 'new-sub',
        group_id: 10,
        rule_type_override: 'grade',
        rule_payload_override: { op: 'gte', value: 0.85, scale: 'percent' },
      });
    });

    it('sends logic_operator (uppercased) but no group_id for a placeholder group belonging to the clicked course', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPost(createUrl).reply(201, {
        id: 907,
        group_id: 11,
        rule_profile_id: 1,
        rule_type_override: null,
        rule_payload_override: null,
        object_tag_id: tagId,
      });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('add-placeholder-group-1'));
      fireEvent.click(screen.getByText('associate-course-a'));

      await waitFor(() => expect(axiosMock.history.post).toHaveLength(1));
      expect(JSON.parse(axiosMock.history.post[0].data)).toEqual({ object_id: 'new-sub', logic_operator: 'OR' });
    });

    it('sends logic_operator and both rule fields together for a placeholder group whose score the author set', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPost(createUrl).reply(201, {
        id: 908,
        group_id: 11,
        rule_profile_id: null,
        rule_type_override: 'grade',
        rule_payload_override: { op: 'gte', value: 0.85, scale: 'percent' },
        object_tag_id: tagId,
      });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('add-placeholder-group-1'));
      fireEvent.click(screen.getByText('set-placeholder-rule-payload'));
      fireEvent.click(screen.getByText('associate-course-a'));

      await waitFor(() => expect(axiosMock.history.post).toHaveLength(1));
      expect(JSON.parse(axiosMock.history.post[0].data)).toEqual({
        object_id: 'new-sub',
        logic_operator: 'OR',
        rule_type_override: 'grade',
        rule_payload_override: { op: 'gte', value: 0.85, scale: 'percent' },
      });
    });

    it('omits every optional field for a placeholder group when the subsection is from a different course', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPost(createUrl).reply(201, {
        id: 909,
        group_id: 20,
        rule_profile_id: 1,
        rule_type_override: null,
        rule_payload_override: null,
        object_tag_id: tagId,
      });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('add-placeholder-group-1'));
      fireEvent.click(screen.getByText('associate-other-course'));

      await waitFor(() => expect(axiosMock.history.post).toHaveLength(1));
      expect(JSON.parse(axiosMock.history.post[0].data)).toEqual({ object_id: 'new-sub' });
    });
  });

  describe('updateGroupOperator', () => {
    it('sends the new operator, with no toast, on success', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPatch(updateGroupOperatorUrl).reply(200, {
        id: 10,
        parent_id: 1,
        tag_id: tagId,
        course_key: null,
        name: 'leaf',
        ordering: 0,
        logic_operator: 'OR',
        archived: false,
      });
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('update-group-operator'));

      await waitFor(() => expect(axiosMock.history.patch).toHaveLength(1));
      expect(axiosMock.history.patch[0].url).toEqual(updateGroupOperatorUrl);
      expect(JSON.parse(axiosMock.history.patch[0].data)).toEqual({ logic_operator: 'OR' });
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('shows a failure toast on rejection', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPatch(updateGroupOperatorUrl).reply(500);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

      fireEvent.click(screen.getByText('update-group-operator'));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'There was a problem updating this group\'s logic. Please try again.',
        );
      });
    });
  });

  describe('updateRuleScore', () => {
    it(
      'sends the batch payload and derives the new focus key from the response\'s own values, not the '
        + 'request\'s, on success',
      async () => {
        axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
        axiosMock.onGet(profileUrl).reply(200, profileResponse);
        axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
        // The request (below) sends an explicit override of 0.8; the mocked response simulates
        // the backend's "reset to default" behavior instead, reassigning the criterion to the
        // shared default profile (0.7) with both override fields cleared. An implementation that
        // (incorrectly) derived the new focus key from the request would compute 0.8's key here.
        axiosMock.onPatch(updateRuleScoreUrl).reply(200, [
          {
            id: 900,
            object_id: 'existing-sub',
            group_id: 10,
            rule_profile_id: 1,
            rule_type_override: null,
            rule_payload_override: null,
          },
        ]);
        renderProvider();
        await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));

        fireEvent.click(screen.getByText('update-rule-score'));

        await waitFor(() => expect(axiosMock.history.patch).toHaveLength(1));
        expect(axiosMock.history.patch[0].url).toEqual(updateRuleScoreUrl);
        expect(JSON.parse(axiosMock.history.patch[0].data)).toEqual({
          criterion_ids: [900],
          rule_type_override: 'grade',
          rule_payload_override: { op: 'gte', value: 0.8, scale: 'percent' },
        });

        await waitFor(() => {
          expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":10');
        });
        expect(screen.getByTestId('focus')).toHaveTextContent('"ruleKey":"grade:gte:0.7:percent"');
      },
    );

    it('shows a failure toast on rejection, without changing focus', async () => {
      axiosMock.onGet(groupsUrl).reply(200, singleGroupResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      axiosMock.onPatch(updateRuleScoreUrl).reply(500);
      renderProvider();
      await waitFor(() => {
        expect(screen.getByTestId('focus')).toHaveTextContent('"ruleKey":"grade:gte:0.7:percent"');
      });

      fireEvent.click(screen.getByText('update-rule-score'));

      await waitFor(() => {
        expect(mockShowToast).toHaveBeenCalledWith(
          'There was a problem updating this rule\'s score. Please try again.',
        );
      });
      expect(screen.getByTestId('focus')).toHaveTextContent('"ruleKey":"grade:gte:0.7:percent"');
    });
  });

  describe('deleteGroup', () => {
    const deleteUrl = apiUrls.updateCompetencyCriteriaGroup(tagId, 10);

    /** Serves `initial` once, then `refetched` (held until `release` is called) for every later GET. */
    const mockGroupsReads = (
      initial: CriteriaGroupsHttpResponse,
      refetched: CriteriaGroupsHttpResponse,
    ) => {
      const control = { release: () => {} };
      axiosMock.onGet(groupsUrl).replyOnce(200, initial);
      axiosMock.onGet(groupsUrl).reply(() => (
        new Promise((resolve) => {
          control.release = () => resolve([200, refetched]);
        })
      ));
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      return control;
    };

    const renderWithFocusOnGroup10 = async () => {
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));
      fireEvent.click(screen.getByText('focus-group-10'));
      expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":10');
    };

    it('stays pending until the refetch lands, then focuses the neighbor and requests keyboard focus for it', async () => {
      axiosMock.onDelete(deleteUrl).reply(200, {});
      const reads = mockGroupsReads(twoGroupsWithCriteriaResponse, afterDeletingGroup10Response);
      await renderWithFocusOnGroup10();

      fireEvent.click(screen.getByText('delete-group-10'));

      await waitFor(() => expect(screen.getByTestId('is-deleting-group')).toHaveTextContent('true'));
      await waitFor(() => expect(axiosMock.history.get.filter((req) => req.url === groupsUrl)).toHaveLength(2));
      // The delete itself has resolved, but the refetch has not.
      expect(screen.getByTestId('is-deleting-group')).toHaveTextContent('true');
      expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":10');

      await act(async () => {
        reads.release();
      });

      await waitFor(() => expect(screen.getByTestId('is-deleting-group')).toHaveTextContent('false'));
      expect(screen.getByTestId('focus')).toHaveTextContent(`{"groupId":11,"ruleKey":"${defaultRuleKey}"}`);
      expect(screen.getByTestId('keyboard-focus-request')).toHaveTextContent(
        '{"kind":"group","groupId":11,"expand":true}',
      );
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('treats a 404 as success: no toast, and focus still moves off the vanished group', async () => {
      axiosMock.onDelete(deleteUrl).reply(404);
      const reads = mockGroupsReads(twoGroupsWithCriteriaResponse, afterDeletingGroup10Response);
      await renderWithFocusOnGroup10();

      fireEvent.click(screen.getByText('delete-group-10'));
      await waitFor(() => expect(axiosMock.history.get.filter((req) => req.url === groupsUrl)).toHaveLength(2));
      await act(async () => {
        reads.release();
      });

      await waitFor(() => expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":11'));
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('toasts on a failure, keeps focus when the group is still there, and requests no keyboard focus', async () => {
      axiosMock.onDelete(deleteUrl).reply(500);
      const reads = mockGroupsReads(twoGroupsWithCriteriaResponse, twoGroupsWithCriteriaResponse);
      await renderWithFocusOnGroup10();

      fireEvent.click(screen.getByText('delete-group-10'));
      await waitFor(() => expect(axiosMock.history.get.filter((req) => req.url === groupsUrl)).toHaveLength(2));
      await act(async () => {
        reads.release();
      });

      await waitFor(() => expect(screen.getByTestId('is-deleting-group')).toHaveTextContent('false'));
      expect(mockShowToast).toHaveBeenCalledWith('Couldn\'t remove the group. The panel was refreshed.');
      expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":10');
      expect(screen.getByTestId('keyboard-focus-request')).toHaveTextContent('null');
    });

    it('drops a second call made before the first settles, so one request is sent', async () => {
      axiosMock.onDelete(deleteUrl).reply(200, {});
      const reads = mockGroupsReads(twoGroupsWithCriteriaResponse, afterDeletingGroup10Response);
      await renderWithFocusOnGroup10();

      fireEvent.click(screen.getByText('delete-group-10-twice'));
      await waitFor(() => expect(axiosMock.history.get.filter((req) => req.url === groupsUrl)).toHaveLength(2));
      await act(async () => {
        reads.release();
      });

      await waitFor(() => expect(screen.getByTestId('is-deleting-group')).toHaveTextContent('false'));
      expect(axiosMock.history.delete).toHaveLength(1);
    });

    it('requests the empty state when the delete leaves no course group', async () => {
      axiosMock.onDelete(deleteUrl).reply(200, {});
      const reads = mockGroupsReads(singleGroupResponse, noGroupsResponse);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('focus')).toHaveTextContent('"groupId":10'));

      fireEvent.click(screen.getByText('delete-group-10'));
      await waitFor(() => expect(axiosMock.history.get.filter((req) => req.url === groupsUrl)).toHaveLength(2));
      await act(async () => {
        reads.release();
      });

      await waitFor(() => expect(screen.getByTestId('keyboard-focus-request')).toHaveTextContent('{"kind":"empty"}'));
      expect(screen.getByTestId('focus')).toHaveTextContent('null');
    });

    it('clears the keyboard focus request when focus is written some other way', async () => {
      axiosMock.onDelete(deleteUrl).reply(200, {});
      const reads = mockGroupsReads(twoGroupsWithCriteriaResponse, afterDeletingGroup10Response);
      await renderWithFocusOnGroup10();
      fireEvent.click(screen.getByText('delete-group-10'));
      await waitFor(() => expect(axiosMock.history.get.filter((req) => req.url === groupsUrl)).toHaveLength(2));
      await act(async () => {
        reads.release();
      });
      await waitFor(() => expect(screen.getByTestId('keyboard-focus-request')).toHaveTextContent('"groupId":11'));

      fireEvent.click(screen.getByText('focus-group-11'));

      expect(screen.getByTestId('keyboard-focus-request')).toHaveTextContent('null');
    });

    it('moves focus to the course group above when deleting the only rule group cascades its course group away', async () => {
      axiosMock.onDelete(apiUrls.updateCompetencyCriteriaGroup(tagId, 20)).reply(200, {});
      const reads = mockGroupsReads(twoCoursesWithCriteriaResponse, {
        groups: twoCoursesWithCriteriaResponse.groups.filter((group) => group.id !== 2 && group.id !== 20),
        criteria: twoCoursesWithCriteriaResponse.criteria.filter((criterion) => criterion.groupId === 10),
        criteria_count: 1,
        total_criteria_count: 1,
      });
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB)).reply(200, outlineFixture);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));
      await waitFor(() => expect(screen.getByTestId('accessible-course-group-ids')).toHaveTextContent(courseB));
      fireEvent.click(screen.getByText('focus-group-20'));

      fireEvent.click(screen.getByText('delete-group-20'));
      await waitFor(() => expect(axiosMock.history.get.filter((req) => req.url === groupsUrl)).toHaveLength(2));
      await act(async () => {
        reads.release();
      });

      await waitFor(() => {
        expect(screen.getByTestId('focus')).toHaveTextContent(`{"groupId":10,"ruleKey":"${defaultRuleKey}"}`);
      });
      expect(screen.getByTestId('keyboard-focus-request')).toHaveTextContent(
        '{"kind":"group","groupId":10,"expand":true}',
      );
    });

    it('leaves focus alone, and asks to keep sections as they are, when the deleted group did not hold focus', async () => {
      axiosMock.onDelete(deleteUrl).reply(200, {});
      const reads = mockGroupsReads(twoGroupsWithCriteriaResponse, afterDeletingGroup10Response);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));
      fireEvent.click(screen.getByText('focus-group-11'));
      const focusBefore = screen.getByTestId('focus').textContent;

      fireEvent.click(screen.getByText('delete-group-10'));
      await waitFor(() => expect(axiosMock.history.get.filter((req) => req.url === groupsUrl)).toHaveLength(2));
      await act(async () => {
        reads.release();
      });

      await waitFor(() => expect(screen.getByTestId('is-deleting-group')).toHaveTextContent('false'));
      expect(screen.getByTestId('focus').textContent).toEqual(focusBefore);
      expect(screen.getByTestId('keyboard-focus-request')).toHaveTextContent(
        '{"kind":"group","groupId":11,"expand":false}',
      );
    });

    it('respects a click made on another group while the delete is pending', async () => {
      axiosMock.onDelete(deleteUrl).reply(200, {});
      const reads = mockGroupsReads(twoGroupsWithCriteriaResponse, afterDeletingGroup10Response);
      await renderWithFocusOnGroup10();

      fireEvent.click(screen.getByText('delete-group-10'));
      await waitFor(() => expect(axiosMock.history.get.filter((req) => req.url === groupsUrl)).toHaveLength(2));
      fireEvent.click(screen.getByText('focus-group-11'));
      await act(async () => {
        reads.release();
      });

      await waitFor(() => expect(screen.getByTestId('is-deleting-group')).toHaveTextContent('false'));
      expect(screen.getByTestId('focus')).toHaveTextContent(`{"groupId":11,"ruleKey":"${defaultRuleKey}"}`);
    });

    it('requests the empty state when only a course group the author cannot see is left', async () => {
      axiosMock.onDelete(deleteUrl).reply(200, {});
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB)).reply(403);
      const reads = mockGroupsReads(twoCoursesWithCriteriaResponse, {
        groups: twoCoursesWithCriteriaResponse.groups.filter((group) => group.id !== 1 && group.id !== 10),
        criteria: twoCoursesWithCriteriaResponse.criteria.filter((criterion) => criterion.groupId === 20),
        criteria_count: 1,
        total_criteria_count: 1,
      });
      await renderWithFocusOnGroup10();

      fireEvent.click(screen.getByText('delete-group-10'));
      await waitFor(() => expect(axiosMock.history.get.filter((req) => req.url === groupsUrl)).toHaveLength(2));
      await act(async () => {
        reads.release();
      });

      await waitFor(() => expect(screen.getByTestId('keyboard-focus-request')).toHaveTextContent('{"kind":"empty"}'));
      expect(screen.getByTestId('focus')).toHaveTextContent('null');
    });
  });

  describe('removePlaceholderGroup', () => {
    it('sends no request, and focuses the last saved group of the placeholder\'s course with a keyboard request', async () => {
      axiosMock.onGet(groupsUrl).reply(200, twoGroupsWithCriteriaResponse);
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));
      fireEvent.click(screen.getByText('add-placeholder-group-1'));
      expect(screen.getByTestId('focus')).toHaveTextContent('{"groupId":null,"ruleKey":null}');

      fireEvent.click(screen.getByText('remove-placeholder-group'));

      expect(screen.getByTestId('focus')).toHaveTextContent(`{"groupId":11,"ruleKey":"${defaultRuleKey}"}`);
      expect(screen.getByTestId('keyboard-focus-request')).toHaveTextContent(
        '{"kind":"group","groupId":11,"expand":true}',
      );
      expect(axiosMock.history.delete).toHaveLength(0);
      expect(axiosMock.history.patch).toHaveLength(0);
      expect(axiosMock.history.post).toHaveLength(0);
    });

    it('clears focus, with no keyboard request, when the placeholder\'s course group has no saved group', async () => {
      axiosMock.onGet(groupsUrl).reply(200, {
        groups: singleGroupResponse.groups.filter((group) => group.id !== 10),
        criteria: [],
        criteria_count: 0,
        total_criteria_count: 0,
      });
      axiosMock.onGet(profileUrl).reply(200, profileResponse);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA)).reply(200, outlineFixture);
      renderProvider();
      await waitFor(() => expect(screen.getByTestId('groups-status')).toHaveTextContent('groups-success'));
      fireEvent.click(screen.getByText('add-placeholder-group-1'));

      fireEvent.click(screen.getByText('remove-placeholder-group'));

      expect(screen.getByTestId('focus')).toHaveTextContent('null');
      expect(screen.getByTestId('keyboard-focus-request')).toHaveTextContent('null');
    });
  });
});
