/**
 * Query-form classifier for the reranker gate (`search.reranker.question_form_only`).
 *
 * WHY THIS EXISTS — measured, not assumed. A 2026-08-26 A/B of BGE-reranker-v2-m3
 * over 286 real `query_cache` queries found the reranker's win is **not uniform**:
 * it is concentrated in natural-language questions and reverses on bare keyword
 * queries. Judged blind by two independent models (Gemma 4 26B / vLLM and
 * Qwen3.5-9B / MLX), each row scored twice with sides swapped, decoy-controlled:
 *
 *   natural-question queries   n=58   rerank better 77.6%   p < 0.0001
 *   keyword / phrase queries   n=24   rerank better 33.3%   p = 0.15
 *   interaction (Fisher exact)                              p = 0.00027
 *
 * Mechanism: a cross-encoder scores a (query, document) pair jointly, so it needs
 * query semantics to attend over. A two-word phrase supplies almost none, and the
 * reranker's confidence there is not backed by signal.
 *
 * ⚠ The keyword stratum is n=24 / p=0.15 — DIRECTIONAL, NOT ESTABLISHED. This gate
 * is therefore conservative-by-construction: it withholds reranking where the
 * evidence is weak and applies it only where the evidence is strong. It is NOT a
 * claim that reranking harms keyword search.
 *
 * ⚠ Keep this predicate in lockstep with the one in the eval harness
 * (`~/.claude/bin/m2-exit-gate/realq_consensus.py:is_question`). If they drift,
 * production ships a configuration nothing ever measured.
 */

/**
 * Leading tokens that make a query a natural-language question even without a
 * '?'. Deliberately small and closed: a broad list would sweep in keyword
 * queries that merely start with a common word, and the gate's whole value is
 * that it errs toward the well-evidenced side.
 */
const QUESTION_LEADS = new Set([
  'what', 'where', 'who', 'how', 'why', 'which', 'when',
  'is', 'are', 'do', 'does', 'should', 'can',
]);

/**
 * True when `query` reads as a natural-language question.
 *
 * Empty / whitespace-only input returns false — an unclassifiable query gets
 * the conservative branch (no rerank) rather than a coin flip.
 */
export function isQuestionForm(query: string): boolean {
  if (typeof query !== 'string') return false;
  const q = query.trim();
  if (q.length === 0) return false;
  if (q.endsWith('?')) return true;
  const first = q.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  return QUESTION_LEADS.has(first);
}
