import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { BRIDGE_HTML } from './bridgeHtml';
import type {
  BootStatus,
  ConvertOptions,
  ConvertResult,
  Converter,
  ExportFormat,
  ExportResult,
  PreviewFormat,
} from './types';

/**
 * Converter の最初の実装。
 *
 * 不可視 WebView に pandoc.wasm を載せ、Markdown を渡して結果 JSON を受け取る。
 * WebView が別プロセスなので、変換が RN 側のスレッドを止めない
 * （CLAUDE.md がネイティブ入力を選んだ理由のひとつ）。
 */

interface Pending {
  resolve: (r: any) => void;
  reject: (e: Error) => void;
}

/** U+2028 / U+2029 は環境によっては注入時に壊れるので潰しておく */
const toJsLiteral = (value: unknown): string =>
  JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function usePandocConverter(): {
  element: React.ReactElement;
  converter: Converter;
  status: BootStatus;
} {
  const webRef = useRef<WebView>(null);
  const [status, setStatus] = useState<BootStatus>({ phase: 'idle' });

  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);
  const readyWaiters = useRef<Array<() => void>>([]);
  const isReady = useRef(false);
  /* WebView が再ロードされてもテンプレートが失われないよう控えを持つ */
  const templateB64 = useRef<string | null>(null);

  const injectTemplate = (b64: string | null) => {
    webRef.current?.injectJavaScript(
      'window.__morphoSetTemplate(' + (b64 ? toJsLiteral(b64) : 'null') + '); true;',
    );
  };

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'boot-progress':
        setStatus({ phase: 'loading', loadedBytes: msg.loadedBytes, totalBytes: msg.totalBytes });
        return;
      case 'boot-instantiating':
        setStatus({ phase: 'instantiating' });
        return;
      case 'ready':
        isReady.current = true;
        /* 再ロード後の ready でも預けたテンプレートを復元する */
        if (templateB64.current) injectTemplate(templateB64.current);
        setStatus({ phase: 'ready', bootMs: msg.bootMs, heapMB: msg.heapMB });
        readyWaiters.current.splice(0).forEach((fn) => fn());
        return;
      case 'boot-error':
        setStatus({ phase: 'error', message: msg.message });
        return;
      case 'ok': {
        const p = pending.current.get(msg.id);
        if (p) {
          pending.current.delete(msg.id);
          p.resolve(msg.result as ConvertResult);
        }
        return;
      }
      case 'error': {
        const p = pending.current.get(msg.id);
        if (p) {
          pending.current.delete(msg.id);
          p.reject(new Error(msg.message));
        }
        return;
      }
    }
  }, []);

  const waitForReady = useCallback(
    () =>
      isReady.current
        ? Promise.resolve()
        : new Promise<void>((resolve) => readyWaiters.current.push(resolve)),
    [],
  );

  const converter = useMemo<Converter>(
    () => ({
      name: 'pandoc.wasm 1.1.0',
      async convert(
        markdown: string,
        options: ConvertOptions & { format?: PreviewFormat } = {},
      ): Promise<any> {
        await waitForReady();
        const id = nextId.current++;
        const promise = new Promise<ConvertResult>((resolve, reject) => {
          pending.current.set(id, { resolve, reject });
        });
        const { format = 'slides', ...rest } = options;
        webRef.current?.injectJavaScript(
          'window.__morphoConvert(' + id + ',' + toJsLiteral(markdown) + ',' +
            toJsLiteral(rest) + ',' + toJsLiteral(format) + '); true;',
        );
        return promise;
      },
      async exportFile(
        markdown: string,
        format: ExportFormat,
        options: ConvertOptions = {},
      ): Promise<ExportResult> {
        await waitForReady();
        const id = nextId.current++;
        const promise = new Promise<ExportResult>((resolve, reject) => {
          pending.current.set(id, { resolve, reject });
        });
        webRef.current?.injectJavaScript(
          'window.__morphoExport(' + id + ',' + toJsLiteral(markdown) + ',' + toJsLiteral(options) + ',' + toJsLiteral(format) + '); true;',
        );
        return promise;
      },
      setReferenceDoc(base64: string | null): void {
        templateB64.current = base64;
        if (isReady.current) injectTemplate(base64);
        /* 未起動なら ready 時に復元される */
      },
    }),
    [waitForReady],
  );

  const element = (
    <WebView
      ref={webRef}
      source={{ html: BRIDGE_HTML, baseUrl: 'https://morpho.local/' }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      cacheEnabled
      /* 55.9MB を毎回取り直さないよう、画面外に置いたまま生かしておく。
         display:none だと iOS で実行が止まることがある。
         注意: style は「中の WebView」にしか効かない。外側のコンテナは
         flex:1 で包まれており（WebView.styles.ts）、containerStyle を
         潰さないと画面の半分を取る。v0.1.1 の「下半分にしか出ない」の原因 */
      style={styles.hidden}
      containerStyle={styles.hidden}
      onMessage={onMessage}
      onError={(e) =>
        setStatus({ phase: 'error', message: 'WebView: ' + e.nativeEvent.description })
      }
      onHttpError={(e) =>
        setStatus({ phase: 'error', message: 'WebView HTTP ' + e.nativeEvent.statusCode })
      }
    />
  );

  return { element, converter, status };
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
    // flex:1 の既定を確実に殺す
    flex: 0,
  },
});
