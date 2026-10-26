'use strict';

const mockPost = jest.fn();
const mockCreate = jest.fn();

jest.mock('axios', () => ({ post: (...args) => mockPost(...args) }));
jest.mock('openai', () => ({
    OpenAI: jest.fn().mockImplementation(() => ({ chat: { completions: { create: (...args) => mockCreate(...args) } } })),
}));

const LlmClient = require('../src/clients/llm-client');

const ENV_KEYS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'COMPLAINT_MINER_LLM_PROVIDER', 'COMPLAINT_MINER_MODEL'];
let savedEnv;

beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    ENV_KEYS.forEach((k) => delete process.env[k]);
    mockPost.mockReset();
});

afterEach(() => {
    ENV_KEYS.forEach((k) => {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    });
});

describe('complaint-miner llm client', () => {
    test('uses OpenAI by default, even when a Gemini key is also present', () => {
        process.env.OPENAI_API_KEY = 'o';
        process.env.GEMINI_API_KEY = 'g';
        expect(LlmClient.getProvider()).toBe('openai');
        expect(LlmClient.isConfigured()).toBe(true);
    });

    test('falls back to Gemini only when there is no OpenAI key; can be forced either way', () => {
        process.env.GEMINI_API_KEY = 'g';
        expect(LlmClient.getProvider()).toBe('gemini');
        expect(LlmClient.getModel()).toBe('gemini-3.5-flash');
        process.env.COMPLAINT_MINER_LLM_PROVIDER = 'openai';
        expect(LlmClient.getProvider()).toBe('openai');
        expect(LlmClient.isConfigured()).toBe(false);
    });

    test('calls OpenAI chat completions in JSON mode and parses the reply', async () => {
        process.env.OPENAI_API_KEY = 'sk-test';
        process.env.GEMINI_API_KEY = 'g';
        mockCreate.mockResolvedValue({
            choices: [{ message: { content: '{"complaints":[]}' } }],
            usage: { total_tokens: 77 },
        });

        const result = await LlmClient.completeJson({ system: 'sys', user: 'text' });

        expect(result).toEqual({ json: { complaints: [] }, tokens: 77 });
        const [body] = mockCreate.mock.calls[0];
        expect(body.model).toBe(LlmClient.getModel());
        expect(body.response_format).toEqual({ type: 'json_object' });
        expect(body.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'text' }]);
        expect(mockPost).not.toHaveBeenCalled();
    });

    test('calls Gemini in JSON mode with the API key header and parses the reply', async () => {
        process.env.GEMINI_API_KEY = 'secret-key';
        mockPost.mockResolvedValue({
            data: {
                candidates: [{ content: { parts: [{ text: '{"complaints":' }, { text: '[]}' }] } }],
                usageMetadata: { totalTokenCount: 42 },
            },
        });

        const result = await LlmClient.completeJson({ system: 'sys', user: 'text' });

        expect(result).toEqual({ json: { complaints: [] }, tokens: 42 });
        const [url, body, config] = mockPost.mock.calls[0];
        expect(url).toContain('/models/gemini-3.5-flash:generateContent');
        expect(body.generationConfig.responseMimeType).toBe('application/json');
        expect(body.systemInstruction.parts[0].text).toBe('sys');
        expect(config.headers['x-goog-api-key']).toBe('secret-key');
    });

    test('surfaces Gemini API errors without leaking the key', async () => {
        process.env.GEMINI_API_KEY = 'secret-key';
        mockPost.mockRejectedValue({ response: { status: 429, data: { error: { message: 'quota exceeded' } } } });
        await expect(LlmClient.completeJson({ system: 's', user: 'u' })).rejects.toThrow('Gemini request failed (429): quota exceeded');
    });

    test('throws when no key is configured', async () => {
        await expect(LlmClient.completeJson({ system: 's', user: 'u' })).rejects.toThrow(/OPENAI_API_KEY is not set/);
    });

    test('parseJson tolerates fenced output', () => {
        expect(LlmClient.parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
        expect(LlmClient.parseJson('nope')).toBeNull();
    });
});
