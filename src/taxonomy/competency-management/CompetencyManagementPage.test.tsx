import type MockAdapter from 'axios-mock-adapter';

import {
  act,
  fireEvent,
  initializeMocks,
  render as baseRender,
  screen,
  waitFor,
  within,
  type RouteOptions,
} from '@src/testUtils';
import { TaxonomyContext, type TaxonomyContextData } from '../common/context';
import { TaxonomyType } from '../data/constants';
import { apiUrls } from '../data/api';
import { CompetencyManagementPage } from '.';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const taxonomyId = 1;
const newTaxonomyId = 2;

const route: RouteOptions = {
  path: '/taxonomy/:taxonomyId/competencies',
  params: { taxonomyId: `${taxonomyId}` },
};

const taxonomyResponse = {
  id: taxonomyId,
  name: 'Test taxonomy',
  description: 'This is a description',
  taxonomy_type: 'competency',
  read_only: false,
  can_change_taxonomy: true,
  can_delete_taxonomy: true,
};

const listTaxonomiesUrl = 'http://localhost:18010/api/content_tagging/v1/taxonomies/?enabled=true';
const importNewTaxonomyUrl = 'http://localhost:18010/api/content_tagging/v1/taxonomies/import/';

const mockSetAlertError = jest.fn();
const context: TaxonomyContextData = {
  toastMessage: null,
  setToastMessage: jest.fn(),
  alertError: null,
  setAlertError: mockSetAlertError,
};

const render = () =>
  baseRender(<CompetencyManagementPage />, {
    ...route,
    extraWrapper: ({ children }) => <TaxonomyContext.Provider value={context}>{children}</TaxonomyContext.Provider>,
  });

/** Open the import wizard and walk it up to the step where the new taxonomy is described. */
const goToPopulateStep = async () => {
  fireEvent.click(await screen.findByTestId('import-competency-framework-button'));

  expect(await screen.findByTestId('upload-step')).toBeInTheDocument();
  fireEvent.drop(screen.getByTestId('dropzone'), {
    dataTransfer: { files: [new File(['{}'], 'framework.json', { type: 'application/json' })], types: ['Files'] },
  });
  expect(await screen.findByTestId('file-info')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByTestId('populate-step')).toBeInTheDocument();
};

/** Fill in the fields the wizard requires, then import. */
const fillInAndImport = async (name: string) => {
  fireEvent.change(screen.getByLabelText('Taxonomy Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Taxonomy Description'), { target: { value: `${name} description` } });

  const importButton = screen.getByRole('button', { name: 'Import' });
  await waitFor(() => {
    expect(importButton).not.toHaveAttribute('aria-disabled', 'true');
  });
  act(() => {
    fireEvent.click(importButton);
  });
};

describe('<CompetencyManagementPage />', () => {
  let axiosMock: MockAdapter;

  beforeEach(() => {
    ({ axiosMock } = initializeMocks());
    axiosMock.onGet(listTaxonomiesUrl).reply(200, { results: [], canAddTaxonomy: true });
  });

  it('shows the spinner before the query is complete', () => {
    // Use an unresolved promise to keep the Loading visible
    axiosMock.onGet(apiUrls.taxonomy(taxonomyId)).reply(() => new Promise(() => {}));

    const { getByRole } = render();

    expect(getByRole('status').textContent).toEqual('Loading...');
  });

  it('shows the connection error component if no taxonomy is returned', async () => {
    // Use an empty response to trigger the error. Returning an error does not
    // work because the query will retry.
    axiosMock.onGet(apiUrls.taxonomy(taxonomyId)).reply(200);

    const { findByTestId } = render();

    expect(await findByTestId('connectionErrorAlert')).toBeInTheDocument();
  });

  it('shows the taxonomy name as the title, under a breadcrumb back to the list', async () => {
    axiosMock.onGet(apiUrls.taxonomy(taxonomyId)).reply(200, taxonomyResponse);

    const { findByRole, getByRole, queryByRole } = render();

    expect(await findByRole('heading')).toHaveTextContent('Test taxonomy');
    expect(getByRole('link', { name: 'Taxonomies' })).toHaveAttribute('href', '/taxonomies/');
    // The taxonomy name is the breadcrumb's active step, so it is text rather than a link
    expect(queryByRole('link', { name: 'Test taxonomy' })).not.toBeInTheDocument();
  });

  describe('import competency framework button', () => {
    beforeEach(() => {
      axiosMock.onGet(apiUrls.taxonomy(taxonomyId)).reply(200, taxonomyResponse);
    });

    it('is shown to users who may create taxonomies', async () => {
      render();

      expect(await screen.findByRole('button', { name: 'Import Competency Framework' })).toBeInTheDocument();
    });

    it('is hidden from users who may not create taxonomies', async () => {
      axiosMock.onGet(listTaxonomiesUrl).reply(200, { results: [], canAddTaxonomy: false });

      render();

      // Wait for the page itself, so that the button's absence is not just the page still loading.
      expect(await screen.findByRole('heading')).toHaveTextContent('Test taxonomy');
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Import Competency Framework' })).not.toBeInTheDocument();
      });
    });

    it('opens the wizard on the upload step, skipping the export step', async () => {
      render();

      fireEvent.click(await screen.findByTestId('import-competency-framework-button'));

      expect(await screen.findByTestId('upload-step')).toBeInTheDocument();
      expect(screen.queryByTestId('export-step')).not.toBeInTheDocument();
      // Only the reimport flow can step back to the export step.
      expect(screen.queryByTestId('back-button')).not.toBeInTheDocument();
    });

    it('defaults the type of the new taxonomy to Competency, and leaves it editable', async () => {
      render();
      await goToPopulateStep();

      const select = screen.getByTestId('taxonomy-type-select');
      expect(select).toHaveValue(TaxonomyType.Competency);
      expect(within(select).getByRole('option', { name: 'Competency', selected: true })).toBeInTheDocument();
      expect(select).toBeEnabled();
    });

    it('imports a competency taxonomy and goes to its competency management page', async () => {
      render();
      await goToPopulateStep();

      axiosMock.onPost(importNewTaxonomyUrl).replyOnce(200, { id: newTaxonomyId, name: 'New framework' });

      await fillInAndImport('New framework');

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(`/taxonomy/${newTaxonomyId}/competencies`);
      });

      const formData = axiosMock.history.post[0].data;
      expect(formData.get('taxonomy_name')).toEqual('New framework');
      expect(formData.get('taxonomy_type')).toEqual(TaxonomyType.Competency);
    });

    it('closes the wizard and shows a page-level alert if the import fails', async () => {
      render();
      await goToPopulateStep();

      axiosMock.onPost(importNewTaxonomyUrl).replyOnce(400, { error: 'Invalid file' });

      await fillInAndImport('Broken framework');

      await waitFor(() => {
        expect(mockSetAlertError).toHaveBeenCalledWith(expect.objectContaining({ title: 'Import error' }));
      });
      // The wizard offers no retry: it closes, leaving the alert as the only report of the failure.
      expect(screen.queryByTestId('populate-step')).not.toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
