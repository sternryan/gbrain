import { resolveSearchMode, knobsHash } from '../../src/core/search/mode.ts';
import { isQuestionForm } from '../../src/core/search/question-form.ts';
let fail = 0;
const ck = (n: string, c: boolean, d = '') => { console.log(`  ${c?'ok  ':'FAIL'}  ${n}${c?'':'  '+d}`); if(!c) fail++; };

const base = { mode: 'tokenmax', overrides: {} as any, perCall: {} as any };
const on  = { ...base, overrides: { reranker_enabled: true, reranker_question_form_only: true } };
const off = { ...base, overrides: { reranker_enabled: true, reranker_question_form_only: false } };

const Q = 'What is the litellm gateway port?';
const K = 'quartermint compliance';

ck('gate off: keyword still reranks', resolveSearchMode({...off, query:K}).reranker_enabled === true);
ck('gate off: question still reranks', resolveSearchMode({...off, query:Q}).reranker_enabled === true);
ck('gate on: question reranks',        resolveSearchMode({...on,  query:Q}).reranker_enabled === true);
ck('gate on: keyword does NOT rerank', resolveSearchMode({...on,  query:K}).reranker_enabled === false);

// narrowing only — must never enable a reranker that the mode/config turned off
const offBase = { ...base, overrides: { reranker_enabled: false, reranker_question_form_only: true } };
ck('gate cannot ENABLE a disabled reranker',
   resolveSearchMode({...offBase, query:Q}).reranker_enabled === false);

// un-threaded caller keeps today's behaviour rather than silently losing rerank
ck('no query threaded -> unchanged (fail-safe)',
   resolveSearchMode({...on}).reranker_enabled === true);

// THE ONE THAT MATTERS: cache keys must differ, or a keyword query can be
// served a reranked row written by a question.
const hQ = knobsHash(resolveSearchMode({...on, query:Q}));
const hK = knobsHash(resolveSearchMode({...on, query:K}));
ck('gated question/keyword produce DIFFERENT knobsHash', hQ !== hK, `${hQ} vs ${hK}`);
// and with the gate off they must collapse back to one row (no needless split)
const oQ = knobsHash(resolveSearchMode({...off, query:Q}));
const oK = knobsHash(resolveSearchMode({...off, query:K}));
ck('gate off -> SAME knobsHash (no cache fragmentation)', oQ === oK, `${oQ} vs ${oK}`);

// config parsing
import { loadOverridesFromConfig } from '../../src/core/search/mode.ts';
const parsed = loadOverridesFromConfig({ 'search.reranker.question_form_only': 'true' });
const parsedOff = loadOverridesFromConfig({ 'search.reranker.question_form_only': 'false' });
const parsedAbsent = loadOverridesFromConfig({});
ck('config key parses true', parsed.reranker_question_form_only === true, JSON.stringify(parsed));
ck('config key parses false', parsedOff.reranker_question_form_only === false, JSON.stringify(parsedOff));
ck('absent key stays undefined (falls through to bundle)',
   parsedAbsent.reranker_question_form_only === undefined, JSON.stringify(parsedAbsent));

ck('predicate matches eval harness on the measured strata',
   isQuestionForm('Where should I look for archived projects?') &&
   !isQuestionForm('batch lane for slow local models'));

console.log(fail ? `\n${fail} FAILED` : '\nPASS');
process.exit(fail ? 1 : 0);
