import { useEffect, useMemo, useState } from 'react';
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';

import { useUserPermissions } from '@src/authz/data/apiHooks';
import { COURSE_PERMISSIONS } from '@src/authz/constants';
import { useWaffleFlags } from '@src/data/apiHooks';
import type { PermissionValidationQuery } from '@src/authz/types';

import * as api from './api';
import type {
  CompetencyCriteriaGroup,
  CompetencyCriterion,
  CompetencyGroupLogicOperator,
  CreateCompetencyCriterionPayload,
  CreateCompetencyCriterionResponse,
  GradeRulePayload,
} from './types';

/**
 * Query key factory for competency-management data, following the same
 * `all -> one entity -> its sub-resources` shape as `taxonomyQueryKeys`
 * (`src/taxonomy/data/apiHooks.ts`), so invalidating `competency(tagId)`
 * would clear every query scoped to one competency at once.
 */
export const competencyQueryKeys = {
  all: ['competencyManagement'],
  /** Base key for data specific to one competency (tag). No data is stored directly in this key.
   * @param tagId ID of the competency (tag)
   */
  competency: (tagId: number | undefined) => [...competencyQueryKeys.all, 'competency', tagId],
  /** @param tagId ID of the competency (tag) */
  competencyCriteriaGroups: (tagId: number | undefined, courseKeys?: string[]) => [
    ...competencyQueryKeys.competency(tagId),
    'criteriaGroups',
    ...(courseKeys ? [courseKeys] : []),
  ],
  competencyBlockedCourses: (tagId: number | undefined, courseKeys?: string[]) => [
    ...competencyQueryKeys.competency(tagId),
    'blockedCourses',
    ...(courseKeys ? [courseKeys] : []),
  ],
  /** The studio-wide default rule profile - not scoped to any one competency. */
  defaultRuleProfile: () => [...competencyQueryKeys.all, 'defaultRuleProfile'],
} satisfies Record<
  string,
  Array<string | number | undefined> | ((...args: any[]) => Array<string | number | string[] | undefined>)
>;

/**
 * Load a competency's existing criteria groups and criteria (`#681`).
 * @param tagId The id of the selected competency, or `undefined` while
 * none is selected yet - the query is disabled until a real id is available.
 * @param courseKeys The listed courses' keys; `undefined` until reported (query disabled).
 */
export const useCompetencyCriteriaGroups = (tagId: number | undefined, courseKeys: string[] | undefined) => (
  useQuery({
    queryKey: competencyQueryKeys.competencyCriteriaGroups(tagId, courseKeys),
    queryFn: tagId !== undefined && courseKeys !== undefined
      ? () => api.getCompetencyCriteriaGroups(tagId, courseKeys)
      : skipToken,
  })
);

/** Load which of the listed courses a parent or child competency already claims .*/
export const useCompetencyBlockedCourses = (tagId: number | undefined, courseKeys: string[] | undefined) => (
  useQuery({
    queryKey: competencyQueryKeys.competencyBlockedCourses(tagId, courseKeys),
    queryFn: tagId !== undefined && courseKeys?.length
      ? () => api.getCompetencyBlockedCourses(tagId, courseKeys)
      : skipToken,
    gcTime: 0,
  })
);

/** Load the studio-wide default competency rule profile (`#773`). */
export const useDefaultCompetencyRuleProfile = () => (
  useQuery({
    queryKey: competencyQueryKeys.defaultRuleProfile(),
    queryFn: () => api.getDefaultCompetencyRuleProfile(),
  })
);

/**
 * Refresh every scoped criteria-groups entry of one competency after a write.
 * The inactive entries (other course-list pages) are removed rather than only
 * marked stale, so revisiting a page can't briefly show its pre-write counts.
 * @returns The invalidation promise, which settles once the active refetch lands.
 */
const refreshCompetencyCriteriaGroups = (queryClient: QueryClient, tagId: number) => {
  const queryKey = competencyQueryKeys.competencyCriteriaGroups(tagId);
  queryClient.removeQueries({ queryKey, type: 'inactive' });
  return queryClient.invalidateQueries({ queryKey });
};

/** Build the mutation to create a new criterion under a competency (`#665`),
 * refreshing its criteria groups on success.
 */
export const useCreateCompetencyCriterion = () => {
  const queryClient = useQueryClient();
  return useMutation<
    CreateCompetencyCriterionResponse,
    AxiosError<Record<string, string[]>>,
    { tagId: number; payload: CreateCompetencyCriterionPayload; }
  >({
    mutationFn: (
      { tagId, payload }: { tagId: number; payload: CreateCompetencyCriterionPayload; },
    ) => api.createCompetencyCriterion(tagId, payload),
    onSuccess: (_data, { tagId }) => refreshCompetencyCriteriaGroups(queryClient, tagId),
  });
};

/** Build the mutation to update a bottom-tier group's any/all combining
 * logic (`#760`), refreshing the competency's criteria groups on success.
 */
export const useUpdateCompetencyCriteriaGroupOperator = () => {
  const queryClient = useQueryClient();
  return useMutation<
    CompetencyCriteriaGroup,
    AxiosError<Record<string, string[]>>,
    { tagId: number; groupId: number; logicOperator: CompetencyGroupLogicOperator; }
  >({
    mutationFn: (
      { tagId, groupId, logicOperator }: {
        tagId: number;
        groupId: number;
        logicOperator: CompetencyGroupLogicOperator;
      },
    ) => api.updateCompetencyCriteriaGroupOperator(tagId, groupId, logicOperator),
    onSuccess: (_data, { tagId }) => refreshCompetencyCriteriaGroups(queryClient, tagId),
  });
};

/** Build the mutation to batch-update a rule box's score threshold (`#759`),
 * refreshing the competency's criteria groups on success. `tagId` is only
 * used for that refresh - the endpoint's own URL isn't nested under a competency.
 */
export const useUpdateCompetencyCriteriaRule = () => {
  const queryClient = useQueryClient();
  return useMutation<
    CompetencyCriterion[],
    AxiosError<Record<string, string[]>>,
    { tagId: number; groupId: number; criterionIds: number[]; ruleType: string; rulePayload: GradeRulePayload; }
  >({
    mutationFn: (
      { groupId, criterionIds, ruleType, rulePayload }: {
        tagId: number;
        groupId: number;
        criterionIds: number[];
        ruleType: string;
        rulePayload: GradeRulePayload;
      },
    ) => api.updateCompetencyCriteriaRule(groupId, criterionIds, ruleType, rulePayload),
    onSuccess: (_data, { tagId }) => refreshCompetencyCriteriaGroups(queryClient, tagId),
  });
};

/** Build the mutation to delete a group (`#709`). It refreshes the competency's
 * criteria groups on success and failure alike, and stays pending until that
 * refetch lands.
 */
export const useDeleteCompetencyCriteriaGroup = () => {
  const queryClient = useQueryClient();
  return useMutation<void, AxiosError, { tagId: number; groupId: number; }>({
    mutationFn: ({ tagId, groupId }) => api.deleteCompetencyCriteriaGroup(tagId, groupId),
    onSettled: (_data, _error, { tagId }) => refreshCompetencyCriteriaGroups(queryClient, tagId),
  });
};

export interface UseCourseTaggingPermissionsReturn {
  isLoading: boolean;
  isAuthzEnabled: boolean;
  permissionsByCourseId: Record<string, boolean>;
}

/**
 * Whether the signed-in author can manage this competency's associations for
 * each of the given courses, via the studio-wide `courses.manage_tags`
 * authz action (`COURSE_PERMISSIONS.MANAGE_TAGS`).
 *
 * Reproduces `useCourseUserPermissions`'s fallback rules for a *list* of
 * courses: every course resolves to `true` when `enableAuthzCourseAuthoring`
 * is off, and to `false` while that flag or the permissions call is loading.
 *
 * A course id's last-known answer survives a later, bigger `courseIds` call
 * (e.g. expanding a second course): `useUserPermissions`'s cache key embeds
 * the whole query object, so a bigger set is a new, momentarily-loading
 * query, and without this every already-resolved course would flash back to
 * `false` too.
 */
export const useCourseTaggingPermissions = (courseIds: string[]): UseCourseTaggingPermissionsReturn => {
  // The studio-wide endpoint returns the same flag regardless of course, so
  // no course id is passed here (the parameter is optional).
  const waffleFlags = useWaffleFlags();
  const isWaffleFlagsLoading = waffleFlags?.isLoading ?? true;
  const isAuthzEnabled = waffleFlags?.enableAuthzCourseAuthoring ?? false;

  // Memoized on a sorted/joined id string, not the `courseIds` array
  // reference, so this query object - and so `useUserPermissions`'s own
  // cache key, which embeds the whole object - stays stable across renders
  // that pass an equivalent but differently-ordered or new-reference array.
  const sortedCourseIdsKey = [...courseIds].sort().join(',');
  const query = useMemo<PermissionValidationQuery>(() => {
    if (!sortedCourseIdsKey) {
      return {};
    }
    return sortedCourseIdsKey.split(',').reduce<PermissionValidationQuery>((acc, courseId) => {
      acc[courseId] = { action: COURSE_PERMISSIONS.MANAGE_TAGS, scope: courseId };
      return acc;
    }, {});
  }, [sortedCourseIdsKey]);

  // Mirrors `useCourseUserPermissions`'s own `isAuthzEnabled && !!courseId`
  // gate, generalized to "there's at least one course id to check."
  const shouldValidatePermissions = isAuthzEnabled && courseIds.length > 0;
  const { isLoading: isLoadingUserPermissions, data: userPermissions } = useUserPermissions(
    query,
    shouldValidatePermissions,
  );

  const isLoading = isWaffleFlagsLoading || (isAuthzEnabled && isLoadingUserPermissions);

  // Accumulates every course id's last-known answer as permissions calls
  // resolve, so a course already resolved once keeps that answer while a
  // later, bigger query is still in flight (see the docstring above).
  const [resolvedAnswers, setResolvedAnswers] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!isLoadingUserPermissions && userPermissions) {
      setResolvedAnswers((prev) => ({ ...prev, ...userPermissions }));
    }
  }, [isLoadingUserPermissions, userPermissions]);

  const permissionsByCourseId = useMemo(() => {
    const result: Record<string, boolean> = {};
    courseIds.forEach((courseId) => {
      if (isWaffleFlagsLoading) {
        result[courseId] = false;
      } else {
        result[courseId] = isAuthzEnabled ? (resolvedAnswers[courseId] ?? false) : true;
      }
    });
    return result;
  }, [courseIds, isWaffleFlagsLoading, isAuthzEnabled, resolvedAnswers]);

  return { isLoading, isAuthzEnabled, permissionsByCourseId };
};
