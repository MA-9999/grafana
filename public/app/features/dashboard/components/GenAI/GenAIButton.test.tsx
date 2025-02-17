import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Router } from 'react-router-dom';
import { Observable } from 'rxjs';

import { selectors } from '@grafana/e2e-selectors';
import { locationService } from '@grafana/runtime';

import { GenAIButton, GenAIButtonProps } from './GenAIButton';
import { StreamStatus, useOpenAIStream } from './hooks';
import { EventTrackingSrc } from './tracking';
import { Role } from './utils';

const mockedUseOpenAiStreamState = {
  setMessages: jest.fn(),
  reply: 'I am a robot',
  streamStatus: StreamStatus.IDLE,
  error: null,
  value: null,
};

jest.mock('./hooks', () => ({
  useOpenAIStream: jest.fn(() => mockedUseOpenAiStreamState),
  StreamStatus: {
    IDLE: 'idle',
    GENERATING: 'generating',
  },
}));

describe('GenAIButton', () => {
  const onGenerate = jest.fn();
  const eventTrackingSrc = EventTrackingSrc.unknown;

  function setup(props: GenAIButtonProps = { onGenerate, messages: [], eventTrackingSrc }) {
    return render(
      <Router history={locationService.getHistory()}>
        <GenAIButton text="Auto-generate" {...props} />
      </Router>
    );
  }

  describe('when LLM plugin is not configured', () => {
    beforeAll(() => {
      jest.mocked(useOpenAIStream).mockReturnValue({
        error: undefined,
        streamStatus: StreamStatus.IDLE,
        reply: 'Some completed genereated text',
        setMessages: jest.fn(),
        value: {
          enabled: false,
          stream: new Observable().subscribe(),
        },
      });
    });

    it('should not render anything', async () => {
      setup();

      waitFor(async () => expect(await screen.findByText('Auto-generate')).not.toBeInTheDocument());
    });
  });

  describe('when LLM plugin is properly configured, so it is enabled', () => {
    const setMessagesMock = jest.fn();
    beforeEach(() => {
      jest.mocked(useOpenAIStream).mockReturnValue({
        error: undefined,
        streamStatus: StreamStatus.IDLE,
        reply: 'Some completed genereated text',
        setMessages: setMessagesMock,
        value: {
          enabled: true,
          stream: new Observable().subscribe(),
        },
      });
    });

    it('should render text ', async () => {
      setup();

      waitFor(async () => expect(await screen.findByText('Auto-generate')).toBeInTheDocument());
    });

    it('should enable the button', async () => {
      setup();
      waitFor(async () => expect(await screen.findByRole('button')).toBeEnabled());
    });

    it('should send the configured messages', async () => {
      setup({ onGenerate, messages: [{ content: 'Generate X', role: 'system' as Role }], eventTrackingSrc });
      const generateButton = await screen.findByRole('button');

      // Click the button
      await fireEvent.click(generateButton);
      await waitFor(() => expect(generateButton).toBeEnabled());

      // Wait for the loading state to be resolved
      expect(setMessagesMock).toHaveBeenCalledTimes(1);
      expect(setMessagesMock).toHaveBeenCalledWith([{ content: 'Generate X', role: 'system' as Role }]);
    });

    it('should call the onClick callback', async () => {
      const onGenerate = jest.fn();
      const onClick = jest.fn();
      const messages = [{ content: 'Generate X', role: 'system' as Role }];
      setup({ onGenerate, messages, temperature: 3, onClick, eventTrackingSrc });

      const generateButton = await screen.findByRole('button');
      await fireEvent.click(generateButton);

      await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    });
  });

  describe('when it is generating data', () => {
    beforeEach(() => {
      jest.mocked(useOpenAIStream).mockReturnValue({
        error: undefined,
        streamStatus: StreamStatus.GENERATING,
        reply: 'Some incomplete generated text',
        setMessages: jest.fn(),
        value: {
          enabled: true,
          stream: new Observable().subscribe(),
        },
      });
    });

    it('should render loading text ', async () => {
      setup();

      waitFor(async () => expect(await screen.findByText('Auto-generate')).toBeInTheDocument());
    });

    it('should enable the button', async () => {
      setup();
      waitFor(async () => expect(await screen.findByRole('button')).toBeEnabled());
    });

    it('disables the button while generating', async () => {
      const { getByText, getByRole } = setup();
      const generateButton = getByText('Generating');

      // The loading text should be visible and the button disabled
      expect(generateButton).toBeVisible();
      await waitFor(() => expect(getByRole('button')).toBeDisabled());
    });

    it('should call onGenerate when the text is generating', async () => {
      const onGenerate = jest.fn();
      setup({ onGenerate, messages: [], eventTrackingSrc: eventTrackingSrc });

      await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));

      expect(onGenerate).toHaveBeenCalledWith('Some incomplete generated text');
    });
  });

  describe('when there is an error generating data', () => {
    const setMessagesMock = jest.fn();
    beforeEach(() => {
      jest.mocked(useOpenAIStream).mockReturnValue({
        error: new Error('Something went wrong'),
        streamStatus: StreamStatus.IDLE,
        reply: '',
        setMessages: setMessagesMock,
        value: {
          enabled: true,
          stream: new Observable().subscribe(),
        },
      });
    });

    it('should render error state text', async () => {
      setup();

      waitFor(async () => expect(await screen.findByText('Retry')).toBeInTheDocument());
    });

    it('should enable the button', async () => {
      setup();
      waitFor(async () => expect(await screen.findByRole('button')).toBeEnabled());
    });

    it('should retry when clicking', async () => {
      const onGenerate = jest.fn();
      const messages = [{ content: 'Generate X', role: 'system' as Role }];
      const { getByText } = setup({ onGenerate, messages, temperature: 3, eventTrackingSrc });
      const generateButton = getByText('Retry');

      await fireEvent.click(generateButton);

      expect(setMessagesMock).toHaveBeenCalledTimes(1);
      expect(setMessagesMock).toHaveBeenCalledWith(messages);
    });

    it('should display the error message as tooltip', async () => {
      const { getByRole, getByTestId } = setup();

      // Wait for the check to be completed
      const button = getByRole('button');
      await userEvent.hover(button);

      const tooltip = await waitFor(() => getByTestId(selectors.components.Tooltip.container));
      expect(tooltip).toBeVisible();

      // The tooltip keeps interactive to be able to click the link
      await userEvent.hover(tooltip);
      expect(tooltip).toBeVisible();
      expect(tooltip).toHaveTextContent('Something went wrong');
    });

    it('should call the onClick callback', async () => {
      const onGenerate = jest.fn();
      const onClick = jest.fn();
      const messages = [{ content: 'Generate X', role: 'system' as Role }];
      setup({ onGenerate, messages, temperature: 3, onClick, eventTrackingSrc });

      const generateButton = await screen.findByRole('button');
      await fireEvent.click(generateButton);

      await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
    });
  });
});
