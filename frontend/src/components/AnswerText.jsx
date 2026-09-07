/**
 * Renders an answer with light markup support.
 *
 * Deliberately hand-rolled rather than pulling in a markdown library: it keeps
 * the bundle small, and because it builds React elements instead of setting
 * innerHTML, model output can never inject markup.
 *
 * Supported: paragraphs, bullet and numbered lists, **bold**, `code`, and
 * (page N) citations, which become inline chips.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\((?:see\s+)?pages?\s+[\d,\s-]+\))/gi;

function renderInline(text, keyPrefix) {
  const nodes = [];
  let index = 0;

  for (const piece of String(text).split(INLINE)) {
    if (!piece) continue;
    const key = `${keyPrefix}-${index++}`;

    if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) {
      nodes.push(<strong key={key}>{piece.slice(2, -2)}</strong>);
    } else if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 2) {
      nodes.push(
        <code className="inline-code" key={key}>
          {piece.slice(1, -1)}
        </code>,
      );
    } else if (/^\((?:see\s+)?pages?\s/i.test(piece)) {
      nodes.push(
        <span className="page-chip" key={key}>
          {piece.replace(/^\(|\)$/g, "")}
        </span>,
      );
    } else {
      nodes.push(piece);
    }
  }

  return nodes;
}

const BULLET = /^\s*[-*•‣]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

export default function AnswerText({ text }) {
  const lines = String(text ?? "").split("\n");
  const blocks = [];
  let list = null;

  const flush = () => {
    if (!list) return;
    const Tag = list.type === "ordered" ? "ol" : "ul";
    blocks.push(
      <Tag className="answer-list" key={`list-${blocks.length}`}>
        {list.items.map((item, position) => (
          <li key={position}>{renderInline(item, `li-${blocks.length}-${position}`)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  lines.forEach((line, position) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flush();
      return;
    }

    if (BULLET.test(trimmed)) {
      if (list?.type !== "unordered") flush();
      list = list ?? { type: "unordered", items: [] };
      list.items.push(trimmed.replace(BULLET, ""));
      return;
    }

    if (NUMBERED.test(trimmed)) {
      if (list?.type !== "ordered") flush();
      list = list ?? { type: "ordered", items: [] };
      list.items.push(trimmed.replace(NUMBERED, ""));
      return;
    }

    flush();
    blocks.push(
      <p className="answer-paragraph" key={`p-${position}`}>
        {renderInline(trimmed, `p-${position}`)}
      </p>,
    );
  });

  flush();

  return <>{blocks}</>;
}
