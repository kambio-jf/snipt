// Type surface for cutlib.mjs — lets the TypeScript API consume the engine
// directly instead of reimplementing it. Keep in sync with cutlib.mjs.

/** A transcribed word with its timing on the source timeline. */
export interface Word {
  /** index within the word array; reassigned after any transform */
  i: number;
  start: number;
  end: number;
  text: string;
}

/** A [start, end] range in seconds on the source timeline. */
export type Span = [number, number];

/** One entry of the correction dictionary (corrections.json → rules[]). */
export interface CorrectionRule {
  /** phrase to match, case/punctuation-insensitive, across consecutive words */
  from: string;
  /** replacement text; the matched run collapses to a single word */
  to: string;
}

export interface ComputeKeepOptions {
  words: Word[];
  /** the edited script — surviving words, whitespace-separated */
  editedText: string;
  /** source duration in seconds; clamps the final span */
  dur: number;
  /** collapse pauses between kept words longer than this many ms (0 = off) */
  tighten?: number;
  /** also drop bare filler words (um/uh/…) */
  defiller?: boolean;
}

export interface ComputeKeepResult {
  keep: Span[];
  /** how many source words the LCS matched */
  matched: number;
  /** how many words survived (post-defiller) */
  kept: number;
  keptWords?: Word[];
}

/** A word positioned on a timeline, interpolated within its SRT segment. */
export interface TimelineWord {
  text: string;
  start: number;
}

/** Repo root (parent of lib/) — holds models/ and corrections.json. */
export const ROOT: string;
/** Keep-span padding in seconds, so word onsets aren't clipped. */
export const PAD: number;
export const FILLERS: Set<string>;

/** Lowercase, strip everything non-alphanumeric. */
export function norm(s: string): string;
/** Parse an SRT timestamp (HH:MM:SS,mmm) to seconds. */
export function srtSec(s: string): number;
/** Duration of a media file in seconds, via ffprobe. */
export function ffprobeDur(file: string): number;

export interface WhisperOptions {
  /** overrides the corrections.json dictionary; pass [] to skip corrections */
  rules?: CorrectionRule[];
}

export interface WhisperAsyncOptions extends WhisperOptions {
  /** source duration in seconds — required for onProgress to mean anything */
  durationS?: number;
  /** 0..99, driven by ffmpeg's `time=` against durationS */
  onProgress?: (pct: number) => void;
  /** aborting kills the ffmpeg child (job cancel) */
  signal?: AbortSignal;
}

/** Rules from corrections.json, or [] when it's absent. */
export function loadFileCorrections(): CorrectionRule[];

/** Word-level SRT -> words; standalone punctuation merged into the prior word. */
export function parseWordSrt(srtPath: string): Word[];

/**
 * Run word-level Whisper (max_len=1) over a clip, corrections applied.
 * BLOCKS the event loop for the whole inference (minutes) — CLI only.
 * Servers must use runWordWhisperAsync from a worker process.
 */
export function runWordWhisper(clip: string, opts?: WhisperOptions): Word[];

/** Async word-level Whisper for the job worker: non-blocking, reports progress, abortable. */
export function runWordWhisperAsync(clip: string, opts?: WhisperAsyncOptions): Promise<Word[]>;

/** Apply a correction dictionary to a word array. Longest rules win. */
export function applyCorrections(words: Word[], rules: CorrectionRule[]): Word[];

/**
 * LCS-align an edited script against the original words and build keep-spans.
 * Cuts snap to gap midpoints (±PAD) so they land in silence.
 */
export function computeKeep(opts: ComputeKeepOptions): ComputeKeepResult;

/** Build a mapper from a source-timeline time to its time on the cut timeline. */
export function raw2final(keep: Span[]): (raw: number) => number;

/** Word-level timeline from a (proofread) SRT, interpolated within each segment. */
export function srtWordTimeline(srtPath: string): TimelineWord[];

/**
 * Resolve an anchor phrase to its time in a word array. Falls back to shorter
 * prefixes of the phrase; returns 0 for "start" or on no match.
 */
export function anchorTime(words: Word[] | TimelineWord[], anchor: string): number;

/** Subtract ranges (e.g. manual redactions) from a set of keep-spans. */
export function subtractRanges(spans: Span[], cuts: Span[]): Span[];

/** Single-pass select/aselect filtergraph for keep-spans. */
export function cutFilter(keep: Span[]): string;
