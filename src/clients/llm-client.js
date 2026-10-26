"use strict";

/**
 * JSON-mode LLM client for the analyst agent.
 *
 * Providers:
 *   openai (default) — OpenAI chat completions (JSON mode)
 *   gemini (fallback, only when no OPENAI_API_KEY is set) — Google Generative Language REST API via axios
 * Force one with COMPLAINT_MINER_LLM_PROVIDER=openai|gemini; model via COMPLAINT_MINER_MODEL.
 */

const axios = require("axios");
const { OpenAI } = require("openai");
const { DEFAULTS } = require("../constants");

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
// Gemini "thinking" tokens count against the output budget, so leave generous headroom.
const GEMINI_MAX_OUTPUT_TOKENS = 8192;

let openaiClient = null;

function getProvider() {
    const forced = String(process.env.COMPLAINT_MINER_LLM_PROVIDER || "").trim().toLowerCase();
    if (forced === "gemini" || forced === "openai") return forced;
    if (!process.env.OPENAI_API_KEY && process.env.GEMINI_API_KEY) return "gemini";
    return "openai";
}

function isConfigured() {
    return getProvider() === "gemini" ? Boolean(process.env.GEMINI_API_KEY) : Boolean(process.env.OPENAI_API_KEY);
}

function getModel() {
    return process.env.COMPLAINT_MINER_MODEL || DEFAULTS.llmModels[getProvider()];
}

function parseJson(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (_) {
        // Tolerate a fenced ```json block if the model adds one.
        const match = String(raw).match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch (__) {
            return null;
        }
    }
}

async function completeWithGemini({ system, user }) {
    const res = await axios.post(
        `${GEMINI_URL}/${encodeURIComponent(getModel())}:generateContent`,
        {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0,
                maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
            },
        },
        {
            headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
            timeout: DEFAULTS.llmTimeoutMs,
        }
    ).catch((err) => {
        const status = err.response?.status;
        const detail = err.response?.data?.error?.message || err.message;
        const wrapped = new Error(`Gemini request failed (${status || "network"}): ${detail}`);
        wrapped.status = status;
        throw wrapped;
    });

    const candidate = res.data?.candidates?.[0];
    if (!candidate) {
        const reason = res.data?.promptFeedback?.blockReason || "no candidates";
        throw new Error(`Gemini returned no output (${reason})`);
    }
    const raw = (candidate.content?.parts || []).map((p) => p.text || "").join("");
    return { json: parseJson(raw), tokens: res.data?.usageMetadata?.totalTokenCount || 0 };
}

async function completeWithOpenAI({ system, user, maxTokens }) {
    if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULTS.llmTimeoutMs);
    try {
        const response = await openaiClient.chat.completions.create(
            {
                model: getModel(),
                response_format: { type: "json_object" },
                temperature: 0,
                max_tokens: maxTokens,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
            },
            { signal: controller.signal }
        );
        return {
            json: parseJson(response.choices?.[0]?.message?.content),
            tokens: response.usage?.total_tokens || 0,
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * @returns {Promise<{ json: object|null, tokens: number }>}
 */
async function completeJson({ system, user, maxTokens = 1800 }) {
    if (!isConfigured()) {
        throw new Error(`${getProvider() === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"} is not set`);
    }
    return getProvider() === "gemini"
        ? completeWithGemini({ system, user })
        : completeWithOpenAI({ system, user, maxTokens });
}

module.exports = { isConfigured, getProvider, getModel, completeJson, parseJson };
