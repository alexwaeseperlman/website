interface Props {
  connected: boolean;
  onClose: () => void;
}

export function EngineSettings({ connected, onClose }: Props) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="About the Lean engine" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>About the Lean engine</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {connected ? (
          <p>This page is using the Lean engine running on this computer.</p>
        ) : (
          <>
            <p>
              Every step in Leandoku is checked by real Lean. Running Lean inside the browser is the next piece of
              work, so on this page you can build proofs but they are not checked yet.
            </p>
            <p>To play with checking today, run it locally from the website repository:</p>
            <pre className="fact-source">
              cd leandoku{'\n'}npm install{'\n'}npm run bridge:build{'\n'}npm run engine:serve &amp;{'\n'}npm run dev
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
