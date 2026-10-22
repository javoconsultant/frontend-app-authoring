import {
  act,
  fireEvent,
  initializeMocks,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from '@src/testUtils';
import { isEqual, uniqBy } from 'lodash';
import { getApiBaseUrl, type Course } from '@src/studio-home/data/api';
import { getCourseOutlineIndexApiUrl } from '@src/course-outline/data';
import { buildOutlineIndex } from '@src/course-outline/__mocks__';
import { CompetencyAssociationsProvider } from '../CompetencyAssociationsContext';
import { apiUrls as competencyManagementApiUrls } from '../data/api';
import type { CompetencyTreeNode } from '../CompetencyTree';
import CourseRow from './CourseRow';
import CourseSearchBrowse from './CourseSearchBrowse';

let axiosMock;

const coursesApiUrl = `${getApiBaseUrl()}/api/contentstore/v2/home/courses`;

const activeCompetency: CompetencyTreeNode = { id: 1, value: 'Test Competency' };

const buildCourse = (overrides: Partial<Course> = {}): Course => ({
  courseKey: 'course-v1:OrgX+CS101+2024',
  displayName: 'Intro to Testing',
  lmsLink: null,
  number: 'CS101',
  org: 'OrgX',
  rerunLink: null,
  run: '2024',
  url: '/course/course-v1:OrgX+CS101+2024',
  ...overrides,
});

const buildResponse = (courses: Course[], numPages: number = 1) => ({
  results: { courses },
  numPages,
  count: courses.length,
});

/** The params of the summary line's unfiltered accessible-course-count request, which hits the same endpoint. */
const accessibleCoursesCountParams = { page_size: 1 };
const accessibleCourseCount = 208;
const buildAccessibleCountResponse = (count: number = accessibleCourseCount) => ({
  results: { courses: [buildCourse()] },
  numPages: count,
  count,
});

/** A request for a page of the course list itself, not the accessible-course-count one. */
const isCourseListRequest = (req: { url?: string; params?: unknown; }) => (
  req.url === coursesApiUrl && !isEqual(req.params, accessibleCoursesCountParams)
);
const accessibleCountRequests = () =>
  axiosMock.history.get.filter(
    (req) => req.url === coursesApiUrl && isEqual(req.params, accessibleCoursesCountParams),
  );

// Scoped to the course list's own requests: `axiosMock.history.get` also holds
// `CompetencyAssociationsProvider`'s requests and the accessible-course-count one.
const lastRequestParams = () => {
  const courseRequests = axiosMock.history.get.filter(isCourseListRequest);
  return courseRequests[courseRequests.length - 1].params;
};

/** A promise-backed reply the test settles itself, to hold a request in flight. */
const deferredReply = () => {
  let settle: (reply: [number, unknown]) => void = () => {};
  const promise = new Promise<[number, unknown]>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
};

const courseSearchBrowseTree = (competency: CompetencyTreeNode = activeCompetency) => (
  <CompetencyAssociationsProvider
    tagId={Number(competency.id)}
    competencyName={competency.value}
    competencyExternalId={null}
  >
    <CourseSearchBrowse activeCompetency={competency} />
  </CompetencyAssociationsProvider>
);

const renderCourseSearchBrowse = () => render(courseSearchBrowseTree());

const renderCourseRow = (course: Course) =>
  render(
    <CompetencyAssociationsProvider
      tagId={Number(activeCompetency.id)}
      competencyName={activeCompetency.value}
      competencyExternalId={null}
    >
      <CourseRow course={course} />
    </CompetencyAssociationsProvider>,
  );

describe('<CourseSearchBrowse /> and <CourseRow />', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  beforeEach(() => {
    ({ axiosMock } = initializeMocks());
    // Registered before any test's own course-list handler, so it alone
    // answers the accessible-course-count request (handlers match in order).
    axiosMock.onGet(coursesApiUrl, { params: accessibleCoursesCountParams })
      .reply(200, buildAccessibleCountResponse());
    // The associations section mounts alongside the course list and fires
    // its own requests; mocked here to the empty-associations shape so
    // tests that don't care about it aren't left in a loading state.
    axiosMock.onGet(competencyManagementApiUrls.competencyCriteriaGroups(Number(activeCompetency.id)))
      .reply(200, { groups: [], criteria: [], criteria_count: 0, total_criteria_count: 0 });
    axiosMock.onGet(competencyManagementApiUrls.competencyBlockedCourses(Number(activeCompetency.id)))
      .reply(200, { count: 0, next: null, previous: null, results: [] });
    axiosMock.onGet(competencyManagementApiUrls.defaultCompetencyRuleProfile())
      .reply(200, {
        count: 1,
        next: null,
        previous: null,
        results: [{
          id: 1,
          scope_type: 'system_default',
          rule_type: 'grade',
          rule_payload: { op: 'gte', value: 0.7, scale: 'percent' },
          archived: false,
        }],
      });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('<CourseSearchBrowse />', () => {
    it(
      'renders the active competency\'s name in the "Demonstrate Mastery For" line, and the '
        + 'empty-associations state once the associations queries resolve',
      async () => {
        axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([buildCourse()]));
        renderCourseSearchBrowse();

        expect(await screen.findByText('Demonstrate Mastery For Test Competency')).toBeInTheDocument();
        expect(await screen.findByText('No content associated.')).toBeInTheDocument();
        expect(
          screen.getByText('Make content selections to associate this competency with course content.'),
        ).toBeInTheDocument();
      },
    );

    it('renders course rows once the request resolves, and paginates on page-button click', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([buildCourse()], 2));
      renderCourseSearchBrowse();

      // Scoped to the "Courses & Content" list itself: the associations
      // section above it (mocked in `beforeEach`) briefly shows its own
      // loading spinner too, so an unscoped `getByRole('status')` would see
      // two.
      const coursesContainer = screen.getByText('Courses & Content').closest(
        '.course-search-browse__container',
      ) as HTMLElement;
      expect(within(coursesContainer).getByRole('status')).toBeInTheDocument();
      expect(await screen.findByText('Intro to Testing')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));

      await waitFor(() => {
        expect(lastRequestParams()).toMatchObject({ page: 2 });
      });
    });

    it('renders an inline error, not the empty state, when the request fails', async () => {
      axiosMock.onGet(coursesApiUrl).reply(500);
      renderCourseSearchBrowse();

      expect(await screen.findByText('There was a problem loading courses. Please try again.'))
        .toBeInTheDocument();
      expect(screen.queryByText('You do not have access to any courses.')).not.toBeInTheDocument();
      expect(screen.queryByText('No courses match your search.')).not.toBeInTheDocument();
    });

    it('shows distinct empty-result messages for no search vs. a search value, and clears the search on demand', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([]));
      renderCourseSearchBrowse();

      expect(await screen.findByText('You do not have access to any courses.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();

      const searchBox = screen.getByRole('searchbox');
      fireEvent.change(searchBox, { target: { value: 'nonexistent' } });
      act(() => {
        jest.advanceTimersByTime(400);
      });

      expect(await screen.findByText('No courses match your search.')).toBeInTheDocument();
      expect(screen.queryByText('You do not have access to any courses.')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

      await waitFor(() => expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(''));
      await waitFor(() => {
        expect(lastRequestParams()).toMatchObject({ search: '' });
      });
    });

    it('shows the "no matching courses" message, not "no accessible courses", when only a date filter (no search text) narrows the results to zero', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([buildCourse()]));
      renderCourseSearchBrowse();
      await screen.findByText('Intro to Testing');

      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([]));
      fireEvent.click(screen.getByLabelText('Start Date'));
      const startDay = screen.getByText('10').closest('.react-datepicker__day') as HTMLElement;
      fireEvent.click(startDay);

      // No search text is active here - only the date filter - so the
      // narrowed-by-a-filter wording is the correct one, not the
      // no-filters-at-all "no accessible courses" wording.
      expect(await screen.findByText('No courses match your search.')).toBeInTheDocument();
      expect(screen.queryByText('You do not have access to any courses.')).not.toBeInTheDocument();
    });

    it('debounces the search field by 400ms and resets the page back to 1', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([buildCourse()], 3));
      renderCourseSearchBrowse();
      await screen.findByText('Intro to Testing');

      // Move off page 1 first, so the reset back to page 1 below is observable.
      fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
      await waitFor(() => {
        expect(lastRequestParams()).toMatchObject({ page: 2 });
      });

      const requestCountBeforeTyping = axiosMock.history.get.length;
      const searchBox = screen.getByRole('searchbox');
      fireEvent.change(searchBox, { target: { value: 'physics' } });

      act(() => {
        jest.advanceTimersByTime(399);
      });
      expect(axiosMock.history.get).toHaveLength(requestCountBeforeTyping);

      act(() => {
        jest.advanceTimersByTime(1);
      });
      await waitFor(() => {
        expect(axiosMock.history.get.length).toBeGreaterThan(requestCountBeforeTyping);
      });

      // Exactly one request: an intermediate one pairing the new search
      // with the old page would mean the two were reset in separate renders.
      const requestsSinceTyping = axiosMock.history.get.slice(requestCountBeforeTyping);
      expect(requestsSinceTyping).toHaveLength(1);
      expect(requestsSinceTyping[0].params).toMatchObject({ search: 'physics', page: 1 });
    });

    it('keeps an active search filter in the request when only the page changes', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([buildCourse()], 3));
      renderCourseSearchBrowse();
      await screen.findByText('Intro to Testing');

      const searchBox = screen.getByRole('searchbox');
      fireEvent.change(searchBox, { target: { value: 'physics' } });
      act(() => {
        jest.advanceTimersByTime(400);
      });
      await waitFor(() => {
        expect(lastRequestParams()).toMatchObject({ search: 'physics', page: 1 });
      });
      // The request firing (checked above) doesn't mean the response has
      // been processed and re-rendered yet - wait for the page controls
      // themselves, so the click below lands once they're actually there.
      const pageTwoButton = await screen.findByRole('button', { name: 'Page 2' });

      // Changing the page alone must not drop the still-active search filter.
      fireEvent.click(pageTwoButton);
      await waitFor(() => {
        expect(lastRequestParams()).toMatchObject({ search: 'physics', page: 2 });
      });
    });

    it('sends start_date_on_or_after when a start date is picked in the range calendar, and resets the page back to 1', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([buildCourse()], 3));
      renderCourseSearchBrowse();
      await screen.findByText('Intro to Testing');

      // Move off page 1 first, so the reset back to page 1 below is observable.
      fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
      await waitFor(() => {
        expect(lastRequestParams()).toMatchObject({ page: 2 });
      });

      const requestCountBeforeChange = axiosMock.history.get.length;
      // Open the range calendar and pick a single day - react-datepicker's
      // `selectsRange` fires `onChange` as `[start, null]` immediately after
      // this first click, before any second (end) day is ever picked.
      fireEvent.click(screen.getByLabelText('Start Date'));
      const startDay = screen.getByText('10').closest('.react-datepicker__day') as HTMLElement;
      fireEvent.click(startDay);

      await waitFor(() => {
        expect(axiosMock.history.get.length).toBeGreaterThan(requestCountBeforeChange);
      });

      // Exactly one request: an intermediate one pairing the new date with
      // the old page would mean the two were reset in separate renders.
      const requestsSinceChange = axiosMock.history.get.slice(requestCountBeforeChange);
      expect(requestsSinceChange).toHaveLength(1);
      // Plain `YYYY-MM-DD`: the backend's `get_date_param` 400s on anything else.
      expect(requestsSinceChange[0].params.start_date_on_or_after).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(requestsSinceChange[0].params.start_date_on_or_before).toBeUndefined();
      expect(requestsSinceChange[0].params).toMatchObject({ page: 1 });
    });

    it('sends both start_date_on_or_after and start_date_on_or_before once an end date is also picked', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([buildCourse()], 3));
      renderCourseSearchBrowse();
      await screen.findByText('Intro to Testing');

      fireEvent.click(screen.getByLabelText('Start Date'));
      const startDay = screen.getByText('10').closest('.react-datepicker__day') as HTMLElement;
      fireEvent.click(startDay);
      await waitFor(() => {
        expect(lastRequestParams().start_date_on_or_before).toBeUndefined();
      });

      const requestCountBeforeChange = axiosMock.history.get.length;
      const endDay = screen.getByText('20').closest('.react-datepicker__day') as HTMLElement;
      fireEvent.click(endDay);

      await waitFor(() => {
        expect(axiosMock.history.get.length).toBeGreaterThan(requestCountBeforeChange);
      });

      const requestsSinceChange = axiosMock.history.get.slice(requestCountBeforeChange);
      expect(requestsSinceChange).toHaveLength(1);
      expect(requestsSinceChange[0].params.start_date_on_or_after).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(requestsSinceChange[0].params.start_date_on_or_before).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('omits start_date_on_or_after and start_date_on_or_before from the request when neither date is set', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([buildCourse()]));
      renderCourseSearchBrowse();
      await screen.findByText('Intro to Testing');

      // The mock adapter records params before axios serializes them, so an
      // `undefined` value (the key axios's serializer drops) is still
      // distinguishable here from `''` (sent as an empty query param).
      expect(lastRequestParams().start_date_on_or_after).toBeUndefined();
      expect(lastRequestParams().start_date_on_or_before).toBeUndefined();
    });
  });

  describe('the course-list summary line', () => {
    const courseA = buildCourse({ courseKey: 'course-v1:OrgX+CSA+2024', displayName: 'Course A' });
    const courseB = buildCourse({ courseKey: 'course-v1:OrgX+CSB+2024', displayName: 'Course B' });
    const courseC = buildCourse({ courseKey: 'course-v1:OrgX+CSC+2024', displayName: 'Course C' });

    /** Its counts and filters are each wrapped in `<strong>`, so its own text alone is what starts with "Showing". */
    const summaryLine = () => screen.getByText(/^Showing/);
    const findSummaryLine = () => screen.findByText(/^Showing/);
    const querySummaryLine = () => screen.queryByText(/^Showing/);

    const typeSearch = (value: string) => {
      fireEvent.change(screen.getByRole('searchbox'), { target: { value } });
      act(() => {
        jest.advanceTimersByTime(400);
      });
    };

    const openCalendar = () => fireEvent.click(screen.getByLabelText('Start Date'));
    /** Clicks a day of the open range calendar: the first pick is the start date, the second the end date. */
    const pickDay = (day: string) => {
      fireEvent.click(screen.getByText(day).closest('.react-datepicker__day') as HTMLElement);
    };

    beforeEach(() => {
      // Pins the month the range calendar opens on, so picked days have known dates.
      jest.setSystemTime(new Date(2026, 6, 15));
    });

    it('shows how many courses are listed out of every accessible course, naming no filter when none is applied', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA, courseB]));
      renderCourseSearchBrowse();

      expect(await findSummaryLine()).toHaveTextContent(
        /^Showing 2 of 208 Courses, and 0 of 0 Competency Criteria Associations$/,
      );
    });

    it('says "Course", not "Courses", when only one course is accessible', async () => {
      axiosMock.onGet(coursesApiUrl, { params: accessibleCoursesCountParams })
        .reply(200, buildAccessibleCountResponse(1));
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA]));
      renderCourseSearchBrowse();

      expect(await findSummaryLine()).toHaveTextContent(
        /^Showing 1 of 1 Course, and 0 of 0 Competency Criteria Associations$/,
      );
    });

    it('names the search term once the search has debounced, against the same accessible total', async () => {
      axiosMock.onGet(coursesApiUrl).reply((config) => [
        200,
        buildResponse(config.params.search === 'pro' ? [courseA] : [courseA, courseB, courseC]),
      ]);
      renderCourseSearchBrowse();
      expect(await findSummaryLine()).toHaveTextContent(
        /^Showing 3 of 208 Courses, and 0 of 0 Competency Criteria Associations$/,
      );

      typeSearch('pro');

      await waitFor(() => {
        expect(summaryLine()).toHaveTextContent(
          /^Showing 1 of 208 Courses containing “pro”, and 0 of 0 Competency Criteria Associations$/,
        );
      });
    });

    it('names a start date alone as "on or after", then the whole range once an end date is picked', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA, courseB]));
      renderCourseSearchBrowse();
      await findSummaryLine();

      openCalendar();
      pickDay('10');
      await waitFor(() => {
        expect(summaryLine()).toHaveTextContent(
          /^Showing 2 of 208 Courses starting on or after 07-10-2026, and 0 of 0 Competency Criteria Associations$/,
        );
      });

      pickDay('20');
      await waitFor(() => {
        expect(summaryLine()).toHaveTextContent(
          /^Showing 2 of 208 Courses starting between 07-10-2026 and 07-20-2026, and 0 of 0 Competency Criteria Associations$/,
        );
      });
    });

    it('names both the search term and the start-date filter when both are applied', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA, courseB]));
      renderCourseSearchBrowse();
      await findSummaryLine();

      typeSearch('pro');
      await waitFor(() => {
        expect(summaryLine()).toHaveTextContent(
          /^Showing 2 of 208 Courses containing “pro”, and 0 of 0 Competency Criteria Associations$/,
        );
      });

      openCalendar();
      pickDay('10');
      await waitFor(() => {
        expect(summaryLine()).toHaveTextContent(
          /^Showing 2 of 208 Courses containing “pro”, starting on or after 07-10-2026, and 0 of 0 Competency Criteria Associations$/,
        );
      });

      pickDay('20');
      await waitFor(() => {
        expect(summaryLine()).toHaveTextContent(
          /^Showing 2 of 208 Courses containing “pro”, starting between 07-10-2026 and 07-20-2026, and 0 of 0 Competency Criteria Associations$/,
        );
      });
    });

    it('drops the filter clauses again once the search and the dates are cleared', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA, courseB]));
      renderCourseSearchBrowse();
      await findSummaryLine();

      typeSearch('pro');
      openCalendar();
      pickDay('10');
      await waitFor(() => {
        expect(summaryLine()).toHaveTextContent(
          /containing “pro”, starting on or after 07-10-2026, and 0 of 0 Competency Criteria Associations$/,
        );
      });

      fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }));
      typeSearch('');
      await waitFor(() => {
        expect(summaryLine()).toHaveTextContent(
          /^Showing 2 of 208 Courses, and 0 of 0 Competency Criteria Associations$/,
        );
      });
    });

    it('shows zero courses listed against the accessible total when a search matches nothing', async () => {
      axiosMock.onGet(coursesApiUrl).reply((config) => [
        200,
        buildResponse(config.params.search ? [] : [courseA, courseB]),
      ]);
      renderCourseSearchBrowse();
      await findSummaryLine();

      typeSearch('nonexistent');

      expect(await screen.findByText('No courses match your search.')).toBeInTheDocument();
      expect(summaryLine()).toHaveTextContent(
        /^Showing 0 of 208 Courses containing “nonexistent”, and 0 of 0 Competency Criteria Associations$/,
      );
    });

    it('fetches the accessible total once, unfiltered, and keeps it across paging, searching, and date changes', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA, courseB], 3));
      renderCourseSearchBrowse();
      await findSummaryLine();

      fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
      await waitFor(() => expect(lastRequestParams()).toMatchObject({ page: 2 }));
      typeSearch('pro');
      await waitFor(() => expect(lastRequestParams()).toMatchObject({ search: 'pro' }));
      openCalendar();
      pickDay('10');
      await waitFor(() => expect(lastRequestParams().start_date_on_or_after).toBe('2026-07-10'));

      await waitFor(() => {
        expect(summaryLine()).toHaveTextContent(/^Showing 2 of 208 Courses containing “pro”, starting on or after/);
      });
      expect(accessibleCountRequests()).toHaveLength(1);
    });

    it('truncates a long search term in the summary, while the course list still filters on the whole term', async () => {
      const longSearchTerm = `${'a'.repeat(50)}${'b'.repeat(10)}`;
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA]));
      renderCourseSearchBrowse();
      await findSummaryLine();

      typeSearch(longSearchTerm);

      await waitFor(() => expect(lastRequestParams()).toMatchObject({ search: longSearchTerm }));
      await waitFor(() => {
        expect(summaryLine()).toHaveTextContent(`containing “${'a'.repeat(50)}…”`);
      });
      expect(summaryLine()).not.toHaveTextContent(longSearchTerm);
    });

    it('shows nothing while the course list loads, and nothing once it fails', async () => {
      const coursesReply = deferredReply();
      axiosMock.onGet(coursesApiUrl).reply(() => coursesReply.promise);
      renderCourseSearchBrowse();

      await waitFor(() => expect(accessibleCountRequests()).toHaveLength(1));
      expect(querySummaryLine()).not.toBeInTheDocument();

      await act(async () => {
        coursesReply.settle([500, {}]);
      });

      expect(await screen.findByText('There was a problem loading courses. Please try again.')).toBeInTheDocument();
      expect(querySummaryLine()).not.toBeInTheDocument();
    });

    it('shows nothing while the next page loads, rather than the previous page\'s count', async () => {
      const pageTwoReply = deferredReply();
      axiosMock.onGet(coursesApiUrl).reply((config) => (
        config.params.page === 2 ? pageTwoReply.promise : [200, buildResponse([courseA, courseB], 2)]
      ));
      renderCourseSearchBrowse();
      expect(await findSummaryLine()).toHaveTextContent(
        /^Showing 2 of 208 Courses, and 0 of 0 Competency Criteria Associations$/,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
      await waitFor(() => expect(lastRequestParams()).toMatchObject({ page: 2 }));
      expect(querySummaryLine()).not.toBeInTheDocument();

      await act(async () => {
        pageTwoReply.settle([200, buildResponse([courseC], 2)]);
      });
      expect(await findSummaryLine()).toHaveTextContent(
        /^Showing 1 of 208 Courses, and 0 of 0 Competency Criteria Associations$/,
      );
    });

    it('shows nothing, but still lists the courses, when the accessible total fails to load', async () => {
      axiosMock.onGet(coursesApiUrl, { params: accessibleCoursesCountParams }).reply(500);
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA]));
      renderCourseSearchBrowse();

      expect(await screen.findByText('Course A')).toBeInTheDocument();
      await waitFor(() => expect(accessibleCountRequests()).toHaveLength(1));
      expect(querySummaryLine()).not.toBeInTheDocument();
    });

    describe('its association clause', () => {
      const groupsUrl = competencyManagementApiUrls.competencyCriteriaGroups(Number(activeCompetency.id));
      /** Only the counts matter to the summary, so the payload carries no groups or criteria. */
      const buildCountsResponse = (criteriaCount: number, totalCriteriaCount: number) => ({
        groups: [],
        criteria: [],
        criteria_count: criteriaCount,
        total_criteria_count: totalCriteriaCount,
      });
      const associationsErrorMessage = 'There was a problem loading this competency\'s associations. Please try again.';

      it('counts the associations in the listed courses out of all of the competency\'s associations', async () => {
        axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA, courseB]));
        axiosMock.onGet(groupsUrl).reply(200, buildCountsResponse(2, 5));
        renderCourseSearchBrowse();

        expect(await findSummaryLine()).toHaveTextContent(
          /^Showing 2 of 208 Courses, and 2 of 5 Competency Criteria Associations$/,
        );
      });

      it('says "Association", not "Associations", when the competency has only one', async () => {
        axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA]));
        axiosMock.onGet(groupsUrl).reply(200, buildCountsResponse(1, 1));
        renderCourseSearchBrowse();

        expect(await findSummaryLine()).toHaveTextContent(
          /^Showing 1 of 208 Courses, and 1 of 1 Competency Criteria Association$/,
        );
      });

      it('keeps the association clause alongside the search and start-date clauses', async () => {
        axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA, courseB]));
        axiosMock.onGet(groupsUrl).reply(200, buildCountsResponse(0, 3));
        renderCourseSearchBrowse();
        await findSummaryLine();

        typeSearch('pro');
        openCalendar();
        pickDay('10');
        pickDay('20');

        await waitFor(() => {
          expect(summaryLine()).toHaveTextContent(
            /^Showing 2 of 208 Courses containing “pro”, starting between 07-10-2026 and 07-20-2026, and 0 of 3 Competency Criteria Associations$/,
          );
        });
      });

      it('re-counts the associations for each page of courses', async () => {
        axiosMock.onGet(coursesApiUrl).reply((config) => [
          200,
          buildResponse(config.params.page === 2 ? [courseC] : [courseA, courseB], 2),
        ]);
        axiosMock.onGet(groupsUrl).reply((config) => [
          200,
          config.params.course_keys === courseC.courseKey ? buildCountsResponse(1, 4) : buildCountsResponse(3, 4),
        ]);
        renderCourseSearchBrowse();
        expect(await findSummaryLine()).toHaveTextContent(
          /^Showing 2 of 208 Courses, and 3 of 4 Competency Criteria Associations$/,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));

        expect(await screen.findByText('Course C')).toBeInTheDocument();
        await waitFor(() => {
          expect(summaryLine()).toHaveTextContent(
            /^Showing 1 of 208 Courses, and 1 of 4 Competency Criteria Associations$/,
          );
        });
      });

      it('shows nothing while the listed courses\' associations load, and nothing once they fail', async () => {
        const groupsReply = deferredReply();
        axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA]));
        axiosMock.onGet(groupsUrl).reply(() => groupsReply.promise);
        renderCourseSearchBrowse();

        expect(await screen.findByText('Course A')).toBeInTheDocument();
        await waitFor(() => expect(axiosMock.history.get.some((req) => req.url === groupsUrl)).toBe(true));
        expect(querySummaryLine()).not.toBeInTheDocument();

        await act(async () => {
          groupsReply.settle([500, {}]);
        });

        expect(await screen.findByText(associationsErrorMessage)).toBeInTheDocument();
        expect(querySummaryLine()).not.toBeInTheDocument();
      });
    });
  });

  describe('scoping the associations to the listed courses', () => {
    const tagId = Number(activeCompetency.id);
    const groupsUrl = competencyManagementApiUrls.competencyCriteriaGroups(tagId);
    const courseA = buildCourse({ courseKey: 'course-v1:OrgX+CSA+2024', displayName: 'Course A' });
    const courseB = buildCourse({ courseKey: 'course-v1:OrgX+CSB+2024', displayName: 'Course B' });
    const courseC = buildCourse({ courseKey: 'course-v1:OrgX+CSC+2024', displayName: 'Course C' });
    const emptyMessage = 'No content associated.';

    const groupsRequests = () => axiosMock.history.get.filter((req) => req.url === groupsUrl);

    /** Course A's and B's criteria together: the total a response scoped to either course alone still reports. */
    const criteriaAcrossBothCourses = 2;

    /** One course-level group for `course`, holding one leaf group with one criterion, in wire (snake_case) form. */
    const buildGroupsResponse = (course: Course, courseGroupId: number, totalCriteriaCount = 1) => ({
      groups: [
        {
          id: 500,
          parent_id: null,
          tag_id: tagId,
          course_key: null,
          name: 'root',
          ordering: 0,
          logic_operator: 'AND',
          archived: false,
        },
        {
          id: courseGroupId,
          parent_id: 500,
          tag_id: tagId,
          course_key: course.courseKey,
          name: 'course',
          ordering: 0,
          logic_operator: 'AND',
          archived: false,
        },
        {
          id: courseGroupId * 10,
          parent_id: courseGroupId,
          tag_id: tagId,
          course_key: null,
          name: 'leaf',
          ordering: 0,
          logic_operator: 'AND',
          archived: false,
        },
      ],
      criteria: [{
        id: courseGroupId * 100,
        object_id: `sub-${courseGroupId}`,
        group_id: courseGroupId * 10,
        rule_profile_id: 1,
        rule_type_override: null,
        rule_payload_override: null,
      }],
      criteria_count: 1,
      total_criteria_count: totalCriteriaCount,
    });

    /** Several `buildGroupsResponse` payloads as one response, listing their shared root group once. */
    const combineGroupsResponses = (...responses: ReturnType<typeof buildGroupsResponse>[]) => {
      const criteria = responses.flatMap((response) => response.criteria);
      return {
        groups: uniqBy(responses.flatMap((response) => response.groups), 'id'),
        criteria,
        criteria_count: criteria.length,
        total_criteria_count: criteria.length,
      };
    };

    /** No groups or criteria in the listed courses, while the competency has `totalCriteriaCount` across the instance. */
    const buildEmptyGroupsResponse = (totalCriteriaCount: number) => ({
      groups: [],
      criteria: [],
      criteria_count: 0,
      total_criteria_count: totalCriteriaCount,
    });

    /** The outline names the course differently from its course-list row, so a course group's header is findable apart from that row. */
    const outlineNameOf = (course: Course) => `${course.displayName} outline`;
    const buildOutline = (course: Course) =>
      buildOutlineIndex({
        overrides: { courseStructure: { displayName: outlineNameOf(course) } },
      });

    /** Records whether `text` is ever added to the page, so a message that flashes between assertions is still caught. */
    const watchForText = (text: string) => {
      let seen = false;
      const check = (records: MutationRecord[]) => {
        seen = seen || records.some((record) => (
          Array.from(record.addedNodes).some((node) => node.textContent?.includes(text))
        ));
      };
      const observer = new MutationObserver(check);
      observer.observe(document.body, { childList: true, subtree: true });
      return {
        wasSeen: () => {
          check(observer.takeRecords());
          return seen;
        },
        stop: () => observer.disconnect(),
      };
    };

    beforeEach(() => {
      // jsdom has no layout; a sole group gets auto-focused, and its rule box scrolls itself into view.
      Element.prototype.scrollIntoView = jest.fn();
    });

    const associationsSection = () =>
      screen.getByText('Competency Criteria Associations').closest(
        '.course-search-browse__associations',
      ) as HTMLElement;

    it('sends no groups request until the course list loads, then one carrying its keys in list order', async () => {
      // Deliberately out of alphabetical order, so any sort on the way out would show.
      const listedCourses = [courseC, courseA, courseB];
      const coursesReply = deferredReply();
      axiosMock.onGet(coursesApiUrl).reply(() => coursesReply.promise);
      renderCourseSearchBrowse();

      await waitFor(() => {
        expect(axiosMock.history.get.some(isCourseListRequest)).toBe(true);
      });
      expect(groupsRequests()).toHaveLength(0);

      await act(async () => {
        coursesReply.settle([200, buildResponse(listedCourses)]);
      });
      expect(await screen.findByText('Course C')).toBeInTheDocument();

      await waitFor(() => expect(groupsRequests()).toHaveLength(1));
      expect(groupsRequests()[0].params).toEqual({
        course_keys: listedCourses.map((course) => course.courseKey).join(','),
      });
    });

    it('still sends course_keys, as an empty value, for an empty page', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([]));
      axiosMock.onGet(groupsUrl).reply(200, buildEmptyGroupsResponse(0));
      renderCourseSearchBrowse();

      expect(await screen.findByText('You do not have access to any courses.')).toBeInTheDocument();
      await waitFor(() => expect(groupsRequests()).toHaveLength(1));
      expect(groupsRequests()[0].params).toEqual({ course_keys: '' });
      expect(await screen.findByText(emptyMessage)).toBeInTheDocument();
    });

    it('shows the empty state for an empty page, even when the competency has associations elsewhere', async () => {
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([]));
      axiosMock.onGet(groupsUrl).reply(200, buildEmptyGroupsResponse(criteriaAcrossBothCourses));
      renderCourseSearchBrowse();

      expect(await screen.findByText('You do not have access to any courses.')).toBeInTheDocument();
      expect(await within(associationsSection()).findByText(emptyMessage)).toBeInTheDocument();
    });

    it('keeps nothing from the previous page once a page change has loaded', async () => {
      axiosMock.onGet(coursesApiUrl).reply((
        config,
      ) => [200, buildResponse(config.params.page === 2 ? [courseB] : [courseA], 2)]);
      axiosMock.onGet(groupsUrl).reply((config) => [
        200,
        config.params.course_keys === courseB.courseKey
          ? buildGroupsResponse(courseB, 2, criteriaAcrossBothCourses)
          : buildGroupsResponse(courseA, 1, criteriaAcrossBothCourses),
      ]);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA.courseKey)).reply(200, buildOutline(courseA));
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB.courseKey)).reply(200, buildOutline(courseB));
      renderCourseSearchBrowse();
      expect(await screen.findByText(outlineNameOf(courseA))).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));

      expect(await screen.findByText(outlineNameOf(courseB))).toBeInTheDocument();
      expect(screen.queryByText(outlineNameOf(courseA))).not.toBeInTheDocument();
      expect(screen.queryByText('Course A')).not.toBeInTheDocument();
      expect(groupsRequests()[groupsRequests().length - 1].params).toEqual({ course_keys: courseB.courseKey });
    });

    it('re-scopes the groups request to the narrowed list once a search has debounced', async () => {
      axiosMock.onGet(coursesApiUrl).reply((config) => [
        200,
        buildResponse(config.params.search === 'Course A' ? [courseA] : [courseA, courseB]),
      ]);
      axiosMock.onGet(groupsUrl).reply((config) => [
        200,
        config.params.course_keys === courseA.courseKey
          ? buildGroupsResponse(courseA, 1, criteriaAcrossBothCourses)
          : combineGroupsResponses(buildGroupsResponse(courseA, 1), buildGroupsResponse(courseB, 2)),
      ]);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA.courseKey)).reply(200, buildOutline(courseA));
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB.courseKey)).reply(200, buildOutline(courseB));
      renderCourseSearchBrowse();
      expect(await screen.findByText(outlineNameOf(courseB))).toBeInTheDocument();
      expect(screen.getByText(outlineNameOf(courseA))).toBeInTheDocument();

      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Course A' } });
      act(() => {
        jest.advanceTimersByTime(400);
      });

      await waitFor(() => expect(groupsRequests()).toHaveLength(2));
      expect(groupsRequests()[1].params).toEqual({ course_keys: courseA.courseKey });
      expect(await screen.findByText(outlineNameOf(courseA))).toBeInTheDocument();
      expect(screen.queryByText(outlineNameOf(courseB))).not.toBeInTheDocument();
    });

    it('re-scopes the groups request to the narrowed list once a start date is picked', async () => {
      axiosMock.onGet(coursesApiUrl).reply((config) => [
        200,
        buildResponse(config.params.start_date_on_or_after ? [courseA] : [courseA, courseB]),
      ]);
      axiosMock.onGet(groupsUrl).reply((config) => [
        200,
        config.params.course_keys === courseA.courseKey
          ? buildGroupsResponse(courseA, 1, criteriaAcrossBothCourses)
          : combineGroupsResponses(buildGroupsResponse(courseA, 1), buildGroupsResponse(courseB, 2)),
      ]);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA.courseKey)).reply(200, buildOutline(courseA));
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB.courseKey)).reply(200, buildOutline(courseB));
      renderCourseSearchBrowse();
      expect(await screen.findByText(outlineNameOf(courseB))).toBeInTheDocument();
      expect(screen.getByText(outlineNameOf(courseA))).toBeInTheDocument();

      fireEvent.click(screen.getByLabelText('Start Date'));
      const startDay = screen.getByText('10').closest('.react-datepicker__day') as HTMLElement;
      fireEvent.click(startDay);

      await waitFor(() => expect(groupsRequests()).toHaveLength(2));
      expect(groupsRequests()[1].params).toEqual({ course_keys: courseA.courseKey });
      expect(await screen.findByText(outlineNameOf(courseA))).toBeInTheDocument();
      expect(screen.queryByText(outlineNameOf(courseB))).not.toBeInTheDocument();
    });

    it('re-scopes and re-counts on a competency change, reusing the listed courses without refetching them', async () => {
      const otherCompetency: CompetencyTreeNode = { id: 2, value: 'Other Competency' };
      const otherGroupsUrl = competencyManagementApiUrls.competencyCriteriaGroups(Number(otherCompetency.id));
      const otherGroupsRequests = () => axiosMock.history.get.filter((req) => req.url === otherGroupsUrl);
      const listedCourseKeys = [courseA, courseB].map((course) => course.courseKey).join(',');
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA, courseB]));
      axiosMock.onGet(groupsUrl).reply(200, buildGroupsResponse(courseA, 1));
      axiosMock.onGet(otherGroupsUrl).reply(200, buildEmptyGroupsResponse(3));
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA.courseKey)).reply(200, buildOutline(courseA));
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB.courseKey)).reply(200, buildOutline(courseB));
      const { rerender } = renderCourseSearchBrowse();
      expect(await screen.findByText(outlineNameOf(courseA))).toBeInTheDocument();
      expect(groupsRequests()).toHaveLength(1);
      expect(groupsRequests()[0].params).toEqual({ course_keys: listedCourseKeys });
      const courseListRequestCount = axiosMock.history.get.filter(isCourseListRequest).length;

      rerender(courseSearchBrowseTree(otherCompetency));

      const section = associationsSection();
      expect(
        await within(section).findByText(emptyMessage),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByText(/^Showing/)).toHaveTextContent(/, and 0 of 3 Competency Criteria Associations$/)
      );
      expect(within(section).getByText('Demonstrate Mastery For Other Competency')).toBeInTheDocument();
      expect(screen.queryByText(outlineNameOf(courseA))).not.toBeInTheDocument();
      expect(otherGroupsRequests()).toHaveLength(1);
      expect(otherGroupsRequests()[0].params).toEqual({ course_keys: listedCourseKeys });
      expect(axiosMock.history.get.filter(isCourseListRequest)).toHaveLength(courseListRequestCount);
      expect(screen.getByText('Course A')).toBeInTheDocument();
      expect(screen.getByText('Course B')).toBeInTheDocument();
    });

    it('shows a page\'s Course Group again, unchanged, on returning to that page', async () => {
      axiosMock.onGet(coursesApiUrl).reply((
        config,
      ) => [200, buildResponse(config.params.page === 2 ? [courseB] : [courseA], 2)]);
      axiosMock.onGet(groupsUrl).reply((config) => [
        200,
        config.params.course_keys === courseB.courseKey
          ? buildGroupsResponse(courseB, 2, criteriaAcrossBothCourses)
          : buildGroupsResponse(courseA, 1, criteriaAcrossBothCourses),
      ]);
      // Names the subsection behind Course A's one criterion (`sub-1`), so its chip is identifiable.
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA.courseKey)).reply(
        200,
        buildOutlineIndex({
          sections: [{ id: 'section-a', displayName: 'Section A', children: [{ id: 'sub-1', displayName: 'Quiz A' }] }],
          overrides: { courseStructure: { displayName: outlineNameOf(courseA) } },
        }),
      );
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB.courseKey)).reply(200, buildOutline(courseB));
      renderCourseSearchBrowse();

      /** Course A's Course Group holds exactly one leaf group, holding one rule box with the "Quiz A" chip. */
      const expectCourseAGroup = () => {
        const courseGroup = screen.getByText(outlineNameOf(courseA)).closest('.course-group-section') as HTMLElement;
        const leafGroups = courseGroup.querySelectorAll<HTMLElement>('.criteria-group-box');
        expect(leafGroups).toHaveLength(1);
        const ruleBoxes = leafGroups[0].querySelectorAll<HTMLElement>('.rule-box');
        expect(ruleBoxes).toHaveLength(1);
        expect(within(ruleBoxes[0]).getByText('Quiz A')).toBeInTheDocument();
      };

      expect(await screen.findByText(outlineNameOf(courseA))).toBeInTheDocument();
      expectCourseAGroup();

      fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
      expect(await screen.findByText(outlineNameOf(courseB))).toBeInTheDocument();
      expect(screen.queryByText(outlineNameOf(courseA))).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Page 1' }));
      expect(await screen.findByText(outlineNameOf(courseA))).toBeInTheDocument();
      expect(screen.queryByText(outlineNameOf(courseB))).not.toBeInTheDocument();
      expectCourseAGroup();
    });

    it('shows no empty-associations message at any point while re-scoping to a new page', async () => {
      const page2CoursesReply = deferredReply();
      const page2GroupsReply = deferredReply();
      const outlineBReply = deferredReply();
      axiosMock.onGet(coursesApiUrl).reply((config) => (
        config.params.page === 2 ? page2CoursesReply.promise : [200, buildResponse([courseA], 2)]
      ));
      axiosMock.onGet(groupsUrl).reply((config) => (
        config.params.course_keys === courseB.courseKey
          ? page2GroupsReply.promise
          : [200, buildGroupsResponse(courseA, 1, criteriaAcrossBothCourses)]
      ));
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA.courseKey)).reply(200, buildOutline(courseA));
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseB.courseKey)).reply(() => outlineBReply.promise);
      renderCourseSearchBrowse();
      expect(await screen.findByText(outlineNameOf(courseA))).toBeInTheDocument();

      const emptyMessageWatch = watchForText(emptyMessage);
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));

        // The new page's courses are loading.
        await waitFor(() => {
          expect(axiosMock.history.get.some((req) => req.url === coursesApiUrl && req.params.page === 2)).toBe(true);
        });
        expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();

        // The new page is listed; its groups are loading.
        await act(async () => {
          page2CoursesReply.settle([200, buildResponse([courseB], 2)]);
        });
        expect(await screen.findByText('Course B')).toBeInTheDocument();
        await waitFor(() => expect(groupsRequests()).toHaveLength(2));
        expect(within(associationsSection()).getByRole('status')).toBeInTheDocument();
        expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();

        // The new page's groups are in; its course's outline, which decides access, is loading.
        await act(async () => {
          page2GroupsReply.settle([200, buildGroupsResponse(courseB, 2, criteriaAcrossBothCourses)]);
        });
        await waitFor(() => {
          expect(axiosMock.history.get.some((req) => req.url === getCourseOutlineIndexApiUrl(courseB.courseKey)))
            .toBe(true);
        });
        expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();

        await act(async () => {
          outlineBReply.settle([200, buildOutline(courseB)]);
        });
        expect(await screen.findByText(outlineNameOf(courseB))).toBeInTheDocument();

        expect(emptyMessageWatch.wasSeen()).toBe(false);
      } finally {
        emptyMessageWatch.stop();
      }
    });

    it('drops the previous page\'s Course Groups once the next page\'s courses fail to load', async () => {
      axiosMock.onGet(coursesApiUrl).reply((config) => (
        config.params.page === 2 ? [500] : [200, buildResponse([courseA], 2)]
      ));
      axiosMock.onGet(groupsUrl).reply(200, buildGroupsResponse(courseA, 1));
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA.courseKey)).reply(200, buildOutline(courseA));
      renderCourseSearchBrowse();
      expect(await screen.findByText(outlineNameOf(courseA))).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));

      expect(await screen.findByText('There was a problem loading courses. Please try again.')).toBeInTheDocument();
      expect(screen.queryByText(outlineNameOf(courseA))).not.toBeInTheDocument();
    });

    it('shows the associations error, and no empty-associations message, when the next page\'s groups fail to load', async () => {
      axiosMock.onGet(coursesApiUrl).reply((
        config,
      ) => [200, buildResponse(config.params.page === 2 ? [courseB] : [courseA], 2)]);
      axiosMock.onGet(groupsUrl).reply((config) => (
        config.params.course_keys === courseB.courseKey
          ? [500]
          : [200, buildGroupsResponse(courseA, 1, criteriaAcrossBothCourses)]
      ));
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA.courseKey)).reply(200, buildOutline(courseA));
      renderCourseSearchBrowse();
      expect(await screen.findByText(outlineNameOf(courseA))).toBeInTheDocument();

      const emptyMessageWatch = watchForText(emptyMessage);
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));

        expect(
          await within(associationsSection()).findByText(
            'There was a problem loading this competency\'s associations. Please try again.',
          ),
        ).toBeInTheDocument();
        expect(groupsRequests()[groupsRequests().length - 1].params).toEqual({ course_keys: courseB.courseKey });
        expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
        expect(screen.queryByText(outlineNameOf(courseA))).not.toBeInTheDocument();
        expect(emptyMessageWatch.wasSeen()).toBe(false);
      } finally {
        emptyMessageWatch.stop();
      }
    });

    it('sends no groups request, and shows only the header lines, when the first courses request fails', async () => {
      axiosMock.onGet(coursesApiUrl).reply(500);
      // Would show a Course Group if the section ever asked for one.
      axiosMock.onGet(groupsUrl).reply(200, buildGroupsResponse(courseA, 1));
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA.courseKey)).reply(200, buildOutline(courseA));
      renderCourseSearchBrowse();

      expect(await screen.findByText('There was a problem loading courses. Please try again.')).toBeInTheDocument();
      expect(groupsRequests()).toHaveLength(0);
      const section = associationsSection();
      expect(within(section).getByText('Demonstrate Mastery For Test Competency')).toBeInTheDocument();
      expect(within(section).queryByRole('status')).not.toBeInTheDocument();
      expect(within(section).queryByText(outlineNameOf(courseA))).not.toBeInTheDocument();
      expect(within(section).queryByText(emptyMessage)).not.toBeInTheDocument();
    });

    it('shows a spinner, not the previous page\'s Course Groups, while the next page\'s courses load', async () => {
      const page2CoursesReply = deferredReply();
      axiosMock.onGet(coursesApiUrl).reply((config) => (
        config.params.page === 2 ? page2CoursesReply.promise : [200, buildResponse([courseA], 2)]
      ));
      axiosMock.onGet(groupsUrl).reply(200, buildGroupsResponse(courseA, 1));
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA.courseKey)).reply(200, buildOutline(courseA));
      renderCourseSearchBrowse();
      expect(await screen.findByText(outlineNameOf(courseA))).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));

      await waitFor(() => {
        expect(axiosMock.history.get.some((req) => req.url === coursesApiUrl && req.params.page === 2)).toBe(true);
      });
      expect(within(associationsSection()).getByRole('status')).toBeInTheDocument();
      expect(screen.queryByText(outlineNameOf(courseA))).not.toBeInTheDocument();
    });

    it('offers no subsection selection until the listed courses\' groups load, then sends the create request', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const createUrl = competencyManagementApiUrls.createCompetencyCriterion(tagId);
      const groupsReply = deferredReply();
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA]));
      axiosMock.onGet(groupsUrl).reply(() => groupsReply.promise);
      axiosMock.onGet(getCourseOutlineIndexApiUrl(courseA.courseKey)).reply(
        200,
        buildOutlineIndex({
          sections: [{
            id: 'section-1',
            displayName: 'Section 1',
            children: [{ id: 'sub-1a', displayName: 'Subsection 1A', overrides: { graded: true } }],
          }],
        }),
      );
      axiosMock.onPost(createUrl).reply(201, {
        id: 901,
        group_id: 20,
        rule_profile_id: 1,
        rule_type_override: null,
        rule_payload_override: null,
        object_tag_id: tagId,
      });
      renderCourseSearchBrowse();

      expect(await screen.findByText('Course A')).toBeInTheDocument();
      await waitFor(() => expect(groupsRequests()).toHaveLength(1));
      // The course row's own chevron, then its outline's section once that has loaded.
      await user.click(screen.getByRole('button', { name: 'Expand' }));
      await user.click(await screen.findByRole('button', { name: 'Expand' }));

      expect(await screen.findByText('Subsection 1A')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Subsection 1A' })).not.toBeInTheDocument();

      await act(async () => {
        groupsReply.settle([200, { groups: [], criteria: [], criteria_count: 0, total_criteria_count: 0 }]);
      });
      expect(await screen.findByRole('button', { name: 'Subsection 1A' })).toBeEnabled();

      await user.click(screen.getByRole('button', { name: 'Subsection 1A' }));

      await waitFor(() => expect(axiosMock.history.post).toHaveLength(1));
      expect(axiosMock.history.post[0].url).toEqual(createUrl);
      expect(JSON.parse(axiosMock.history.post[0].data)).toEqual({ object_id: 'sub-1a' });
    });
  });

  describe('courses blocked by a related competency (#797)', () => {
    const blockedCoursesUrl = competencyManagementApiUrls.competencyBlockedCourses(Number(activeCompetency.id));
    const courseA = buildCourse({ courseKey: 'course-v1:OrgX+CSA+2024', displayName: 'Course A' });
    const courseB = buildCourse({ courseKey: 'course-v1:OrgX+CSB+2024', displayName: 'Course B' });
    const conflictTooltip = 'Already associated with Critical Thinking in this course';

    const blockedCoursesRequests = () => axiosMock.history.get.filter((req) => req.url === blockedCoursesUrl);
    const blockedCoursesBody = (courses: Course[]) => ({
      count: courses.length,
      next: null,
      previous: null,
      results: courses.map((course) => ({
        course_key: course.courseKey,
        conflicting_tag_id: 7,
        conflicting_tag_value: 'Critical Thinking',
      })),
    });
    const mockOutline = (course: Course) => {
      axiosMock.onGet(getCourseOutlineIndexApiUrl(course.courseKey)).reply(
        200,
        buildOutlineIndex({
          sections: [{
            id: `section-${course.number}`,
            displayName: 'Section 1',
            children: [{ id: `sub-${course.number}`, displayName: 'Subsection 1', overrides: { graded: true } }],
          }],
        }),
      );
    };
    /** Expands the sole listed course, then its sole section. */
    const expandCourseAndSection = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: 'Expand' }));
      await user.click(await screen.findByRole('button', { name: 'Expand' }));
    };

    it('disables a blocked course\'s subsections, with a tooltip naming the related competency', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA]));
      axiosMock.onGet(blockedCoursesUrl).reply(200, blockedCoursesBody([courseA]));
      mockOutline(courseA);
      renderCourseSearchBrowse();

      expect(await screen.findByText('Course A')).toBeInTheDocument();
      await expandCourseAndSection(user);

      const row = await screen.findByRole('button', { name: 'Subsection 1' });
      await waitFor(() => expect(row).toBeDisabled());
      expect(blockedCoursesRequests()[0].params).toEqual({ course_keys: courseA.courseKey });
      await user.hover(row.closest('.course-search-browse__subsection')!.querySelector('span[tabindex="0"]')!);
      expect(await screen.findByText(conflictTooltip)).toBeInTheDocument();
    });

    it('keeps subsections selectable while the blocked-courses request is in flight', async () => {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const blockedReply = deferredReply();
      axiosMock.onGet(coursesApiUrl).reply(200, buildResponse([courseA]));
      axiosMock.onGet(blockedCoursesUrl).reply(() => blockedReply.promise);
      mockOutline(courseA);
      renderCourseSearchBrowse();

      expect(await screen.findByText('Course A')).toBeInTheDocument();
      await expandCourseAndSection(user);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Subsection 1' })).toBeEnabled());

      await act(async () => {
        blockedReply.settle([200, blockedCoursesBody([courseA])]);
      });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Subsection 1' })).toBeDisabled());
    });

    it('scopes a new blocked-courses request to the next page\'s courses', async () => {
      axiosMock.onGet(coursesApiUrl).reply((config) => [
        200,
        buildResponse(config.params.page === 2 ? [courseB] : [courseA], 2),
      ]);
      axiosMock.onGet(blockedCoursesUrl).reply(200, blockedCoursesBody([]));
      renderCourseSearchBrowse();
      await waitFor(() => expect(blockedCoursesRequests()).toHaveLength(1));
      expect(blockedCoursesRequests()[0].params).toEqual({ course_keys: courseA.courseKey });

      fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));

      await waitFor(() => expect(blockedCoursesRequests()).toHaveLength(2));
      expect(blockedCoursesRequests()[1].params).toEqual({ course_keys: courseB.courseKey });
    });
  });

  describe('<CourseRow />', () => {
    it('toggles expansion only via its disclosure control, and title clicks do nothing', async () => {
      const course = buildCourse();
      const outlineSectionHeading = 'Section 1';
      axiosMock.onGet(getCourseOutlineIndexApiUrl(course.courseKey)).reply(
        200,
        buildOutlineIndex({
          sections: [
            {
              id: 'section-1',
              displayName: outlineSectionHeading,
              children: [
                { id: 'sub-1a', displayName: 'Subsection 1A', overrides: { graded: true } },
              ],
            },
          ],
        }),
      );
      renderCourseRow(course);

      expect(screen.queryByText(outlineSectionHeading)).not.toBeInTheDocument();

      const expandButton = screen.getByRole('button', { name: 'Expand' });
      expect(expandButton).toHaveAttribute('aria-expanded', 'false');

      // Clicking the row's own title text does nothing - only the disclosure
      // control (asserted below) toggles anything.
      fireEvent.click(screen.getByText(course.displayName));
      expect(screen.queryByText(outlineSectionHeading)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(expandButton);
      const collapseButton = screen.getByRole('button', { name: 'Collapse' });
      expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
      // Expanding now mounts the real CourseOutlineSubtree, which fires a real
      // outline request - wait for it to resolve and render.
      expect(await screen.findByText(outlineSectionHeading)).toBeInTheDocument();

      fireEvent.click(collapseButton);
      expect(screen.getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText(outlineSectionHeading)).not.toBeInTheDocument();
    });
  });
});
