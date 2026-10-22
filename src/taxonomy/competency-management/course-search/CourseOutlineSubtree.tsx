import { type ReactNode, useState } from 'react';

import { useIntl } from '@edx/frontend-platform/i18n';
import {
  Badge,
  Button,
  Icon,
  IconButton,
} from '@openedx/paragon';
import {
  AddCircleOutline,
  AdsClick,
  CheckCircle,
  ExpandLess,
  ExpandMore,
} from '@openedx/paragon/icons';

import { useCourseOutlineIndex } from '@src/course-outline/data';
import type { XBlock } from '@src/data/types';
import { LoadingSpinner } from '@src/generic/Loading';
import { useCompetencyAssociations } from '../CompetencyAssociationsContext';
import DisabledControlTooltip from '../DisabledControlTooltip';
import rootMessages from '../messages';
import messages from './messages';

export interface CourseOutlineSubtreeProps {
  courseId: string;
}

interface SubsectionRowProps {
  subsection: XBlock;
  courseId: string;
}

/**
 * One row for a single graded subsection.
 *
 * Clicking the row associates the subsection with the competency. The row is
 * non-interactive when the course can't be edited, association data is still
 * loading, or another competency blocks the course. The associated state is
 * always shown, even when the row can't be clicked.
 */
const SubsectionRow = ({ subsection, courseId }: SubsectionRowProps) => {
  const intl = useIntl();
  const {
    associatedObjectIds,
    associateSubsection,
    canEditCourse,
    competencyExternalId,
    conflictingCompetencyName,
    index,
    systemDefaultProfile,
    isDeletingGroup,
    isLoadingAssociations,
  } = useCompetencyAssociations();
  // The real `course_index` response populates `.id`, never `.usageKey`
  // (declared on the shared `XBlockBase` type but always `undefined` here).
  const isAssociated = associatedObjectIds.has(subsection.id);
  const canSelect = canEditCourse(courseId) && !!index && !!systemDefaultProfile;
  const conflictingCompetency = conflictingCompetencyName(courseId);

  const rowClassName = 'course-search-browse__subsection d-flex align-items-center justify-content-between';
  const competencyIdLabel = competencyExternalId && (
    <span className="sr-only">
      {intl.formatMessage(rootMessages.competencyIdAccessibleLabel, { externalId: competencyExternalId })}
    </span>
  );
  const associatedIcon = isAssociated && (
    <Icon
      src={CheckCircle}
      size="xs"
      className="course-search-browse__subsection-associated-icon"
      aria-hidden="true"
    />
  );

  if (canSelect && conflictingCompetency !== undefined) {
    return (
      <div className={`${rowClassName} course-search-browse__subsection--blocked`} data-associated={isAssociated}>
        <Button variant="tertiary" type="button" disabled className="course-search-browse__subsection-title">
          {subsection.displayName}
        </Button>
        <span className="course-search-browse__subsection-actions">
          <DisabledControlTooltip
            tooltip={intl.formatMessage(messages.hierarchyConflictTooltip, { competencyName: conflictingCompetency })}
            placement="left"
            variant="light"
            className="course-search-browse__subsection-badge-tooltip-wrapper"
            tooltipClassName="course-search-browse-blocked-tooltip"
          >
            {competencyIdLabel}
            <Badge
              variant="secondary"
              pill
              className="course-search-browse__subsection-badge course-search-browse__subsection-badge--blocked"
              aria-hidden="true"
            >
              <Icon src={AdsClick} size="sm" />
              {competencyExternalId}
            </Badge>
          </DisabledControlTooltip>
          {associatedIcon}
        </span>
      </div>
    );
  }

  const rowContent = (
    <>
      <span>{subsection.displayName}</span>
      <span className="course-search-browse__subsection-actions">
        {isAssociated && competencyExternalId && (
          <>
            {competencyIdLabel}
            <Badge
              variant="info"
              pill
              className="course-search-browse__subsection-badge"
              aria-hidden="true"
            >
              <Icon src={AdsClick} size="sm" />
              {competencyExternalId}
            </Badge>
          </>
        )}
        {associatedIcon}
        {canSelect && (
          <Icon
            src={AddCircleOutline}
            size="xs"
            className="course-search-browse__subsection-select-icon"
            aria-hidden="true"
          />
        )}
      </span>
    </>
  );

  if (!canSelect) {
    return (
      <div className={rowClassName} data-associated={isAssociated}>
        {rowContent}
      </div>
    );
  }

  return (
    <Button
      variant="tertiary"
      type="button"
      block
      className={rowClassName}
      data-associated={isAssociated}
      disabled={isDeletingGroup || isLoadingAssociations}
      onClick={() => associateSubsection(subsection.id, courseId)}
    >
      {rowContent}
    </Button>
  );
};

interface SectionHeaderProps {
  displayName: string;
  hasGradedSubsection: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

/**
 * One section (chapter) header: navigation only, never an association
 * target. A section with a graded subsection gets its own disclosure
 * control, starting collapsed; a section with none renders as plain,
 * non-interactive text with no icon.
 */
const SectionHeader = ({
  displayName,
  hasGradedSubsection,
  isExpanded,
  onToggle,
}: SectionHeaderProps) => {
  const intl = useIntl();

  if (!hasGradedSubsection) {
    return <div className="course-search-browse__section-header font-weight-bold small">{displayName}</div>;
  }

  const toggleLabel = isExpanded
    ? intl.formatMessage(messages.collapseSectionButtonLabel)
    : intl.formatMessage(messages.expandSectionButtonLabel);

  return (
    <div className="course-search-browse__section-header font-weight-bold small d-flex align-items-center">
      <IconButton
        src={isExpanded ? ExpandLess : ExpandMore}
        alt={toggleLabel}
        aria-label={toggleLabel}
        aria-expanded={isExpanded}
        size="sm"
        onClick={onToggle}
      />
      <div className="course-search-browse__section-title ml-2">{displayName}</div>
    </div>
  );
};

/**
 * Lazily-fetched course outline shown inside an expanded `CourseRow`.
 *
 * Renders each section as a header, and under it only its graded
 * subsections as clickable rows; ungraded subsections and anything below a
 * subsection (units/verticals) are never rendered.
 */
const CourseOutlineSubtree = ({ courseId }: CourseOutlineSubtreeProps) => {
  const intl = useIntl();
  // `refetchOnMount: false`: without it, collapsing and re-expanding the
  // same course (unmount/remount) within the query cache's staleTime would
  // trigger a wasted refetch of already-cached data.
  const { data, isLoading, isError } = useCourseOutlineIndex(courseId, { refetchOnMount: false });
  // Ids of sections currently expanded; every section starts collapsed.
  const [expandedSectionIds, setExpandedSectionIds] = useState<Set<string>>(new Set());

  const handleToggleSection = (sectionId: string) => {
    setExpandedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  let content: ReactNode;
  if (isLoading) {
    content = <LoadingSpinner size="sm" />;
  } else if (isError) {
    content = (
      <div role="alert" className="text-danger small">
        {intl.formatMessage(messages.outlineErrorMessage)}
      </div>
    );
  } else {
    // Computed once per section (rather than filtered separately for
    // `hasGradedSubsection` and for rendering) so both uses stay in sync.
    const sectionsWithGradedSubsections = (data?.courseStructure.childInfo?.children ?? [])
      .filter((block) => block.category === 'chapter')
      .map((section) => ({
        section,
        gradedSubsections: (section.childInfo?.children ?? []).filter(
          (subsection) => subsection.category === 'sequential' && subsection.graded,
        ),
      }));
    const hasGradedSubsection = sectionsWithGradedSubsections.some(
      ({ gradedSubsections }) => gradedSubsections.length > 0,
    );

    if (!hasGradedSubsection) {
      content = <div className="small">{intl.formatMessage(messages.noGradedSubsectionsMessage)}</div>;
    } else {
      content = sectionsWithGradedSubsections.map(({ section, gradedSubsections }) => {
        const sectionId = String(section.id);
        const sectionHasGradedSubsection = gradedSubsections.length > 0;
        const isExpanded = expandedSectionIds.has(sectionId);

        return (
          <div key={section.id} className="course-search-browse__group course-search-browse__group--section">
            <SectionHeader
              displayName={section.displayName}
              hasGradedSubsection={sectionHasGradedSubsection}
              isExpanded={isExpanded}
              onToggle={() => handleToggleSection(sectionId)}
            />
            {sectionHasGradedSubsection && isExpanded && gradedSubsections.map((subsection) => (
              <SubsectionRow
                key={subsection.id}
                subsection={subsection}
                courseId={courseId}
              />
            ))}
          </div>
        );
      });
    }
  }

  return (
    <div className="course-search-browse__outline pt-2">
      {content}
    </div>
  );
};

export default CourseOutlineSubtree;
