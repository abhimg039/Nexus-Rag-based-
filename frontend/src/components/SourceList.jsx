import { useState } from "react";

import { truncate } from "../lib/format";
import Icon from "./Icon";

/**
 * Retrieved passages.
 *
 * Each card can be expanded to show the passage text. The original UI showed
 * only page number and a similarity score, which meant there was no way to
 * check whether an answer was actually supported by the document.
 */
export default function SourceList({ sources }) {
  const [openId, setOpenId] = useState(null);

  if (!sources?.length) return null;

  return (
    <div className="sources">
      <div className="sources-head">
        <Icon name="layers" size={15} />
        <span>Evidence</span>
        <span className="sources-count">{sources.length}</span>
      </div>

      <ul className="source-list">
        {sources.map((source) => {
          const key = `${source.document_id}-${source.chunk_index}`;
          const isOpen = openId === key;
          const percent = Math.round(Math.max(0, Math.min(1, source.similarity)) * 100);

          return (
            <li className={`source-card ${isOpen ? "is-open" : ""}`} key={key}>
              <button
                type="button"
                className="source-toggle"
                onClick={() => setOpenId(isOpen ? null : key)}
                aria-expanded={isOpen}
              >
                <span className="source-page">p.{source.page}</span>

                <span className="source-preview">
                  {isOpen ? "Hide passage" : truncate(source.text, 90)}
                </span>

                <span className="source-score" title={`Cosine similarity ${source.similarity}`}>
                  <span className="score-bar">
                    <span className="score-fill" style={{ width: `${percent}%` }} />
                  </span>
                  {percent}%
                </span>

                <Icon name="chevron" size={15} className="source-chevron" />
              </button>

              {isOpen && (
                <div className="source-body">
                  <p>{source.text}</p>
                  <div className="source-footnote">
                    Page {source.page} · passage {source.chunk_index}
                    {source.keyword_hits ? ` · ${source.keyword_hits} keyword matches` : ""}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
