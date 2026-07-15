import { useEffect, useState } from "react";
import { api } from "./api/client.js";

type Word = { idx: number; startS: number; endS: number; text: string };
type TranscriptData = { status: string; model: string; words: Word[] };

const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function Transcript({ videoAssetId }: { videoAssetId: string }) {
  const [data, setData] = useState<TranscriptData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await api.GET("/api/video-assets/{videoAssetId}/transcript", {
        params: { path: { videoAssetId } },
      });
      if (cancelled) return;
      if (error) return setError("Failed to load transcript");
      setData(data as TranscriptData);
    })();
    return () => { cancelled = true; };
  }, [videoAssetId]);

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">Loading transcript…</p>;

  const last = data.words[data.words.length - 1];

  return (
    <>
      <h2>
        Transcript{" "}
        <span className="pill">{data.words.length} words</span>{" "}
        <span className="pill">{data.model}</span>
        {last && <span className="pill">{stamp(last.endS)}</span>}
      </h2>
      <div className="transcript">
        {data.words.map((w) => (
          // title carries the timing — the Editor (KMBO-253) turns these into click-to-delete
          <span key={w.idx} className="w" title={`${w.startS.toFixed(2)}s – ${w.endS.toFixed(2)}s`}>
            {w.text}{" "}
          </span>
        ))}
      </div>
      <p className="muted">Hover a word to see its timing.</p>
    </>
  );
}
