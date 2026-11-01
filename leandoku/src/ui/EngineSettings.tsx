import type { EngineChoice } from '../engine/config';

interface Props {
  choice: EngineChoice['kind'];
  onClose: () => void;
}

export function EngineSettings({ choice, onClose }: Props) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="About the Lean engine" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>About the Lean engine</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {choice === 'native' && <p>This page is using the Lean engine running on this computer.</p>}
        {choice === 'wasm' && (
          <>
            <p>
              Every step is checked by real Lean, compiled to WebAssembly and running inside this page. Nothing you
              write leaves your device.
            </p>
            <p>
              The first visit downloads Lean and its core library (about 30 MB). After that your browser keeps them,
              and Lean starts in a few seconds.
            </p>
          </>
        )}
        {choice === 'none' && (
          <>
            <p>This build of the page has no Lean engine, so proofs here are not checked.</p>
            <p>To play with checking, run it locally from the website repository:</p>
            <pre className="fact-source">
              cd leandoku{'\n'}npm install{'\n'}npm run bridge:build{'\n'}npm run engine:serve &amp;{'\n'}npm run dev
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
