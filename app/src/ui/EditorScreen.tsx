import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import Constants from 'expo-constants';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LatestOnly } from '../converter/latestOnly';
import { sanitizeForXml, splitFrontMatter } from '../converter/frontMatter';
import { insertBlock } from '../text/blockInsert.ts';
import { COLUMN_SEPARATOR_TEXT } from '../text/columns.ts';
import { findSplitSuspects } from '../preview/slideSync.ts';
import { usePandocConverter } from '../converter/usePandocConverter';
import { WebView } from 'react-native-webview';

import type {
  BootStatus,
  ConvertResult,
  Diagnostic,
  DocResult,
  Paragraph,
  PreviewFormat,
  SlideDecoration,
  SlideOutline,
  SlideResult,
  TextRun,
  WebResult,
} from '../converter/types';
import { slideIndexAtCursor, slideSegments } from '../preview/cursorSlide';
import { getNotes, setNotes } from '../preview/notesEdit.ts';
import {
  locateEditable,
  rebuildBlock,
  type EditableBlock,
} from '../preview/lineBreakEdit.ts';
import {
  createDoc,
  createExternalDoc,
  deleteDoc,
  listDocs,
  loadDoc,
  readExternal,
  readExternalReconnecting,
  saveDoc,
  setDocExternal,
  titleOf,
  writeExternal,
  writeExternalReconnecting,
  type DocMeta,
  type ExternalRef,
} from '../store/documents';
import { errorCodes, isErrorWithCode, pick } from '@react-native-documents/picker';
import { checkForUpdate, type UpdateInfo } from '../store/updateCheck';
import {
  EMPTY_DESIGN,
  deleteDesign,
  loadDesign,
  loadTemplateFile,
  saveTemplateFile,
  deleteTemplateFile,
  newDecorationId,
  saveDesign,
  type DesignData,
} from '../store/designs';
import { makePreset, moveDecoration, type PresetKind } from '../design/presets';
import {
  copyDesignToAllSlides,
  dissolveGroup,
  dragMembersOf,
  makeGroup,
  pruneGroups,
} from '../design/groups';
import { parseDesignFile, serializeDesign } from '../design/designFile';
import { adjustDeck, toExportSizes, type TextSizes } from '../design/textSizes';
import {
  applyAssignments,
  autoAssign,
  b64ToBytes,
  bytesToB64,
  listLayoutNames,
  PANDOC_LAYOUTS,
  type PandocLayout,
} from '../design/template';
import { DecorSheet } from './DecorSheet';
import { DecorEditLayer } from './DecorEditLayer';
import {
  assetUri,
  deleteAssets,
  loadAssetB64,
  referencedImages,
  saveAsset,
} from '../store/assets';
import { sanitizeFileName, shareExport } from '../store/exportShare';
import { DocumentSurface } from './DocumentSurface';
import { DocumentsModal } from './DocumentsModal';
import { ConflictSheet } from './ConflictSheet';
import { ExportMenu, type ExportChoice } from './ExportMenu';
import { BreakEditSheet } from './BreakEditSheet';
import { NotesEditSheet } from './NotesEditSheet';
import { SlideShow } from './SlideShow';
import { SlideSurface } from './SlideSurface';

/** CLAUDE.md 性能設計: デッキ全体の変換は手が止まって 1.5 秒後 */
const IDLE_MS = 1500;
/** 自動保存は手が止まって 1 秒後。フラッシュは文書切替と background 遷移でも走る */
const SAVE_MS = 1000;

const SAMPLE = `---
title: "Morpho"
author: "フテイケイ"
---

# 単一ソース出版

一つの原稿から、スライド・書籍・PDF・Web を刷り分ける。

## 日本語の段落

これは箇条書きではない普通の段落です。**太字**と*斜体*と\`コード\`を含みます。

欧文では *italic* と **bold** がこう出ます。
和文の斜体は iOS の日本語書体に斜体字形が無いため傾きません。

<!-- これは HTML コメント。既定では RawBlock 警告が出ます -->

***

# 二枚目

改行位置を自分で決める行は\\
行末にバックスラッシュを置く。

- 箇条書き
- 入れ子は半角スペース2つ（またはタブ）で字下げする
  - 二階層目
    - 三階層目
- 半角1つでは入れ子にならず、全角スペースだと箇条書き自体が壊れる

1. 番号付き
2. ふたつめ

\`\`\`js
const x = 1;
\`\`\`

::: notes
ここは発表者ノート。スライドには出ない。
プレビューの「ノート」から確認できる。
:::
`;

const NEW_DOC = `# 無題

ここに書き始める。
`;

type SaveState = { kind: 'editing' } | { kind: 'saving' } | { kind: 'saved'; at: number };

const two = (n: number) => String(n).padStart(2, '0');

export default function EditorScreen() {
  const { element, converter, status } = usePandocConverter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // iPad の縦向きは 820〜834pt。900 では縦で二画面にならず、狭い縦積みになる
  const wide = width >= 700;

  const [source, setSource] = useState('');
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

  /* ---------- 文書 ---------- */
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'saved', at: Date.now() });
  const [docsOpen, setDocsOpen] = useState(false);

  const sourceRef = useRef(source);
  sourceRef.current = source;
  const statusRef = useRef(status.phase);
  statusRef.current = status.phase;
  const resultRef = useRef<SlideResult | null>(null);
  resultRef.current = result;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const docsRef = useRef(docs);
  docsRef.current = docs;
  /* 外部ファイルのアクセス切れ警告は文書ごとに一度だけ */
  const extWarnedRef = useRef<Set<string>>(new Set());
  const warnExternalRef = useRef<(id: string) => void>(() => {});
  /* 進行中の保存。外部リフレッシュはこれを待ってから比較する（巻き戻り防止） */
  const savingRef = useRef<Promise<void> | null>(null);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* エディタは非制御（defaultValue）。value= で制御すると、長い原稿では
     キーストロークごとの JS 往復でネイティブに text が再設定され、
     そのたびにスクロールがカーソル位置へ飛ぶ。native 側を真実とし、
     プログラム的に原稿を差し替える時だけ epoch を上げて remount で反映する */
  const editorRef = useRef<TextInput>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const setSourceProgrammatic = useCallback((text: string) => {
    setSource(text);
    setEditorEpoch((e) => e + 1);
  }, []);

  /* デバウンス中でも、書き込み先は必ず「その編集が起きた文書」。
     文書切替の前に必ず flush するので、ref 参照で取り違えは起きない */
  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const id = activeIdRef.current;
    if (!dirtyRef.current || !id) return;
    dirtyRef.current = false;
    setSaveState({ kind: 'saving' });
    const work = (async () => {
      const next = await saveDoc(id, sourceRef.current);
      setDocs(next);
      setSaveState({ kind: 'saved', at: Date.now() });
      /* 外部ファイルと結ばれた文書は元ファイルへも上書きする（open in place）。
         アクセス切れ（完全終了後）は bookmark で自動再接続して書き直す。
         それでも失敗したらアプリ内には保存済みのまま、選び直しを促す */
      const meta = next.find((d) => d.id === id);
      if (meta?.external) {
        const w = await writeExternalReconnecting(id, meta.external, sourceRef.current);
        if (w.docs) setDocs(w.docs);
        if (!w.ok) warnExternalRef.current(id);
      }
    })();
    savingRef.current = work;
    try {
      await work;
    } catch (e) {
      dirtyRef.current = true;
      setSaveState({ kind: 'editing' });
    } finally {
      if (savingRef.current === work) savingRef.current = null;
    }
  }, []);

  const onChangeSource = useCallback(
    (text: string) => {
      /* 直後に flushSave() を呼ぶ経路（画像挿入）があるので、レンダーを待たずに
         ここで ref も進める。レンダー時に同じ値が再代入されるので冪等 */
      sourceRef.current = text;
      setSource(text);
      dirtyRef.current = true;
      setSaveState({ kind: 'editing' });
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushSave(), SAVE_MS);
    },
    [flushSave],
  );

  /* front matter を保ったまま本文だけ差し替える。
     原稿へ書き戻す操作（画像挿入・ノート編集・改行編集）はすべてここを通す */
  const patchBody = useCallback(
    (nextBody: string, nextCursor?: number) => {
      const src = sourceRef.current;
      const { body } = splitFrontMatter(src);
      onChangeSource(src.slice(0, src.length - body.length) + nextBody);
      /* エディタは非制御なので、プログラム的な差し替えは remount で画面へ反映する */
      setEditorEpoch((e) => e + 1);
      /* remount 後の TextInput は選択位置を持たない。挿し込んだ直後だけ戻す
         （handleSelectSlide と同じ作法。focus してから1フレーム置く） */
      if (nextCursor !== undefined) {
        const input = editorRef.current;
        if (input) {
          input.focus();
          requestAnimationFrame(() => editorRef.current?.setSelection(nextCursor, nextCursor));
        }
      }
    },
    [onChangeSource],
  );

  /* ---------- 文書デザインデータ（装飾。三層分離の第3層） ---------- */
  const [design, setDesign] = useState<DesignData>(EMPTY_DESIGN);
  const designRef = useRef(design);
  designRef.current = design;
  useEffect(() => {
    if (!activeId) return;
    /* 前の文書の装飾を非同期ロードの間だけでも見せない・書かせない。
       残したまま編集されると前の文書の装飾ごと新しい文書へ保存されてしまう */
    setDesign(EMPTY_DESIGN);
    let alive = true;
    void loadDesign(activeId).then((d) => {
      if (alive) setDesign(d);
    });
    return () => {
      alive = false;
    };
  }, [activeId]);

  /* 変更のたびに即保存（小さな JSON なのでデバウンス不要）。
     updater 内で副作用を起こすと StrictMode の再実行で保存が二重に走るため、
     next の計算と保存は setState の外で行う */
  const mutateDesign = useCallback((fn: (prev: DesignData) => DesignData) => {
    const next = fn(designRef.current);
    designRef.current = next;
    setDesign(next);
    const id = activeIdRef.current;
    if (id) {
      void saveDesign(id, next).catch((e) =>
        Alert.alert('装飾を保存できませんでした', String(e instanceof Error ? e.message : e)),
      );
    }
  }, []);

  /* ---------- テンプレート（reference-doc）を変換器へ預ける ---------- */
  /* 文書切替・テンプレートの取り込み / 割り当て変更 / 取り外しで更新する。
     バイナリは毎回運ばず、変換器側に 1 度だけ預けて useTemplate で参照する */
  const templateKeyRef = useRef('');
  useEffect(() => {
    const id = activeId;
    const meta = design.template;
    const key = id && meta ? id + '|' + JSON.stringify(meta.assignments) : '';
    if (key === templateKeyRef.current) return;
    templateKeyRef.current = key;
    let alive = true;
    /* 配線盤の連打で毎回 zip を組み直さないよう、少し待ってから預け直す。
       文書切替（テンプレートなし → なし）はキー不変で早期 return 済み */
    const timer = setTimeout(() => void (async () => {
      let wired = false;
      if (id && meta) {
        const b64 = await loadTemplateFile(id);
        if (!alive) return;
        if (b64) {
          try {
            /* 原本は保存したまま、割り当て（英語名への書き換え）を渡す直前に適用 */
            converter.setReferenceDoc(bytesToB64(applyAssignments(b64ToBytes(b64), meta.assignments)));
            wired = true;
          } catch {
            /* 壊れたテンプレートは黙って外す（変換自体は既定で動く） */
          }
        }
      }
      if (!wired) converter.setReferenceDoc(null);
      /* テンプレートの有無・割り当てが変わったのでプレビューを取り直す */
      if (statusRef.current === 'ready') {
        setBusy(true);
        runnerRef.current?.submit({ md: sourceRef.current, format: previewFormatRef.current });
      }
    })(), 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [activeId, design.template, converter]);

  const handlePickTemplate = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'org.openxmlformats.presentationml.presentation',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      const b64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const names = listLayoutNames(b64ToBytes(b64));
      if (!names.length) {
        Alert.alert(
          'レイアウトが見つかりません',
          'この .pptx にはスライドレイアウトが入っていないため、テンプレートとして使えません。',
        );
        return;
      }
      await saveTemplateFile(id, b64);
      const assignments = autoAssign(names);
      mutateDesign((prev) => ({
        ...prev,
        template: { name: asset.name ?? 'テンプレート.pptx', layoutNames: names, assignments },
      }));
      const missing = PANDOC_LAYOUTS.filter((en) => assignments[en] === undefined);
      if (missing.length) {
        Alert.alert(
          'レイアウトの割り当てを確認してください',
          '自動で結べなかった枠があります。装飾シートの「テンプレート」で、' +
            '各枠にどのレイアウトを使うかをタップして選べます（未割り当ての枠は pandoc 既定になります）。',
        );
      }
    } catch (e) {
      Alert.alert(
        'テンプレートを読み込めませんでした',
        String(e instanceof Error ? e.message : e),
      );
    }
  }, [mutateDesign]);

  /* 配線盤: タップで候補（未使用のレイアウト名 → 割り当てない）を順に切り替える */
  const handleCycleLayout = useCallback(
    (en: PandocLayout) => {
      mutateDesign((prev) => {
        const meta = prev.template;
        if (!meta) return prev;
        const used = new Set(
          PANDOC_LAYOUTS.filter((k) => k !== en)
            .map((k) => meta.assignments[k])
            .filter((v): v is string => v !== undefined),
        );
        const candidates = meta.layoutNames.filter((n) => !used.has(n));
        const cur = meta.assignments[en];
        const idx = cur === undefined ? -1 : candidates.indexOf(cur);
        const next = idx + 1 < candidates.length ? candidates[idx + 1] : undefined;
        const assignments = { ...meta.assignments };
        if (next === undefined) delete assignments[en];
        else assignments[en] = next;
        return { ...prev, template: { ...meta, assignments } };
      });
    },
    [mutateDesign],
  );

  const handleRemoveTemplate = useCallback(() => {
    const id = activeIdRef.current;
    Alert.alert('テンプレートを外す', '既定のデザインに戻します。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '外す',
        style: 'destructive',
        onPress: () => {
          if (id) void deleteTemplateFile(id);
          mutateDesign((prev) => {
            const next = { ...prev };
            delete next.template;
            return next;
          });
        },
      },
    ]);
  }, [mutateDesign]);

  /* ---------- 画像アセット ---------- */

  const imageUriOf = useCallback(
    (name: string) => (activeIdRef.current ? assetUri(activeIdRef.current, name) : name),
    [],
  );

  /* 原稿が参照する画像を変換器へ預ける。参照の集合が変わったときだけ読み直す。
     キーの記録は預けが成功してから（読込中の打鍵で預けが失われないように）。
     古い実行は完了時点のキー比較で自滅する */
  const assetsKeyRef = useRef('');
  useEffect(() => {
    const id = activeId;
    if (!id) return;
    const refs = referencedImages(source).sort();
    const key = id + '|' + refs.join(',');
    if (key === assetsKeyRef.current) return;
    void (async () => {
      const map: Record<string, string> = {};
      for (const name of refs) {
        const b64 = await loadAssetB64(id, name);
        if (b64) map[name] = b64;
      }
      const nowKey =
        activeIdRef.current + '|' + referencedImages(sourceRef.current).sort().join(',');
      if (nowKey !== key) return; /* 読込中に参照が変わった。最新の実行に任せる */
      converter.setAssets(Object.keys(map).length ? map : null);
      assetsKeyRef.current = key;
      /* 預けの前に走った変換は [画像なし] のまま — 取り直す */
      if (statusRef.current === 'ready') {
        setBusy(true);
        runnerRef.current?.submit({ md: sourceRef.current, format: previewFormatRef.current });
      }
    })();
  }, [activeId, source, converter]);

  const handleInsertImage = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    /* ピッカーを開いている間の差し替えを見張る基準 */
    const baseSource = sourceRef.current;
    const baseCursor = cursorRef.current;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['public.image', 'image/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      const b64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const name = await saveAsset(id, asset.name ?? 'image.png', b64);
      /* ピッカーを開いている間に原稿が差し替わるとカーソル位置は無意味になる
         （外部ファイルの取り込みが AppState 'active' で走る経路がある）。
         改行編集と同じ楽観ロックで中止する。画像は保存済みなので名前を伝える */
      if (activeIdRef.current !== id || sourceRef.current !== baseSource) {
        Alert.alert(
          '画像を挿入できませんでした',
          '選んでいる間に原稿が変わりました。原稿に ![](' + name + ') と書けば使えます',
        );
        return;
      }
      /* 位置決めは純関数へ。フェンス行を割らず、必ず単独の段落として入れる */
      const { body } = splitFrontMatter(baseSource);
      const fmLen = baseSource.length - body.length;
      const r = insertBlock(body, baseCursor - fmLen, '![](' + name + ')');
      patchBody(r.body, fmLen + r.cursor);
      await flushSave();
    } catch (e) {
      Alert.alert('画像を挿入できませんでした', String(e instanceof Error ? e.message : e));
    }
  }, [flushSave, patchBody]);

  /* 段組み（`+++` の列区切り）を入れる。1 行なので位置決めだけ blockInsert に任せる。
     記法そのものは notes/column-input.md。書き手が手で `+++` と打っても同じ */
  const handleInsertColumn = useCallback(() => {
    const src = sourceRef.current;
    const { body } = splitFrontMatter(src);
    const fmLen = src.length - body.length;
    const r = insertBlock(body, cursorRef.current - fmLen, COLUMN_SEPARATOR_TEXT);
    patchBody(r.body, fmLen + r.cursor);
  }, [patchBody]);

  /* ---------- 更新チェック（起動時に1回・失敗は黙って無視） ---------- */
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    let alive = true;
    void checkForUpdate(VERSION).then((u) => {
      if (alive && u) setUpdate(u);
    });
    return () => {
      alive = false;
    };
  }, []);

  /* 起動時: 既存の文書を開く。無ければサンプルで1冊作る */
  useEffect(() => {
    void (async () => {
      const existing = await listDocs();
      if (existing.length === 0) {
        const { id, docs: next } = await createDoc(SAMPLE);
        setDocs(next);
        setActiveId(id);
        setSourceProgrammatic(SAMPLE);
      } else {
        setDocs(existing);
        setActiveId(existing[0].id);
        setSourceProgrammatic((await loadDoc(existing[0].id)) ?? '');
      }
    })();
  }, []);

  /* background/inactive でデバウンス中の編集を取りこぼさない */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') void flushSave();
      // アイドル後の初回変換は遅い（実測 83ms vs 46ms）。復帰時に裏で温める
      if (state === 'active' && status.phase === 'ready') {
        void converter.convert('# warm', {}).catch(() => {});
      }
      /* 外部ファイルは復帰時に最新を取り込む（Obsidian 側の編集を反映） */
      if (state === 'active') void refreshExternalRef.current();
    });
    return () => sub.remove();
  }, [flushSave, converter, status.phase]);

  /* 文書を替えたら前の文書のプレビューを 1.5 秒引きずらない。
     即時に変換を投げ、強調位置とカード座標も破棄する */
  const resetPreviewFor = useCallback(
    (text: string) => {
      setResult(null);
      setWebResult(null);
      setDocResult(null);
      setError(null);
      setCurrentSlide(1);
      cardYs.current.clear();
      webScrollY.current = 0;
      if (statusRef.current === 'ready') {
        setBusy(true);
        runnerRef.current?.submit({ md: text, format: previewFormatRef.current });
      }
    },
    [],
  );

  const switchDoc = useCallback(
    async (id: string) => {
      try {
        await flushSave();
        let text = await loadDoc(id);
        if (text === null) return;
        /* 外部ファイルと結ばれた文書は元ファイルの最新を読む（Obsidian 等での
           編集を取り込む）。アクセス切れなら bookmark で自動再接続を試し、
           それでも読めなければミラーで開いて選び直しを促す */
        const meta = docsRef.current.find((d) => d.id === id);
        if (meta?.external) {
          const got = await readExternalReconnecting(id, meta.external);
          if (got?.docs) setDocs(got.docs);
          const ext = got?.text ?? null;
          if (ext === null) {
            warnExternalRef.current(id);
          } else if (ext !== text) {
            if (deferredConflictRef.current.has(id)) {
              /* 「あとで決める」した競合はミラーのまま開き、選び直しを出す */
              setConflict({
                id,
                ref: got!.ref,
                appText: text,
                fileText: ext,
                openAfter: false,
              });
            } else {
              text = ext;
              setDocs(await saveDoc(id, ext));
            }
          }
        }
        setActiveId(id);
        setSourceProgrammatic(text);
        setSaveState({ kind: 'saved', at: Date.now() });
        resetPreviewFor(text);
        setDocsOpen(false);
      } catch (e) {
        Alert.alert('切り替えられませんでした', String(e instanceof Error ? e.message : e));
      }
    },
    [flushSave, resetPreviewFor],
  );

  const handleCreate = useCallback(async () => {
    try {
      await flushSave();
      const { id, docs: next } = await createDoc(NEW_DOC);
      setDocs(next);
      setActiveId(id);
      setSourceProgrammatic(NEW_DOC);
      setSaveState({ kind: 'saved', at: Date.now() });
      resetPreviewFor(NEW_DOC);
      setDocsOpen(false);
    } catch (e) {
      Alert.alert('作成できませんでした', String(e instanceof Error ? e.message : e));
    }
  }, [flushSave, resetPreviewFor]);

  const handleImport = useCallback(async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['text/markdown', 'text/plain'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const text = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      await flushSave();
      const { id, docs: next } = await createDoc(text);
      setDocs(next);
      setActiveId(id);
      setSourceProgrammatic(text);
      setSaveState({ kind: 'saved', at: Date.now() });
      resetPreviewFor(text);
      setDocsOpen(false);
    } catch (e) {
      Alert.alert('読み込めませんでした', String(e instanceof Error ? e.message : e));
    }
  }, [flushSave, resetPreviewFor]);

  /* ---------- 外部ファイル（open in place・実験的） ---------- */

  /* 外部ファイルとアプリ内コピーの競合（Diff を見て選ぶ）。
     openAfter = 解決後にその文書を開く（「その場で開く」経由） */
  const [conflict, setConflict] = useState<{
    id: string;
    ref: ExternalRef;
    appText: string;
    fileText: string;
    openAfter: boolean;
  } | null>(null);
  /* 「あとで決める」した文書。解決するまで、切替・復帰時に黙って同期せず
     この画面を出し直す（赤で見せた行を無言で失わない） */
  const deferredConflictRef = useRef<Set<string>>(new Set());
  const resolvingRef = useRef(false);

  const resolveConflict = useCallback(
    async (useFile: boolean) => {
      const c = conflict;
      if (!c || resolvingRef.current) return;
      resolvingRef.current = true;
      setTimeout(() => { resolvingRef.current = false; }, 500);
      deferredConflictRef.current.delete(c.id);
      setConflict(null);
      const chosen = useFile ? c.fileText : c.appText;
      if (useFile) {
        setDocs(await saveDoc(c.id, c.fileText));
      } else {
        try {
          await writeExternal(c.ref, c.appText);
        } catch (e) {
          Alert.alert(
            'ファイルへ書き込めませんでした',
            String(e instanceof Error ? e.message : e),
          );
        }
      }
      if (c.openAfter || c.id === activeIdRef.current) {
        setActiveId(c.id);
        setSourceProgrammatic(chosen);
        setSaveState({ kind: 'saved', at: Date.now() });
        resetPreviewFor(chosen);
      }
    },
    [conflict, resetPreviewFor],
  );

  const EXTERNAL_TYPES = ['public.plain-text', 'public.text', 'net.daringfireball.markdown'];

  const pickExternal = useCallback(async (): Promise<ExternalRef | null> => {
    const [file] = await pick({
      mode: 'open',
      requestLongTermAccess: true,
      type: EXTERNAL_TYPES,
    });
    if (!file?.uri) return null;
    return {
      uri: file.uri,
      fileName: file.name ?? 'external.md',
      ...(file.bookmarkStatus === 'success' ? { bookmark: file.bookmark } : {}),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenExternal = useCallback(async () => {
    try {
      const ref = await pickExternal();
      if (!ref) return;
      /* 現在の編集を書き切ってから読む（同じファイルを選び直したときに
         古い内容へ巻き戻さない） */
      await flushSave();
      const text = await FileSystem.readAsStringAsync(ref.uri);
      const openWith = (docId: string, content: string) => {
        setActiveId(docId);
        setSourceProgrammatic(content);
        setSaveState({ kind: 'saved', at: Date.now() });
        resetPreviewFor(content);
        setDocsOpen(false);
      };
      /* 同じファイルを既に結んでいたら、新規に作らず再接続して開く */
      const existing = docsRef.current.find((d) => d.external?.uri === ref.uri);
      if (!existing) {
        const { id, docs: next } = await createExternalDoc(text, ref);
        setDocs(next);
        openWith(id, text);
        return;
      }
      await setDocExternal(existing.id, ref);
      extWarnedRef.current.delete(existing.id);
      /* 接続が切れていた間のアプリ側の編集がファイルへ書けていない可能性。
         食い違っていたら黙って上書きせず選ばせる */
      const mirror = (await loadDoc(existing.id)) ?? '';
      if (mirror !== text) {
        setDocsOpen(false);
        setConflict({
          id: existing.id,
          ref,
          appText: mirror,
          fileText: text,
          openAfter: true,
        });
        return;
      }
      setDocs(await saveDoc(existing.id, text));
      openWith(existing.id, text);
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return;
      Alert.alert('開けませんでした', String(e instanceof Error ? e.message : e));
    }
  }, [pickExternal, flushSave, resetPreviewFor]);

  /* 再接続。アプリ内とファイルの内容が食い違っていたらユーザーに選ばせる
     （どちらかを黙って上書きしない）。アクティブでない文書にも同じ扱い */
  const handleRelinkExternal = useCallback(
    async (id: string) => {
      try {
        const ref = await pickExternal();
        if (!ref) return;
        await flushSave();
        setDocs(await setDocExternal(id, ref));
        extWarnedRef.current.delete(id);
        const isActive = id === activeIdRef.current;
        const mine = isActive ? sourceRef.current : ((await loadDoc(id)) ?? '');
        const ext = await readExternal(ref);
        const writeMine = () =>
          void writeExternal(ref, mine).catch((e) =>
            Alert.alert(
              'ファイルへ書き込めませんでした',
              String(e instanceof Error ? e.message : e),
            ),
          );
        if (ext === null || ext === mine) {
          if (ext === null) writeMine();
          return;
        }
        setDocsOpen(false);
        setConflict({ id, ref, appText: mine, fileText: ext, openAfter: false });
      } catch (e) {
        if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return;
        Alert.alert('再接続できませんでした', String(e instanceof Error ? e.message : e));
      }
    },
    [pickExternal, flushSave, resetPreviewFor],
  );

  warnExternalRef.current = (id: string) => {
    if (extWarnedRef.current.has(id)) return;
    extWarnedRef.current.add(id);
    Alert.alert(
      '外部ファイルに接続できません',
      '自動での再接続にも失敗しました（ファイルの削除・移動、または iOS がアクセスを拒否）。ファイルを選び直すと再接続できます。それまではアプリ内のコピーで編集でき、内容は失われません。',
      [
        { text: 'このまま編集', style: 'cancel' },
        { text: 'ファイルを選び直す', onPress: () => void handleRelinkExternal(id) },
      ],
    );
  };

  /* フォアグラウンド復帰時、外部ファイルの変更を取り込む（未保存の編集があれば触らない） */
  const refreshExternalRef = useRef<() => Promise<void>>(async () => {});
  refreshExternalRef.current = async () => {
    /* 進行中の保存を待ってから比べる（保存前の内容へ巻き戻さない） */
    if (savingRef.current) await savingRef.current.catch(() => {});
    const id = activeIdRef.current;
    if (!id || dirtyRef.current) return;
    const meta = docsRef.current.find((d) => d.id === id);
    if (!meta?.external) return;
    /* アクセス切れ（完全終了後の復帰など）は bookmark で自動再接続する */
    const got = await readExternalReconnecting(id, meta.external);
    if (got?.docs) setDocs(got.docs);
    /* 待っている間に打鍵があれば触らない（取り込みは次の機会に回す） */
    if (dirtyRef.current) return;
    const ext = got?.text ?? null;
    if (ext === null || ext === sourceRef.current) return;
    if (deferredConflictRef.current.has(id)) {
      setConflict({
        id,
        ref: got!.ref,
        appText: sourceRef.current,
        fileText: ext,
        openAfter: false,
      });
      return;
    }
    setSourceProgrammatic(ext);
    setDocs(await saveDoc(id, ext));
    setSaveState({ kind: 'saved', at: Date.now() });
    resetPreviewFor(ext);
  };

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        /* デバウンス中の自動保存と競合させない。
           消す文書の編集は破棄し、他の文書の編集は先に書き切る */
        if (id === activeIdRef.current) {
          if (saveTimer.current) {
            clearTimeout(saveTimer.current);
            saveTimer.current = null;
          }
          dirtyRef.current = false;
        } else {
          await flushSave();
        }
        const next = await deleteDoc(id);
        await deleteAssets(id);
        await deleteDesign(id);
        setDocs(next);
        if (id === activeIdRef.current) {
          if (next.length > 0) {
            const text = (await loadDoc(next[0].id)) ?? '';
            setActiveId(next[0].id);
            setSourceProgrammatic(text);
            resetPreviewFor(text);
          } else {
            const created = await createDoc(NEW_DOC);
            setDocs(created.docs);
            setActiveId(created.id);
            setSourceProgrammatic(NEW_DOC);
            resetPreviewFor(NEW_DOC);
          }
          setSaveState({ kind: 'saved', at: Date.now() });
        }
      } catch (e) {
        Alert.alert('削除できませんでした', String(e instanceof Error ? e.message : e));
      }
    },
    [flushSave, resetPreviewFor],
  );

  /* ---------- 変換 ---------- */
  const runner = useMemo(
    () =>
      new LatestOnly<{ md: string; format: PreviewFormat }, ConvertResult>(
        (job) => {
          // CLAUDE.md 落とし穴 1: front matter は自前で剥がして metadata で渡す
          // 落とし穴 9: XML 非対応の制御文字は pandoc へ渡す直前に空白へ置換する
          const { metadata, body } = sanitizeForXml(splitFrontMatter(job.md));
          return converter.convert(body, {
            metadata,
            stripHtmlComments: true,
            format: job.format,
            useTemplate: designRef.current.template !== undefined,
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
    [converter],
  );

  /* resetPreviewFor は宣言順の都合で ref 経由に読む */
  const runnerRef = useRef<typeof runner | null>(null);
  runnerRef.current = runner;

  const convTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (status.phase !== 'ready' || activeId === null) return;
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
  }, [source, status.phase, runner, activeId]);

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
    if (statusRef.current === 'ready') {
      setBusy(true);
      runnerRef.current?.submit({ md: sourceRef.current, format: f });
    }
  }, []);

  /* ---------- カーソルとプレビューの同期 ---------- */
  const [currentSlide, setCurrentSlide] = useState(1);
  const cardYs = useRef(new Map<number, number>());
  const previewRef = useRef<ScrollView>(null);
  /* Web プレビューのスクロール位置。再ロード（再変換）後に復元する */
  const webViewRef = useRef<WebView>(null);
  const webScrollY = useRef(0);

  /* 画像挿入の差し込み位置に使う（最後に見たカーソル位置） */
  const cursorRef = useRef(0);

  const onSelectionChange = useCallback(
    (e: { nativeEvent: { selection: { start: number } } }) => {
      // 読むだけ。selection を書き戻すと日本語 IME が壊れる
      const cursor = e.nativeEvent.selection.start;
      cursorRef.current = cursor;
      const src = sourceRef.current;
      const { metadata, body } = splitFrontMatter(src);
      const bodyCursor = cursor - (src.length - body.length);
      const idx = slideIndexAtCursor(body, bodyCursor, metadata.title !== undefined);
      setCurrentSlide(idx);
    },
    [],
  );

  useEffect(() => {
    const clamped = result ? Math.min(currentSlide, result.slideCount) : currentSlide;
    const y = cardYs.current.get(clamped);
    if (y !== undefined) previewRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, [currentSlide, result]);

  /* プレビューのスライドをタップ → 原稿の該当区間の先頭へカーソルを移す。
     読み取り専用の移動なので、スライド数と区間数がずれていても実害はなく
     最寄りの区間へ寄せる（contentIndexOf のような中止はしない） */
  const handleSelectSlide = useCallback((slideIndex: number) => {
    const src = sourceRef.current;
    const { metadata, body } = splitFrontMatter(src);
    const fmOffset = src.length - body.length;
    const titleOffset = metadata.title !== undefined ? 1 : 0;
    const ci = slideIndex - titleOffset;
    let pos = 0; // タイトルスライドは front matter 由来なので先頭へ
    if (ci >= 1) {
      const segments = slideSegments(body);
      const seg = segments[Math.min(ci, segments.length) - 1];
      if (seg) pos = fmOffset + seg.start;
    }
    setCurrentSlide(slideIndex);
    const input = editorRef.current;
    if (!input) return;
    input.focus();
    // focus 直後の setSelection は無視されることがあるので1フレーム置く
    requestAnimationFrame(() => editorRef.current?.setSelection(pos, pos));
  }, []);

  /* ---------- プレビューからの原稿編集（ノート・改行） ---------- */
  const [notesSheet, setNotesSheet] = useState<{ ci: number; text: string } | null>(null);
  const [breakSheet, setBreakSheet] = useState<EditableBlock | null>(null);


  /**
   * プレビューの slide.index → 原稿のコンテンツスライド番号。
   * 表の後ろのスライド分割（CLAUDE.md 落とし穴 5）などで pandoc のスライド数が
   * 原稿の区間数と食い違うと対応が取れないので、その場合は null を返して
   * 呼び出し側で編集を止める（誤った区間への書き込みを防ぐ）。
   */
  const contentIndexOf = useCallback(
    (slideIndex: number): number | null => {
      const { metadata, body } = splitFrontMatter(sourceRef.current);
      const titleOffset = metadata.title !== undefined ? 1 : 0;
      const slideCount = resultRef.current?.slideCount ?? 0;
      const segs = slideSegments(body).length;
      if (slideCount - titleOffset !== segs) {
        /* 犯人の推定は「不足枚数と推定した箇所の数が一致する」ときだけ出す。
           合わないときは別の理由（`##` による slide level 2 など）が混ざっている
           ので、外れた場所へ案内するより汎用の文面のほうが親切 */
        const suspects = findSplitSuspects(body);
        const s =
          suspects.length > 0 && suspects.length === slideCount - titleOffset - segs
            ? suspects[0]
            : undefined;
        const why =
          s !== undefined
            ? `${s.segment} 番目の「${s.heading ?? '見出しなし'}」のスライドで、` +
              `${{ columns: '段組み', table: '表', image: '画像', unknown: '内容' }[s.cause]}` +
              'の前後に別の内容が入っているため、スライドが分かれています。' +
              '区切りたい位置に `***` の行を入れると使えます'
            : 'スライドの分かれ方が原稿の区切りと違います。原稿側で編集してください';
        Alert.alert(
          'ノート・改行の編集は使えません',
          why + '。（装飾・文字サイズ・テンプレートはそのまま使えます）',
          s !== undefined
            ? [
                { text: '閉じる', style: 'cancel' as const },
                {
                  text: 'その場所へ移動',
                  onPress: () => {
                    const pos = sourceRef.current.length - body.length + s.insertAt;
                    editorRef.current?.focus();
                    requestAnimationFrame(() => editorRef.current?.setSelection(pos, pos));
                  },
                },
              ]
            : undefined,
        );
        return null;
      }
      return slideIndex - titleOffset;
    },
    [],
  );

  /**
   * プレビューの slide.index → 装飾・文字サイズ・テンプレートが使う番号。
   *
   * contentIndex は「出力スライド番号 − titleOffset」そのもので、描画
   * （decorBySlide）も注入（applyDecorations）も同じ式で戻す。原稿に書かない層
   * なので原稿の区間数とは無関係 — 表や段組みでスライドが割れても止めない
   * （止めると、原稿と関係のないデザイン操作まで道連れになる）
   */
  const designIndexOf = useCallback(
    (slideIndex: number): number =>
      slideIndex -
      (splitFrontMatter(sourceRef.current).metadata.title !== undefined ? 1 : 0),
    [],
  );

  const handleEditNotes = useCallback(
    (slideIndex: number) => {
      const ci = contentIndexOf(slideIndex);
      if (ci === null) return;
      if (ci < 1) {
        Alert.alert('このスライドのノートは編集できません', 'タイトルスライドは front matter から生成されています');
        return;
      }
      const { body } = splitFrontMatter(sourceRef.current);
      setNotesSheet({ ci, text: getNotes(body, ci) ?? '' });
    },
    [contentIndexOf],
  );

  const handleSaveNotes = useCallback(
    (text: string) => {
      if (!notesSheet) return;
      const { body } = splitFrontMatter(sourceRef.current);
      const next = setNotes(body, notesSheet.ci, text);
      if (next === null) {
        Alert.alert('書き込めませんでした', '対象のスライドが原稿内に見つかりません');
      } else {
        patchBody(next);
      }
      setNotesSheet(null);
    },
    [notesSheet, patchBody],
  );

  const handleParagraphLongPress = useCallback(
    (slideIndex: number, paragraph: Paragraph) => {
      const ci = contentIndexOf(slideIndex);
      if (ci === null) return;
      if (ci < 1) {
        Alert.alert('この段落は編集できません', 'タイトルスライドは front matter から生成されています');
        return;
      }
      /* いちばん長いランを手がかりに、原稿内のブロックを探す */
      const needle = paragraph.runs.reduce((a, b) => (b.text.length > a.length ? b.text : a), '');
      const { body } = splitFrontMatter(sourceRef.current);
      const loc = locateEditable(body, ci, needle);
      if (!loc.ok) {
        if (loc.reason === 'heading') {
          Alert.alert('見出しの改行編集は未対応です');
        } else if (loc.reason === 'table') {
          Alert.alert('表の改行編集は未対応です');
        } else {
          Alert.alert('原稿内で段落を特定できませんでした');
        }
        return;
      }
      if (loc.block.plain.length < 2) {
        Alert.alert('この段落は短すぎて分割できません');
        return;
      }
      setBreakSheet(loc.block);
    },
    [contentIndexOf],
  );

  const handleApplyBreaks = useCallback(
    (offsets: Set<number>) => {
      if (!breakSheet) return;
      const { body } = splitFrontMatter(sourceRef.current);
      /* シートを開いている間に原稿が変わっていたら（ハードウェアキーボード等）
         保存済みオフセットが無効なので適用しない */
      if (body.slice(breakSheet.start, breakSheet.end) !== breakSheet.raw) {
        Alert.alert('適用を中止しました', 'シートを開いている間に原稿が変更されています');
        setBreakSheet(null);
        return;
      }
      const rebuilt = rebuildBlock(breakSheet, offsets);
      patchBody(body.slice(0, breakSheet.start) + rebuilt + body.slice(breakSheet.end));
      setBreakSheet(null);
    },
    [breakSheet, patchBody],
  );

  /* ---------- 装飾（飾る力） ---------- */
  const [decorSheetCi, setDecorSheetCi] = useState<number | null>(null);
  /* パネルとプレビュー上の直接操作で共有する選択状態 */
  const [selectedDecorId, setSelectedDecorId] = useState<string | null>(null);
  /* グループ化のための複数マーク（一時的な UI 状態） */
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set());
  /* 装飾ドラッグ中はプレビューの縦スクロールを止める（実機での競合対策） */
  const [decorDragging, setDecorDragging] = useState(false);

  const handleEditDecor = useCallback(
    (slideIndex: number) => {
      const ci = designIndexOf(slideIndex);
      /* ci=0 = タイトルスライド（表紙）。装飾は原稿に書かないので表紙にも置ける */
      setDecorSheetCi((prev) => {
        if (prev !== ci) {
          setSelectedDecorId(null);
          setMarkedIds(new Set());
        }
        return ci;
      });
    },
    [designIndexOf],
  );

  const handleAddDecor = useCallback(
    (kind: PresetKind) => {
      const ci = decorSheetCi;
      if (ci === null) return;
      const deck = resultRef.current?.deck;
      mutateDesign((prev) => {
        const d = makePreset(kind, ci, newDecorationId(), deck?.w ?? 9144000, deck?.h ?? 5143500);
        if (kind === 'badge') {
          /* 番号バッジは同一スライド内の数字テキストの最大値の続き番号にする
             （どの図形にもテキストを載せられるので、数だけ数えるとずれる） */
          const max = prev.decorations
            .filter((x) => x.contentIndex === ci && x.text != null && /^\d+$/.test(x.text))
            .reduce((m, x) => Math.max(m, Number(x.text)), 0);
          d.text = String(max + 1);
        }
        return { ...prev, decorations: [...prev.decorations, d] };
      });
    },
    [decorSheetCi, mutateDesign],
  );

  const handleUpdateDecor = useCallback(
    (d: SlideDecoration) => {
      mutateDesign((prev) => ({
        ...prev,
        decorations: prev.decorations.map((x) => (x.id === d.id ? d : x)),
      }));
    },
    [mutateDesign],
  );

  const handleRemoveDecor = useCallback(
    (id: string) => {
      mutateDesign((prev) => {
        const decorations = prev.decorations.filter((x) => x.id !== id);
        return { ...prev, decorations, groups: pruneGroups(prev.groups, decorations) };
      });
      /* 消した装飾のマークも忘れる（グループ化ボタンの件数が嘘をつかないように） */
      setMarkedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [mutateDesign],
  );

  /* 直接操作の確定はグループぶんまとめて来る */
  const handleUpdateDecors = useCallback(
    (ds: SlideDecoration[]) => {
      mutateDesign((prev) => ({
        ...prev,
        decorations: prev.decorations.map((x) => ds.find((n) => n.id === x.id) ?? x),
      }));
    },
    [mutateDesign],
  );

  const decorDragMembers = useCallback(
    (id: string) => dragMembersOf(designRef.current.groups, id),
    [],
  );

  const handleToggleMark = useCallback((id: string) => {
    setMarkedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleGroupMarked = useCallback(() => {
    const ids = [...markedIds];
    const next = makeGroup(
      designRef.current.groups,
      designRef.current.decorations,
      ids,
      newDecorationId(),
    );
    if (!next) {
      Alert.alert(
        'グループ化できません',
        '同じスライドの、まだグループに入っていない装飾を2つ以上マークしてください',
      );
      return;
    }
    mutateDesign((prev) => ({ ...prev, groups: next }));
    setMarkedIds(new Set());
  }, [markedIds, mutateDesign]);

  const handleUngroup = useCallback(
    (groupId: string) => {
      mutateDesign((prev) => ({ ...prev, groups: dissolveGroup(prev.groups, groupId) }));
    },
    [mutateDesign],
  );

  const handleDuplicateDecor = useCallback(
    (id: string) => {
      const deck = resultRef.current?.deck;
      const w = deck?.w ?? 9144000;
      const h = deck?.h ?? 5143500;
      mutateDesign((prev) => {
        const src = prev.decorations.find((x) => x.id === id);
        if (!src) return prev;
        /* 元と重ならないよう 2% ずらして複製 */
        const copy: SlideDecoration = {
          ...src,
          id: newDecorationId(),
          x: Math.round(src.x + w / 50),
          y: Math.round(src.y + h / 50),
        };
        return { ...prev, decorations: [...prev.decorations, copy] };
      });
    },
    [mutateDesign],
  );

  const handleReorderDecor = useCallback(
    (id: string, dir: 'back' | 'front') => {
      mutateDesign((prev) => ({
        ...prev,
        decorations: moveDecoration(prev.decorations, id, dir),
      }));
    },
    [mutateDesign],
  );

  const handleCopyDecorToAll = useCallback(() => {
    const ci = decorSheetCi;
    if (ci === null) return;
    /* contentIndex は出力スライド番号の座標系。ただし result は最大 1.5 秒
       遅れる（デバウンス）ので、原稿の区間数と大きいほうを採り、
       範囲外の既存装飾は copyDesignToAllSlides 側が保持する */
    const { metadata, body } = splitFrontMatter(sourceRef.current);
    const total = Math.max(
      (resultRef.current?.slideCount ?? 0) - (metadata.title !== undefined ? 1 : 0),
      slideSegments(body).length,
    );
    Alert.alert(
      '全スライドへコピー',
      `${ci === 0 ? '表紙' : `スライド ${ci}`}の装飾を全 ${total} 枚のコンテンツスライドへコピーします。` +
        '他のスライドの既存の装飾は置き換えられます。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'コピー',
          style: 'destructive',
          onPress: () =>
            mutateDesign((prev) =>
              copyDesignToAllSlides(prev, ci, total, newDecorationId),
            ),
        },
      ],
    );
  }, [decorSheetCi, mutateDesign]);

  /* デザインの .morphodesign 書き出し（文書全体・Git 再現用） */
  const handleExportDesign = useCallback(async () => {
    try {
      const fileName =
        sanitizeFileName(titleOf(sourceRef.current, Date.now())) + '.morphodesign';
      await shareExport(fileName, 'morphodesign', {
        text: serializeDesign(designRef.current),
      });
    } catch (e) {
      Alert.alert('書き出せませんでした', String(e instanceof Error ? e.message : e));
    }
  }, []);

  const handleImportDesign = useCallback(async () => {
    try {
      /* .morphodesign は OS に未登録の拡張子なので型では絞れない */
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.length) return;
      const text = await FileSystem.readAsStringAsync(picked.assets[0].uri);
      const parsed = parseDesignFile(text);
      if (!parsed) {
        Alert.alert(
          '読み込めませんでした',
          'このファイルは .morphodesign（Morpho のデザインデータ）ではないようです',
        );
        return;
      }
      Alert.alert(
        'デザインを読み込む',
        `装飾 ${parsed.decorations.length} 件を読み込みます。` +
          'この文書の現在のデザインは置き換えられます。',
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: '置き換える',
            style: 'destructive',
            onPress: () => {
              /* .morphodesign はテンプレートを持たない（本体が別ファイル）。
                 取り込みでこの文書のテンプレート設定を消さない */
              mutateDesign((prev) =>
                prev.template ? { ...parsed, template: prev.template } : parsed,
              );
              setSelectedDecorId(null);
              setMarkedIds(new Set());
            },
          },
        ],
      );
    } catch (e) {
      Alert.alert('読み込めませんでした', String(e instanceof Error ? e.message : e));
    }
  }, [mutateDesign]);

  /* 文字サイズ設定を反映したプレビュー用デッキ（書き出しは OOXML 側で適用） */
  const previewDeck = useMemo(
    () => (result ? adjustDeck(result.deck, design.text) : null),
    [result, design.text],
  );
  const previewResult = useMemo(
    () => (result && previewDeck ? { ...result, deck: previewDeck } : result),
    [result, previewDeck],
  );

  const handleUpdateTextSizes = useCallback(
    (t: TextSizes | undefined) => {
      mutateDesign((prev) => {
        const next = { ...prev };
        if (t && Object.keys(t).length) next.text = t;
        else delete next.text;
        return next;
      });
    },
    [mutateDesign],
  );

  const titleOffset = useMemo(
    () => (splitFrontMatter(source).metadata.title !== undefined ? 1 : 0),
    [source],
  );

  /* プレビュー用: スライド番号（タイトル込み）→ 装飾の対応表 */
  const decorBySlide = useMemo(() => {
    const map = new Map<number, SlideDecoration[]>();
    for (const d of design.decorations) {
      const idx = d.contentIndex + titleOffset;
      const arr = map.get(idx);
      if (arr) arr.push(d);
      else map.set(idx, [d]);
    }
    return map;
  }, [design, titleOffset]);

  /* 直接操作を有効にするスライド（パネルを開いているスライドのみ） */
  const editingSlideIndex = decorSheetCi === null ? null : decorSheetCi + titleOffset;

  /* ---------- スライドショー ---------- */
  const [showOpen, setShowOpen] = useState(false);
  const [previewW, setPreviewW] = useState(0);

  /* ---------- 書き出し ---------- */
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportChoice | null>(null);

  const handleExport = useCallback(
    async (choice: ExportChoice) => {
      const src = sourceRef.current;
      const fileName = sanitizeFileName(titleOf(src, Date.now())) + '.' + choice;
      setExporting(choice);
      try {
        await flushSave();
        if (choice === 'obsidian') {
          /* Obsidian の公式 URI。vault を省略すると最後に開いた保管庫に入る。
             URL に本文を載せるため長文では失敗し得る。Expo Go でも動く唯一の経路 */
          if (src.length > 20000) {
            throw new Error(
              '本文が長すぎて URI で送れません（約2万字まで）。.md を書き出して Obsidian の保管庫フォルダへ保存してください',
            );
          }
          const name = sanitizeFileName(titleOf(src, Date.now()));
          const uri =
            'obsidian://new?file=' +
            encodeURIComponent(name) +
            '&content=' +
            encodeURIComponent(src);
          try {
            await Linking.openURL(uri);
          } catch {
            throw new Error('Obsidian を開けませんでした。インストールされていますか？');
          }
          setExportOpen(false);
        } else if (choice === 'md') {
          await shareExport(fileName, 'md', { text: src });
        } else {
          /* 落とし穴 9: XML 非対応の制御文字は pandoc へ渡す直前に空白へ置換する */
          const { metadata, body } = sanitizeForXml(splitFrontMatter(src));
          const out = await converter.exportFile(body, choice, {
            metadata,
            stripHtmlComments: true,
            /* 装飾・文字サイズは pptx にだけ焼き込まれる（ブリッジ側で無関係な形式は無視） */
            decorations: design.decorations,
            groups: design.groups,
            textSizes: toExportSizes(
              design.text,
              resultRef.current?.deck?.bodySz ?? [2400, 2100, 1800, 1500, 1500],
            ),
            useTemplate: design.template !== undefined,
          });
          await shareExport(fileName, choice, { base64: out.base64 });
        }
        setExportOpen(false);
      } catch (e) {
        Alert.alert('書き出せませんでした', String(e instanceof Error ? e.message : e));
      } finally {
        setExporting(null);
      }
    },
    [converter, flushSave, design],
  );

  /* ---------- 表示 ---------- */
  const saveLabel =
    saveState.kind === 'editing'
      ? '編集中'
      : saveState.kind === 'saving'
        ? '保存中…'
        : `保存 ${two(new Date(saveState.at).getHours())}:${two(new Date(saveState.at).getMinutes())}`;

  const highlighted = result ? Math.min(currentSlide, result.slideCount) : currentSlide;

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {element}

      <HeaderBar
        status={status}
        busy={busy}
        result={previewFormat === 'web' ? webResult : previewFormat === 'doc' ? docResult : result}
        canPlay={previewFormat === 'slides' && result !== null}
        onOpenDocs={() => setDocsOpen(true)}
        onOpenExport={() => setExportOpen(true)}
        onPlay={() => setShowOpen(true)}
      />

      {update && (
        <View style={styles.updateBar}>
          <Text style={styles.updateText}>
            新しい版 v{update.version} が公開されています（現在 v{VERSION}）
          </Text>
          <Pressable hitSlop={8} onPress={() => void Linking.openURL(update.url)}>
            <Text style={styles.updateLink}>リリースを開く</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setUpdate(null)}>
            <Text style={styles.updateDismiss}>閉じる</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.panes, wide && styles.panesWide]}>
        <View style={[styles.pane, styles.editorPane]}>
          <View style={styles.paneLabelRow}>
            <Text style={styles.paneLabel}>原稿</Text>
            <Pressable hitSlop={8} onPress={() => void handleInsertImage()}>
              <Text style={styles.imageInsert}>画像</Text>
            </Pressable>
            <Pressable hitSlop={8} onPress={handleInsertColumn}>
              <Text style={styles.imageInsert}>段組み</Text>
            </Pressable>
            <Text style={styles.paneMeta}>
              {source.length}字 · {saveLabel}
            </Text>
          </View>
          <TextInput
            ref={editorRef}
            key={editorEpoch}
            defaultValue={source}
            onChangeText={onChangeSource}
            onSelectionChange={onSelectionChange}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            style={styles.editor}
            textAlignVertical="top"
          />
        </View>

        <View
          style={[styles.pane, styles.previewPane, wide && styles.previewPaneWide]}
          onLayout={(e) => setPreviewW(e.nativeEvent.layout.width)}
        >
          <View style={styles.paneLabelRow}>
            <Text style={styles.paneLabel}>
              プレビュー
              {previewFormat === 'slides' && result ? ` · ${result.slideCount} 枚` : ''}
            </Text>
            <View style={styles.formatSeg}>
              {(
                [
                  ['slides', 'スライド'],
                  ['doc', '文書'],
                  ['web', 'Web'],
                ] as Array<[PreviewFormat, string]>
              ).map(([f, label]) => (
                <Pressable
                  key={f}
                  style={[styles.formatBtn, previewFormat === f && styles.formatBtnOn]}
                  onPress={() => handleFormatChange(f)}
                >
                  <Text
                    style={[styles.formatText, previewFormat === f && styles.formatTextOn]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {previewFormat === 'doc' ? (
            <View style={styles.webPane}>
              {error && (
                <View style={[styles.diag, styles.critical]}>
                  <Text style={styles.diagLabel}>変換に失敗しました</Text>
                  <Text style={styles.diagText}>{error}</Text>
                </View>
              )}
              {docResult?.diagnostics.map((d, i) => (
                <DiagnosticRow key={i} diagnostic={d} />
              ))}
              {docResult ? (
                <DocumentSurface result={docResult} imageUriOf={imageUriOf} />
              ) : (
                <View style={styles.webEmpty}>
                  <ActivityIndicator />
                </View>
              )}
            </View>
          ) : previewFormat === 'web' ? (
            <View style={styles.webPane}>
              {error && (
                <View style={[styles.diag, styles.critical]}>
                  <Text style={styles.diagLabel}>変換に失敗しました</Text>
                  <Text style={styles.diagText}>{error}</Text>
                </View>
              )}
              {webResult?.diagnostics.map((d, i) => (
                <DiagnosticRow key={i} diagnostic={d} />
              ))}
              {webResult ? (
                <WebView
                  ref={webViewRef}
                  style={styles.webView}
                  originWhitelist={['*']}
                  source={{ html: webResult.html }}
                  /* 実出力の表示専用。ページ内アンカー（about:blank#fn1 等）は
                     通し、外部リンクだけブロックする */
                  onShouldStartLoadWithRequest={(req) =>
                    req.url.startsWith('about:blank') || req.url.startsWith('data:')
                  }
                  setSupportMultipleWindows={false}
                  /* 再変換のたびに文書ごとロードし直されるので、
                     スクロール位置を覚えてロード後に復元する */
                  onScroll={(e) => {
                    webScrollY.current = e.nativeEvent.contentOffset.y;
                  }}
                  onLoadEnd={() => {
                    if (webScrollY.current > 0) {
                      webViewRef.current?.injectJavaScript(
                        'window.scrollTo(0, ' + Math.round(webScrollY.current) + '); true;',
                      );
                    }
                  }}
                />
              ) : (
                <View style={styles.webEmpty}>
                  <ActivityIndicator />
                </View>
              )}
            </View>
          ) : (
            <ScrollView
              ref={previewRef}
              contentContainerStyle={styles.previewBody}
              /* 装飾ドラッグ中はネイティブスクロールを止める（JS レスポンダの
                 拒否だけでは実機の縦スクロールに勝てない・実機フィードバック） */
              scrollEnabled={!decorDragging}
            >
              {error && (
                <View style={[styles.diag, styles.critical]}>
                  <Text style={styles.diagLabel}>変換に失敗しました</Text>
                  <Text style={styles.diagText}>{error}</Text>
                </View>
              )}
              {result?.diagnostics.map((d, i) => (
                <DiagnosticRow key={i} diagnostic={d} />
              ))}
              {result?.slides.map((s) => (
                <View
                  key={s.index}
                  onLayout={(e) => cardYs.current.set(s.index, e.nativeEvent.layout.y)}
                >
                  <SlideCard
                    imageUriOf={imageUriOf}
                    slide={s}
                    deck={previewDeck ?? result.deck}
                    active={s.index === highlighted}
                    width={Math.max(0, previewW - 40 - 26)}
                    decorations={decorBySlide.get(s.index)}
                    editingDecor={s.index === editingSlideIndex}
                    selectedDecorId={selectedDecorId}
                    dragMembers={decorDragMembers}
                    onSelectDecor={setSelectedDecorId}
                    onCommitDecors={handleUpdateDecors}
                    onDragActive={setDecorDragging}
                    onSelect={handleSelectSlide}
                    onEditNotes={handleEditNotes}
                    onEditDecor={handleEditDecor}
                    onParagraphLongPress={handleParagraphLongPress}
                  />
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>

      <NotesEditSheet
        visible={notesSheet !== null}
        initialText={notesSheet?.text ?? ''}
        onSave={handleSaveNotes}
        onClose={() => setNotesSheet(null)}
      />
      <BreakEditSheet
        visible={breakSheet !== null}
        plain={breakSheet?.plain ?? ''}
        initialOffsets={breakSheet?.breakOffsets ?? new Set()}
        onApply={handleApplyBreaks}
        onClose={() => setBreakSheet(null)}
      />
      <DecorSheet
        visible={decorSheetCi !== null}
        contentIndex={decorSheetCi ?? 1}
        decorations={design.decorations.filter((d) => d.contentIndex === decorSheetCi)}
        deck={previewDeck ?? result?.deck ?? null}
        selectedId={selectedDecorId}
        onSelectItem={setSelectedDecorId}
        markedIds={markedIds}
        onToggleMark={handleToggleMark}
        groups={design.groups.filter((g) => g.contentIndex === decorSheetCi)}
        onGroupMarked={handleGroupMarked}
        onUngroup={handleUngroup}
        onAdd={handleAddDecor}
        onUpdate={handleUpdateDecor}
        onRemove={handleRemoveDecor}
        onDuplicate={handleDuplicateDecor}
        onReorder={handleReorderDecor}
        onCopyToAll={handleCopyDecorToAll}
        textSizes={design.text}
        onUpdateTextSizes={handleUpdateTextSizes}
        onExportDesign={handleExportDesign}
        onImportDesign={handleImportDesign}
        template={design.template}
        onPickTemplate={() => void handlePickTemplate()}
        onCycleLayout={handleCycleLayout}
        onRemoveTemplate={handleRemoveTemplate}
        onClose={() => {
          setDecorSheetCi(null);
          setSelectedDecorId(null);
          setMarkedIds(new Set());
          setDecorDragging(false);
        }}
      />
      <SlideShow
        visible={showOpen}
        result={previewResult}
        initialIndex={highlighted}
        decorations={decorBySlide}
        imageUriOf={imageUriOf}
        onClose={() => setShowOpen(false)}
      />
      <ExportMenu
        visible={exportOpen}
        busy={exporting}
        onSelect={(c) => void handleExport(c)}
        onClose={() => setExportOpen(false)}
      />
      <DocumentsModal
        visible={docsOpen}
        docs={docs}
        activeId={activeId}
        onSelect={(id) => void switchDoc(id)}
        onCreate={() => void handleCreate()}
        onImport={() => void handleImport()}
        onOpenExternal={() => void handleOpenExternal()}
        onRelink={(id) => void handleRelinkExternal(id)}
        onDelete={(id) => void handleDelete(id)}
        onClose={() => setDocsOpen(false)}
      />
      <ConflictSheet
        visible={conflict !== null}
        fileName={conflict?.ref.fileName ?? ''}
        appText={conflict?.appText ?? ''}
        fileText={conflict?.fileText ?? ''}
        onUseFile={() => void resolveConflict(true)}
        onUseApp={() => void resolveConflict(false)}
        onClose={() => {
          if (conflict) deferredConflictRef.current.add(conflict.id);
          setConflict(null);
        }}
      />
    </View>
  );
}

const VERSION = Constants.expoConfig?.version ?? '?';

function HeaderBar({
  status,
  busy,
  result,
  canPlay,
  onOpenDocs,
  onOpenExport,
  onPlay,
}: {
  status: BootStatus;
  busy: boolean;
  result: ConvertResult | null;
  /** ▶再生はスライド形式のときだけ */
  canPlay: boolean;
  onOpenDocs: () => void;
  onOpenExport: () => void;
  onPlay: () => void;
}) {
  let text: string;
  switch (status.phase) {
    case 'idle':
      text = '起動中';
      break;
    case 'loading': {
      const mb = (status.loadedBytes / 1048576).toFixed(1);
      const total = status.totalBytes ? ' / ' + (status.totalBytes / 1048576).toFixed(1) : '';
      text = 'pandoc.wasm 取得中 ' + mb + total + ' MB';
      break;
    }
    case 'instantiating':
      text = 'インスタンス化中';
      break;
    case 'ready':
      text = '';
      break;
    case 'error':
      text = '起動に失敗: ' + status.message;
      break;
  }

  return (
    <View style={[styles.header, status.phase === 'error' && styles.headerError]}>
      <Text style={styles.wordmark}>Morpho</Text>
      <Text style={styles.version}>{VERSION}</Text>
      <Text style={styles.statusText} numberOfLines={1}>
        {text}
      </Text>
      {busy && <ActivityIndicator size="small" />}
      {result && !busy && (
        <Text style={styles.statusMetric}>
          {result.ms} ms · {(result.bytes / 1024).toFixed(0)} KB
        </Text>
      )}
      <Pressable
        style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
        disabled={!canPlay}
        onPress={onPlay}
      >
        <Text style={[styles.headerBtnText, !canPlay && styles.headerBtnDisabled]}>▶ 再生</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
        onPress={onOpenDocs}
      >
        <Text style={styles.headerBtnText}>書類</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.headerBtn,
          styles.headerBtnPrimary,
          pressed && styles.headerBtnPressed,
        ]}
        disabled={status.phase !== 'ready'}
        onPress={onOpenExport}
      >
        <Text style={[styles.headerBtnText, styles.headerBtnPrimaryText]}>書き出し</Text>
      </Pressable>
    </View>
  );
}

function SlideCard({
  slide,
  deck,
  active,
  width,
  decorations,
  imageUriOf,
  editingDecor,
  selectedDecorId,
  dragMembers,
  onSelectDecor,
  onCommitDecors,
  onDragActive,
  onSelect,
  onEditNotes,
  onEditDecor,
  onParagraphLongPress,
}: {
  slide: SlideOutline;
  deck: SlideResult['deck'];
  active: boolean;
  width: number;
  decorations?: SlideDecoration[];
  imageUriOf?: (name: string) => string;
  /** 装飾パネルを開いているスライド。直接操作レイヤーを重ねる */
  editingDecor: boolean;
  selectedDecorId: string | null;
  dragMembers: (id: string) => string[];
  onSelectDecor: (id: string | null) => void;
  onCommitDecors: (ds: SlideDecoration[]) => void;
  /** ドラッグ中は親がプレビューのスクロールを止める */
  onDragActive: (active: boolean) => void;
  onSelect: (slideIndex: number) => void;
  onEditNotes: (slideIndex: number) => void;
  onEditDecor: (slideIndex: number) => void;
  onParagraphLongPress: (slideIndex: number, paragraph: Paragraph) => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const hasNotes = slide.notes.length > 0;

  /* 直接操作のドラッグ中の一時値。SlideSurface 側の描画を差し替えて
     「本文の背面のまま」動かす（z 順が書き出しと一致し続ける） */
  const [liveDecors, setLiveDecors] = useState<SlideDecoration[] | null>(null);
  useEffect(() => {
    if (!editingDecor) {
      setLiveDecors(null);
      /* ドラッグ中に編集対象が切り替わった場合もスクロールロックを必ず解く */
      onDragActive(false);
    }
  }, [editingDecor, onDragActive]);
  /* カードごとアンマウントされた場合（再変換でスライド構成が変わる等）も解く */
  useEffect(() => () => onDragActive(false), [onDragActive]);
  const handleLive = (ds: SlideDecoration[] | null) => {
    setLiveDecors(ds);
    onDragActive(ds !== null);
  };
  const shownDecorations =
    editingDecor && liveDecors
      ? decorations?.map((x) => liveDecors.find((l) => l.id === x.id) ?? x)
      : decorations;
  return (
    <Pressable
      style={[styles.slide, active && styles.slideActive]}
      onPress={() => onSelect(slide.index)}
    >
      <View style={styles.slideHead}>
        <Text style={styles.slideNum}>{slide.index}</Text>
        <Text style={styles.slideLayout}>{slide.layout ?? 'レイアウト不明'}</Text>
        <View style={styles.slideHeadSpace} />
        <Pressable hitSlop={8} onPress={() => onEditDecor(slide.index)}>
          <Text style={styles.notesToggle}>
            装飾{decorations?.length ? ` ${decorations.length}` : ''}
          </Text>
        </Pressable>
        {hasNotes ? (
          <Pressable hitSlop={8} onPress={() => setNotesOpen((v) => !v)}>
            <Text style={[styles.notesToggle, notesOpen && styles.notesToggleOpen]}>
              ノート {notesOpen ? '▾' : '▸'}
            </Text>
          </Pressable>
        ) : (
          <Pressable hitSlop={8} onPress={() => onEditNotes(slide.index)}>
            <Text style={styles.notesToggle}>ノート追加</Text>
          </Pressable>
        )}
      </View>
      {width > 0 && (
        <View style={styles.surfaceWrap}>
          <View>
            <SlideSurface
              slide={slide}
              deck={deck}
              width={width}
              decorations={shownDecorations}
              imageUriOf={imageUriOf}
              onParagraphPress={() => onSelect(slide.index)}
              onParagraphLongPress={(p) => onParagraphLongPress(slide.index, p)}
            />
            {editingDecor && (
              <DecorEditLayer
                decorations={decorations ?? []}
                deck={deck}
                width={width}
                selectedId={selectedDecorId}
                dragMembers={dragMembers}
                live={liveDecors}
                onSelect={onSelectDecor}
                onLive={handleLive}
                onCommit={onCommitDecors}
              />
            )}
          </View>
        </View>
      )}
      {notesOpen && hasNotes && (
        <View style={styles.notesBox}>
          {slide.notes.map((p, i) => (
            <Text key={i} style={styles.notesText}>
              {p.runs.map((run, ri) => (
                <Text key={ri} style={runStyle(run)}>
                  {run.text}
                </Text>
              ))}
            </Text>
          ))}
          <Pressable hitSlop={8} onPress={() => onEditNotes(slide.index)}>
            <Text style={styles.notesEdit}>編集</Text>
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

function runStyle(run: TextRun): StyleProp<TextStyle> {
  return [
    run.bold && styles.bold,
    run.italic && styles.italic,
    run.underline && styles.underline,
    run.mono && styles.mono,
  ];
}

function DiagnosticRow({ diagnostic }: { diagnostic: Diagnostic }) {
  const tone =
    diagnostic.kind === 'critical'
      ? styles.critical
      : diagnostic.kind === 'design'
        ? styles.design
        : styles.info;
  return (
    <View style={[styles.diag, tone]}>
      <Text style={styles.diagLabel}>
        {diagnostic.label}
        {diagnostic.count > 1 ? ' ×' + diagnostic.count : ''}
      </Text>
      <Text style={styles.diagHint}>{diagnostic.hint}</Text>
      <Text style={styles.diagText} numberOfLines={3}>
        {diagnostic.text}
      </Text>
    </View>
  );
}

const RULE = '#BFC4CD';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E6E8EC' },
  panes: { flex: 1 },
  panesWide: { flexDirection: 'row' },
  pane: { flex: 1 },
  editorPane: { backgroundColor: '#F7F8FA' },
  previewPane: { borderTopWidth: 1, borderTopColor: RULE },
  previewPaneWide: { borderTopWidth: 0, borderLeftWidth: 1, borderLeftColor: RULE },

  paneLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
  },
  paneLabel: { fontSize: 11, letterSpacing: 0.6, color: '#666C78' },
  paneMeta: { fontSize: 11, color: '#666C78', fontVariant: ['tabular-nums'] },
  imageInsert: { fontSize: 11, color: '#1B3FE0' },

  formatSeg: {
    flexDirection: 'row',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#BFC4CD',
    overflow: 'hidden',
  },
  formatBtn: { paddingHorizontal: 12, paddingVertical: 4, backgroundColor: '#FFFFFF' },
  formatBtnOn: { backgroundColor: '#1B3FE0' },
  formatText: { fontSize: 12, color: '#14161B' },
  formatTextOn: { color: '#FFFFFF', fontWeight: '600' },

  updateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: '#E9EDFB',
    borderBottomWidth: 1,
    borderBottomColor: '#BFC4CD',
  },
  updateText: { flex: 1, fontSize: 13, color: '#14161B' },
  updateLink: { fontSize: 13, color: '#1B3FE0', fontWeight: '600' },
  updateDismiss: { fontSize: 13, color: '#666C78' },

  webPane: { flex: 1, paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
  webView: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFC4CD',
    backgroundColor: '#FFFFFF',
  },
  webEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  editor: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
    fontSize: 17,
    lineHeight: 27,
    color: '#14161B',
    fontFamily: 'Menlo',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    backgroundColor: '#F7F8FA',
  },
  headerError: { backgroundColor: '#F6E4E8' },
  wordmark: { fontSize: 16, fontWeight: '700', color: '#14161B', letterSpacing: 0.2 },
  version: { fontSize: 11, color: '#666C78', fontVariant: ['tabular-nums'] },
  statusText: { flex: 1, fontSize: 13, color: '#666C78' },
  statusMetric: { fontSize: 13, color: '#1B3FE0', fontVariant: ['tabular-nums'] },
  headerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RULE,
  },
  headerBtnPrimary: { backgroundColor: '#1B3FE0', borderColor: '#1B3FE0' },
  headerBtnPressed: { opacity: 0.6 },
  headerBtnText: { fontSize: 14, color: '#14161B' },
  headerBtnDisabled: { color: '#BFC4CD' },
  headerBtnPrimaryText: { color: '#FFFFFF', fontWeight: '600' },

  previewBody: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },

  diag: { padding: 12, borderRadius: 8, borderLeftWidth: 4, backgroundColor: '#F7F8FA' },
  critical: { borderLeftColor: '#B01030' },
  design: { borderLeftColor: '#A8730A' },
  info: { borderLeftColor: '#BFC4CD' },
  diagLabel: { fontSize: 13, fontWeight: '600', color: '#14161B' },
  diagHint: { fontSize: 12, color: '#666C78', marginTop: 2 },
  diagText: { fontSize: 11, color: '#666C78', marginTop: 6, fontFamily: 'Menlo' },

  slide: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: RULE,
  },
  slideActive: { borderColor: '#1B3FE0', borderWidth: 2, padding: 15 },
  slideHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  slideNum: { fontSize: 11, color: '#FFFFFF', backgroundColor: '#1B3FE0', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  slideLayout: { fontSize: 11, color: '#666C78' },
  slideEmpty: { fontSize: 12, color: '#666C78', fontStyle: 'italic' },
  slideHeadSpace: { flex: 1 },
  notesToggle: { fontSize: 12, color: '#666C78' },
  notesToggleOpen: { color: '#1B3FE0' },
  notesBox: {
    marginTop: 10,
    paddingTop: 8,
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderRadius: 6,
    backgroundColor: '#FBF6E3',
    borderLeftWidth: 3,
    borderLeftColor: '#A8730A',
  },
  notesText: { fontSize: 13, lineHeight: 20, color: '#5A4A14', marginTop: 2 },
  notesEdit: { fontSize: 12, color: '#1B3FE0', marginTop: 8 },

  surfaceWrap: { borderWidth: 1, borderColor: RULE, borderRadius: 4, alignSelf: 'flex-start' },

  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  mono: { fontFamily: 'Menlo', fontSize: 14, backgroundColor: '#E6E8EC' },
});
