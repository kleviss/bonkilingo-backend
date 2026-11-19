// =====================================================
// OpenAI models and fallback
// =====================================================
//
// OpenAI retires models over time. This file is the one place to change when
// that happens: which models a client may ask for, which one is used by
// default, and which are tried when a model stops answering.

import OpenAI from "openai";

// Models a client may ask for. App builds already installed on people's phones
// keep sending the model name they shipped with; a request naming anything
// else gets the default instead of an error.
export const SUPPORTED_MODELS = ["gpt-6-luna", "gpt-6.1-terra"];

// The model used when a request names none.
export const DEFAULT_MODEL = "gpt-6-luna";

// Tried in this order when the requested model and the default can't answer.
// gpt-4o-mini is what the API ran on until November 2026. OpenAI shuts it down
// on Jan 14, 2027; it stays last as a known-good safety net until then and can
// be removed afterwards.
export const BACKUP_MODELS = ["gpt-6.1-terra", "gpt-4o-mini"];

export function resolveModel(model) {
  return SUPPORTED_MODELS.includes(model) ? model : DEFAULT_MODEL;
}

export function isOpenAIConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

let client;

// The client is created on first use rather than at startup, so a deployment
// without the key still starts and the request fails with a message that says
// what to set.
function getOpenAI() {
  if (!isOpenAIConfigured()) {
    throw new Error("OPENAI_API_KEY is not set. Add it to the deployment's environment variables and redeploy.");
  }
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

// gpt-4o-mini predates reasoning models: it takes a temperature and rejects a
// reasoning effort. The GPT-6 models are the other way round.
const TAKES_TEMPERATURE = new Set(["gpt-4o-mini"]);

function optionsFor(model, temperature) {
  if (TAKES_TEMPERATURE.has(model)) return { temperature };
  // The GPT-6 models reason before answering unless told not to, which these
  // short tasks don't need.
  return { reasoning_effort: "none" };
}

// A wrong key or an exhausted quota fails the same way on every model, so
// there is no point trying another one.
function wouldFailOnAnyModel(error) {
  return error instanceof OpenAI.APIError && (error.status === 401 || error.code === "insufficient_quota");
}

/**
 * Asks the requested model and, if it can't answer, the default and then the
 * backups in order.
 * @returns {Promise<{text: string, model: string}>} the answer and the model that gave it
 */
export async function completeChat({ model, messages, temperature }) {
  const openai = getOpenAI();
  const candidates = [...new Set([model, DEFAULT_MODEL, ...BACKUP_MODELS])];

  // If every model fails, report why the first one did: that is the one that
  // was asked for.
  let firstError;
  for (const candidate of candidates) {
    try {
      const completion = await openai.chat.completions.create({
        model: candidate,
        messages,
        ...optionsFor(candidate, temperature),
      });
      return { text: completion.choices[0].message?.content?.trim() ?? "", model: candidate };
    } catch (error) {
      firstError ??= error;
      if (wouldFailOnAnyModel(error)) break;
      console.warn(`OpenAI model ${candidate} could not answer, trying the next one: ${error.message}`);
    }
  }
  throw firstError;
}
