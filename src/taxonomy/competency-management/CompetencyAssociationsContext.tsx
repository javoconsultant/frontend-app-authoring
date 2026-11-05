import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode, SetStateAction } from 'react';
import { Error as ErrorIcon, InfoOutline } from '@openedx/paragon/icons';
import { useIntl } from '@edx/frontend-platform/i18n';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { isEqual } from 'lodash';

import { getCourseOutlineIndex } from '@src/course-outline/data';
// Bypasses the public barrel deliberately: this is the same query key
// `useCourseOutlineIndex` uses, so the `useQueries` calls below share its
// cache instead of refetching per course.
import { courseOutlineQueryKeys } from '@src/course-outline/data/queryKeys';
import { useToastContext } from '@src/generic/toast-context';

import {
  competencyQueryKeys,
  useCompetencyBlockedCourses,
  useCompetencyCriteriaGroups,
  useCourseTaggingPermissions,
  useCreateCompetencyCriterion,
  useDefaultCompetencyRuleProfile,
  useDeleteCompetencyCriteriaGroup,
  useUpdateCompetencyCriteriaGroupOperator,
  useUpdateCompetencyCriteriaRule,
} from './data/apiHooks';
import type {
  CompetencyCriteriaGroupsResponse,
  CompetencyGroupLogicOperator,
  CompetencyRuleProfile,
  CourseCompetencyCriteriaGroup,
  CreateCompetencyCriterionPayload,
  GradeRulePayload,
} from './data/types';
import { courseKeyOfSelection, resolveCreateTarget } from './criterionTarget';
import messages from './messages';
import { usePlaceholderState } from './usePlaceholderState';
import type { CompetencyCriteriaGroupsIndex, PageOrderSnapshot } from './utils';
import {
  associatedObjectIds,
  bottomTierGroupsForCourse,
  buildCompetencyCriteriaGroupsIndex,
  effectiveRuleOf,
  selectionTargetAfterRemoval,
  hasVisibleOrNewCourseGroup,
  lastBottomTierGroupForCourse,
  lastRealRuleKeyIn,
  ruleBoxesForGroup,
  ruleKeyOf,
  snapshotPageOrder,
  visibleCourseGroups,
} from './utils';

/** A rule box only means anything inside its own group, so `groupId` and
 * `ruleKey` are always written together (see `selectGroup`/`selectRuleBox`).
 *
 * `groupId === null` means the selected group is a not-yet-saved placeholder
 * group. `ruleKey === null` means a placeholder rule box is selected, inside
 * the selected real group or inside the placeholder group. Only one
 * placeholder can exist at a time, since `selection` has only one slot.
 */
export interface CriteriaSelection {
  groupId: number | null;
  ruleKey: string | null;
}

/** The author's choices on the placeholder, kept apart from `selection`
 * because the non-placeholder flows also write `selection`. `parentRuleGroupId`
 * and `logicOperator` only matter while `selection.groupId === null`.
 */
export interface CriteriaPlaceholder {
  parentRuleGroupId: number | null;
  logicOperator: CompetencyGroupLogicOperator;
  rulePayload: GradeRulePayload | null;
}

/** One-shot move of the browser's keyboard focus after a delete removes the ⋮ button that held it (focus would fall to <body>).
 * `group` targets the newly selected group's select button, `empty` the empty-panel message;
 * `expand` opens a collapsed section holding the target. */
export type KeyboardFocusRequest = { kind: 'group'; groupId: number; expand: boolean; } | { kind: 'empty'; };

export interface CompetencyAssociationsContextValue {
  selection: CriteriaSelection | null;
  placeholder: CriteriaPlaceholder;
  /** Starts a placeholder rule box in the given real group, replacing any
   * existing placeholder.
   */
  addPlaceholderRuleBox: (groupId: number) => void;
  /** Starts a placeholder group under the given course-level group,
   * replacing any existing placeholder.
   */
  addPlaceholderGroup: (parentRuleGroupId: number) => void;
  /** Sets the placeholder group's own any/all combining logic. */
  setPlaceholderLogicOperator: (logicOperator: CompetencyGroupLogicOperator) => void;
  /** Sets the placeholder rule box's score, which is only persisted once
   * content is associated.
   */
  setPlaceholderRulePayload: (rulePayload: GradeRulePayload) => void;
  /** True after content was selected while the placeholder's score duplicated
   * a box in its group; the request is not sent.
   */
  placeholderDuplicateRejected: boolean;
  /** Drops the placeholder by clearing `selection`. */
  discardPlaceholder: () => void;
  /** Whether a placeholder exists, which disables both add controls. */
  hasPlaceholder: boolean;
  /** Selects a group and its last real rule box (`lastRealRuleKeyIn`). A
   * no-op when `groupId` is already selected, so re-clicking the group
   * heading doesn't discard a rule box the author had selected inside it.
   */
  selectGroup: (groupId: number) => void;
  /** Selects one specific rule box, and the group it belongs to, together. */
  selectRuleBox: (groupId: number, ruleKey: string) => void;
  /** Notify the provider that a course was expanded in the content panel.
   * Call only from that panel's own per-course chevron on expand, never on
   * collapse or from a page-level "Expand All". Feeds `canEditCourse` for a
   * group-less course, and moves selection to the course's last bottom-tier group
   * and its last rule box when selection is unset or on another course's group.
   */
  notifyCourseExpanded: (courseId: string) => void;
  /** Associates a piece of course content (a gradable subsection) with the
   * active competency.
   */
  associateSubsection: (objectId: string, courseId: string) => void;
  /** Updates a bottom-tier group's any/all combining logic (`#760`); a
   * rejected save is a no-op besides a failure toast.
   */
  updateGroupOperator: (groupId: number, logicOperator: CompetencyGroupLogicOperator) => void;
  /** Updates a rule box's score threshold across every criterion listed in
   * `criterionIds` (`#759`), deriving the new selection key from the response.
   */
  updateRuleScore: (groupId: number, criterionIds: number[], rulePayload: GradeRulePayload) => Promise<void>;
  /** Deletes a group, then moves selection per `selectionTargetAfterRemoval` once the refetch lands.
   * A 404 counts as success; any other failure shows a toast.
   */
  deleteGroup: (groupId: number) => void;
  /** True until a delete's follow-up refetch lands. */
  isDeletingGroup: boolean;
  /** Discards the placeholder group without a request and selects the last
   * saved group in its course-level group, or nothing when it has none.
   */
  removePlaceholderGroup: () => void;
  keyboardFocusRequest: KeyboardFocusRequest | null;
  /** Clears `keyboardFocusRequest` once the component it names has taken it. */
  consumeKeyboardFocusRequest: () => void;
  /**
   * Whether the signed-in author can create/manage associations for the
   * given course, via `useCourseTaggingPermissions`'s `courses.manage_tags`
   * check.
   */
  canEditCourse: (courseId: string) => boolean;
  /** The related competency that blocks the given listed course, or
   * `undefined` when the course is not blocked or the lookup is still
   * loading or failed, so selection fails open (the backend still rejects).
   */
  conflictingCompetencyName: (courseId: string) => string | undefined;
  groupsQuery: UseQueryResult<CompetencyCriteriaGroupsResponse>;
  profileQuery: UseQueryResult<CompetencyRuleProfile>;
  /** True until both `groupsQuery` and `profileQuery` have data, which
   * includes the time before any course keys are given, when `groupsQuery` is
   * disabled. The content panel disables subsection selection on it.
   */
  isLoadingAssociations: boolean;
  /** Built from `groupsQuery.data`; `undefined` until that query resolves. */
  index: CompetencyCriteriaGroupsIndex | undefined;
  systemDefaultProfile: CompetencyRuleProfile | undefined;
  /** Every already-associated criterion's `objectId` in the listed courses:
   * the create mutation's duplicate guard and the content panel's
   * "already associated" marking both read this. Content can only be picked
   * from a listed course, so the guard needs nothing outside them.
   */
  associatedObjectIds: Set<string>;
  /** `utils.ts`'s `visibleCourseGroups`, filtered by this provider's own
   * per-course outline-fetch results.
   */
  accessibleCourseGroups: CourseCompetencyCriteriaGroup[];
  /** Whether any course-level group's outline fetch is still pending.
   * `accessibleCourseGroups` is incomplete until this is `false`. A failed
   * fetch counts as resolved.
   */
  areCourseOutlinesLoading: boolean;
  /** The active competency's short external id (e.g. "CCRS-1.3"), shown on
   * an already-associated subsection's badge. `null` when the competency
   * has none.
   */
  competencyExternalId: string | null;
  /** Tells the provider which course keys the course list shows; call only
   * once its query has succeeded. A change in the keys discards an unsaved
   * placeholder.
   */
  notifyCoursesDisplayed: (courseKeys: string[]) => void;
  /** The course keys last given to `notifyCoursesDisplayed`, which
   * `groupsQuery` is scoped to; `undefined` until the first call. Until it
   * matches the course list's own keys, `groupsQuery.data` describes the
   * previously listed courses.
   */
  displayedCourseKeys: string[] | undefined;
  /** The active competency's name, shown in the Course Group menu's
   * "Remove from {competencyName}" item.
   */
  competencyName: string;
}

// Exported so component tests can render a hand-built value via
// `<CompetencyAssociationsContext.Provider>` without mocking every HTTP
// request the real provider would issue - see e.g. `criteria-groups/RuleBox.test.tsx`.
export const CompetencyAssociationsContext = createContext<CompetencyAssociationsContextValue | undefined>(undefined);

/** Reads the current competency-associations context. Throws outside a
 * `<CompetencyAssociationsProvider>` ancestor rather than a no-op default,
 * so a missing provider surfaces instead of failing silently.
 */
export function useCompetencyAssociations(): CompetencyAssociationsContextValue {
  const ctx = useContext(CompetencyAssociationsContext);
  if (ctx === undefined) {
    throw new Error(
      'useCompetencyAssociations() was used in a component without a <CompetencyAssociationsProvider> ancestor.',
    );
  }
  return ctx;
}

export interface CompetencyAssociationsProviderProps {
  tagId: number;
  competencyName: string;
  /** The active competency's short external id, for the already-associated
   * badge in the content panel below. `null` when the competency has none.
   */
  competencyExternalId: string | null;
  children: ReactNode;
}

/** Where focus should move when `courseId` is expanded, or `null` to leave it
 * as is: already on one of that course's groups, or the course has no group.
 */
function courseExpansionSelection(
  courseId: string,
  selection: CriteriaSelection | null,
  placeholder: CriteriaPlaceholder,
  index: CompetencyCriteriaGroupsIndex,
  systemDefaultProfile: CompetencyRuleProfile,
): CriteriaSelection | null {
  if (selection !== null && courseKeyOfSelection(selection, placeholder, index) === courseId) {
    return null;
  }
  const target = lastBottomTierGroupForCourse(index, courseId);
  return target ? { groupId: target.id, ruleKey: lastRealRuleKeyIn(target.id, index, systemDefaultProfile) } : null;
}

/** Provides per-competency criteria-association state to the right-hand
 * course panel.
 *
 * Never remounted (no `key={tagId}`), so it doesn't reset
 * `CourseSearchBrowse`'s own state on competency change; instead it resets
 * its selection by comparing the incoming `tagId` against the previous render's
 * value, React's documented alternative to a remounting `key`. The expanded
 * courses persist, mirroring the content panel's own expansion state.
 */
export const CompetencyAssociationsProvider = ({
  tagId,
  competencyName,
  competencyExternalId,
  children,
}: CompetencyAssociationsProviderProps) => {
  const intl = useIntl();
  const { showToast } = useToastContext();

  const [prevTagId, setPrevTagId] = useState(tagId);
  const [selection, setSelection] = useState<CriteriaSelection | null>(null);
  const [keyboardFocusRequest, setKeyboardFocusRequest] = useState<KeyboardFocusRequest | null>(null);
  // Any selection write other than a delete's own drops a pending keyboard focus request.
  const setSelectionAndDropKeyboardRequest = useCallback((next: SetStateAction<CriteriaSelection | null>) => {
    setSelection(next);
    setKeyboardFocusRequest(null);
  }, []);
  const {
    placeholder,
    duplicateRejected,
    setDuplicateRejected,
    resetPlaceholderState,
    addPlaceholderRuleBox,
    addPlaceholderGroup,
    setPlaceholderLogicOperator,
    setPlaceholderRulePayload,
    discardPlaceholder,
  } = usePlaceholderState(setSelectionAndDropKeyboardRequest);
  const [expandedCourseIds, setExpandedCourseIds] = useState<Set<string>>(new Set());
  const [displayedCourseKeys, setDisplayedCourseKeys] = useState<string[] | undefined>(undefined);
  const [prevDisplayedCourseKeys, setPrevDisplayedCourseKeys] = useState(displayedCourseKeys);
  // A course expanded before its group tree and default profile loaded.
  const [pendingExpandedCourseId, setPendingExpandedCourseId] = useState<string | null>(null);
  const hasRunInitialSelectionRef = useRef(false);
  // Bumped on every competency change, so an in-flight create can tell that
  // the author left and came back, which a tagId comparison can't.
  const [competencyVisitId, setCompetencyVisitId] = useState(0);
  const latestCompetencyVisitIdRef = useRef(competencyVisitId);
  latestCompetencyVisitIdRef.current = competencyVisitId;
  const competencyChanged = tagId !== prevTagId;
  if (competencyChanged) {
    setPrevTagId(tagId);
    setCompetencyVisitId(competencyVisitId + 1);
    setSelection(null);
    setPendingExpandedCourseId(null);
    resetPlaceholderState();
    setKeyboardFocusRequest(null);
    hasRunInitialSelectionRef.current = false;
  }

  // Drops an unsaved placeholder when the listed courses change, even when its
  // course stays listed (#683 leaves that open). Its course is only known
  // through the previous scope's index, and the new response can differ from
  // it, so the placeholder would need re-validating either way; a discard is
  // the predictable outcome. A saved selection is kept: `resolveCreateTarget` and
  // `notifyCourseExpanded` ignore a selection whose group is out of scope, the
  // cards don't highlight it, and it shows again once its page is listed.
  // Updating `prevDisplayedCourseKeys` makes this run once per change.
  if (displayedCourseKeys !== prevDisplayedCourseKeys) {
    setPrevDisplayedCourseKeys(displayedCourseKeys);
    const isFirstReport = prevDisplayedCourseKeys === undefined;
    const isPlaceholderSelected = selection !== null && selection.ruleKey === null;
    if (!isFirstReport && isPlaceholderSelected) {
      setSelection(null);
      setKeyboardFocusRequest(null);
      setDuplicateRejected(false);
    }
  }

  const notifyCoursesDisplayed = useCallback((courseKeys: string[]) => {
    setDisplayedCourseKeys((prev) => (isEqual(prev, courseKeys) ? prev : courseKeys));
  }, []);

  const groupsQuery = useCompetencyCriteriaGroups(tagId, displayedCourseKeys);
  const blockedCoursesQuery = useCompetencyBlockedCourses(tagId, displayedCourseKeys);
  const profileQuery = useDefaultCompetencyRuleProfile();
  const createCriterion = useCreateCompetencyCriterion();
  const updateGroupOperatorMutation = useUpdateCompetencyCriteriaGroupOperator();
  const updateRuleScoreMutation = useUpdateCompetencyCriteriaRule();
  const { mutate: mutateDeleteGroup, isPending: isDeletingGroup } = useDeleteCompetencyCriteriaGroup();
  const queryClient = useQueryClient();
  // A delete's settle callback runs after the refetch, so it reads the
  // latest selection and placeholder through refs to respect a click made
  // while the request was in flight.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;

  const index = useMemo(
    () => (groupsQuery.data ? buildCompetencyCriteriaGroupsIndex(groupsQuery.data) : undefined),
    [groupsQuery.data],
  );
  const systemDefaultProfile = profileQuery.data;
  const isLoadingAssociations = groupsQuery.isPending || profileQuery.isPending;
  const associatedIds = useMemo(
    () => (groupsQuery.data ? associatedObjectIds(groupsQuery.data) : new Set<string>()),
    [groupsQuery.data],
  );

  // Applied during render so the initial-focus effect below already sees it.
  // Skipped on the render that changes competency: the pending course belongs
  // to the previous one, but `index` may already be the new one's cached tree.
  if (!competencyChanged && pendingExpandedCourseId !== null && index && systemDefaultProfile) {
    const next = courseExpansionSelection(
      pendingExpandedCourseId,
      selection,
      placeholder,
      index,
      systemDefaultProfile,
    );
    setPendingExpandedCourseId(null);
    if (next) {
      setKeyboardFocusRequest(null);
      setDuplicateRejected(false);
      setSelection(next);
    }
  }

  const notifyCourseExpanded = useCallback((courseId: string) => {
    setExpandedCourseIds((prev) => (prev.has(courseId) ? prev : new Set(prev).add(courseId)));
    if (!index || !systemDefaultProfile) {
      setPendingExpandedCourseId(courseId);
      return;
    }
    const next = courseExpansionSelection(courseId, selection, placeholder, index, systemDefaultProfile);
    if (next) {
      setKeyboardFocusRequest(null);
      setDuplicateRejected(false);
      setSelection(next);
    }
  }, [selection, placeholder, index, systemDefaultProfile]);

  // Every course-level group's course key in the listed courses - each must
  // be fetched to determine accessibility (see `accessibleCourseIds` below).
  // Also feeds the initial-selection gate and, unioned with `expandedCourseIds`,
  // `canEditCourse`'s permission check.
  const courseIdsWithGroups = useMemo(
    () => (index ? index.courseGroups.map((courseGroup) => courseGroup.courseKey) : []),
    [index],
  );

  const outlineQueries = useQueries({
    queries: courseIdsWithGroups.map((courseId) => ({
      queryKey: courseOutlineQueryKeys.index(courseId),
      queryFn: () => getCourseOutlineIndex(courseId),
      retry: false as const,
    })),
  });
  const allVisibleCourseOutlinesResolved = outlineQueries.every((query) => !query.isLoading);

  // A course counts as accessible only once its outline fetch succeeds - a
  // failed fetch is excluded entirely rather than shown with a placeholder
  // name, and a still-loading one doesn't count as accessible either.
  const accessibleCourseIds = useMemo(() => {
    const ids = new Set<string>();
    courseIdsWithGroups.forEach((courseId, i) => {
      if (outlineQueries[i]?.isSuccess) {
        ids.add(courseId);
      }
    });
    return ids;
  }, [courseIdsWithGroups, outlineQueries]);

  const accessibleCourseGroups = useMemo(
    () => (index ? visibleCourseGroups(index, accessibleCourseIds) : []),
    [index, accessibleCourseIds],
  );

  const selectGroup = useCallback((groupId: number) => {
    setPendingExpandedCourseId(null);
    setSelection((prev) => {
      if (prev?.groupId === groupId) {
        // No-op: clicking the group already selected must not re-resolve
        // its default rule box, or it would silently throw away whichever
        // rule box the author had selected inside it.
        return prev;
      }
      const ruleKey = (index && systemDefaultProfile) ? lastRealRuleKeyIn(groupId, index, systemDefaultProfile) : null;
      return { groupId, ruleKey };
    });
    setKeyboardFocusRequest(null);
    setDuplicateRejected(false);
  }, [index, systemDefaultProfile]);

  const selectRuleBox = useCallback((groupId: number, ruleKey: string) => {
    setPendingExpandedCourseId(null);
    setSelection({ groupId, ruleKey });
    setKeyboardFocusRequest(null);
    setDuplicateRejected(false);
  }, []);

  const hasPlaceholder = selection !== null && selection.ruleKey === null;

  // Runs at most once per competency: once groups, profile, and every
  // course-with-a-group's outline have resolved, select the sole bottom-tier
  // group if exactly one exists among *accessible* course-level groups (an
  // inaccessible one isn't rendered, so it must never be auto-select
  // eligible). Independent of `expandedCourseIds`, which must not delay
  // this gate. A click that sets the selection first beats this auto-select; the
  // effect still marks itself as run, it just skips writing.
  useEffect(() => {
    if (hasRunInitialSelectionRef.current) {
      return;
    }
    if (!groupsQuery.isSuccess || !profileQuery.isSuccess || !allVisibleCourseOutlinesResolved || !index) {
      return;
    }
    hasRunInitialSelectionRef.current = true;
    if (selection !== null) {
      return;
    }
    const allBottomTierGroups = accessibleCourseGroups
      .flatMap((courseGroup) => bottomTierGroupsForCourse(index, courseGroup.courseKey));
    if (allBottomTierGroups.length === 1) {
      selectGroup(allBottomTierGroups[0].id);
    }
  }, [
    groupsQuery.isSuccess,
    profileQuery.isSuccess,
    allVisibleCourseOutlinesResolved,
    index,
    accessibleCourseGroups,
    selection,
    selectGroup,
  ]);

  // `canEditCourse`'s course list: every course with a group plus every
  // course expanded in the content panel (even group-less). Must not feed
  // the initial-selection gate above.
  const courseIdsForPermissions = useMemo(() => {
    const ids = new Set(expandedCourseIds);
    courseIdsWithGroups.forEach((courseId) => ids.add(courseId));
    return Array.from(ids);
  }, [expandedCourseIds, courseIdsWithGroups]);

  const { permissionsByCourseId } = useCourseTaggingPermissions(courseIdsForPermissions);
  const canEditCourse = useCallback(
    (courseId: string) => permissionsByCourseId[courseId] ?? false,
    [permissionsByCourseId],
  );

  const conflictingCompetencyName = useCallback(
    (courseId: string) => blockedCoursesQuery.data?.find((row) => row.courseKey === courseId)?.conflictingTagValue,
    [blockedCoursesQuery.data],
  );

  const associateSubsection = useCallback((objectId: string, courseId: string) => {
    if (associatedIds.has(objectId)) {
      // Not a real failure - the backend is still the real backstop for a
      // race, this only spares the author a failed-request error for
      // something that isn't actually one.
      showToast(intl.formatMessage(messages.alreadyAssociatedToastMessage), undefined, undefined, InfoOutline);
      return;
    }
    if (!index || !systemDefaultProfile) {
      // The content panel only offers this action once both are loaded.
      return;
    }

    const target = resolveCreateTarget(courseId, selection, placeholder, index, systemDefaultProfile);
    if (target.kind === 'duplicate') {
      setDuplicateRejected(true);
      return;
    }
    const payload: CreateCompetencyCriterionPayload = { object_id: objectId, ...target.fields };

    createCriterion.mutate({ tagId, payload }, {
      onSuccess: (criterion) => {
        if (latestCompetencyVisitIdRef.current !== competencyVisitId) {
          return;
        }
        // From the response itself, not `lastRealRuleKeyIn` against the
        // local tree: the groups query hasn't refetched yet, so the local
        // tree still doesn't know about this brand-new criterion (or
        // group) and would resolve a stale/`null` rule key.
        setDuplicateRejected(false);
        setSelection({
          groupId: criterion.groupId,
          ruleKey: ruleKeyOf(criterion, systemDefaultProfile),
        });
      },
      onError: (error) => {
        // The backend's hierarchy dominance check (ADR 0002): rejects a new
        // criterion when an ancestor or descendant competency already has
        // criteria in the same course, as a 400 with a `tag_id` field error.
        const { response } = error;
        const isHierarchyConflict = response?.status === 400
          && typeof response.data === 'object' && response.data !== null && 'tag_id' in response.data;
        showToast(
          intl.formatMessage(
            isHierarchyConflict
              ? messages.createCriterionHierarchyConflictToastMessage
              : messages.createCriterionFailedToastMessage,
          ),
          undefined,
          undefined,
          ErrorIcon,
        );
      },
    });
  }, [
    associatedIds,
    index,
    systemDefaultProfile,
    selection,
    placeholder,
    tagId,
    competencyVisitId,
    createCriterion,
    showToast,
    intl,
  ]);

  const updateGroupOperator = useCallback((groupId: number, logicOperator: CompetencyGroupLogicOperator) => {
    updateGroupOperatorMutation.mutate({ tagId, groupId, logicOperator }, {
      onError: () => {
        // No local rollback needed: `LogicOperatorSelect` always renders
        // from `group.logicOperator`, which a rejected mutation never touches.
        showToast(intl.formatMessage(messages.updateGroupOperatorFailedToastMessage));
      },
    });
  }, [tagId, updateGroupOperatorMutation, showToast, intl]);

  const updateRuleScore = useCallback((
    groupId: number,
    criterionIds: number[],
    rulePayload: GradeRulePayload,
  ): Promise<void> => {
    if (!index || !systemDefaultProfile) {
      // Defensive TypeScript-narrowing guard, not an expected runtime path: a rule box is only
      // ever rendered - let alone made editable - once both queries have resolved.
      throw new Error('updateRuleScore called before the groups index and system default profile were loaded.');
    }
    // Rule type is pinned to the box's current effective rule, resolved
    // from any one criterion already in it (they all share it, by definition).
    const groupCriteria = index.criteriaByGroupId.get(groupId) ?? [];
    const anchorCriterion = groupCriteria.find((criterion) => criterionIds.includes(criterion.id));
    if (!anchorCriterion) {
      // Defensive guard, not an expected runtime path: `criterionIds` always comes from this
      // same group's own rendered rule box.
      throw new Error(`updateRuleScore: no criterion in group ${groupId} matched the given criterionIds.`);
    }
    const { ruleType } = effectiveRuleOf(anchorCriterion, systemDefaultProfile);

    return updateRuleScoreMutation.mutateAsync({ tagId, groupId, criterionIds, ruleType, rulePayload })
      .then((updatedCriteria) => {
        // From the response, not the request: a "reset to default" edit can
        // echo back a shared profile reference instead of the sent values,
        // so the new selection key has to come from what was actually persisted.
        const [updatedCriterion] = updatedCriteria;
        if (updatedCriterion) {
          setSelection({ groupId, ruleKey: ruleKeyOf(updatedCriterion, systemDefaultProfile) });
        }
      })
      .catch((error) => {
        showToast(intl.formatMessage(messages.updateRuleScoreFailedToastMessage));
        // Re-thrown so ScoreThresholdField's own commit handler also sees
        // the rejection and reverts its local input.
        throw error;
      });
  }, [index, systemDefaultProfile, tagId, updateRuleScoreMutation, showToast, intl]);

  const consumeKeyboardFocusRequest = useCallback(() => setKeyboardFocusRequest(null), []);

  // Selects the group's FIRST rule box (per the ticket); `selectGroup` selects the last.
  const selectGroupAfterRemoval = useCallback((
    groupId: number,
    freshIndex: CompetencyCriteriaGroupsIndex,
    shouldRequestKeyboardFocus: boolean,
  ) => {
    const ruleKey = systemDefaultProfile
      ? (ruleBoxesForGroup(groupId, freshIndex, systemDefaultProfile)[0]?.key ?? null)
      : null;
    setSelection({ groupId, ruleKey });
    setDuplicateRejected(false);
    setKeyboardFocusRequest(shouldRequestKeyboardFocus ? { kind: 'group', groupId, expand: true } : null);
  }, [systemDefaultProfile]);

  const resolveSelectionAfterDelete = useCallback((deletedGroupId: number, snapshot: PageOrderSnapshot) => {
    // Reads the keys from its closure on purpose, unlike selection and placeholder:
    // `snapshot` describes the page the delete started on. If the author paged
    // meanwhile, the refresh removed that page's entry, so this returns and
    // leaves the selection alone rather than repairing it against another page's groups.
    const freshData = queryClient.getQueryData<CompetencyCriteriaGroupsResponse>(
      competencyQueryKeys.competencyCriteriaGroups(tagId, displayedCourseKeys),
    );
    if (!freshData) {
      return;
    }
    const freshIndex = buildCompetencyCriteriaGroupsIndex(freshData);
    const currentSelection = selectionRef.current;
    const target = selectionTargetAfterRemoval(
      snapshot,
      freshIndex,
      currentSelection,
      placeholderRef.current.parentRuleGroupId,
    );
    // A failed or no-op delete leaves the menu button in the DOM, which
    // keeps the browser's focus; only a vanished group strands it.
    const isDeletedGroupGone = !freshIndex.groupsById.has(deletedGroupId);

    if (target === 'keep-current') {
      const selectedGroupId = currentSelection?.groupId ?? null;
      const shouldReturnKeyboardFocusToSelection = isDeletedGroupGone && selectedGroupId !== null;
      if (shouldReturnKeyboardFocusToSelection) {
        setKeyboardFocusRequest({ kind: 'group', groupId: selectedGroupId, expand: false });
      }
    } else if (target === null) {
      const isPanelEmpty = isDeletedGroupGone && !hasVisibleOrNewCourseGroup(snapshot, freshIndex);
      setSelection(null);
      setDuplicateRejected(false);
      setKeyboardFocusRequest(isPanelEmpty ? { kind: 'empty' } : null);
    } else {
      selectGroupAfterRemoval(target, freshIndex, isDeletedGroupGone);
    }
  }, [queryClient, tagId, displayedCourseKeys, selectGroupAfterRemoval]);

  const deleteGroup = useCallback((groupId: number) => {
    if (!index) {
      return;
    }
    const snapshot = snapshotPageOrder(index, accessibleCourseGroups);
    mutateDeleteGroup({ tagId, groupId }, {
      onError: (error) => {
        // 404: the group is already gone, which is what the author asked for.
        if (error.response?.status !== 404) {
          showToast(intl.formatMessage(messages.deleteGroupFailedToastMessage));
        }
      },
      onSettled: () => {
        resolveSelectionAfterDelete(groupId, snapshot);
      },
    });
  }, [index, accessibleCourseGroups, tagId, mutateDeleteGroup, resolveSelectionAfterDelete, showToast, intl]);

  const removePlaceholderGroup = useCallback(() => {
    const { parentRuleGroupId } = placeholder;
    const parentGroup = parentRuleGroupId !== null ? index?.groupsById.get(parentRuleGroupId) : undefined;
    const lastGroup = index && parentGroup?.courseKey != null
      ? lastBottomTierGroupForCourse(index, parentGroup.courseKey)
      : null;
    if (index && lastGroup) {
      selectGroupAfterRemoval(lastGroup.id, index, true);
    } else {
      setSelection(null);
      setKeyboardFocusRequest(null);
    }
  }, [placeholder, index, selectGroupAfterRemoval]);

  const contextValue = useMemo<CompetencyAssociationsContextValue>(() => ({
    selection,
    placeholder,
    addPlaceholderRuleBox,
    addPlaceholderGroup,
    setPlaceholderLogicOperator,
    setPlaceholderRulePayload,
    discardPlaceholder,
    hasPlaceholder,
    placeholderDuplicateRejected: duplicateRejected,
    selectGroup,
    selectRuleBox,
    notifyCourseExpanded,
    associateSubsection,
    updateGroupOperator,
    updateRuleScore,
    deleteGroup,
    isDeletingGroup,
    removePlaceholderGroup,
    keyboardFocusRequest,
    consumeKeyboardFocusRequest,
    canEditCourse,
    conflictingCompetencyName,
    groupsQuery,
    profileQuery,
    isLoadingAssociations,
    index,
    systemDefaultProfile,
    associatedObjectIds: associatedIds,
    accessibleCourseGroups,
    areCourseOutlinesLoading: !allVisibleCourseOutlinesResolved,
    competencyExternalId,
    notifyCoursesDisplayed,
    displayedCourseKeys,
    competencyName,
  }), [
    selection,
    placeholder,
    addPlaceholderRuleBox,
    addPlaceholderGroup,
    setPlaceholderLogicOperator,
    setPlaceholderRulePayload,
    discardPlaceholder,
    hasPlaceholder,
    duplicateRejected,
    selectGroup,
    selectRuleBox,
    notifyCourseExpanded,
    associateSubsection,
    updateGroupOperator,
    updateRuleScore,
    deleteGroup,
    isDeletingGroup,
    removePlaceholderGroup,
    keyboardFocusRequest,
    consumeKeyboardFocusRequest,
    canEditCourse,
    conflictingCompetencyName,
    groupsQuery,
    profileQuery,
    isLoadingAssociations,
    index,
    systemDefaultProfile,
    associatedIds,
    accessibleCourseGroups,
    allVisibleCourseOutlinesResolved,
    competencyExternalId,
    notifyCoursesDisplayed,
    displayedCourseKeys,
    competencyName,
  ]);

  return (
    <CompetencyAssociationsContext.Provider value={contextValue}>
      {children}
    </CompetencyAssociationsContext.Provider>
  );
};
