import { useCallback, useState, type RefObject } from 'react';
import { exportToBlob, exportToSvg } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { Button } from '../../shell/ui/primitives.js';

type Tool =
  | 'selection'
  | 'freedraw'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'arrow'
  | 'line'
  | 'text'
  | 'image'
  | 'eraser';

const TOOLS: Array<{ tool: Tool; label: string; glyph: string }> = [
  { tool: 'selection', label: 'Select', glyph: '⌖' },
  { tool: 'freedraw', label: 'Draw', glyph: '✎' },
  { tool: 'rectangle', label: 'Rectangle', glyph: '▭' },
  { tool: 'ellipse', label: 'Ellipse', glyph: '◯' },
  { tool: 'diamond', label: 'Diamond', glyph: '◇' },
  { tool: 'arrow', label: 'Arrow', glyph: '→' },
  { tool: 'line', label: 'Line', glyph: '╱' },
  { tool: 'text', label: 'Text', glyph: 'T' },
  { tool: 'image', label: 'Image', glyph: '▣' },
  { tool: 'eraser', label: 'Eraser', glyph: '⌫' },
];

/**
 * Our toolbar, driving their canvas.
 *
 * Excalidraw's own tool island is hidden in board.css; this replaces it with shell buttons so
 * the board reads as part of the product rather than as somebody else's app embedded in it.
 *
 * What is deliberately NOT replaced is their contextual style island — stroke, fill, width,
 * opacity, layer order. That is UI *of the selected shape* rather than chrome around the app,
 * and reimplementing ten live-preview controls would buy nothing.
 */
export function BoardToolbar({
  apiRef,
  title,
}: {
  apiRef: RefObject<ExcalidrawImperativeAPI | null>;
  title: string;
}) {
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Tool>('selection');

  const choose = useCallback(
    (tool: Tool) => {
      setActive(tool);
      apiRef.current?.setActiveTool({ type: tool });
    },
    [apiRef],
  );

  /**
   * Export the board as a picture.
   *
   * Entirely client-side — the elements are already here, and a server round trip would mean
   * rendering Excalidraw in Node to produce something the browser can draw in one call.
   *
   * The download is an object URL rather than a data URL: a large board as base64 can exceed
   * what some browsers will accept in an href.
   */
  const download = useCallback(
    async (format: 'png' | 'svg') => {
      const editor = apiRef.current;
      if (!editor || busy) return;
      setBusy(true);
      try {
        const elements = editor.getSceneElements();
        const appState = editor.getAppState();
        const files = editor.getFiles();

        const blob =
          format === 'png'
            ? await exportToBlob({
                elements,
                appState: { ...appState, exportBackground: true },
                files,
                mimeType: 'image/png',
                // Legible when someone pastes it into a document, without being enormous.
                exportPadding: 16,
                getDimensions: (w: number, h: number) => ({ width: w * 2, height: h * 2, scale: 2 }),
              })
            : new Blob(
                [
                  (
                    await exportToSvg({
                      elements,
                      appState: { ...appState, exportBackground: true },
                      files,
                      exportPadding: 16,
                    })
                  ).outerHTML,
                ],
                { type: 'image/svg+xml' },
              );

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${title.replace(/[^\w. -]+/g, '_') || 'whiteboard'}.${format}`;
        anchor.click();
        // Revoked on the next tick: revoking synchronously can beat the click in Safari.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } finally {
        setBusy(false);
      }
    },
    [apiRef, busy, title],
  );

  return (
    <div className="wb-toolbar" role="toolbar" aria-label="Drawing tools">
      {TOOLS.map(({ tool, label, glyph }) => (
        <Button
          key={tool}
          variant="ghost"
          size="sm"
          title={label}
          aria-label={label}
          aria-pressed={active === tool}
          className={active === tool ? 'wb-tool wb-tool-on' : 'wb-tool'}
          onClick={() => choose(tool)}
        >
          <span aria-hidden="true">{glyph}</span>
        </Button>
      ))}

      <span className="wb-toolbar-gap" />

      {/*
        * No undo/redo here, and that is not an omission.
        *
        * `ExcalidrawImperativeAPI` exposes `history.clear()` and nothing else — there is no
        * `undo()` to call. The only ways to offer buttons would be to synthesise ⌘Z keyboard
        * events at their canvas or to patch the package, and both are the kind of cleverness
        * that breaks silently on their next release. So Excalidraw's own undo/redo island
        * stays visible in the bottom-left (see board.css), and ⌘Z keeps working.
        */}
      <Button
        variant="ghost"
        size="sm"
        title="Fit to content"
        aria-label="Fit to content"
        onClick={() => apiRef.current?.scrollToContent(undefined, { fitToContent: true })}
      >
        <span aria-hidden="true">⤢</span>
      </Button>

      <span className="wb-toolbar-gap" />

      <Button
        variant="ghost"
        size="sm"
        title="Download as PNG"
        disabled={busy}
        onClick={() => void download('png')}
      >
        PNG
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="Download as SVG"
        disabled={busy}
        onClick={() => void download('svg')}
      >
        SVG
      </Button>
    </div>
  );
}
