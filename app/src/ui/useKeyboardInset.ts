import { useEffect, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions, type KeyboardEvent } from 'react-native';

import { keyboardOverlap } from './layout';

/**
 * ソフトキーボードが画面の下からどれだけ重なっているか（pt）。
 *
 * KeyboardAvoidingView を使わない理由: 二画面レイアウトの**両方の面**を
 * 同じ高さぶん縮めたいので、ルートの下余白を 1 か所で足すほうが単純で、
 * iPad のフローティング／物理キーボード時の短いバーにも `keyboardOverlap` の
 * 規則 1 つで対応できる（KeyboardAvoidingView は iPad の undocked で暴れる）。
 *
 * iOS は keyboardWillChangeFrame（出る・消える・高さが変わる、のすべて）。
 * Android は Did 系しか信用できないので show / hide を別々に聞く。
 */
export function useKeyboardInset(): number {
  const win = useWindowDimensions();
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const apply = (e: KeyboardEvent) => {
      const f = e.endCoordinates;
      setInset(
        keyboardOverlap(
          { screenY: f.screenY, height: f.height, width: f.width },
          { width: win.width, height: win.height },
        ),
      );
    };
    if (Platform.OS === 'ios') {
      const sub = Keyboard.addListener('keyboardWillChangeFrame', apply);
      return () => sub.remove();
    }
    const show = Keyboard.addListener('keyboardDidShow', apply);
    const hide = Keyboard.addListener('keyboardDidHide', () => setInset(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [win.width, win.height]);
  /* 回転で window の高さが変わった直後は古い矩形を信じない（次のイベントで戻る） */
  return Math.min(inset, win.height);
}
