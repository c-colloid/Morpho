import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LatestOnly } from '../converter/latestOnly';
import { sanitizeForXml, splitFrontMatter } from '../converter/frontMatter';
import type {
  ConvertResult,
  Converter,
  DocResult,
  PreviewFormat,
  SlideResult,
  WebResult,
} from '../converter/types';
import { toDocFooter } from '../design/footer';
import { toExportSizes } from '../design/textSizes';
import type { DesignData } from '../store/designs';
import { compileTheme, resolveTheme } from '../theme/theme';

/** 手が止まってから変換するまで（CLAUDE.md の性能設計。デッキ全体の変換は 1.5 秒後） */
export const IDLE_MS = 1500;

/**
 * プレビューの同期 — 変換の投入・結果の保持・形式の切り替え・再変換の引き金。
 *
 * EditorScreen から切り出したもの（notes/foundation-2026-09.md C）。動作は変えていない。
 * テーマ層（v0.19）が触るのはここ（変換オプションにテーマを渡す・テーマ変更で再変換する）。
 *
 * 決まりごと:
 *   - 変換はアクティブな形式だけ走らせる（ブリッジは単一 FIFO 直列・中断不可。
 *     notes/preview-formats.md）。形式は ref で読む
 *   - キューは「最新だけ残す」（LatestOnly）
 *   - 変換オプションの組み立て（front matter 剥がし・制御文字の浄化・文字サイズ・
 *     デッキ全体フッター）はここに閉じる
 */
export function usePreviewSync(args: {
  converter: Converter;
  /** 変換器が起動済みか（status.phase === 'ready'） */
  ready: boolean;
  activeId: string | null;
  source: string;
  /** 文書デザインデータ。変換オプション（文字サイズ・帯モード・フッター）に使う */
  design: DesignData;
  designRef: React.RefObject<DesignData>;
}) {
  const { converter, ready, activeId, source, design, designRef } = args;

  const [result, setResult] = useState<SlideResult | null>(null);
  const [webResult, setWebResult] = useState<WebResult | null>(null);
  const [docResult, setDocResult] = useState<DocResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* プレビューの形式。変換はアクティブな形式だけを走らせる
     （ブリッジは単一 FIFO 直列・中断不可のため。notes/preview-formats.md） */
  const [previewFormat, setPreviewFormat] = useState<PreviewFormat>('slides');
  const previewFormatRef = useRef(previewFormat);
  previewFormatRef.current = previewFormat;

  const resultRef = useRef<SlideResult | null>(null);
  resultRef.current = result;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const sourceRef = useRef(source);
  sourceRef.current = source;

  /* ---------- 変換 ---------- */
  const runner = useMemo(
    () =>
      new LatestOnly<{ md: string; format: PreviewFormat }, ConvertResult>(
        (job) => {
          // CLAUDE.md 落とし穴 1: front matter は自前で剥がして metadata で渡す
          // 落とし穴 9: XML 非対応の制御文字は pandoc へ渡す直前に空白へ置換する
          const { metadata, body } = sanitizeForXml(splitFrontMatter(job.md));
          const d = designRef.current;
          return converter.convert(body, {
            metadata,
            stripHtmlComments: true,
            format: job.format,
            useTemplate: d.template !== undefined,
            /* 文字サイズ設定。プレビューではマスターを書き換えず（adjustDeck が
               RN 側で重ねる）、表・図と並ぶスライドのタイトルを枠に合わせる
               目標サイズにだけ使う（ブリッジの applyTitleFitZip） */
            textSizes: toExportSizes(
              d.text,
              resultRef.current?.deck?.bodySz ?? [2400, 2100, 1800, 1500, 1500],
            ),
            captionTitle: d.captionTitle,
            /* docx / Web のデッキ全体フッター。pptx は帯をアプリ側で描くので不要 */
            docFooter: toDocFooter(metadata.footer, d.footer),
            /* テーマ（第2層）。配色はこの文書の deck で解決する（初回は pandoc 既定） */
            theme: compileTheme(resolveTheme(d.theme), resultRef.current?.deck?.colors ?? {}),
          });
        },
        (r, e) => {
          setBusy(false);
          if (e) {
            setError(e.message);
          } else if (r) {
            setError(null);
            if (r.kind === 'web') {
              /* HTML が同一なら state を差し替えない。WebView の再ロード
                 （＝スクロール先頭戻り）を無駄に起こさないため */
              setWebResult((prev) => (prev && prev.html === r.html ? prev : r));
            } else if (r.kind === 'doc') {
              setDocResult(r);
            } else {
              setResult(r);
            }
          }
        },
      ),
    [converter, designRef],
  );

  const runnerRef = useRef(runner);
  runnerRef.current = runner;

  /** 今すぐ変換する（テンプレート・画像の預け直し、文書切替、体裁の変更から呼ぶ）。
      変換器が起動前なら何もしない。quiet は busy 表示を出さない（docx / Web の
      フッター変更の経路が従来そうしていた） */
  const refreshPreview = useCallback((md?: string, opts?: { quiet?: boolean }) => {
    if (!readyRef.current) return;
    if (!opts?.quiet) setBusy(true);
    runnerRef.current.submit({ md: md ?? sourceRef.current, format: previewFormatRef.current });
  }, []);

  /** 文書を替えたら前の文書のプレビューを 1.5 秒引きずらない。
      結果を捨てて即時に変換を投げる（カード座標や強調位置の破棄は呼び手側） */
  const resetPreview = useCallback(
    (text: string) => {
      setResult(null);
      setWebResult(null);
      setDocResult(null);
      setError(null);
      refreshPreview(text);
    },
    [refreshPreview],
  );

  const convTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ready || activeId === null) return;
    if (convTimer.current) clearTimeout(convTimer.current);
    convTimer.current = setTimeout(() => {
      setBusy(true);
      /* 形式は ref で読む。切り替え時は handleFormatChange が即時変換するので、
         ここを previewFormat に依存させると同じ入力を二重に変換してしまう */
      runner.submit({ md: source, format: previewFormatRef.current });
    }, IDLE_MS);
    return () => {
      if (convTimer.current) clearTimeout(convTimer.current);
    };
  }, [source, ready, runner, activeId]);

  /* 文字サイズ設定（と表・図と並ぶタイトルの置き方・テーマ）が変わったら再変換する。表・図と並ぶスライド（Content with
     Caption）のタイトルは、ブリッジが設定を目標に枠へ合わせて XML へ焼き込むので
     adjustDeck だけでは追従しない。ほかのタイトルは adjustDeck が即時に反映し、
     こちらは少し遅れて揃う。書類の切り替えは本線の効果が変換するので除く */
  const textSizesKey = JSON.stringify([design.text ?? null, design.captionTitle ?? null, design.theme ?? null]);
  const textSizesSeen = useRef<{ id: string | null; key: string } | null>(null);
  useEffect(() => {
    const prev = textSizesSeen.current;
    textSizesSeen.current = { id: activeId, key: textSizesKey };
    if (!prev || prev.id !== activeId || prev.key === textSizesKey) return;
    if (!readyRef.current || activeId === null) return;
    const t = setTimeout(() => {
      setBusy(true);
      runnerRef.current.submit({ md: sourceRef.current, format: previewFormatRef.current });
    }, 300);
    return () => clearTimeout(t);
  }, [textSizesKey, activeId]);

  /* 形式の切り替え。古い結果は残したまま（切り戻しで即表示）、
     その形式の最新結果をすぐ取りに行く */
  const handleFormatChange = useCallback((f: PreviewFormat) => {
    setPreviewFormat(f);
    previewFormatRef.current = f;
    /* 直前のタイピングで武装済みのデバウンスを解除。放置すると
       同じ入力の変換がもう一度走る（ここで即時変換するため不要） */
    if (convTimer.current) {
      clearTimeout(convTimer.current);
      convTimer.current = null;
    }
    if (readyRef.current) {
      setBusy(true);
      runnerRef.current.submit({ md: sourceRef.current, format: f });
    }
  }, []);

  return {
    result,
    webResult,
    docResult,
    error,
    busy,
    previewFormat,
    previewFormatRef,
    resultRef,
    refreshPreview,
    resetPreview,
    handleFormatChange,
  };
}
