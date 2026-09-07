import UploadDropzone from "./UploadDropzone";

/** Shown when no document is selected: the welcome hero plus the upload target. */
export default function EmptyState({ upload, onFile, onBrowse }) {
  return (
    <div className="empty-state">
      <div className="empty-copy">
        <p className="empty-kicker">Private document intelligence</p>
        {/* h2, not h1: the workspace header above already owns the page's only
            h1, and two h1s in one view is a screen-reader trip hazard. */}
        <h2>
          Your documents.
          <br />
          <span className="gradient-text">Understood.</span>
        </h2>
        <p className="empty-lead">
          Ask focused questions and get answers grounded in your own PDFs — retrieved,
          cited, and generated entirely on this machine.
        </p>

        <UploadDropzone upload={upload} onFile={onFile} onBrowse={onBrowse} variant="hero" />

        <ul className="empty-stack">
          <li>PyMuPDF</li>
          <li>BGE embeddings</li>
          <li>pgvector</li>
          <li>Llama 3.2</li>
        </ul>
      </div>

      <div className="empty-visual" aria-hidden="true">
        <div className="orbit orbit-one">
          <span className="orbit-dot" />
        </div>
        <div className="orbit orbit-two">
          <span className="orbit-dot" />
        </div>
        <div className="orbit orbit-three">
          <span className="orbit-dot" />
        </div>
        <div className="core">
          <span className="core-ring ring-one" />
          <span className="core-ring ring-two" />
          <span className="core-center" />
        </div>
        <p className="visual-caption">
          <span>RAG core</span>
          <small>384-dimension semantic space</small>
        </p>
      </div>
    </div>
  );
}
